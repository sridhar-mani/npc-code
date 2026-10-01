import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentSessionFromServices, createAgentSessionServices } from "../../core/src/agent-session-services.ts";
import type { ExtensionContext } from "../../core/src/extensions/types.ts";
import { DefaultResourceLoader } from "../../core/src/resource-loader.ts";
import { type CreateAgentSessionOptions, createAgentSession, type InlineExtension } from "../../core/src/sdk.ts";
import { SembleSearchService } from "../../core/src/semble/semble-search.ts";
import { SessionManager } from "../../core/src/session-manager.ts";
import { SettingsManager } from "../../core/src/settings-manager.ts";

type ToolOptions = Pick<CreateAgentSessionOptions, "tools" | "excludeTools" | "noTools" | "customTools">;

describe("defaultTools setting", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-default-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	async function createSession(
		defaultTools: string[],
		options: ToolOptions = {},
		extensionFactories: InlineExtension[] = [],
	) {
		const settingsManager = SettingsManager.inMemory({ defaultTools });
		const resourceLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager,
			extensionFactories,
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
				...options,
			})
		).session;
	}

	it("uses the configured list as the initial built-in selection", async () => {
		const session = await createSession(["grep", "find"]);

		expect(
			session
				.getAllTools()
				.map((tool) => tool.name)
				.sort(),
		).toEqual(["bash", "edit", "find", "grep", "ls", "powershell", "read", "write"]);
		expect(session.getActiveToolNames()).toEqual(["grep", "find"]);
		expect(session.systemPrompt).toContain("- grep:");
		expect(session.systemPrompt).not.toContain("- read:");
		session.dispose();
	});

	it("adds Semble to the active tool loadout when the feature is enabled", async () => {
		const settingsManager = SettingsManager.inMemory({
			agentFeatures: { semble: { enabled: true } },
		});
		const resourceLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();

		const session = (
			await createAgentSession({
				cwd: tempDir,
				agentDir,
				model: getModel("anthropic", "claude-sonnet-4-5")!,
				settingsManager,
				sessionManager: SessionManager.inMemory(tempDir),
				resourceLoader,
			})
		).session;

		expect(session.getActiveToolNames()).toContain("semble");
		expect(session.getAllTools().map((tool) => tool.name)).toContain("semble");
		session.dispose();
	});

	it("can select powershell instead of bash", async () => {
		const session = await createSession(["read", "powershell", "edit", "write"]);

		expect(session.getActiveToolNames()).toEqual(["read", "powershell", "edit", "write"]);
		expect(session.systemPrompt).toContain("- powershell: Execute PowerShell commands");
		expect(session.systemPrompt).not.toContain("- bash:");
		session.dispose();
	});

	it("keeps extension and SDK custom tools enabled", async () => {
		const session = await createSession(
			["grep"],
			{
				customTools: [
					{
						name: "sdk_tool",
						label: "SDK Tool",
						description: "SDK custom tool",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					},
				],
			},
			[
				(pi) => {
					pi.registerTool({
						name: "static_tool",
						label: "Static Tool",
						description: "Statically registered extension tool",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					});
					pi.on("session_start", () => {
						pi.registerTool({
							name: "dynamic_tool",
							label: "Dynamic Tool",
							description: "Dynamically registered extension tool",
							parameters: Type.Object({}),
							execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
						});
					});
				},
			],
		);
		await session.bindExtensions({});

		expect(session.getActiveToolNames().sort()).toEqual(["dynamic_tool", "grep", "sdk_tool", "static_tool"]);
		expect(session.getAllTools().map((tool) => tool.name)).toEqual(
			expect.arrayContaining(["read", "dynamic_tool", "sdk_tool", "static_tool"]),
		);
		session.dispose();
	});

	it("does not override explicit tool selection when Semble is enabled", async () => {
		const explicitSession = await createSession([], { tools: ["read"] });
		expect(explicitSession.getActiveToolNames()).toEqual(["read"]);
		explicitSession.dispose();

		const noToolsSession = await createSession([], { noTools: "all" });
		expect(noToolsSession.getActiveToolNames()).toEqual([]);
		noToolsSession.dispose();

		const excludedSession = await createSession([], { excludeTools: ["semble"] });
		expect(excludedSession.getActiveToolNames()).not.toContain("semble");
		excludedSession.dispose();
	});

	it("passes the configured Semble result limit into the tool", async () => {
		const searchSpy = vi.spyOn(SembleSearchService, "search").mockResolvedValue([]);
		const settingsManager = SettingsManager.inMemory({
			agentFeatures: { semble: { enabled: true, maxResults: 12 } },
		});
		const resourceLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();

		const session = (
			await createAgentSession({
				cwd: tempDir,
				agentDir,
				model: getModel("anthropic", "claude-sonnet-4-5")!,
				settingsManager,
				sessionManager: SessionManager.inMemory(tempDir),
				resourceLoader,
			})
		).session;

		const tool = session.getToolDefinition("semble");
		expect(tool).toBeDefined();
		await tool!.execute("test-call", { query: "needle" }, undefined, undefined, {} as ExtensionContext);
		expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ query: "needle", limit: 12 }));
		searchSpy.mockRestore();
		session.dispose();
	});

	it("preserves explicit tool option precedence", async () => {
		const allowlistedSession = await createSession(["grep"], { tools: ["read"] });
		expect(allowlistedSession.getActiveToolNames()).toEqual(["read"]);
		allowlistedSession.dispose();

		const excludedSession = await createSession(["read", "grep"], { excludeTools: ["read"] });
		expect(excludedSession.getActiveToolNames()).toEqual(["grep"]);
		excludedSession.dispose();

		const toolLessSession = await createSession(["read"], { noTools: "all" });
		expect(toolLessSession.getAllTools()).toEqual([]);
		expect(toolLessSession.getActiveToolNames()).toEqual([]);
		toolLessSession.dispose();
	});

	it("applies through service-based session creation", async () => {
		const settingsManager = SettingsManager.inMemory({ defaultTools: ["ls"] });
		const services = await createAgentSessionServices({ cwd: tempDir, agentDir, settingsManager });
		const { session } = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(tempDir),
			model: getModel("anthropic", "claude-sonnet-4-5")!,
		});

		expect(
			session
				.getAllTools()
				.map((tool) => tool.name)
				.sort(),
		).toEqual(["bash", "edit", "find", "grep", "ls", "powershell", "read", "write"]);
		expect(session.getActiveToolNames()).toEqual(["ls"]);
		session.dispose();
	});
});
