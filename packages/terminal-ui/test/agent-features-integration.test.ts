import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentSession } from "../../core/src/sdk.ts";
import { ConventionStore } from "../../core/src/personalization/convention-store.ts";
import { SessionManager } from "../../core/src/session-manager.ts";
import { SettingsManager } from "../../core/src/settings-manager.ts";
import { DefaultResourceLoader } from "../../core/src/resource-loader.ts";

describe("agent feature integrations", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-agent-features-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
	if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	});

	async function makeSession(settingsOverrides: Parameters<typeof SettingsManager.inMemory>[0]) {
		const settingsManager = SettingsManager.inMemory(settingsOverrides);
		const resourceLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();
		return (
			await createAgentSession({
				cwd: tempDir,
				agentDir,
				model: getModel("anthropic", "claude-sonnet-4-5")!,
				settingsManager,
				sessionManager: SessionManager.inMemory(tempDir),
				resourceLoader,
			})
		).session;
	}

	it("selects the Switchyard virtual model when routing is enabled", async () => {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const session = await makeSession({
			agentFeatures: {
				switchyard: {
					enabled: true,
					efficientModel: `${model.provider}/${model.id}`,
					capableModel: `${model.provider}/${model.id}`,
					picker: "efficient_first",
				},
			},
		});

		expect(session.model?.provider).toBe("switchyard");
		expect(session.model?.id).toBe("auto");
		session.dispose();
	});

	it("injects enabled persisted conventions into the session system prompt", async () => {
		const store = new ConventionStore({ workspaceDir: tempDir });
		store.set({
			tier: "custom_rule",
			category: "style",
			content: "Always use TypeScript strict mode.",
			confidence: 1,
		});

		const session = await makeSession({
			agentFeatures: { personalization: { enabled: true, maxTokens: 1200 } },
		});

		expect(session.systemPrompt).toContain("Always use TypeScript strict mode.");
		session.dispose();
	});

	it("blocks dangerous tool calls through the enabled guardrail engine", async () => {
		const session = await makeSession({
			agentFeatures: { guardrails: { enabled: true, hooksEnabled: false, defaultTier: "ask" } },
		});

		await expect(
			session.agent.beforeToolCall?.({
			toolCall: { id: "test-call", name: "bash", arguments: { command: "rm -rf /" } } as any,
			args: { command: "rm -rf /" },
		} as any),
		).rejects.toThrow(/Guardrail blocked bash/);

		session.dispose();
	});

	it("blocks tool calls when a configured PreToolUse hook exits with code 2", async () => {
		const piDir = join(tempDir, ".pi");
		mkdirSync(piDir, { recursive: true });
		writeFileSync(
			join(piDir, "guardrails.json"),
			JSON.stringify({
				hooks: {
					PreToolUse: [
						{
							matcher: "bash",
							hooks: [{ type: "command", command: "node -e \\\"process.exit(2)\\\"" }],
						},
					],
				},
			}),
		);

		const session = await makeSession({
			agentFeatures: { guardrails: { enabled: true, hooksEnabled: true, defaultTier: "allow" } },
		});

		await expect(
			session.agent.beforeToolCall?.({
			toolCall: { id: "hook-call", name: "bash", arguments: { command: "echo safe" } } as any,
			args: { command: "echo safe" },
		} as any),
		).rejects.toThrow(/hook blocked/i);

		session.dispose();
	});
});
