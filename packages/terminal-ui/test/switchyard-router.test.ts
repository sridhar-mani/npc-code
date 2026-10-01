import { describe, expect, it } from "vitest";
import {
	capabilityBoundarySteps,
	isTaskClassifierVerdictValid,
	SwitchyardModelRouter,
} from "../../core/src/model/switchyard-router.ts";

describe("NVIDIA Switchyard Model Router Specification", () => {
	const router = new SwitchyardModelRouter({
		efficientModel: "test/efficient-model",
		capableModel: "test/capable-model",
		baseThreshold: 0.5,
		thresholdStep: 0.1,
		confidenceThreshold: 0.5,
	});

	describe("Level 0: Deterministic Signals", () => {
		it("routes localized single-file tasks to efficient tier", () => {
			const decision = router.routeByDeterministicSignals("Format code and fix typos", {
				filesChangedCount: 1,
			});
			expect(decision).not.toBeNull();
			expect(decision?.selectedTier).toBe("efficient");
			expect(decision?.selectedModel).toBe("test/efficient-model");
			expect(decision?.decisionSource).toBe("deterministic_rules");
		});

		it("routes recurring failures directly to capable tier", () => {
			const decision = router.routeByDeterministicSignals("Update authentication tokens", {
				previousTestFailures: 2,
			});
			expect(decision).not.toBeNull();
			expect(decision?.selectedTier).toBe("capable");
			expect(decision?.selectedModel).toBe("test/capable-model");
			expect(decision?.decisionSource).toBe("deterministic_rules");
		});

		it("returns null for ambiguous tasks to allow Level 1 Capability Judge", () => {
			const decision = router.routeByDeterministicSignals("Optimize graph neural operator convolution kernels", {
				filesChangedCount: 5,
				previousTestFailures: 0,
			});
			expect(decision).toBeNull();
		});
	});

	describe("Level 1: Capability Classifier & Boundary Calculations", () => {
		it("calculates boundary steps accurately", () => {
			expect(capabilityBoundarySteps("supported")).toBe(0);
			expect(capabilityBoundarySteps("uncertain")).toBe(1);
			expect(capabilityBoundarySteps("unmatched")).toBe(1);
			expect(capabilityBoundarySteps("unsupported")).toBe(2);
		});

		it("validates verdict consistency per NVIDIA Switchyard contract", () => {
			expect(
				isTaskClassifierVerdictValid({
					crux: "Validator present",
					primary_rule: "SUP-1",
					capability_boundary: "supported",
					p_solve: 0.8,
				}),
			).toBe(true);

			// Mismatched boundary
			expect(
				isTaskClassifierVerdictValid({
					crux: "Validator present",
					primary_rule: "SUP-1",
					capability_boundary: "unsupported",
					p_solve: 0.8,
				}),
			).toBe(false);

			// Invalid p_solve range
			expect(
				isTaskClassifierVerdictValid({
					crux: "Validator present",
					primary_rule: "SUP-1",
					capability_boundary: "supported",
					p_solve: 1.5,
				}),
			).toBe(false);

			// Empty crux
			expect(
				isTaskClassifierVerdictValid({
					crux: "",
					primary_rule: "SUP-1",
					capability_boundary: "supported",
					p_solve: 0.5,
				}),
			).toBe(false);
		});

		it("fails open to capable tier when judge is unconfigured", async () => {
			const unconfiguredRouter = new SwitchyardModelRouter({
				efficientModel: "test/efficient-model",
				capableModel: "test/capable-model",
				judgeEndpoint: undefined,
				judgeModel: undefined,
			});
			const decision = await unconfiguredRouter.routeByCapability("Complex architectural refactor");
			expect(decision.selectedTier).toBe("capable");
			expect(decision.selectedModel).toBe("test/capable-model");
			expect(decision.decisionSource).toBe("escalation_fallback");
			expect(decision.confidence).toBe(1.0);
		});

		it("routes supported tasks to efficient tier when p_solve >= threshold", async () => {
			const mockRouter = new SwitchyardModelRouter({
				efficientModel: "test/efficient-model",
				capableModel: "test/capable-model",
				baseThreshold: 0.5,
				thresholdStep: 0.1,
				judgeExecutor: async () => ({
					crux: "Local unit test validator exists",
					primary_rule: "SUP-1",
					capability_boundary: "supported",
					p_solve: 0.65,
				}),
			});

			const decision = await mockRouter.routeByCapability("Add unit test assertion");
			expect(decision.selectedTier).toBe("efficient");
			expect(decision.selectedModel).toBe("test/efficient-model");
			expect(decision.decisionSource).toBe("capability_judge");
			expect(decision.verdict?.primary_rule).toBe("SUP-1");
		});

		it("routes unsupported tasks to capable tier when threshold escalates", async () => {
			// unsupported boundary adds 2 steps -> threshold = 0.5 + 2 * 0.1 = 0.70
			const mockRouter = new SwitchyardModelRouter({
				efficientModel: "test/efficient-model",
				capableModel: "test/capable-model",
				baseThreshold: 0.5,
				thresholdStep: 0.1,
				judgeExecutor: async () => ({
					crux: "Hidden intermediate state reproduction",
					primary_rule: "LIM-2",
					capability_boundary: "unsupported",
					p_solve: 0.65, // below 0.70 threshold
				}),
			});

			const decision = await mockRouter.routeByCapability("Reproduce undocumented server behavior");
			expect(decision.selectedTier).toBe("capable");
			expect(decision.selectedModel).toBe("test/capable-model");
			expect(decision.decisionSource).toBe("capability_judge");
		});
	});

	describe("Level 2: Stage Router (Rules 1-4)", () => {
		it("Rule 1: Hard escalates on context compaction", () => {
			const decision = router.routeByStageSignals({
				turnDepth: 5,
				errorSeverity: 0.0,
				compacted: true,
			});
			expect(decision.selectedTier).toBe("capable");
			expect(decision.decisionSource).toBe("override");
			expect(decision.confidence).toBe(1.0);
		});

		it("Rule 1: Hard escalates on critical error severity (>= 1.0)", () => {
			const decision = router.routeByStageSignals({
				turnDepth: 5,
				errorSeverity: 1.0,
			});
			expect(decision.selectedTier).toBe("capable");
			expect(decision.decisionSource).toBe("override");
			expect(decision.confidence).toBe(1.0);
		});

		it("Rule 2: Hard de-escalates when tests pass with production and zero errors", () => {
			const decision = router.routeByStageSignals({
				turnDepth: 5,
				errorSeverity: 0.0,
				testsPassed: true,
				recentWriteCount: 2,
				recentEditCount: 1,
			});
			expect(decision.selectedTier).toBe("efficient");
			expect(decision.decisionSource).toBe("tests_passed");
			expect(decision.confidence).toBe(1.0);
		});

		it("Rule 3: Scorer escalates to capable tier on high error severity and spinning", () => {
			const decision = router.routeByStageSignals({
				turnDepth: 10,
				errorSeverity: 0.7,
				isSpinning: true,
				recentWriteCount: 0,
				recentEditCount: 0,
			});
			expect(decision.selectedTier).toBe("capable");
			expect(decision.decisionSource).toBe("dimensions");
		});

		it("Rule 4: Falls open to retained user-turn tier when sub-threshold", () => {
			const decision = router.routeByStageSignals({
				turnDepth: 2,
				errorSeverity: 0.0,
				recentReadCount: 1,
				fallOpenTier: "efficient",
			});
			expect(decision.selectedTier).toBe("efficient");
			expect(decision.decisionSource).toBe("fall_open");
		});
	});

	describe("Error Severity Classification", () => {
		it("classifies clean runs as 0.0", () => {
			expect(SwitchyardModelRouter.classifyErrorSeverity([{ output: "Everything built successfully" }])).toBe(0.0);
		});

		it("classifies soft exit codes as 0.3", () => {
			expect(SwitchyardModelRouter.classifyErrorSeverity([{ output: "Process exited with code 1" }])).toBe(0.3);
		});

		it("classifies tracebacks and syntax errors as 0.7", () => {
			expect(
				SwitchyardModelRouter.classifyErrorSeverity([
					{ output: "Traceback (most recent call last):\n  File 'app.py', line 12\nSyntaxError: invalid syntax" },
				]),
			).toBe(0.7);
		});

		it("classifies OOM and SIGSEGV as 1.0", () => {
			expect(
				SwitchyardModelRouter.classifyErrorSeverity([{ output: "CUDA out of memory. Tried to allocate 2.00 GiB" }]),
			).toBe(1.0);
			expect(
				SwitchyardModelRouter.classifyErrorSeverity([{ output: "Fatal error: Segmentation fault (core dumped)" }]),
			).toBe(1.0);
		});
	});
});
