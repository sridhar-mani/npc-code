import { describe, expect, it } from "vitest";
import { ExecCriticScaffold } from "../../core/src/index.ts";

describe("ExecCritic Decoupled Test & Repair Scaffold (Unit Tests)", () => {
	it("rejects non-discriminative test candidates that pass on buggy base code", async () => {
		const scaffold = new ExecCriticScaffold({ repoPath: process.cwd() });
		const result = await scaffold.qualifyReproductionTest(["tests/test_dummy.py"], "true");
		expect(result.qualified).toBe(false);
		expect(result.reason).toContain("Fail-closed test rejection");
		expect(scaffold.getActiveManifest()).toBeUndefined();
	});

	it("qualifies and freezes reproduction test when it reproduces defect with non-zero exit code", async () => {
		const scaffold = new ExecCriticScaffold({ repoPath: process.cwd() });
		const result = await scaffold.qualifyReproductionTest(["tests/test_reproduce.py", "tests/fixture.json"], "false");
		expect(result.qualified).toBe(true);
		expect(result.manifest).toBeDefined();
		expect(result.manifest?.testPaths).toContain("tests/test_reproduce.py");
		expect(result.manifest?.baseExitCode).not.toBe(0);

		// Verified that manifest is now active
		const active = scaffold.getActiveManifest();
		expect(active?.id).toBe(result.manifest?.id);
	});

	it("identifies protected test paths to prevent repair agent test tampering", async () => {
		const scaffold = new ExecCriticScaffold({ repoPath: process.cwd() });
		await scaffold.qualifyReproductionTest(["tests/reproduce_issue.ts"], "false");

		// Protected test files
		expect(scaffold.isProtectedTestFile("tests/reproduce_issue.ts")).toBe(true);
		expect(scaffold.isProtectedTestFile("/workspace/tests/reproduce_issue.ts")).toBe(true);

		// Unprotected application files
		expect(scaffold.isProtectedTestFile("src/service.ts")).toBe(false);
		expect(scaffold.isProtectedTestFile("packages/core/src/index.ts")).toBe(false);
	});

	it("throws if repair phase is requested before freezing a reproduction test", async () => {
		const scaffold = new ExecCriticScaffold({ repoPath: process.cwd() });
		await expect(scaffold.beginRepairPhase("test-session")).rejects.toThrow(
			"Cannot begin repair phase: No qualified reproduction test has been frozen",
		);
	});
});
