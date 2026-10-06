/**
 * packages/core/src/guardrails/four-tier-engine.ts
 *
 * 4-Tier Declarative Permission Policy Engine for Pi.
 *
 * Tiers:
 *   Tier 0 (Always Allow): Read-only within workspace, non-mutating queries, local checks.
 *   Tier 1 (Ask on Modify): Workspace file edits, write operations, local environment mutations.
 *   Tier 2 (Ask on External/Network): Outbound HTTP/fetch, web search, package installations, git push/pull.
 *   Tier 3 (Strictly Block): Out-of-workspace paths, root/etc, sensitive credentials (.env, id_rsa), destructive sys calls.
 *
 * Zero Hardcoding Invariant: All default patterns are configurable via PermissionPolicyConfig,
 * environment variables, or local JSON manifests (.pi/guardrails.json, .ziq/guardrails.json).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PermissionTier = {
	AlwaysAllow: 0,
	AskOnModify: 1,
	AskOnExternal: 2,
	StrictlyBlock: 3,
} as const;

export type PermissionTier = (typeof PermissionTier)[keyof typeof PermissionTier];

export type TierName = "always_allow" | "ask_on_modify" | "ask_on_external" | "strictly_block";

export interface CustomPermissionRule {
	readonly action?: string;
	readonly resource?: string;
	readonly tier: TierName;
	readonly description?: string;
}

export interface PermissionPolicyConfig {
	readonly version?: 1;
	readonly defaultTier?: TierName;
	readonly blockedPathPatterns?: readonly string[];
	readonly blockedCommandPatterns?: readonly string[];
	readonly networkActionPatterns?: readonly string[];
	readonly networkCommandPatterns?: readonly string[];
	readonly modifyActionPatterns?: readonly string[];
	readonly customRules?: readonly CustomPermissionRule[];
}

export interface EvaluationResult {
	readonly tier: PermissionTier;
	readonly tierName: TierName;
	readonly decision: "allow" | "ask" | "deny";
	readonly reason: string;
}

export interface PolicyEvaluationTarget {
	readonly action: string;
	readonly command?: string;
	readonly resourcePath?: string;
	readonly workspaceDir?: string;
}

function matchGlob(pattern: string, target: string, isPath = true): boolean {
	const normTarget = target.replace(/\\/g, "/");
	const normPattern = pattern.replace(/\\/g, "/");
	if (normPattern === "*" || normPattern === "**" || normPattern === normTarget) {
		return true;
	}
	const escaped = normPattern
		.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
		.replace(/\*\*/g, ".*")
		.replace(/\*/g, isPath ? "[^/]*" : ".*");
	try {
		return new RegExp(`^${escaped}$`, "i").test(normTarget);
	} catch {
		return false;
	}
}

export class FourTierPermissionEngine {
	private readonly config: PermissionPolicyConfig;

	constructor(customConfig?: PermissionPolicyConfig) {
		const envBlockedPaths = process.env.PI_GUARDRAIL_BLOCKED_PATHS
			? process.env.PI_GUARDRAIL_BLOCKED_PATHS.split(",").map((s) => s.trim())
			: undefined;
		const envBlockedCommands = process.env.PI_GUARDRAIL_BLOCKED_COMMANDS
			? process.env.PI_GUARDRAIL_BLOCKED_COMMANDS.split(",").map((s) => s.trim())
			: undefined;

		this.config = {
			version: 1,
			defaultTier: customConfig?.defaultTier ?? "always_allow",
			blockedPathPatterns: customConfig?.blockedPathPatterns ??
				envBlockedPaths ?? [
					"/etc/**",
					"/root/**",
					"/var/run/**",
					"/sys/**",
					"/proc/**",
					"~/.ssh/**",
					"~/.gnupg/**",
					"~/.aws/**",
					"**/.env",
					"**/.env.*",
					"**/id_rsa*",
					"**/id_ed25519*",
					"**/.git/config",
				],
			blockedCommandPatterns: customConfig?.blockedCommandPatterns ??
				envBlockedCommands ?? [
					"rm -rf /",
					"rm -rf /*",
					":(){ :|:& };:",
					"mkfs*",
					"dd if=* of=/dev/*",
					"chmod -R 777 /",
					"chown -R * /",
					"shutdown*",
					"reboot*",
					"init 0",
				],
			networkActionPatterns: customConfig?.networkActionPatterns ?? ["webfetch", "websearch", "crawler", "download"],
			networkCommandPatterns: customConfig?.networkCommandPatterns ?? [
				"curl *",
				"wget *",
				"git push*",
				"git pull*",
				"git clone*",
				"npm install*",
				"npm i *",
				"pnpm install*",
				"yarn add*",
				"pip install*",
			],
			modifyActionPatterns: customConfig?.modifyActionPatterns ?? ["write", "edit", "replace", "patch", "delete"],
			customRules: customConfig?.customRules ?? [],
		};
	}

	public static loadPolicyConfig(workspaceDir?: string): PermissionPolicyConfig | undefined {
		const candidates: string[] = [];
		if (workspaceDir) {
			candidates.push(
				path.join(workspaceDir, ".pi/guardrails.json"),
				path.join(workspaceDir, ".ziq/guardrails.json"),
				path.join(workspaceDir, ".pi/permissions.json"),
			);
		}
		const homedir = os.homedir();
		candidates.push(
			path.join(homedir, ".config/pi/guardrails.json"),
			path.join(homedir, ".config/ziq-code/guardrails.json"),
		);

		for (const candidate of candidates) {
			if (fs.existsSync(candidate)) {
				try {
					const raw = fs.readFileSync(candidate, "utf8");
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed === "object") {
						return parsed as PermissionPolicyConfig;
					}
				} catch {
					// Fall through to next candidate
				}
			}
		}
		return undefined;
	}

	public evaluate(target: PolicyEvaluationTarget): EvaluationResult {
		// 1. Evaluate custom rules first
		if (this.config.customRules && this.config.customRules.length > 0) {
			for (const rule of this.config.customRules) {
				const actionMatch = !rule.action || matchGlob(rule.action, target.action);
				const resourceMatch =
					!rule.resource ||
					(target.resourcePath && matchGlob(rule.resource, target.resourcePath)) ||
					(target.command && matchGlob(rule.resource, target.command));

				if (actionMatch && resourceMatch) {
					return this.createResult(
						rule.tier,
						rule.description ?? `Matched custom permission rule for ${rule.tier}`,
					);
				}
			}
		}

		// 2. Tier 3: Blocked Path Check
		if (target.resourcePath && this.config.blockedPathPatterns) {
			const resolvedPath = path.resolve(target.resourcePath);
			const home = os.homedir();
			const normalizedWithTilde = resolvedPath.startsWith(home)
				? `~${resolvedPath.slice(home.length)}`
				: resolvedPath;

			for (const pattern of this.config.blockedPathPatterns) {
				if (matchGlob(pattern, resolvedPath) || matchGlob(pattern, normalizedWithTilde)) {
					return {
						tier: PermissionTier.StrictlyBlock,
						tierName: "strictly_block",
						decision: "deny",
						reason: `Strictly blocked: Path '${target.resourcePath}' matches protected pattern '${pattern}'`,
					};
				}
			}

			// Out-of-workspace check if workspace is provided
			if (target.workspaceDir) {
				const resolvedWs = path.resolve(target.workspaceDir);
				if (!resolvedPath.startsWith(resolvedWs) && !resolvedPath.startsWith("/tmp")) {
					return {
						tier: PermissionTier.AskOnModify,
						tierName: "ask_on_modify",
						decision: "ask",
						reason: `Path '${target.resourcePath}' is outside the active workspace; explicit approval is required`,
					};
				}
			}
		}

		// 3. Tier 3: Blocked Command Check
		if (target.command && this.config.blockedCommandPatterns) {
			const trimmedCmd = target.command.trim();
			for (const pattern of this.config.blockedCommandPatterns) {
				if (matchGlob(pattern, trimmedCmd, false)) {
					return {
						tier: PermissionTier.StrictlyBlock,
						tierName: "strictly_block",
						decision: "deny",
						reason: `Strictly blocked: Command matches dangerous system pattern '${pattern}'`,
					};
				}
			}
		}

		// 4. Tier 2: Network Action or Network Command Check
		if (this.config.networkActionPatterns?.some((p) => matchGlob(p, target.action))) {
			return {
				tier: PermissionTier.AskOnExternal,
				tierName: "ask_on_external",
				decision: "ask",
				reason: `Network action '${target.action}' requires user approval before external transmission`,
			};
		}

		if (target.command && this.config.networkCommandPatterns) {
			const trimmedCmd = target.command.trim();
			for (const pattern of this.config.networkCommandPatterns) {
				if (matchGlob(pattern, trimmedCmd, false)) {
					return {
						tier: PermissionTier.AskOnExternal,
						tierName: "ask_on_external",
						decision: "ask",
						reason: `Network command '${trimmedCmd}' requires user approval before external execution`,
					};
				}
			}
		}

		// 5. Tier 1: Workspace Mutation Check
		if (this.config.modifyActionPatterns?.some((p) => matchGlob(p, target.action))) {
			return {
				tier: PermissionTier.AskOnModify,
				tierName: "ask_on_modify",
				decision: "ask",
				reason: `File modification action '${target.action}' mutates workspace contents`,
			};
		}

		// 6. Tier 0: Default Allow
		const defaultTier = this.config.defaultTier ?? "always_allow";
		return this.createResult(defaultTier, "Action allowed under default policy");
	}

	private createResult(tierName: TierName, reason: string): EvaluationResult {
		switch (tierName) {
			case "strictly_block":
				return {
					tier: PermissionTier.StrictlyBlock,
					tierName,
					decision: "deny",
					reason,
				};
			case "ask_on_external":
				return {
					tier: PermissionTier.AskOnExternal,
					tierName,
					decision: "ask",
					reason,
				};
			case "ask_on_modify":
				return {
					tier: PermissionTier.AskOnModify,
					tierName,
					decision: "ask",
					reason,
				};
			default:
				return {
					tier: PermissionTier.AlwaysAllow,
					tierName: "always_allow",
					decision: "allow",
					reason,
				};
		}
	}
}
