import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorktreeManager } from "../../core/src/worktree/index.ts";

describe("WorktreeManager", () => {
	it("detects git repositories accurately", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-wt-detect-"));
		try {
			expect(await WorktreeManager.isGitRepo(tempDir)).toBe(false);

			execSync("git init", { cwd: tempDir });
			expect(await WorktreeManager.isGitRepo(tempDir)).toBe(true);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("creates and cleans up an isolated worktree branch", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-wt-lifecycle-"));
		try {
			execSync("git init -b main", { cwd: tempDir });
			execSync("git config user.email 'test@example.com'", { cwd: tempDir });
			execSync("git config user.name 'Test'", { cwd: tempDir });

			fs.writeFileSync(path.join(tempDir, "README.md"), "# Initial Commit\n");
			execSync("git add README.md && git commit -m 'Initial commit'", { cwd: tempDir });

			// Create worktree
			const session = await WorktreeManager.createWorktree({
				repoPath: tempDir,
				taskName: "feature-test",
				sessionId: "s1",
			});

			expect(session.isIsolated).toBe(true);
			expect(fs.existsSync(session.worktreePath)).toBe(true);
			expect(session.branchName).toContain("pi-worktree-feature-test");

			// Write in worktree
			fs.writeFileSync(path.join(session.worktreePath, "feature.txt"), "New Feature Content");

			// Merge worktree back
			const merged = await WorktreeManager.mergeWorktree(
				tempDir,
				session.worktreePath,
				session.branchName,
				"feat: add feature file",
			);
			expect(merged).toBe(true);

			// Verify merged content in parent repo
			expect(fs.existsSync(path.join(tempDir, "feature.txt"))).toBe(true);
			expect(fs.readFileSync(path.join(tempDir, "feature.txt"), "utf8")).toBe("New Feature Content");

			// Verify worktree directory and branch were pruned
			expect(fs.existsSync(session.worktreePath)).toBe(false);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
