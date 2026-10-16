import { describe, expect, it } from "vitest";
import { classifyCommandRisk } from "../src/guardrails/risk-classifier.ts";

describe("classifyCommandRisk", () => {
	it("classifies destructive file deletion as danger", () => {
		const result = classifyCommandRisk("bash", { command: "rm -rf /tmp/some_dir" });
		expect(result.dangerLevel).toBe("danger");
		expect(result.riskReason).toContain("rm -rf");
	});

	it("classifies destructive git operations as danger", () => {
		const reset = classifyCommandRisk("bash", { command: "git reset --hard HEAD~1" });
		expect(reset.dangerLevel).toBe("danger");

		const forcePush = classifyCommandRisk("bash", { command: "git push --force origin main" });
		expect(forcePush.dangerLevel).toBe("danger");
	});

	it("classifies privilege escalation and fork bomb as danger", () => {
		const sudo = classifyCommandRisk("bash", { command: "sudo apt-get update" });
		expect(sudo.dangerLevel).toBe("danger");

		const forkBomb = classifyCommandRisk("bash", { command: ":(){ :|:& };:" });
		expect(forkBomb.dangerLevel).toBe("danger");
	});

	it("classifies sensitive file modification as danger", () => {
		const envWrite = classifyCommandRisk("write", { path: "/project/.env" });
		expect(envWrite.dangerLevel).toBe("danger");
		expect(envWrite.riskReason).toContain("sensitive credentials");

		const sshWrite = classifyCommandRisk("edit", { path: "/home/user/.ssh/id_rsa" });
		expect(sshWrite.dangerLevel).toBe("danger");
	});

	it("classifies outbound network or package installs as warning", () => {
		const npm = classifyCommandRisk("bash", { command: "npm install express" });
		expect(npm.dangerLevel).toBe("warning");

		const curl = classifyCommandRisk("bash", { command: "curl https://api.example.com/data" });
		expect(curl.dangerLevel).toBe("warning");
	});

	it("classifies safe read-only commands as safe", () => {
		const status = classifyCommandRisk("read", { path: "/project/src/index.ts" });
		expect(status.dangerLevel).toBe("safe");
	});
});
