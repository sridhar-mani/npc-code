import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FourTierPermissionEngine, HookRunner, PermissionTier } from "../../core/src/guardrails/index.ts";

describe("FourTierPermissionEngine", () => {
	const engine = new FourTierPermissionEngine();

	it("allows read actions under default policy (Tier 0)", () => {
		const result = engine.evaluate({
			action: "read",
			resourcePath: "/home/project/src/index.ts",
		});
		expect(result.tier).toBe(PermissionTier.AlwaysAllow);
		expect(result.decision).toBe("allow");
	});

	it("asks for permission on modify actions (Tier 1)", () => {
		const result = engine.evaluate({
			action: "write",
			resourcePath: "/home/project/src/index.ts",
		});
		expect(result.tier).toBe(PermissionTier.AskOnModify);
		expect(result.decision).toBe("ask");
	});

	it("asks for permission on network commands like git push and curl (Tier 2)", () => {
		const curlResult = engine.evaluate({
			action: "bash",
			command: "curl https://api.example.com",
		});
		expect(curlResult.tier).toBe(PermissionTier.AskOnExternal);
		expect(curlResult.decision).toBe("ask");

		const gitResult = engine.evaluate({
			action: "bash",
			command: "git push origin main",
		});
		expect(gitResult.tier).toBe(PermissionTier.AskOnExternal);
		expect(gitResult.decision).toBe("ask");
	});

	it("strictly blocks sensitive paths like /etc/shadow or ~/.ssh/id_rsa (Tier 3)", () => {
		const sshResult = engine.evaluate({
			action: "read",
			resourcePath: path.join(os.homedir(), ".ssh/id_rsa"),
		});
		expect(sshResult.tier).toBe(PermissionTier.StrictlyBlock);
		expect(sshResult.decision).toBe("deny");

		const envResult = engine.evaluate({
			action: "read",
			resourcePath: "/project/.env",
		});
		expect(envResult.tier).toBe(PermissionTier.StrictlyBlock);
		expect(envResult.decision).toBe("deny");
	});

	it("strictly blocks destructive system commands (Tier 3)", () => {
		const rmResult = engine.evaluate({
			action: "bash",
			command: "rm -rf /",
		});
		expect(rmResult.tier).toBe(PermissionTier.StrictlyBlock);
		expect(rmResult.decision).toBe("deny");
	});

	it("supports custom permission rules", () => {
		const customEngine = new FourTierPermissionEngine({
			customRules: [
				{
					action: "deploy",
					tier: "strictly_block",
					description: "Deployments disabled in sandbox",
				},
			],
		});
		const res = customEngine.evaluate({ action: "deploy" });
		expect(res.tier).toBe(PermissionTier.StrictlyBlock);
		expect(res.decision).toBe("deny");
		expect(res.reason).toBe("Deployments disabled in sandbox");
	});
});

describe("HookRunner", () => {
	it("proceeds when no hooks match or block", () => {
		const result = HookRunner.run("PreToolUse", {
			toolName: "read",
			toolInput: { path: "test.txt" },
		});
		expect(result.proceed).toBe(true);
	});

	it("blocks execution when declarative hook exits with code 2", () => {
		const result = HookRunner.run(
			"PreToolUse",
			{
				toolName: "bash",
				toolInput: { command: "rm -rf something" },
			},
			{
				hooks: {
					PreToolUse: [
						{
							matcher: "bash",
							hooks: [
								{
									command: "echo 'Blocked by security hook' >&2 && exit 2",
								},
							],
						},
					],
				},
			},
		);
		expect(result.proceed).toBe(false);
		expect(result.blockedReason).toContain("Blocked by security hook");
	});

	it("blocks execution when file-based PreToolUse.sh script exits with code 2", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-hook-test-"));
		const hookDir = path.join(tempDir, ".pi/hooks");
		fs.mkdirSync(hookDir, { recursive: true });

		const hookScript = path.join(hookDir, "PreToolUse.sh");
		fs.writeFileSync(
			hookScript,
			`#!/usr/bin/env bash
if [ "$PI_TOOL_NAME" = "blocked_tool" ]; then
  echo "Blocked by file hook script" >&2
  exit 2
fi
exit 0
`,
		);
		fs.chmodSync(hookScript, 0o755);

		try {
			const allowRes = HookRunner.run("PreToolUse", {
				toolName: "allowed_tool",
				workspaceDir: tempDir,
			});
			expect(allowRes.proceed).toBe(true);

			const blockRes = HookRunner.run("PreToolUse", {
				toolName: "blocked_tool",
				workspaceDir: tempDir,
			});
			expect(blockRes.proceed).toBe(false);
			expect(blockRes.blockedReason).toContain("Blocked by file hook script");
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
