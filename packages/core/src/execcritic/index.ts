/**
 * packages/core/src/execcritic/index.ts
 *
 * ExecCritic: Decoupled Test & Repair Scaffold based on:
 * "ExecCritic: Learn to Test, Test to Improve for Coding Agents" (2026)
 *
 * Provides:
 * 1. Fail-closed test qualification (Base-to-Gold discrimination):
 *    - Rejects tests that trivially pass on buggy base code.
 *    - Freezes qualified reproduction tests as immutable targets.
 * 2. Role-isolated repair loop:
 *    - Repair agent works in an isolated worktree.
 *    - Repair agent cannot modify or weaken frozen reproduction tests.
 *    - Iterates with execution feedback until the frozen test cleanly passes.
 */

import { executeBashWithOperations } from "../bash-executor.ts";
import { createLocalBashOperations } from "../tools/bash.ts";
import { createWorktree, removeWorktree, type WorktreeSession } from "../worktree/worktree-manager.ts";

export interface FrozenTestManifest {
	readonly id: string;
	readonly testPaths: readonly string[];
	readonly testCommand: string;
	readonly baseExitCode: number;
	readonly baseOutput: string;
	readonly qualifiedAt: number;
}

export interface QualificationResult {
	readonly qualified: boolean;
	readonly reason: string;
	readonly manifest?: FrozenTestManifest;
}

export interface RepairIterationResult {
	readonly iteration: number;
	readonly resolved: boolean;
	readonly exitCode: number;
	readonly output: string;
}

export interface ExecCriticOptions {
	readonly repoPath: string;
	readonly maxRepairRounds?: number;
}

export class ExecCriticScaffold {
	private readonly repoPath: string;
	private readonly maxRepairRounds: number;
	private activeFrozenManifest?: FrozenTestManifest;
	private testWorktree?: WorktreeSession;
	private repairWorktree?: WorktreeSession;

	constructor(options: ExecCriticOptions) {
		this.repoPath = options.repoPath;
		this.maxRepairRounds = options.maxRepairRounds ?? 4;
	}

	/**
	 * Creates an isolated worktree for test generation.
	 */
	public async beginTestGenerationPhase(sessionId: string): Promise<WorktreeSession> {
		this.testWorktree = await createWorktree({
			repoPath: this.repoPath,
			sessionId,
			taskName: "execcritic-test-gen",
			branchPrefix: "execcritic/test",
		});
		return this.testWorktree;
	}

	/**
	 * Fail-closed test qualification predicate:
	 * Runs the candidate test command against the base repository.
	 * Must fail (exitCode != 0) to verify it reproduces the problem.
	 */
	public async qualifyReproductionTest(
		testPaths: string[],
		testCommand: string,
		worktreePath?: string,
		signal?: AbortSignal,
	): Promise<QualificationResult> {
		const targetDir = worktreePath ?? this.testWorktree?.worktreePath ?? this.repoPath;
		const operations = createLocalBashOperations();
		const execution = await executeBashWithOperations(testCommand, targetDir, operations, { signal });

		const exitCode = execution.exitCode ?? (execution.cancelled ? 130 : 1);

		// Fail-closed rule: A test that passes on the buggy codebase is non-discriminative and rejected
		if (exitCode === 0) {
			return {
				qualified: false,
				reason:
					"Fail-closed test rejection: Candidate test passed on buggy base repository (exit code 0). It does not reproduce the failure.",
			};
		}

		const manifest: FrozenTestManifest = {
			id: `test-manifest-${Date.now()}`,
			testPaths: [...testPaths],
			testCommand,
			baseExitCode: exitCode,
			baseOutput: execution.output,
			qualifiedAt: Date.now(),
		};

		this.activeFrozenManifest = manifest;
		return {
			qualified: true,
			reason: `Test qualified: cleanly reproduced defect with exit code ${exitCode}.`,
			manifest,
		};
	}

	/**
	 * Creates an isolated repair worktree with frozen test constraints.
	 */
	public async beginRepairPhase(sessionId: string): Promise<WorktreeSession> {
		if (!this.activeFrozenManifest) {
			throw new Error("Cannot begin repair phase: No qualified reproduction test has been frozen.");
		}

		this.repairWorktree = await createWorktree({
			repoPath: this.repoPath,
			sessionId,
			taskName: "execcritic-repair",
			branchPrefix: "execcritic/repair",
		});

		return this.repairWorktree;
	}

	/**
	 * Checks whether a proposed file path is part of the frozen reproduction test suite.
	 * Prevents the Repair Agent from modifying or deleting the test to force a false pass.
	 */
	public isProtectedTestFile(targetFilePath: string): boolean {
		if (!this.activeFrozenManifest) return false;
		return this.activeFrozenManifest.testPaths.some((testPath) => targetFilePath.includes(testPath));
	}

	/**
	 * Executes the frozen test against the repair worktree to measure progress.
	 */
	public async evaluateRepair(iteration: number, signal?: AbortSignal): Promise<RepairIterationResult> {
		if (!this.activeFrozenManifest) {
			throw new Error("No frozen test manifest available to evaluate repair.");
		}
		if (!this.repairWorktree) {
			throw new Error("Repair worktree is not active.");
		}

		const operations = createLocalBashOperations();
		const execution = await executeBashWithOperations(
			this.activeFrozenManifest.testCommand,
			this.repairWorktree.worktreePath,
			operations,
			{ signal },
		);

		const exitCode = execution.exitCode ?? (execution.cancelled ? 130 : 1);
		const resolved = exitCode === 0;

		return {
			iteration,
			resolved,
			exitCode,
			output: execution.output,
		};
	}

	public getActiveManifest(): FrozenTestManifest | undefined {
		return this.activeFrozenManifest;
	}

	public async cleanup(): Promise<void> {
		if (this.testWorktree) {
			await removeWorktree(this.repoPath, this.testWorktree.worktreePath, this.testWorktree.branchName);
			this.testWorktree = undefined;
		}
		if (this.repairWorktree) {
			await removeWorktree(this.repoPath, this.repairWorktree.worktreePath, this.repairWorktree.branchName);
			this.repairWorktree = undefined;
		}
	}
}
