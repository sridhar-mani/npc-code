/**
 * packages/core/src/guardrails/hook-runner.ts
 *
 * Declarative Lifecycle Hook Runner for Pi.
 *
 * Supported features:
 * 1. Declarative command definitions from settings.json / guardrails.json with tool matchers ("bash", "write", etc.)
 * 2. File-based script execution from .npc/hooks/ (e.g. PreToolUse.sh, PostToolUse.sh)
 * 3. Enforces exit code 2 as policy block with stderr returned as model feedback.
 * 4. Supplies tool arguments via stdin JSON and NPC_* environment variables.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type HookEvent = "PreToolUse" | "PostToolUse";

export interface HookCommandDef {
	readonly type?: "command";
	readonly command: string;
	readonly timeout?: number;
	readonly statusMessage?: string;
}

export interface HookMatcherGroup {
	readonly matcher?: string;
	readonly hooks: readonly HookCommandDef[];
}

export interface DeclarativeHooksConfig {
	readonly hooks?: {
		readonly [K in HookEvent]?: readonly HookMatcherGroup[];
	};
}

export interface HookContext {
	readonly toolName?: string;
	readonly toolInput?: Record<string, unknown>;
	readonly toolOutput?: unknown;
	readonly sessionID?: string;
	readonly workspaceDir?: string;
}

export interface HookResult {
	readonly proceed: boolean;
	readonly blockedReason?: string;
}

function matchesTool(matcher: string | undefined, toolName: string | undefined): boolean {
	if (!matcher || matcher === "" || matcher === "*") return true;
	if (!toolName) return false;

	const normMatcher = matcher.trim().toLowerCase();
	const normTool = toolName.trim().toLowerCase();
	if (normMatcher === normTool) return true;

	if (normMatcher.includes("*")) {
		const escaped = normMatcher.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*");
		try {
			return new RegExp(`^${escaped}$`, "i").test(normTool);
		} catch {
			return false;
		}
	}
	return false;
}

export function loadDeclarativeHooks(workspaceDir?: string): DeclarativeHooksConfig {
	const homedir = os.homedir();
	const candidateFiles: string[] = [];

	const envFile = process.env.NPC_HOOKS_CONFIG ?? process.env.PI_HOOKS_CONFIG;
	if (envFile && fs.existsSync(envFile)) {
		candidateFiles.push(envFile);
	}

	if (workspaceDir) {
		candidateFiles.push(
			path.join(workspaceDir, ".npc/guardrails.json"),
			path.join(workspaceDir, ".npc/settings.json"),
		);
	}
	candidateFiles.push(
		path.join(homedir, ".config/npc-code/guardrails.json"),
		path.join(homedir, ".config/npc/guardrails.json"),
	);

	const mergedHooks: Record<string, HookMatcherGroup[]> = {};

	for (const filePath of candidateFiles) {
		if (!fs.existsSync(filePath)) continue;
		try {
			const content = fs.readFileSync(filePath, "utf8");
			const json = JSON.parse(content);
			if (json && typeof json === "object" && json.hooks && typeof json.hooks === "object") {
				for (const [evt, groups] of Object.entries(json.hooks)) {
					if (Array.isArray(groups)) {
						mergedHooks[evt] = (mergedHooks[evt] ?? []).concat(groups as HookMatcherGroup[]);
					}
				}
			}
		} catch {
			// Ignore invalid files
		}
	}

	return { hooks: mergedHooks as DeclarativeHooksConfig["hooks"] };
}

export function runHook(
	event: HookEvent,
	context: HookContext,
	declarativeConfig?: DeclarativeHooksConfig,
): HookResult {
	const cwd = context.workspaceDir && fs.existsSync(context.workspaceDir) ? context.workspaceDir : process.cwd();
	const toolInputJson = JSON.stringify(context.toolInput ?? {});
	const toolOutputJson = JSON.stringify(context.toolOutput ?? {});

	const env: NodeJS.ProcessEnv = {
		...process.env,
		PI_TOOL_NAME: context.toolName ?? "",
		PI_TOOL_INPUT: toolInputJson,
		PI_TOOL_OUTPUT: toolOutputJson,
		PI_SESSION_ID: context.sessionID ?? "",
		PI_WORKSPACE_DIR: cwd,
		NPC_TOOL_NAME: context.toolName ?? "",
		NPC_TOOL_INPUT: toolInputJson,
		NPC_TOOL_OUTPUT: toolOutputJson,
		NPC_SESSION_ID: context.sessionID ?? "",
		NPC_WORKSPACE_DIR: cwd,
	};

	// 1. Evaluate declarative hooks from settings/guardrails configuration
	const config = declarativeConfig ?? loadDeclarativeHooks(context.workspaceDir);
	const groups = config.hooks?.[event] ?? [];

	for (const group of groups) {
		if (!matchesTool(group.matcher, context.toolName)) continue;

		for (const hook of group.hooks) {
			const timeoutMs = hook.timeout && hook.timeout > 0 ? hook.timeout * 1000 : 30_000;
			const proc = spawnSync(hook.command, {
				shell: true,
				cwd,
				env,
				input: toolInputJson,
				timeout: timeoutMs,
				encoding: "utf8",
				maxBuffer: 10 * 1024 * 1024,
			});

			if (proc.status === 2) {
				const reason =
					proc.stderr?.trim() || proc.stdout?.trim() || `Execution blocked by declarative hook: ${hook.command}`;
				return { proceed: false, blockedReason: reason };
			}
		}
	}

	// 2. Fallback to file-based hooks in workspace directories
	if (context.workspaceDir) {
		const candidateScripts = [path.join(context.workspaceDir, ".npc/hooks", `${event}.sh`)];

		for (const scriptPath of candidateScripts) {
			if (!fs.existsSync(scriptPath)) continue;

			try {
				const proc = spawnSync("bash", [scriptPath], {
					cwd,
					env,
					input: toolInputJson,
					timeout: 30_000,
					encoding: "utf8",
					maxBuffer: 10 * 1024 * 1024,
				});

				if (proc.status === 2) {
					const reason =
						proc.stderr?.trim() ||
						proc.stdout?.trim() ||
						`Execution blocked by hook script: ${path.basename(scriptPath)}`;
					return { proceed: false, blockedReason: reason };
				}
			} catch {
				// Fall through on execution error
			}
		}
	}

	return { proceed: true };
}

export const HookRunner = {
	loadDeclarativeHooks,
	run: runHook,
};
