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

export class ModelSafetyEvaluator {
	private readonly runtime: ModelRuntime;
	private readonly modelRef?: string;

	constructor(runtime: ModelRuntime, modelRef?: string) {
		this.runtime = runtime;
		this.modelRef = modelRef?.trim() || undefined;
	}

	private resolveModel(): Model<any> | undefined {
		const models = this.runtime.getModels();
		if (models.length === 0) return undefined;
		if (this.modelRef) {
			const slash = this.modelRef.indexOf("/");
			if (slash > 0) {
				const provider = this.modelRef.slice(0, slash);
				const id = this.modelRef.slice(slash + 1);
				const exact = this.runtime.getModel(provider, id);
				if (exact) return exact;
			}
			const byId = models.find((model) => model.id === this.modelRef);
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
			"You are Ziq's security policy evaluator.",
			"You are NOT the executor and you must not invent tools or commands.",
			"Evaluate only whether the already-parsed tool call should be auto-allowed, shown to the user, or blocked.",
			"Never override a policy hard-deny; a hard-deny has already been applied before you are called.",
			"Prefer ASK when uncertain. Only return ALLOW when the requested action is clearly consistent with the user's request and has no material security concern.",
			"Return exactly one tag and no other text:",
			'<ziq-security decision="allow|ask|deny" confidence="0..1">brief reason</ziq-security>',
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
			const match = text.match(
				/<ziq-security\s+decision="(allow|ask|deny)"\s+confidence="(0(?:\.\d+)?|1(?:\.0+)?)">([\s\S]*?)<\/ziq-security>/i,
			);
			if (!match) {
				return { decision: "ask", confidence: 0, reason: "Evaluator returned an invalid decision tag." };
			}
			const confidence = Math.max(0, Math.min(1, Number(match[2])));
			const decision = match[1].toLowerCase() as SecurityDecision;
			const reason = match[3].trim() || "Evaluator did not provide a reason.";
			if (decision === "allow" && confidence < 0.9) {
				return { decision: "ask", confidence, reason: `Low-confidence evaluator ALLOW: ${reason}` };
			}
			if (decision === "deny" && confidence < 0.8) {
				return { decision: "ask", confidence, reason: `Low-confidence evaluator DENY: ${reason}` };
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
