import { describe, expect, it } from "vitest";
import { type CandidateHarnessEvaluation, RegularizedHarnessEvolution } from "../../core/src/index.ts";

describe("RRSI: Regularized Recursive Self-Improvement", () => {
	it("calculates annealed L0 proposal budget according to cosine schedule", () => {
		const rrsi = new RegularizedHarnessEvolution(0.5, 1000, {
			bMax: 5,
			bMin: 1,
			totalRounds: 20,
		});

		// Round 0: maximum budget
		expect(rrsi.getProposalBudget(0)).toBe(5);

		// Halfway (round 10): intermediate budget
		const midBudget = rrsi.getProposalBudget(10);
		expect(midBudget).toBeGreaterThanOrEqual(2);
		expect(midBudget).toBeLessThanOrEqual(4);

		// Final round (round 20): minimum budget
		expect(rrsi.getProposalBudget(20)).toBe(1);
	});

	it("screens candidate diffs for leakage of benchmark-specific keywords or inert changes", () => {
		const rrsi = new RegularizedHarnessEvolution(0.5, 1000);

		const leakingDiff = `
      + if task_name == "benchmark_fixture_12":
      +     return "hardcoded_result"
    `;
		const leakScreen = rrsi.screenCandidateLeakage(leakingDiff);
		expect(leakScreen.passes).toBe(false);
		expect(leakScreen.reason).toContain("Leakage Screening");

		const emptyDiff = "   \n  ";
		const emptyScreen = rrsi.screenCandidateLeakage(emptyDiff);
		expect(emptyScreen.passes).toBe(false);
		expect(emptyScreen.reason).toContain("inert empty diff");

		const validDiff = `
      + // Add retry logic with exponential backoff on network errors
      + const maxRetries = 3;
    `;
		const validScreen = rrsi.screenCandidateLeakage(validDiff);
		expect(validScreen.passes).toBe(true);
	});

	it("enforces stability floor and Ridge/L2 complexity-aware token cost gate", () => {
		const rrsi = new RegularizedHarnessEvolution(0.6, 1000, {
			noiseBandDelta: 0.02,
			beta0: 0.05,
			beta1: 2.0,
			bMax: 5,
		});

		// Case 1: Regression below stability floor S* - delta (0.6 - 0.02 = 0.58)
		const regressionCandidate: CandidateHarnessEvaluation = {
			candidateId: "cand-regress",
			component: "prompt",
			hypothesis: "simplify instructions",
			diffText: "+ shorter prompt",
			score: 0.55,
			policyTokenCost: 900,
			editsCount: 1,
		};
		const regDecision = rrsi.evaluateCandidate(regressionCandidate, 0);
		expect(regDecision.accepted).toBe(false);
		expect(regDecision.reason).toContain("stability floor");

		// Case 2: Excessive cost explosion for small score gain
		// Gain = 0.63 - 0.60 = 0.03 (> 0.02 delta).
		// Allowed cost ratio = beta0 + beta1 * 0.03 = 0.05 + 2.0 * 0.03 = 0.11 (11%).
		// Candidate cost = 1300 (+30% increase) -> should be rejected by complexity gate.
		const expensiveCandidate: CandidateHarnessEvaluation = {
			candidateId: "cand-expensive",
			component: "context",
			hypothesis: "include full repo AST",
			diffText: "+ load full repo AST into context",
			score: 0.63,
			policyTokenCost: 1300,
			editsCount: 1,
		};
		const expDecision = rrsi.evaluateCandidate(expensiveCandidate, 0);
		expect(expDecision.accepted).toBe(false);
		expect(expDecision.reason).toContain("complexity gate");

		// Case 3: Balanced gain justifying reasonable cost
		// Cost = 1050 (+5% increase, within 11% allowed)
		const goodCandidate: CandidateHarnessEvaluation = {
			candidateId: "cand-good",
			component: "tool_prompt",
			hypothesis: "clarify bash error formats",
			diffText: "+ specify bash exit code handling",
			score: 0.64,
			policyTokenCost: 1050,
			editsCount: 1,
		};
		const goodDecision = rrsi.evaluateCandidate(goodCandidate, 0);
		expect(goodDecision.accepted).toBe(true);
		expect(goodDecision.candidateScore).toBe(0.64);

		// Record decision and verify incumbent update
		rrsi.recordEvaluation(goodCandidate, goodDecision, 0);
		expect(rrsi.getBestScore()).toBe(0.64);
		expect(rrsi.getIncumbentCost()).toBe(1050);
	});

	it("detects stalls and identifies underexplored targets and pruning targets", () => {
		const rrsi = new RegularizedHarnessEvolution(0.7, 1000, {
			stallWindow: 2,
			noiseBandDelta: 0.01,
			pruningWindow: 3,
		});

		const allComponents = ["prompt", "tools", "memory", "subagents"];

		// Initially not stalled
		expect(rrsi.isStalled(0)).toBe(false);

		// Simulate 2 rounds of unaccepted/zero-gain edits on "prompt"
		const dummyCandidate: CandidateHarnessEvaluation = {
			candidateId: "cand-fail",
			component: "prompt",
			hypothesis: "test",
			diffText: "+ some edit",
			score: 0.7,
			policyTokenCost: 1000,
			editsCount: 1,
		};
		const dec = rrsi.evaluateCandidate(dummyCandidate, 1);
		rrsi.recordEvaluation(dummyCandidate, dec, 1);
		rrsi.recordEvaluation(dummyCandidate, dec, 2);

		// Now stalled
		expect(rrsi.isStalled(3)).toBe(true);

		// Structured exploration recommends unexplored components
		const explorationTargets = rrsi.getExplorationTargets(allComponents);
		expect(explorationTargets).toContain("tools");
		expect(explorationTargets).toContain("memory");
		expect(explorationTargets).toContain("subagents");
		expect(explorationTargets).not.toContain("prompt");

		// Check Lasso/L1 structural pruning identifies prompt as unproductive
		const pruningTargets = rrsi.identifyPruningTargets(5);
		expect(pruningTargets).toContain("prompt");
	});
});
