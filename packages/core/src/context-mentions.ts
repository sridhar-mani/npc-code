import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export interface ResolvedMention {
	rawToken: string;
	kind: "file" | "directory" | "rule" | "git" | "unknown";
	reference: string;
	content?: string;
	error?: string;
}

export interface MentionResolutionResult {
	text: string;
	mentions: ResolvedMention[];
	enrichedPrompt: string;
}

const MAX_MENTION_FILE_BYTES = 48 * 1024;

/**
 * Extracts `@` tokens from prompt text and resolves relevant codebase context.
 * Supported mention forms:
 * - `@path/to/file` or `@./file`: local workspace files or folders
 * - `@git`: current git status / diff overview
 * - `@rule:name` or `@rule`: workspace rule instructions
 */
export function resolveContextMentions(cwd: string, text: string): MentionResolutionResult {
	const mentionPattern = /(?:^|\s)@([a-zA-Z0-9_\-./]+(?::[a-zA-Z0-9_\-.]+)?)/g;
	const matches: string[] = [];

	while (true) {
		const match = mentionPattern.exec(text);
		if (!match) {
			break;
		}
		const token = match[1];
		if (token && !matches.includes(token)) {
			matches.push(token);
		}
	}

	if (matches.length === 0) {
		return { text, mentions: [], enrichedPrompt: text };
	}

	const resolvedMentions: ResolvedMention[] = [];
	const contextBlocks: string[] = [];

	for (const raw of matches) {
		if (raw === "git") {
			resolvedMentions.push({
				rawToken: `@${raw}`,
				kind: "git",
				reference: "git",
			});
			continue;
		}

		if (raw.startsWith("rule:") || raw === "rule") {
			const ruleName = raw.startsWith("rule:") ? raw.slice(5) : undefined;
			const ruleContent = resolveRuleContent(cwd, ruleName);
			if (ruleContent) {
				resolvedMentions.push({
					rawToken: `@${raw}`,
					kind: "rule",
					reference: ruleName ?? "default",
					content: ruleContent,
				});
				contextBlocks.push(`<referenced_rule name="${ruleName ?? "default"}">\n${ruleContent}\n</referenced_rule>`);
			}
			continue;
		}

		// Try resolving as a workspace path
		const targetPath = isAbsolute(raw) ? raw : resolve(cwd, raw);
		if (existsSync(targetPath)) {
			try {
				const stat = statSync(targetPath);
				if (stat.isFile()) {
					if (stat.size > MAX_MENTION_FILE_BYTES) {
						const truncated = readFileSync(targetPath, "utf-8").slice(0, MAX_MENTION_FILE_BYTES);
						resolvedMentions.push({
							rawToken: `@${raw}`,
							kind: "file",
							reference: raw,
							content: truncated,
						});
						contextBlocks.push(
							`<referenced_file path="${raw}" size="${stat.size}" truncated="true">\n${truncated}\n</referenced_file>`,
						);
					} else {
						const content = readFileSync(targetPath, "utf-8");
						resolvedMentions.push({
							rawToken: `@${raw}`,
							kind: "file",
							reference: raw,
							content,
						});
						contextBlocks.push(
							`<referenced_file path="${raw}" size="${stat.size}">\n${content}\n</referenced_file>`,
						);
					}
				} else if (stat.isDirectory()) {
					const children = readdirSync(targetPath).slice(0, 50).join("\n");
					resolvedMentions.push({
						rawToken: `@${raw}`,
						kind: "directory",
						reference: raw,
						content: children,
					});
					contextBlocks.push(`<referenced_directory path="${raw}">\n${children}\n</referenced_directory>`);
				}
			} catch (err) {
				resolvedMentions.push({
					rawToken: `@${raw}`,
					kind: "unknown",
					reference: raw,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}

	if (contextBlocks.length === 0) {
		return { text, mentions: resolvedMentions, enrichedPrompt: text };
	}

	const enrichedPrompt = `${text}\n\n[Referenced Context]\n${contextBlocks.join("\n\n")}`;
	return { text, mentions: resolvedMentions, enrichedPrompt };
}

function resolveRuleContent(cwd: string, ruleName?: string): string | null {
	const candidates: string[] = [];
	if (ruleName) {
		candidates.push(
			join(cwd, ".agents", "rules", `${ruleName}.md`),
			join(cwd, ".agents", "rules", ruleName),
			join(cwd, ".pi", "rules", `${ruleName}.md`),
			join(cwd, "rules", `${ruleName}.md`),
		);
	} else {
		candidates.push(
			join(cwd, ".agents", "rules", "default.md"),
			join(cwd, "AGENTS.md"),
			join(cwd, ".pi", "rules", "default.md"),
		);
	}

	for (const path of candidates) {
		if (existsSync(path) && statSync(path).isFile()) {
			try {
				return readFileSync(path, "utf-8");
			} catch {}
		}
	}
	return null;
}
