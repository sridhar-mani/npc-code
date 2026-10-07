import type { AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { contentText } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "../model-runtime.ts";

export type SecurityDecision = "allow" | "ask" | "deny";

export interface SecurityEvaluationInput {
	userRequest: string;
	toolName: string;
	command?: string;
	resourcePath?: string;
	workspaceDir: string;
	policyDecision: "allow" | "ask" | "deny";
	policyReason: string;
}

export interface SecurityEvaluationResult {
	decision: SecurityDecision;
	confidence: number;
	reason: string;
}

export interface ModelSafetyEvaluatorOptions {
	readonly modelRef?: string;
	readonly allowThreshold?: number;
	readonly denyThreshold?: number;
	readonly parseResponse?: (text: string) => SecurityEvaluationResult | null;
}

function extractStructuredDecision(text: string): SecurityEvaluationResult | null {
	const trimmed = text.trim();
	let jsonStr = trimmed;
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
	if (fenced) {
		jsonStr = fenced[1].trim();
	} else {
		const firstBrace = trimmed.indexOf("{");
		const lastBrace = trimmed.lastIndexOf("}");
		if (firstBrace !== -1 && lastBrace > firstBrace) {
			jsonStr = trimmed.slice(firstBrace, lastBrace + 1);
		}
	}

	try {
		const parsed = JSON.parse(jsonStr);
		if (parsed && typeof parsed === "object") {
			const rawDecision = String(parsed.decision ?? "")
				.toLowerCase()
				.trim();
			if (rawDecision === "allow" || rawDecision === "ask" || rawDecision === "deny") {
				const numConf = Number(parsed.confidence);
				const confidence = Number.isFinite(numConf) ? Math.max(0, Math.min(1, numConf)) : 0;
				const reason =
					typeof parsed.reason === "string" ? parsed.reason.trim() : "Evaluator provided no explanation.";
				return { decision: rawDecision as SecurityDecision, confidence, reason };
			}
		}
	} catch {}

	return null;
}

export class ModelSafetyEvaluator {
	private readonly runtime: ModelRuntime;
	private readonly options: ModelSafetyEvaluatorOptions;
	private readonly allowThreshold: number;
	private readonly denyThreshold: number;

	constructor(runtime: ModelRuntime, optionsOrModelRef?: string | ModelSafetyEvaluatorOptions) {
		this.runtime = runtime;
		if (typeof optionsOrModelRef === "string") {
			this.options = { modelRef: optionsOrModelRef.trim() || undefined };
		} else {
			this.options = optionsOrModelRef ?? {};
		}

		const envAllow = process.env.NPC_SAFETY_ALLOW_THRESHOLD
			? Number(process.env.NPC_SAFETY_ALLOW_THRESHOLD)
			: undefined;
		const envDeny = process.env.NPC_SAFETY_DENY_THRESHOLD ? Number(process.env.NPC_SAFETY_DENY_THRESHOLD) : undefined;
		this.allowThreshold = this.options.allowThreshold ?? (Number.isFinite(envAllow) ? envAllow! : 0.9);
		this.denyThreshold = this.options.denyThreshold ?? (Number.isFinite(envDeny) ? envDeny! : 0.8);
	}

	private resolveModel(): Model<any> | undefined {
		const models = this.runtime.getModels();
		if (models.length === 0) return undefined;
		const modelRef = this.options.modelRef;
		if (modelRef) {
			const slash = modelRef.indexOf("/");
			if (slash > 0) {
				const provider = modelRef.slice(0, slash);
				const id = modelRef.slice(slash + 1);
				const exact = this.runtime.getModel(provider, id);
				if (exact) return exact;
			}
			const byId = models.find((model) => model.id === modelRef);
			if (byId) return byId;
		}
		return models[0];
	}

	async evaluate(input: SecurityEvaluationInput, signal?: AbortSignal): Promise<SecurityEvaluationResult> {
		const model = this.resolveModel();
		if (!model) {
			return { decision: "ask", confidence: 0, reason: "No evaluator model is configured." };
		}

		const prompt = [
			"You are NPC's security policy evaluator.",
			"You are NOT the executor and you must not invent tools or commands.",
			"Evaluate only whether the already-parsed tool call should be auto-allowed, shown to the user, or blocked.",
			"Never override a policy hard-deny; a hard-deny has already been applied before you are called.",
			"Prefer ASK when uncertain. Only return ALLOW when the requested action is clearly consistent with the user's request and has no material security concern.",
			"Return a valid JSON object matching this schema and no other text:",
			JSON.stringify({
				decision: "allow | ask | deny",
				confidence: 0.95,
				reason: "concise explanation",
			}),
			"",
			JSON.stringify(
				{
					userRequest: input.userRequest,
					toolName: input.toolName,
					command: input.command,
					resourcePath: input.resourcePath,
					workspaceDir: input.workspaceDir,
					policyDecision: input.policyDecision,
					policyReason: input.policyReason,
				},
				null,
				2,
			),
		].join("\n");

		try {
			const context: Context = {
				messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
			};
			const response: AssistantMessage = await this.runtime.completeSimple(model, context, {
				maxTokens: 220,
				reasoning: "off",
				signal,
			} as any);
			const text = contentText(response.content).trim();
			const result = this.options.parseResponse?.(text) ?? extractStructuredDecision(text);

			if (!result) {
				return { decision: "ask", confidence: 0, reason: "Evaluator returned an invalid structured decision." };
			}

			const { decision, confidence, reason } = result;
			if (decision === "allow" && confidence < this.allowThreshold) {
				return {
					decision: "ask",
					confidence,
					reason: `Low-confidence evaluator ALLOW (${confidence.toFixed(2)} < ${this.allowThreshold}): ${reason}`,
				};
			}
			if (decision === "deny" && confidence < this.denyThreshold) {
				return {
					decision: "ask",
					confidence,
					reason: `Low-confidence evaluator DENY (${confidence.toFixed(2)} < ${this.denyThreshold}): ${reason}`,
				};
			}
			return { decision, confidence, reason };
		} catch (error) {
			return {
				decision: "ask",
				confidence: 0,
				reason: `Evaluator unavailable: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}
}
