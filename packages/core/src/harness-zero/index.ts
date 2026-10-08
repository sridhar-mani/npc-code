/**
 * Harness-Zero: Harness Distillation via Agent-as-Harness.
 * Reference: Ye et al., "Harness-Zero: Harness Distillation via Agent-as-Harness" (arXiv:2609.24974).
 *
 * Implements:
 * 1. Agent-as-Harness response interceptor at the response boundary.
 * 2. Review and correction mechanism: validates candidate proposals against reference harness rules,
 *    translating/correcting into student-native executable actions.
 * 3. Distillation trajectory recorder collecting clean supervised fine-tuning (SFT) demonstrations
 *    without leaking teacher scratchpads or hidden test information.
 */

export interface ActionProposal {
	actionType: "tool_call" | "message" | "stop";
	toolName?: string;
	toolArguments?: Record<string, unknown>;
	content?: string;
}

export interface ReviewRule {
	id: string;
	name: string;
	predicate: (proposal: ActionProposal) => boolean;
	correction: (proposal: ActionProposal) => ActionProposal;
	description: string;
}

export interface TeacherReviewResult {
	accepted: boolean;
	wasModified: boolean;
	effectiveAction: ActionProposal;
	appliedRuleId?: string;
	teacherNote?: string;
}

export interface DistillationTurn {
	turnIndex: number;
	userPrompt: string;
	studentProposal: ActionProposal;
	teacherAcceptedAction: ActionProposal;
	wasCorrected: boolean;
	observation?: string;
}

export interface DistillationDatasetEntry {
	trajectoryId: string;
	turns: DistillationTurn[];
	taskSuccess: boolean;
}

export class HarnessZeroDistillationScaffold {
	private rules: ReviewRule[] = [];
	private activeTrajectory: DistillationTurn[] = [];
	private dataset: DistillationDatasetEntry[] = [];

	constructor(rules: ReviewRule[] = []) {
		this.rules = [...rules];
	}

	addReviewRule(rule: ReviewRule): void {
		this.rules.push(rule);
	}

	/**
	 * Reviews the student proposal at the response boundary.
	 * If a rule triggers, it modifies the proposal into a sound, student-native action.
	 */
	reviewResponse(proposal: ActionProposal): TeacherReviewResult {
		let current = { ...proposal };
		let wasModified = false;
		let appliedRuleId: string | undefined;
		let teacherNote: string | undefined;

		for (const rule of this.rules) {
			if (rule.predicate(current)) {
				current = rule.correction(current);
				wasModified = true;
				appliedRuleId = rule.id;
				teacherNote = rule.description;
				break; // Smallest coherent correction
			}
		}

		return {
			accepted: true,
			wasModified,
			effectiveAction: current,
			appliedRuleId,
			teacherNote,
		};
	}

	/**
	 * Records a turn into the active distillation trajectory.
	 * Teacher internal review notes are stripped so student demonstrations remain clean.
	 */
	recordTurn(
		turnIndex: number,
		userPrompt: string,
		studentProposal: ActionProposal,
		review: TeacherReviewResult,
		observation?: string,
	): DistillationTurn {
		const turn: DistillationTurn = {
			turnIndex,
			userPrompt,
			studentProposal,
			teacherAcceptedAction: review.effectiveAction,
			wasCorrected: review.wasModified,
			observation,
		};
		this.activeTrajectory.push(turn);
		return turn;
	}

	/**
	 * Finalizes the current active trajectory and saves it to the dataset.
	 */
	finalizeTrajectory(trajectoryId: string, taskSuccess: boolean): DistillationDatasetEntry {
		const entry: DistillationDatasetEntry = {
			trajectoryId,
			turns: [...this.activeTrajectory],
			taskSuccess,
		};
		this.dataset.push(entry);
		this.activeTrajectory = [];
		return entry;
	}

	/**
	 * Exports the distillation dataset formatted for Supervised Fine-Tuning (SFT).
	 * Generates input-output pairs where input is the context and output is the teacher-corrected action.
	 */
	exportSftSamples(): Array<{ prompt: string; targetAction: ActionProposal }> {
		const samples: Array<{ prompt: string; targetAction: ActionProposal }> = [];
		for (const traj of this.dataset) {
			if (!traj.taskSuccess) continue; // Only distill successful demonstrations
			for (const turn of traj.turns) {
				samples.push({
					prompt: turn.userPrompt,
					targetAction: turn.teacherAcceptedAction,
				});
			}
		}
		return samples;
	}

	getDataset(): readonly DistillationDatasetEntry[] {
		return this.dataset;
	}
}
