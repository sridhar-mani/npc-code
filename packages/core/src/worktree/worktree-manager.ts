/**
 * packages/core/src/worktree/worktree-manager.ts
 *
 * Git Worktree Isolation Manager for Pi.
 *
 * Runs autonomous tasks, speculative refactors, or risky edits inside isolated
 * ephemeral git worktree branches so exploratory changes never corrupt the user's
 * active working directory.
 */

import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execP = promisify(exec);

export interface WorktreeSession {
	readonly worktreePath: string;
	readonly branchName: string;
	readonly isIsolated: boolean;
}

export interface WorktreeCreateOptions {
	readonly repoPath: string;
	readonly sessionId?: string;
	readonly taskName?: string;
	readonly baseRef?: string;
	readonly worktreeRootDir?: string;
}

/**
 * Checks if a directory is inside a valid git working tree.
 */
export async function isGitRepo(dir: string): Promise<boolean> {
	try {
		const { stdout } = await execP("git rev-parse --is-inside-work-tree", { cwd: dir, timeout: 5000 });
		return stdout.trim() === "true";
	} catch {
		return false;
	}
}

/**
 * Prunes stale or disconnected git worktrees.
 */
export async function pruneStaleWorktrees(repoPath: string): Promise<void> {
	try {
		await execP("git worktree prune", { cwd: repoPath, timeout: 10_000 });
	} catch {
		// Ignore prune errors
	}
}

/**
 * Removes a worktree and deletes its associated ephemeral branch.
 */
export async function removeWorktree(repoPath: string, worktreePath: string, branchName?: string): Promise<void> {
	if (worktreePath === repoPath) return;

	try {
		await execP(`git worktree remove --force "${worktreePath}"`, { cwd: repoPath, timeout: 15_000 });
	} catch {
		// If git worktree remove fails, remove directory manually then prune
		try {
			if (fs.existsSync(worktreePath)) {
				fs.rmSync(worktreePath, { recursive: true, force: true });
			}
			await execP("git worktree prune", { cwd: repoPath, timeout: 10_000 });
		} catch {
			// Ignore cleanup failures
		}
	}

	if (branchName) {
		try {
			await execP(`git branch -D "${branchName}"`, { cwd: repoPath, timeout: 5000 });
		} catch {
			// Ignore branch deletion failures
		}
	}
}

/**
 * Creates an isolated git worktree branch for a task or session.
 */
export async function createWorktree(options: WorktreeCreateOptions): Promise<WorktreeSession> {
	const isGit = await isGitRepo(options.repoPath);
	if (!isGit) {
		return { worktreePath: options.repoPath, branchName: "", isIsolated: false };
	}

	await pruneStaleWorktrees(options.repoPath);

	const shortId = Math.random().toString(36).slice(2, 7);
	const sanitizedTask = (options.taskName ?? "task").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 20);
	const branchName = `pi-worktree-${sanitizedTask}-${shortId}`;
	const worktreesDir = options.worktreeRootDir ?? path.join(options.repoPath, ".pi/worktrees");
	const worktreePath = path.join(worktreesDir, `session-${options.sessionId ?? shortId}-${shortId}`);
	const baseRef = options.baseRef ?? "HEAD";

	try {
		fs.mkdirSync(worktreesDir, { recursive: true });

		// Ensure worktree directory is excluded in .git/info/exclude
		const gitExclude = path.join(options.repoPath, ".git/info/exclude");
		if (fs.existsSync(gitExclude)) {
			const content = fs.readFileSync(gitExclude, "utf8");
			if (!content.includes(".pi/worktrees")) {
				fs.appendFileSync(gitExclude, "\n.pi/worktrees/\n.ziq/worktrees/\n");
			}
		}

		await execP(`git worktree add -b "${branchName}" "${worktreePath}" ${baseRef}`, {
			cwd: options.repoPath,
			timeout: 20_000,
		});

		return { worktreePath, branchName, isIsolated: true };
	} catch {
		// Fall back to main repo directory if worktree creation fails
		return { worktreePath: options.repoPath, branchName: "", isIsolated: false };
	}
}

/**
 * Commits and merges verified worktree changes back into the parent branch.
 */
export async function mergeWorktree(
	repoPath: string,
	worktreePath: string,
	branchName: string,
	commitMessage?: string,
): Promise<boolean> {
	if (!branchName || worktreePath === repoPath) return true;

	try {
		// 1. Commit any uncommitted changes in the worktree
		try {
			await execP("git add -A", { cwd: worktreePath, timeout: 10_000 });
			const message = commitMessage ?? `pi(worktree): verified changes from ${branchName}`;
			await execP(`git commit -m "${message}"`, { cwd: worktreePath, timeout: 10_000 });
		} catch {
			// No uncommitted changes
		}

		// 2. Merge worktree branch into parent branch
		await execP(`git merge --no-ff -m "Merge isolated worktree ${branchName}" "${branchName}"`, {
			cwd: repoPath,
			timeout: 15_000,
		});

		// 3. Clean up worktree and branch
		await removeWorktree(repoPath, worktreePath, branchName);
		return true;
	} catch {
		return false;
	}
}

export const WorktreeManager = {
	isGitRepo,
	createWorktree,
	mergeWorktree,
	removeWorktree,
	pruneStaleWorktrees,
};
