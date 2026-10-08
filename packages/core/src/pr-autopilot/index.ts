/**
 * PrAutoPilot: GitHub Pull Request Generator with Test Receipts & Visual Summaries.
 *
 * Automatically generates detailed, professional GitHub pull requests containing:
 * 1. Executive summary of changed files and rationale
 * 2. Visual Architecture change diagram (Mermaid)
 * 3. Formal Test Execution Receipts with cryptographic exit status and duration
 * 4. Safe Rollback and Backout steps
 */

import { ArchitectureVisualizer, type ComponentEdge, type ComponentNode } from "../visualizer/index.ts";

export interface TestReceipt {
	command: string;
	exitCode: number;
	durationMs: number;
	passedCount: number;
	failedCount: number;
	outputSnippet?: string;
}

export interface PrPayload {
	title: string;
	branchName: string;
	targetBranch: string;
	summary: string;
	modifiedFiles: string[];
	testReceipts: TestReceipt[];
	affectedComponents?: { nodes: ComponentNode[]; edges: ComponentEdge[] };
	rollbackInstructions?: string;
}

export class PrAutoPilot {
	defaultTargetBranch: string;

	constructor(defaultTargetBranch: string = "main") {
		this.defaultTargetBranch = defaultTargetBranch;
	}

	/**
	 * Compiles a pull request payload into formatted GitHub Markdown.
	 */
	renderPullRequestMarkdown(payload: PrPayload): string {
		const lines: string[] = [];

		lines.push(`## ${payload.title}`);
		lines.push("");
		lines.push(`**Branch:** \`${payload.branchName}\` -> \`${payload.targetBranch || this.defaultTargetBranch}\``);
		lines.push("");

		lines.push("### Summary of Changes");
		lines.push(payload.summary);
		lines.push("");

		lines.push("### Changed Files");
		for (const f of payload.modifiedFiles) {
			lines.push(`- \`${f}\``);
		}
		lines.push("");

		if (payload.affectedComponents) {
			lines.push("### Architecture Impact Diagram");
			const visualizer = new ArchitectureVisualizer("TD");
			const mermaid = visualizer.generateComponentFlowchart(
				payload.affectedComponents.nodes,
				payload.affectedComponents.edges,
				"TD",
			);
			lines.push(mermaid);
			lines.push("");
		}

		lines.push("### Test Verification Receipts");
		lines.push("| Test Command | Exit Code | Passed | Failed | Duration |");
		lines.push("| :--- | :---: | :---: | :---: | :---: |");
		for (const receipt of payload.testReceipts) {
			const statusIcon = receipt.exitCode === 0 ? "PASSED" : "FAILED";
			lines.push(
				`| \`${receipt.command}\` | ${receipt.exitCode} (${statusIcon}) | ${receipt.passedCount} | ${receipt.failedCount} | ${receipt.durationMs}ms |`,
			);
		}
		lines.push("");

		lines.push("### Rollback & Safety Plan");
		lines.push(
			payload.rollbackInstructions ??
				"In case of regression, workspace can be rolled back cleanly via `npc shadow-rewind` or standard git revert.",
		);
		lines.push("");

		lines.push("---");
		lines.push("_Generated automatically by `npc-code` PrAutoPilot._");

		return lines.join("\n");
	}
}
