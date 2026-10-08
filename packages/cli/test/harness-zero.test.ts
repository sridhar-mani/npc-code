import { describe, expect, it } from "vitest";
import { type ActionProposal, HarnessZeroDistillationScaffold, type ReviewRule } from "../../core/src/index.ts";

describe("Harness-Zero: Harness Distillation via Agent-as-Harness", () => {
	it("intercepts student proposal and applies minimal coherent corrections", () => {
		// Define a rule simulating reference harness safety:
		// Block raw terminal commands that use recursive deletions without confirmation
		const dangerousRmRule: ReviewRule = {
			id: "safe_file_ops",
			name: "Safe File Deletion",
			predicate: (proposal: ActionProposal) => {
				return (
					proposal.actionType === "tool_call" &&
					proposal.toolName === "bash" &&
					typeof proposal.toolArguments?.command === "string" &&
					proposal.toolArguments.command.includes("rm -rf")
				);
			},
			correction: (proposal: ActionProposal) => {
				return {
					...proposal,
					toolArguments: {
						...proposal.toolArguments,
						command: (proposal.toolArguments?.command as string).replace("rm -rf", "rm -r -i"),
					},
				};
			},
			description: "Require interactive confirmation on recursive deletions",
		};

		const scaffold = new HarnessZeroDistillationScaffold([dangerousRmRule]);

		// Test a sound proposal (should pass unmodified)
		const soundProposal: ActionProposal = {
			actionType: "tool_call",
			toolName: "read",
			toolArguments: { path: "src/index.ts" },
		};
		const reviewSound = scaffold.reviewResponse(soundProposal);
		expect(reviewSound.wasModified).toBe(false);
		expect(reviewSound.effectiveAction.toolName).toBe("read");

		// Test proposal triggering teacher review
		const riskyProposal: ActionProposal = {
			actionType: "tool_call",
			toolName: "bash",
			toolArguments: { command: "rm -rf build/" },
		};
		const reviewRisky = scaffold.reviewResponse(riskyProposal);
		expect(reviewRisky.wasModified).toBe(true);
		expect(reviewRisky.appliedRuleId).toBe("safe_file_ops");
		expect(reviewRisky.effectiveAction.toolArguments?.command).toBe("rm -r -i build/");
	});

	it("records trajectory turns and exports clean SFT distillation samples", () => {
		const scaffold = new HarnessZeroDistillationScaffold();

		// Turn 1
		const p1: ActionProposal = {
			actionType: "tool_call",
			toolName: "read",
			toolArguments: { path: "package.json" },
		};
		const r1 = scaffold.reviewResponse(p1);
		scaffold.recordTurn(0, "Check project dependencies", p1, r1, '{"name": "pi"}');

		// Turn 2
		const p2: ActionProposal = {
			actionType: "tool_call",
			toolName: "edit",
			toolArguments: { path: "package.json" },
		};
		const r2 = scaffold.reviewResponse(p2);
		scaffold.recordTurn(1, "Fix package version", p2, r2, "Applied diff");

		// Finalize successful trajectory
		const entry = scaffold.finalizeTrajectory("traj_001", true);
		expect(entry.turns.length).toBe(2);
		expect(entry.taskSuccess).toBe(true);

		// Export SFT samples
		const sftSamples = scaffold.exportSftSamples();
		expect(sftSamples.length).toBe(2);
		expect(sftSamples[0].prompt).toBe("Check project dependencies");
		expect(sftSamples[0].targetAction.toolName).toBe("read");
		expect(sftSamples[1].prompt).toBe("Fix package version");
		expect(sftSamples[1].targetAction.toolName).toBe("edit");
	});

	it("filters out failed trajectories from SFT distillation export", () => {
		const scaffold = new HarnessZeroDistillationScaffold();

		const p: ActionProposal = {
			actionType: "tool_call",
			toolName: "bash",
			toolArguments: { command: "exit 1" },
		};
		const rev = scaffold.reviewResponse(p);
		scaffold.recordTurn(0, "Attempt failing task", p, rev, "Command failed");

		// Finalize as failed trajectory
		scaffold.finalizeTrajectory("traj_failed", false);

		const sftSamples = scaffold.exportSftSamples();
		expect(sftSamples.length).toBe(0);
	});
});
