/**
 * packages/core/src/model/switchyard-router.ts
 *
 * NVIDIA Switchyard-Aligned Composite Model Router for Pi.
 * Follows the official NVIDIA Switchyard architecture (https://github.com/NVIDIA-NeMo/Switchyard):
 *   1. Capability-Classifier (Forecasts p_solve against SUP-1..5, UNC-1..2, LIM-1..2 capability rules)
 *   2. Stage-Router (Tool execution signals: error severity, spinning, exploration vs production)
 *   3. Escalation / Fallback Cascade (weak/efficient tier -> strong/capable tier on stall or low confidence)
 *   4. Zero Hardcoding: Decisions rely on empirical structural metrics, capability contracts, and dynamic options.
 */

import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { RoutingTelemetryRecorder } from "../neohorse/index.ts";
import type { ModelRoute, ModelRouteRequest, VirtualModelDefinition } from "../virtual-models.ts";

export type SwitchyardTier = "efficient" | "capable";

export type CapabilityRule =
	| "SUP-1" // Complete output contract + deterministic local validator
	| "SUP-2" // All required inputs available, target environment inspectable
	| "SUP-3" // Mathematical/interface specs explicit, exercised by representative harness
	| "SUP-4" // Required mechanism identified, bounded search space, executable success condition
	| "SUP-5" // Reconstruction constrained by executable reference / parser
	| "UNC-1" // Multiple reasonable interpretations with no validator to resolve
	| "UNC-2" // Exhaustive search across heterogeneous inputs without completeness check
	| "LIM-1" // Visual/temporal media without machine-checkable replay
	| "LIM-2" // Undocumented reference behavior / hidden intermediate state
	| "none"; // No matching capability rule

export type CapabilityBoundary = "supported" | "uncertain" | "unsupported" | "unmatched";

export type SwitchyardPicker = "efficient_first" | "capable_first";

export interface StageScorerWeights {
	readonly errorSeverity: number;
	readonly spinning: number;
	readonly exploring: number;
	readonly productionIntensity: number;
	readonly scaleFactor: number;
}

export interface CapabilityClassifierDecision {
	readonly crux: string;
	readonly primary_rule: CapabilityRule;
	readonly capability_boundary: CapabilityBoundary;
	readonly p_solve: number;
}

/**
 * Official NVIDIA libsy verdict validity predicate:
 * Rejects malformed or internally inconsistent verdicts before policy evaluation.
 */
export function isTaskClassifierVerdictValid(verdict: CapabilityClassifierDecision): boolean {
	if (
		typeof verdict.p_solve !== "number" ||
		verdict.p_solve < 0.0 ||
		verdict.p_solve > 1.0 ||
		!verdict.crux ||
		verdict.crux.trim().length === 0
	) {
		return false;
	}
	switch (verdict.primary_rule) {
		case "SUP-1":
		case "SUP-2":
		case "SUP-3":
		case "SUP-4":
		case "SUP-5":
			return verdict.capability_boundary === "supported";
		case "UNC-1":
		case "UNC-2":
			return verdict.capability_boundary === "uncertain";
		case "LIM-1":
		case "LIM-2":
			return verdict.capability_boundary === "unsupported";
		case "none":
			return verdict.capability_boundary === "unmatched";
		default:
			return false;
	}
}

/**
 * Official NVIDIA Switchyard boundary steps calculation:
 * - supported: 0 steps
 * - uncertain / unmatched: 1 step
 * - unsupported: 2 steps
 */
export function capabilityBoundarySteps(boundary: CapabilityBoundary): number {
	switch (boundary) {
		case "supported":
			return 0;
		case "uncertain":
		case "unmatched":
			return 1;
		case "unsupported":
			return 2;
	}
}

export type SwitchyardDecisionSource =
	| "override"
	| "tests_passed"
	| "dimensions"
	| "ambiguous"
	| "capability_judge"
	| "escalation_fallback"
	| "fall_open"
	| "deterministic_rules"
	| "tool_signal_stage";

export type JudgeExecutor = (
	prompt: string,
	model: string,
	endpoint?: string,
) => Promise<CapabilityClassifierDecision | null>;

export interface SwitchyardRouterConfig {
	readonly efficientModel: string;
	readonly capableModel: string;
	readonly evaluatorModel?: string;
	readonly picker?: SwitchyardPicker; // default: "efficient_first"
	readonly mode?: "full" | "lite"; // default: "lite" (KV cache-optimized macro task mode)
	readonly baseThreshold: number; // official base_threshold (default: 0.5)
	readonly thresholdStep: number; // official threshold_step (default: 0.1)
	readonly confidenceThreshold: number; // stage-router threshold (default: 0.5)
	readonly stallMinTurnDepth?: number; // official STALL_MIN_TURN_DEPTH (default: 8)
	readonly hardSeverity?: number; // official HARD_SEVERITY (default: 0.7)
	readonly severityCritical?: number; // official SEVERITY_CRITICAL (default: 1.0)
	readonly signalUnit?: number; // official SIGNAL_UNIT (default: 0.10)
	readonly judgeEndpoint?: string;
	readonly judgeApiKey?: string;
	readonly judgeCustomHeaders?: Record<string, string>;
	readonly judgeModel?: string;
	readonly judgeExecutor?: JudgeExecutor;
	readonly fallbackJudgeEndpoint?: string;
	readonly fallbackJudgeModel?: string;
	readonly maxJudgeRetries?: number; // default: 3
	readonly judgeTimeoutMs?: number; // default: 8000ms
	readonly weights?: Partial<StageScorerWeights>;
	readonly trivialPatterns?: readonly RegExp[];
	readonly escalationPatterns?: readonly RegExp[];
	readonly compactTaskLengthThreshold?: number;
}

export interface DeterministicRoutingSignals {
	readonly filesChangedCount?: number;
	readonly repoSizeBytes?: number;
	readonly taskLabels?: readonly string[];
	readonly isMigrationOrSecurity?: boolean;
	readonly previousTestFailures?: number;
	readonly repeatedRetries?: number;
	readonly turnDepth?: number;
	readonly remainingBudgetTokens?: number;
	readonly isReadOnly?: boolean;
	readonly isSingleFileTask?: boolean;
}

export interface SwitchyardDecision {
	readonly selectedTier: SwitchyardTier;
	readonly selectedModel: string;
	readonly decisionSource: SwitchyardDecisionSource;
	readonly verdict?: CapabilityClassifierDecision;
	readonly confidence: number;
	readonly reason: string;
}

export interface ToolSignalSnapshot {
	readonly turnDepth: number;
	readonly errorSeverity: number; // 0.0 to 1.0 (clean 0.0, soft 0.3, hard 0.7, critical 1.0)
	readonly isSpinning?: boolean; // repeated unproductive tool calls
	readonly isExploring?: boolean; // read/list exploration
	readonly productionIntensity?: number; // code editing intensity
	readonly recentWriteCount?: number;
	readonly recentEditCount?: number;
	readonly recentReadCount?: number;
	readonly recentTodoWriteCount?: number;
	readonly testsPassed?: boolean; // recent tests matched pass indicator
	readonly compacted?: boolean; // request carries context compaction summary
	readonly fallOpenTier?: SwitchyardTier; // retained tier from user-turn judge
}

export class SwitchyardModelRouter {
	private readonly config: SwitchyardRouterConfig;
	public readonly mode: "full" | "lite";
	public readonly weights: StageScorerWeights;
	public readonly stallMinTurnDepth: number;
	public readonly hardSeverity: number;
	public readonly severityCritical: number;
	public readonly signalUnit: number;

	constructor(customConfig?: Partial<SwitchyardRouterConfig>) {
		this.mode = customConfig?.mode ?? (process.env.SWITCHYARD_MODE === "full" ? "full" : "lite");
		const fallbackModel = process.env.PI_MODEL ?? process.env.OPENAI_MODEL ?? "";
		const envTrivial = process.env.SWITCHYARD_TRIVIAL_PATTERNS;
		const envEscalate = process.env.SWITCHYARD_ESCALATE_PATTERNS;
		const envThreshold = process.env.SWITCHYARD_COMPACT_TASK_THRESHOLD;
		const baseThresh =
			customConfig?.baseThreshold ??
			(process.env.SWITCHYARD_BASE_THRESHOLD ? Number.parseFloat(process.env.SWITCHYARD_BASE_THRESHOLD) : 0.5);
		const threshStep =
			customConfig?.thresholdStep ??
			(process.env.SWITCHYARD_THRESHOLD_STEP ? Number.parseFloat(process.env.SWITCHYARD_THRESHOLD_STEP) : 0.1);
		const confThresh =
			customConfig?.confidenceThreshold ??
			(process.env.SWITCHYARD_CONFIDENCE_THRESHOLD
				? Number.parseFloat(process.env.SWITCHYARD_CONFIDENCE_THRESHOLD)
				: 0.5);

		this.stallMinTurnDepth =
			customConfig?.stallMinTurnDepth ??
			(process.env.SWITCHYARD_STALL_MIN_DEPTH ? Number.parseInt(process.env.SWITCHYARD_STALL_MIN_DEPTH, 10) : 8);
		this.hardSeverity =
			customConfig?.hardSeverity ??
			(process.env.SWITCHYARD_HARD_SEVERITY ? Number.parseFloat(process.env.SWITCHYARD_HARD_SEVERITY) : 0.7);
		this.severityCritical =
			customConfig?.severityCritical ??
			(process.env.SWITCHYARD_SEVERITY_CRITICAL ? Number.parseFloat(process.env.SWITCHYARD_SEVERITY_CRITICAL) : 1.0);
		this.signalUnit =
			customConfig?.signalUnit ??
			(process.env.SWITCHYARD_SIGNAL_UNIT ? Number.parseFloat(process.env.SWITCHYARD_SIGNAL_UNIT) : 0.1);

		const wErr =
			customConfig?.weights?.errorSeverity ??
			(process.env.SWITCHYARD_WEIGHT_ERROR
				? Number.parseFloat(process.env.SWITCHYARD_WEIGHT_ERROR)
				: this.signalUnit);
		const wSpin =
			customConfig?.weights?.spinning ??
			(process.env.SWITCHYARD_WEIGHT_SPINNING
				? Number.parseFloat(process.env.SWITCHYARD_WEIGHT_SPINNING)
				: this.signalUnit);
		const wExp =
			customConfig?.weights?.exploring ??
			(process.env.SWITCHYARD_WEIGHT_EXPLORING
				? Number.parseFloat(process.env.SWITCHYARD_WEIGHT_EXPLORING)
				: this.signalUnit / 2.0);
		const wProd =
			customConfig?.weights?.productionIntensity ??
			(process.env.SWITCHYARD_WEIGHT_PRODUCTION
				? Number.parseFloat(process.env.SWITCHYARD_WEIGHT_PRODUCTION)
				: this.signalUnit);
		const wScale =
			customConfig?.weights?.scaleFactor ??
			(process.env.SWITCHYARD_SCALE_FACTOR ? Number.parseFloat(process.env.SWITCHYARD_SCALE_FACTOR) : 5.0);

		this.weights = {
			errorSeverity: wErr,
			spinning: wSpin,
			exploring: wExp,
			productionIntensity: wProd,
			scaleFactor: wScale,
		};

		this.config = {
			efficientModel: customConfig?.efficientModel ?? process.env.SWITCHYARD_EFFICIENT_MODEL ?? fallbackModel,
			capableModel: customConfig?.capableModel ?? process.env.SWITCHYARD_CAPABLE_MODEL ?? fallbackModel,
			evaluatorModel:
				customConfig?.evaluatorModel ??
				process.env.SWITCHYARD_EVALUATOR_MODEL ??
				customConfig?.capableModel ??
				process.env.SWITCHYARD_CAPABLE_MODEL ??
				fallbackModel,
			picker:
				customConfig?.picker ??
				(process.env.SWITCHYARD_PICKER as SwitchyardPicker | undefined) ??
				"efficient_first",
			baseThreshold: baseThresh,
			thresholdStep: threshStep,
			confidenceThreshold: confThresh,
			stallMinTurnDepth: this.stallMinTurnDepth,
			hardSeverity: this.hardSeverity,
			severityCritical: this.severityCritical,
			signalUnit: this.signalUnit,
			judgeEndpoint: customConfig?.judgeEndpoint ?? process.env.SWITCHYARD_API_BASE ?? process.env.OPENAI_BASE_URL,
			judgeApiKey: customConfig?.judgeApiKey ?? process.env.SWITCHYARD_API_KEY ?? process.env.OPENAI_API_KEY,
			judgeCustomHeaders: customConfig?.judgeCustomHeaders,
			judgeModel: customConfig?.judgeModel ?? process.env.SWITCHYARD_JUDGE_MODEL ?? fallbackModel,
			judgeExecutor: customConfig?.judgeExecutor,
			fallbackJudgeEndpoint: customConfig?.fallbackJudgeEndpoint ?? process.env.SWITCHYARD_FALLBACK_API_BASE,
			fallbackJudgeModel:
				customConfig?.fallbackJudgeModel ?? process.env.SWITCHYARD_FALLBACK_JUDGE_MODEL ?? fallbackModel,
			maxJudgeRetries: customConfig?.maxJudgeRetries ?? 3,
			judgeTimeoutMs: customConfig?.judgeTimeoutMs ?? 8000,
			weights: this.weights,
			trivialPatterns:
				customConfig?.trivialPatterns ??
				(envTrivial ? envTrivial.split(",").map((p) => new RegExp(p.trim(), "i")) : undefined),
			escalationPatterns:
				customConfig?.escalationPatterns ??
				(envEscalate ? envEscalate.split(",").map((p) => new RegExp(p.trim(), "i")) : undefined),
			compactTaskLengthThreshold:
				customConfig?.compactTaskLengthThreshold ?? (envThreshold ? Number.parseInt(envThreshold, 10) : 300),
		};
	}

	public getEvaluatorModel(): string {
		return this.config.evaluatorModel ?? this.config.capableModel;
	}

	public getCapableModel(): string {
		return this.config.capableModel;
	}

	public getEfficientModel(): string {
		return this.config.efficientModel;
	}

	/**
	 * Evaluates task using cheap deterministic signals (Level 0 - zero LLM calls).
	 * Relies on empirical structural metrics and dynamic configuration.
	 */
	public routeByDeterministicSignals(
		taskDescription: string,
		signals?: DeterministicRoutingSignals,
	): SwitchyardDecision | null {
		const trimmed = taskDescription.trim();
		const matchesDynamicEscalation = this.config.escalationPatterns?.some((p) => p.test(trimmed));

		// 1. Critical Escalation Signals: Recurring failures, explicit security/migration flag, or dynamic escalation patterns
		if (signals?.isMigrationOrSecurity || (signals?.previousTestFailures ?? 0) >= 2 || matchesDynamicEscalation) {
			return {
				selectedTier: "capable",
				selectedModel: this.config.capableModel,
				decisionSource: "deterministic_rules",
				confidence: 0.95,
				reason:
					"Deterministic routing: Repeated test failures, security/migration flag, or escalation patterns detected — escalated to capable tier.",
			};
		}

		// 2. Simple Deterministic Signals: Single file change, read-only flag, or dynamic trivial pattern match
		const isSingleFile =
			signals?.isSingleFileTask || (signals?.filesChangedCount !== undefined && signals.filesChangedCount <= 1);
		const isCompact =
			this.config.compactTaskLengthThreshold !== undefined &&
			trimmed.length <= this.config.compactTaskLengthThreshold;
		const matchesDynamicTrivial = this.config.trivialPatterns?.some((p) => p.test(trimmed));
		const isSimpleScope = (isSingleFile && isCompact) || signals?.isReadOnly || matchesDynamicTrivial;

		if (isSimpleScope && (signals?.previousTestFailures ?? 0) === 0) {
			return {
				selectedTier: "efficient",
				selectedModel: this.config.efficientModel,
				decisionSource: "deterministic_rules",
				confidence: 0.9,
				reason: "Deterministic routing: Localized single-file or routine scope — assigned to efficient tier.",
			};
		}

		return null;
	}

	/**
	 * Economical Routing Pipeline:
	 * 1. Check Level 0 deterministic signals first (0 inference tokens).
	 * 2. If ambiguous, call Level 1 Switchyard Capability Judge with full retry loop and fail-open invariant.
	 */
	public async routeEconomical(
		taskDescription: string,
		signals?: DeterministicRoutingSignals,
		contextSummary?: string,
	): Promise<SwitchyardDecision> {
		const deterministic = this.routeByDeterministicSignals(taskDescription, signals);
		if (deterministic) return deterministic;
		return this.routeByCapability(taskDescription, contextSummary);
	}

	/**
	 * Evaluates task using NVIDIA Switchyard Capability Classifier (Algorithm 1).
	 * Executes a bounded retry loop with exponential backoff and multi-target fallback.
	 * On exhausted retries or judge failure, strictly adheres to the official Switchyard
	 * fail-open invariant: routes to capable/strong tier.
	 */
	public async routeByCapability(taskDescription: string, contextSummary?: string): Promise<SwitchyardDecision> {
		const maxRetries = this.config.maxJudgeRetries ?? 3;
		const timeoutMs = this.config.judgeTimeoutMs ?? 8000;
		const primaryEndpoint =
			this.config.judgeEndpoint ?? process.env.SWITCHYARD_API_BASE ?? process.env.OPENAI_BASE_URL;
		const primaryModel = this.config.judgeModel ?? process.env.SWITCHYARD_JUDGE_MODEL ?? this.config.capableModel;
		const fallbackEndpoint = this.config.fallbackJudgeEndpoint ?? primaryEndpoint;
		const fallbackModel = this.config.fallbackJudgeModel ?? this.config.capableModel;

		// Fail-open to capable tier per official NVIDIA Switchyard invariant if judge is unconfigured
		if (!this.config.judgeExecutor && (!primaryEndpoint || !primaryModel)) {
			return {
				selectedTier: "capable",
				selectedModel: this.config.capableModel,
				decisionSource: "escalation_fallback",
				confidence: 1.0,
				reason: "Switchyard Fail-Open: Judge endpoint or model unconfigured — assigned to capable tier.",
			};
		}

		const judgePrompt = `You are a task-level probability forecaster for a model router. You receive the task's opening instruction and, when present, its latest user follow-up, plus the qualitative capability card below.

Forecast one binary event:

SUCCESS means that the efficient agent completes the whole task correctly on one fresh run under the actual harness, tools, and budget, as judged by the final verifier. FAILURE means any other outcome. The two outcomes are exhaustive.

Use only evidence in the instruction and the capability card. Do not assume hidden repository state, unmentioned tools, validators, documentation, access, or future work habits. Do not invent empirical counts, success rates, or base rates. The capability card is qualitative evidence, not a measured prior.

# Assessment procedure

1. State the crux: the hardest material requirement for whole-task success.
2. Select the one capability rule that best describes the crux. Use primary_rule=none and capability_boundary=unmatched when no rule applies. Rule ids are opaque labels. Do not infer a boundary from an id's spelling.
3. Privately identify the strongest instruction-visible reasons for SUCCESS and FAILURE, then imagine the most likely concrete failure.
4. Privately consider material unknowns. Missing information should limit extreme estimates, but it is not evidence that p_solve must equal 0.50.
5. Estimate p_solve last. It is the probability of whole-task SUCCESS, not confidence in this assessment, a route recommendation, or a cost judgment.

Interpret probabilities as natural frequencies. If p_solve is 0.70 for 100 comparable fresh runs, about 70 should succeed and 30 should fail. Use the full range when justified. Reserve 0.00 and 1.00 for outcomes that are logically impossible or certain under the visible contract. Supported does not mean 1.00, and unsupported does not mean 0.00. The downstream routing threshold is not part of this forecast.

# Efficient-agent capability card

- SUP-1 [supported]: Route to the Efficient model when the task provides a complete output contract and a deterministic local validator that covers the material requirements.
- SUP-2 [supported]: Route to the Efficient model when all required inputs are available, the target environment can be inspected, and correctness can be verified end-to-end without inaccessible external state.
- SUP-3 [supported]: Route to the Efficient model when mathematical behavior, interfaces, shapes, data types, tolerances, and performance requirements are explicit and exercised by a representative harness.
- SUP-4 [supported]: Route to the Efficient model when the required mechanism is identified, the relevant search space is bounded, and the success condition is executable. Do not infer this rule merely from the task's technical domain.
- SUP-5 [supported]: Route to the Efficient model when reconstruction or behavioral reproduction is constrained by an executable reference, parser, format specification, or checker strong enough to distinguish correct from merely plausible output.
- UNC-1 [uncertain]: Treat the route as uncertain when multiple reasonable interpretations of preprocessing, representation, indexing, naming, or output placement would produce different results and neither the instructions nor a validator resolve the choice.
- UNC-2 [uncertain]: Treat the route as uncertain when success requires finding every relevant item across heterogeneous inputs or environment state, but the task does not define the search boundary or provide a completeness check.
- LIM-1 [unsupported]: Prefer the Capable model when correctness depends primarily on extracting precise information from noisy visual, temporal, or rendered media and no machine-checkable extraction or replay mechanism is available.
- LIM-2 [unsupported]: Prefer the Capable model when success depends on reproducing undocumented reference behavior, hidden intermediate state, or an unknown configuration, and small deviations fail despite satisfying the visible specification.

TASK TO ROUTE:
${taskDescription}
${contextSummary ? `\nCONTEXT:\n${contextSummary}` : ""}

# Output
Return exactly one JSON object matching:
{"crux": string, "primary_rule": "SUP-1"|"SUP-2"|"SUP-3"|"SUP-4"|"SUP-5"|"UNC-1"|"UNC-2"|"LIM-1"|"LIM-2"|"none", "capability_boundary": "supported"|"uncertain"|"unsupported"|"unmatched", "p_solve": number between 0.0 and 1.0}
Do not include markdown or commentary.`;

		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			const endpoint = attempt > 1 && this.config.fallbackJudgeEndpoint ? fallbackEndpoint : primaryEndpoint;
			const model = attempt > 1 && this.config.fallbackJudgeModel ? fallbackModel : primaryModel;

			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);

			try {
				let parsed: CapabilityClassifierDecision | null = null;

				if (this.config.judgeExecutor) {
					parsed = await this.config.judgeExecutor(judgePrompt, model, endpoint);
				} else {
					const headers: Record<string, string> = {
						"Content-Type": "application/json",
					};
					const apiKey = this.config.judgeApiKey ?? process.env.SWITCHYARD_API_KEY ?? process.env.OPENAI_API_KEY;
					if (apiKey) {
						headers.Authorization = `Bearer ${apiKey}`;
					}
					if (this.config.judgeCustomHeaders) {
						Object.assign(headers, this.config.judgeCustomHeaders);
					}

					const cleanEndpoint = (endpoint ?? "").replace(/\/+$/, "");
					const response = await fetch(`${cleanEndpoint}/chat/completions`, {
						method: "POST",
						headers,
						body: JSON.stringify({
							model,
							messages: [{ role: "user", content: judgePrompt }],
							temperature: 0.0,
							response_format: { type: "json_object" },
						}),
						signal: controller.signal,
					});

					clearTimeout(timer);

					if (!response.ok) {
						throw new Error(`Judge returned HTTP ${response.status}: ${response.statusText}`);
					}

					const data = (await response.json()) as {
						choices?: { message?: { content?: unknown } }[];
					};
					const rawContent = data.choices?.[0]?.message?.content;

					if (typeof rawContent === "string") {
						try {
							const json = JSON.parse(rawContent);
							if (json && typeof json === "object") {
								parsed = {
									crux: String(json.crux ?? ""),
									primary_rule: json.primary_rule,
									capability_boundary: json.capability_boundary,
									p_solve: Number(json.p_solve ?? 0),
								};
							}
						} catch {
							parsed = null;
						}
					}
				}

				if (parsed && isTaskClassifierVerdictValid(parsed)) {
					const steps = capabilityBoundarySteps(parsed.capability_boundary);
					const threshold = this.config.baseThreshold + steps * this.config.thresholdStep;

					const isEfficient = parsed.p_solve >= threshold || Math.abs(threshold - parsed.p_solve) <= 1e-9;
					const selectedTier: SwitchyardTier = isEfficient ? "efficient" : "capable";
					const selectedModel = isEfficient ? this.config.efficientModel : this.config.capableModel;

					return {
						selectedTier,
						selectedModel,
						decisionSource: "capability_judge",
						verdict: parsed,
						confidence: parsed.p_solve,
						reason: `Switchyard Capability Classifier: rule=${parsed.primary_rule}, boundary=${parsed.capability_boundary}, p_solve=${parsed.p_solve.toFixed(2)} (threshold: ${threshold.toFixed(2)})`,
					};
				}

				throw new Error(
					parsed ? "Invalid or inconsistent verdict contract" : "Failed to decode capability decision",
				);
			} catch (err) {
				clearTimeout(timer);
				lastError = err instanceof Error ? err : new Error(String(err));

				if (attempt < maxRetries) {
					const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 4000);
					await new Promise((r) => setTimeout(r, backoffMs));
				}
			}
		}

		// Official NVIDIA Switchyard Invariant:
		// Any judge failure, invalid verdict, or exhausted retries routes to strong_target (capable)
		return {
			selectedTier: "capable",
			selectedModel: this.config.capableModel,
			decisionSource: "escalation_fallback",
			confidence: 1.0,
			reason: `Switchyard Fail-Open: Judge exhausted ${maxRetries} retries (${lastError?.message ?? "unknown error"}) — escalated to capable tier.`,
		};
	}

	/**
	 * Evaluates active turn using official NVIDIA Switchyard Stage Router (Algorithm 2).
	 * Implements the 4-rule hierarchy:
	 * 1. Escalate — Hard override (critical severity or context compaction).
	 * 2. De-escalate — Settled turn (tests passed, recent writes/edits >= 1, zero errors).
	 * 3. Scorer — Weigh error axis vs production axis, tanh squashed with scale factor.
	 * 4. Fall open — Sub-threshold turns default according to retained user-turn judge verdict or picker default.
	 */
	public routeByStageSignals(signals: ToolSignalSnapshot): SwitchyardDecision {
		// 1. Escalate — hard reason to go capable, ahead of everything else (libsy should_escalate)
		if (signals.compacted || signals.errorSeverity >= this.severityCritical) {
			const reason = signals.compacted
				? "Switchyard Stage Router: Context compaction detected — hard override to capable tier."
				: `Switchyard Stage Router: Critical error detected (severity ${signals.errorSeverity.toFixed(2)} >= ${this.severityCritical.toFixed(2)}) — hard escalation to capable tier.`;

			return {
				selectedTier: "capable",
				selectedModel: this.config.capableModel,
				decisionSource: "override",
				confidence: 1.0,
				reason,
			};
		}

		// 2. De-escalate — hard reason to go cheap: settled turn (libsy should_deescalate)
		const recentWritesAndEdits = (signals.recentWriteCount ?? 0) + (signals.recentEditCount ?? 0);
		const hasRecentProduction =
			recentWritesAndEdits >= 1 || (signals.productionIntensity !== undefined && signals.productionIntensity > 0);
		if (signals.testsPassed && hasRecentProduction && signals.errorSeverity <= 0.0) {
			return {
				selectedTier: "efficient",
				selectedModel: this.config.efficientModel,
				decisionSource: "tests_passed",
				confidence: 1.0,
				reason:
					"Switchyard Stage Router: Tests passed with recent code production and zero errors — hard de-escalation to efficient tier.",
			};
		}

		// 3. Scorer — weigh error axis vs production axis (libsy score_signal)
		const deepEnough = signals.turnDepth >= this.stallMinTurnDepth;
		const noProduction =
			signals.productionIntensity !== undefined ? signals.productionIntensity === 0 : recentWritesAndEdits === 0;
		const investigating = (signals.recentReadCount ?? 0) >= 1 || (signals.recentTodoWriteCount ?? 0) >= 1;

		const isSpinning = signals.isSpinning ?? (deepEnough && noProduction && !investigating);
		const isExploring = signals.isExploring ?? (deepEnough && noProduction && investigating);
		const prodIntensity =
			signals.productionIntensity ??
			(recentWritesAndEdits > 0
				? recentWritesAndEdits /
					(recentWritesAndEdits + (signals.recentReadCount ?? 0) + (signals.recentTodoWriteCount ?? 0))
				: 0.0);

		const { errorSeverity, spinning, exploring, productionIntensity, scaleFactor } = this.weights;

		// libsy: raw = (severity / HARD_SEVERITY) * wErr + spinning * wSpin + exploring * wExp - prodIntensity * wProd
		const normSeverity = signals.errorSeverity / this.hardSeverity;
		const rawScore =
			normSeverity * errorSeverity +
			(isSpinning ? spinning : 0.0) +
			(isExploring ? exploring : 0.0) -
			prodIntensity * productionIntensity;

		// tanh squashing to (-1, +1)
		const score = Math.tanh(rawScore * scaleFactor);
		const confidence = Math.abs(score);
		const probability = (score + 1.0) / 2.0;
		const halfThreshold = this.config.confidenceThreshold / 2.0;

		if (probability > 0.5 + halfThreshold) {
			return {
				selectedTier: "capable",
				selectedModel: this.config.capableModel,
				decisionSource: "dimensions",
				confidence,
				reason: `Switchyard Stage Router: Confident stage signal (capable, confidence ${confidence.toFixed(2)} >= threshold ${this.config.confidenceThreshold.toFixed(2)}).`,
			};
		}

		if (probability < 0.5 - halfThreshold) {
			return {
				selectedTier: "efficient",
				selectedModel: this.config.efficientModel,
				decisionSource: "dimensions",
				confidence,
				reason: `Switchyard Stage Router: Confident stage signal (efficient, confidence ${confidence.toFixed(2)} >= threshold ${this.config.confidenceThreshold.toFixed(2)}).`,
			};
		}

		// 4. Sub-threshold turns default according to retained user-turn judge verdict or picker default
		const defaultTier: SwitchyardTier =
			signals.fallOpenTier ?? (this.config.picker === "capable_first" ? "capable" : "efficient");
		const defaultModel = defaultTier === "capable" ? this.config.capableModel : this.config.efficientModel;

		return {
			selectedTier: defaultTier,
			selectedModel: defaultModel,
			decisionSource: "fall_open",
			confidence,
			reason: `Switchyard Stage Router: Sub-threshold signal (confidence ${confidence.toFixed(2)} < threshold ${this.config.confidenceThreshold.toFixed(2)}) — retained on ${signals.fallOpenTier ? "user-turn judge" : "picker"} default (${defaultTier}).`,
		};
	}

	/**
	 * Computes empirical error severity from tool execution outputs matching
	 * official NVIDIA Switchyard classification (libsy/src/algorithms/util/tool_signals.rs):
	 * - 0.0: Clean (no errors)
	 * - 0.3: Soft error (plain non-zero exit code without unhandled traceback)
	 * - 0.7: Hard error (tracebacks, syntax/import/assertion errors, timeouts)
	 * - 1.0: Critical error (OOM, SIGSEGV/segfault, connection refused, fatal engine crash)
	 */
	public static classifyErrorSeverity(
		toolResults: readonly { readonly status?: string; readonly output?: string; readonly error?: string }[],
	): number {
		let maxSeverity = 0.0;
		for (const result of toolResults) {
			if (result.status === "error") {
				maxSeverity = Math.max(maxSeverity, 0.3);
			}
			const text = `${result.error ?? ""} ${result.output ?? ""}`.toLowerCase();
			if (!text.trim()) continue;

			// Critical crash patterns (libsy: CRITICAL = 1.0)
			if (
				text.includes("out of memory") ||
				text.includes("memoryerror") ||
				text.includes("segmentation fault") ||
				text.includes("sigsegv") ||
				text.includes("cannot allocate memory") ||
				text.includes("connection refused") ||
				text.includes("econnrefused")
			) {
				return 1.0;
			}

			// Hard exception/traceback patterns (libsy: HARD = 0.7)
			if (
				text.includes("traceback (most recent call last)") ||
				text.includes("syntaxerror:") ||
				text.includes("assertionerror") ||
				text.includes("modulenotfounderror:") ||
				text.includes("importerror:") ||
				text.includes("timed out") ||
				text.includes("deadline exceeded") ||
				text.includes("filenotfounderror:")
			) {
				maxSeverity = Math.max(maxSeverity, 0.7);
			} else if (
				result.status === "error" ||
				text.includes("exit code") ||
				text.includes("returned non-zero") ||
				text.includes("exited with code")
			) {
				maxSeverity = Math.max(maxSeverity, 0.3);
			}
		}
		return maxSeverity;
	}
}

/**
 * Session branch state tracked across user turns and continuation requests for Switchyard.
 */
export interface SwitchyardState {
	readonly lastTier: SwitchyardTier;
	readonly userTurnVerdict?: CapabilityClassifierDecision;
	readonly turnDepth: number;
}

export interface SwitchyardVirtualModelOptions {
	readonly provider: string;
	readonly id: string;
	readonly name: string;
	readonly efficientModel: Model<Api>;
	readonly capableModel: Model<Api>;
	readonly router: SwitchyardModelRouter;
	readonly thinkingLevels?: readonly ModelThinkingLevel[];
	readonly telemetryRecorder?: RoutingTelemetryRecorder;
}

/**
 * Creates a native Pi VirtualModelDefinition driven by NVIDIA Switchyard.
 */
export function createSwitchyardVirtualModel(
	options: SwitchyardVirtualModelOptions,
): VirtualModelDefinition<SwitchyardState> {
	return {
		provider: options.provider,
		id: options.id,
		name: options.name,
		thinkingLevels: options.thinkingLevels ?? ["off"],
		contextWindow: Math.max(options.efficientModel.contextWindow ?? 0, options.capableModel.contextWindow ?? 0),
		maxTokens: Math.max(options.efficientModel.maxTokens ?? 0, options.capableModel.maxTokens ?? 0),
		async route(request: ModelRouteRequest<SwitchyardState>): Promise<ModelRoute<SwitchyardState>> {
			const currentState = request.state ?? {
				lastTier: "efficient",
				turnDepth: 0,
			};

			// 1. Automatic retry after error -> immediately escalate to capable model
			if (request.reason === "retry" && request.failed) {
				const nextState: SwitchyardState = {
					lastTier: "capable",
					userTurnVerdict: currentState.userTurnVerdict,
					turnDepth: currentState.turnDepth + 1,
				};
				return {
					model: options.capableModel,
					thinkingLevel: request.thinkingLevel,
					state: nextState,
				};
			}

			// 2. User turn: Evaluate capability classifier judge
			if (request.reason === "user") {
				const lastUserMsg = [...request.messages].reverse().find((m) => m.role === "user");
				const userPrompt =
					typeof lastUserMsg?.content === "string"
						? lastUserMsg.content
						: Array.isArray(lastUserMsg?.content)
							? lastUserMsg.content
									.map((c) => (typeof c === "string" ? c : "text" in c ? c.text : ""))
									.join("\n")
							: "";

				const decision = await options.router.routeEconomical(userPrompt);
				const targetModel = decision.selectedTier === "capable" ? options.capableModel : options.efficientModel;
				if (options.telemetryRecorder) {
					const rule = decision.verdict?.primary_rule ?? "SUP-1";
					const boundary = decision.verdict?.capability_boundary ?? "supported";
					const pSolve = decision.verdict?.p_solve ?? decision.confidence ?? 0.8;
					const crux = decision.verdict?.crux ?? decision.reason;
					options.telemetryRecorder.record({
						id: `route-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
						timestamp: Date.now(),
						turnIndex: 1,
						crux,
						primaryRule: rule,
						capabilityBoundary: boundary,
						pSolve,
						chosenTier: decision.selectedTier,
						escalated: decision.selectedTier === "capable",
						errorSeverity: 0,
						spinningScore: 0,
						outcome: "pending",
					});
				}
				const nextState: SwitchyardState = {
					lastTier: decision.selectedTier,
					userTurnVerdict: decision.verdict,
					turnDepth: 1,
				};
				return {
					model: targetModel,
					thinkingLevel: request.thinkingLevel,
					state: nextState,
				};
			}

			// 3. Continuation turn: Evaluate stage router signals
			const lastAssistant = [...request.messages].reverse().find((m) => m.role === "assistant");
			const toolCalls =
				lastAssistant && "toolCalls" in lastAssistant && Array.isArray(lastAssistant.toolCalls)
					? lastAssistant.toolCalls
					: [];

			// Find tool results in subsequent messages
			const toolResults: { status?: string; output?: string; error?: string }[] = [];
			for (const msg of request.messages) {
				if (msg.role === "toolResult" || (msg.role as string) === "tool_result") {
					const contentStr = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
					toolResults.push({
						status: "isError" in msg && msg.isError ? "error" : "ok",
						output: contentStr,
					});
				}
			}

			const severity = SwitchyardModelRouter.classifyErrorSeverity(toolResults);
			const stageSignals: ToolSignalSnapshot = {
				turnDepth: currentState.turnDepth + 1,
				errorSeverity: severity,
				fallOpenTier: currentState.userTurnVerdict
					? capabilityBoundarySteps(currentState.userTurnVerdict.capability_boundary) >= 2
						? "capable"
						: "efficient"
					: currentState.lastTier,
				recentWriteCount: toolCalls.filter((c: { name?: string }) => c.name === "write" || c.name === "edit")
					.length,
				recentReadCount: toolCalls.filter((c: { name?: string }) => c.name === "read" || c.name === "grep").length,
			};

			let selectedTier: SwitchyardTier;
			if (options.router.mode === "lite") {
				// Macro-Task Sticky Mode (KV Cache Protection):
				// - If already escalated to capable, stick to capable for the entire macro task
				// - If on efficient tier, only escalate on hard errors or stall depth
				if (currentState.lastTier === "capable") {
					selectedTier = "capable";
				} else if (
					stageSignals.errorSeverity >= options.router.hardSeverity ||
					stageSignals.turnDepth >= options.router.stallMinTurnDepth
				) {
					selectedTier = "capable";
				} else {
					selectedTier = "efficient";
				}
			} else {
				// Full automatic mode: evaluate fine-grained stage-router weights every turn
				const decision = options.router.routeByStageSignals(stageSignals);
				selectedTier = decision.selectedTier;
			}

			const targetModel = selectedTier === "capable" ? options.capableModel : options.efficientModel;
			if (options.telemetryRecorder) {
				const rule = currentState.userTurnVerdict?.primary_rule ?? "none";
				const boundary = currentState.userTurnVerdict?.capability_boundary ?? "unmatched";
				const pSolve = currentState.userTurnVerdict?.p_solve ?? 0.5;
				const crux = currentState.userTurnVerdict?.crux ?? "Continuation stage router turn";
				options.telemetryRecorder.record({
					id: `route-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
					timestamp: Date.now(),
					turnIndex: currentState.turnDepth + 1,
					crux,
					primaryRule: rule,
					capabilityBoundary: boundary,
					pSolve,
					chosenTier: selectedTier,
					escalated: selectedTier === "capable" && currentState.lastTier === "efficient",
					errorSeverity: stageSignals.errorSeverity,
					spinningScore: 0,
					outcome: selectedTier === "capable" ? "escalated" : "pending",
				});
			}
			const nextState: SwitchyardState = {
				lastTier: selectedTier,
				userTurnVerdict: currentState.userTurnVerdict,
				turnDepth: currentState.turnDepth + 1,
			};

			return {
				model: targetModel,
				thinkingLevel: request.thinkingLevel,
				state: nextState,
			};
		},
	};
}
