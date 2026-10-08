/**
 * Regularized Recursive Self-Improvement (RRSI) for Agent Harnesses.
 * Reference: Xia et al., "RRSI: Regularized Recursive Self-Improvement of Agent Harnesses" (arXiv:2609.24972).
 *
 * Implements:
 * 1. Annealed Proposal Budget schedule (L0-style update sparsity)
 * 2. Evidence-Aware Credit Assignment tracking
 * 3. Structured Exploration during progress stalls
 * 4. Leakage Screening (rejecting benchmark/task-specific logic)
 * 5. Stability-Aware & Complexity-Aware Acceptance (Ridge/L2 token cost gating)
 * 6. Structural Pruning (Lasso/L1 removal of unproductive harness components)
 */

export interface RRSIConfig {
	/** Maximum edit budget allowed in round 0 */
	bMax: number;
	/** Minimum edit budget allowed in final round */
	bMin: number;
	/** Total scheduled evolution rounds */
	totalRounds: number;
	/** Empirical noise band delta */
	noiseBandDelta: number;
	/** Stall window size (rounds without improvement > delta) */
	stallWindow: number;
	/** Complexity gating constant beta0 (tolerated fractional token cost change for 0 score gain) */
	beta0: number;
	/** Complexity gating slope beta1 (allowable cost increase per score gain) */
	beta1: number;
	/** Pruning window (number of rounds component must fail to provide positive gain) */
	pruningWindow: number;
	/** Benchmark-specific leakage keywords / regex patterns to reject */
	leakagePatterns?: string[];
}

export const DEFAULT_RRSI_CONFIG: RRSIConfig = {
	bMax: 5,
	bMin: 1,
	totalRounds: 20,
	noiseBandDelta: 0.02,
	stallWindow: 3,
	beta0: 0.05,
	beta1: 2.0,
	pruningWindow: 4,
	leakagePatterns: [
		"eval_data",
		"gold_solution",
		"test_answer",
		"ground_truth",
		"benchmark_fixture",
		"secret_key",
		"hardcoded_result",
	],
};

export interface HarnessEditRecord {
	round: number;
	component: string;
	hypothesis: string;
	diffSummary: string;
	scoreChange: number;
	costChangeRatio: number;
	accepted: boolean;
}

export interface CandidateHarnessEvaluation {
	candidateId: string;
	component: string;
	hypothesis: string;
	diffText: string;
	score: number;
	policyTokenCost: number;
	editsCount: number;
}

export interface SelectionDecision {
	accepted: boolean;
	reason: string;
	candidateId?: string;
	candidateScore?: number;
	candidateCost?: number;
}

export class RegularizedHarnessEvolution {
	private config: RRSIConfig;
	private history: HarnessEditRecord[] = [];
	private bestScore: number;
	private incumbentCost: number;
	private componentStats: Map<string, { lastPositiveGainRound: number; lifetimeEdits: number; gainsSum: number }> =
		new Map();

	constructor(initialScore: number, initialCost: number, config: Partial<RRSIConfig> = {}) {
		this.config = { ...DEFAULT_RRSI_CONFIG, ...config };
		this.bestScore = initialScore;
		this.incumbentCost = initialCost;
	}

	/**
	 * Computes the L0-style annealed proposal budget for round t:
	 * b_t = b_min + (b_max - b_min) * 0.5 * (1 + cos(pi * t / T))
	 */
	getProposalBudget(round: number): number {
		const t = Math.min(Math.max(round, 0), this.config.totalRounds);
		const cosineFactor = 0.5 * (1 + Math.cos((Math.PI * t) / this.config.totalRounds));
		const budget = this.config.bMin + (this.config.bMax - this.config.bMin) * cosineFactor;
		return Math.max(1, Math.round(budget));
	}

	/**
	 * Checks whether the evolution has stalled over the stall window,
	 * indicating the need for structured exploration on untried or underexplored components.
	 */
	isStalled(_currentRound: number): boolean {
		if (this.history.length < this.config.stallWindow) {
			return false;
		}
		const recent = this.history.slice(-this.config.stallWindow);
		const maxRecentGain = Math.max(...recent.map((h) => (h.accepted ? h.scoreChange : 0)), 0);
		return maxRecentGain <= this.config.noiseBandDelta;
	}

	/**
	 * Identifies underexplored components for structured exploration.
	 */
	getExplorationTargets(allKnownComponents: string[]): string[] {
		const explored = new Set(this.history.map((h) => h.component));
		const unexplored = allKnownComponents.filter((c) => !explored.has(c));
		if (unexplored.length > 0) {
			return unexplored;
		}
		// Sort known components by edit count ascending
		return [...allKnownComponents].sort((a, b) => {
			const aCount = this.componentStats.get(a)?.lifetimeEdits ?? 0;
			const bCount = this.componentStats.get(b)?.lifetimeEdits ?? 0;
			return aCount - bCount;
		});
	}

	/**
	 * Pre-evaluation Leakage Screening: rejects candidates containing benchmark-specific
	 * artifacts, hardcoded test IDs, or leaked answers.
	 */
	screenCandidateLeakage(diffText: string): { passes: boolean; reason?: string } {
		const patterns = this.config.leakagePatterns ?? [];
		for (const pat of patterns) {
			const regex = new RegExp(`\\b${pat}\\b`, "i");
			if (regex.test(diffText)) {
				return {
					passes: false,
					reason: `Rejected by Leakage Screening: references task/benchmark-specific pattern "${pat}"`,
				};
			}
		}

		// Reject inert/trivial changes (e.g. empty or whitespace only)
		if (diffText.trim().length === 0) {
			return {
				passes: false,
				reason: "Rejected: inert empty diff",
			};
		}

		return { passes: true };
	}

	/**
	 * Selection Evaluation with regularized criteria:
	 * 1. Cardinality check against annealed budget
	 * 2. Stability floor check (S' >= S* - delta)
	 * 3. Ridge/L2 complexity-aware token cost check (deltaC <= beta0 + beta1 * deltaS)
	 */
	evaluateCandidate(candidate: CandidateHarnessEvaluation, round: number): SelectionDecision {
		const budget = this.getProposalBudget(round);
		if (candidate.editsCount > budget) {
			return {
				accepted: false,
				reason: `Exceeded annealed edit budget: candidate has ${candidate.editsCount} edits, budget is ${budget}`,
			};
		}

		// Stability-aware floor
		const minAllowableScore = this.bestScore - this.config.noiseBandDelta;
		if (candidate.score < minAllowableScore) {
			return {
				accepted: false,
				reason: `Below stability floor: score ${candidate.score.toFixed(4)} < floor ${minAllowableScore.toFixed(4)}`,
			};
		}

		const deltaScore = candidate.score - this.bestScore;
		const deltaCostRatio =
			this.incumbentCost > 0 ? (candidate.policyTokenCost - this.incumbentCost) / this.incumbentCost : 0;

		// Ridge/L2 Complexity-Aware Acceptance:
		// If gain exceeds noise band, require deltaC <= beta0 + beta1 * deltaScore
		if (deltaScore > this.config.noiseBandDelta) {
			const allowedCostRatio = this.config.beta0 + this.config.beta1 * deltaScore;
			if (deltaCostRatio > allowedCostRatio) {
				return {
					accepted: false,
					reason: `Violated complexity gate: token cost grew by ${(deltaCostRatio * 100).toFixed(1)}% (max allowed ${(allowedCostRatio * 100).toFixed(1)}%)`,
				};
			}
		} else {
			// If gain is within or below noise band, candidate cannot increase costs
			if (deltaCostRatio > this.config.beta0) {
				return {
					accepted: false,
					reason: `Within noise band with unjustified cost increase of ${(deltaCostRatio * 100).toFixed(1)}%`,
				};
			}
			// If score did not strictly beat bestScore, reject
			if (candidate.score <= this.bestScore) {
				return {
					accepted: false,
					reason: `Candidate score ${candidate.score.toFixed(4)} did not exceed current best ${this.bestScore.toFixed(4)}`,
				};
			}
		}

		return {
			accepted: true,
			reason: "Passed all regularization constraints (sparsity, stability, complexity gating)",
			candidateId: candidate.candidateId,
			candidateScore: candidate.score,
			candidateCost: candidate.policyTokenCost,
		};
	}

	/**
	 * Applies the candidate outcome to record history and update incumbent state.
	 */
	recordEvaluation(candidate: CandidateHarnessEvaluation, decision: SelectionDecision, round: number): void {
		const scoreChange = candidate.score - this.bestScore;
		const costChangeRatio =
			this.incumbentCost > 0 ? (candidate.policyTokenCost - this.incumbentCost) / this.incumbentCost : 0;

		this.history.push({
			round,
			component: candidate.component,
			hypothesis: candidate.hypothesis,
			diffSummary: candidate.diffText.slice(0, 100),
			scoreChange,
			costChangeRatio,
			accepted: decision.accepted,
		});

		const stat = this.componentStats.get(candidate.component) ?? {
			lastPositiveGainRound: -1,
			lifetimeEdits: 0,
			gainsSum: 0,
		};
		stat.lifetimeEdits += 1;
		if (decision.accepted && scoreChange > 0) {
			stat.lastPositiveGainRound = round;
			stat.gainsSum += scoreChange;
			this.bestScore = candidate.score;
			this.incumbentCost = candidate.policyTokenCost;
		}
		this.componentStats.set(candidate.component, stat);
	}

	/**
	 * Lasso/L1-style structural pruning:
	 * Identifies components that have been modified but produced no strictly positive gain
	 * over the past pruning window rounds.
	 */
	identifyPruningTargets(currentRound: number): string[] {
		const targets: string[] = [];
		for (const [component, stat] of this.componentStats.entries()) {
			if (stat.lifetimeEdits > 0) {
				const roundsSincePositive =
					stat.lastPositiveGainRound === -1 ? currentRound : currentRound - stat.lastPositiveGainRound;
				if (roundsSincePositive >= this.config.pruningWindow) {
					targets.push(component);
				}
			}
		}
		return targets;
	}

	getBestScore(): number {
		return this.bestScore;
	}

	getIncumbentCost(): number {
		return this.incumbentCost;
	}

	getHistory(): readonly HarnessEditRecord[] {
		return this.history;
	}
}
