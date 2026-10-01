/**
 * packages/core/src/semble/semble-search.ts
 *
 * Semble AST Code Search Engine for Pi with Ripgrep Fallback.
 *
 * Capabilities:
 * - Direct execution of `semble search` for AST-aware code chunking (functions, classes, methods)
 * - Automatic fallback to ripgrep regex search if `semble` is not installed or errors
 * - Dynamic token and character budget limits
 */

import { exec, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execP = promisify(exec);

export interface SembleChunk {
	readonly file: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly score: number;
	readonly content: string;
	readonly type?: string; // syntactic AST node type (e.g. function, class, method)
}

export interface SembleSearchInput {
	readonly cwd: string;
	readonly query: string;
	readonly limit?: number;
	readonly maxTokens?: number;
	readonly maxCharacters?: number;
	readonly path?: string;
	readonly signal?: AbortSignal;
}

export function parseSembleJson(raw: string, cwd: string): SembleChunk[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];

	const jsonStart = trimmed.indexOf("[");
	const jsonEnd = trimmed.lastIndexOf("]");
	const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart ? trimmed.slice(jsonStart, jsonEnd + 1) : trimmed;

	try {
		const parsed = JSON.parse(jsonStr);
		if (!Array.isArray(parsed)) return [];

		return parsed.map((item: Record<string, unknown>, idx: number) => {
			const rawPath = String(item.file_path || item.file || item.path || `chunk_${idx}`);
			const relPath = path.isAbsolute(rawPath) ? path.relative(cwd, rawPath) : rawPath;
			const start = Number(item.start_line ?? item.startLine ?? 1);
			const end = Number(item.end_line ?? item.endLine ?? start);
			const score = typeof item.score === "number" ? item.score : 1.0;
			const content = String(item.content || item.code || "");
			const type = typeof item.type === "string" ? item.type : undefined;

			return {
				file: relPath.replace(/\\/g, "/"),
				startLine: Math.max(1, Math.floor(start)),
				endLine: Math.max(start, Math.floor(end)),
				score,
				content,
				type,
			};
		});
	} catch {
		return [];
	}
}

export function applyBudgetLimits(
	chunks: readonly SembleChunk[],
	options?: { maxTokens?: number; maxCharacters?: number; limit?: number },
): SembleChunk[] {
	if (!options) return [...chunks];

	let result = chunks;
	if (options.limit && options.limit > 0) {
		result = result.slice(0, options.limit);
	}

	const charBudget = options.maxCharacters ?? (options.maxTokens ? options.maxTokens * 4 : undefined);
	if (charBudget === undefined) return [...result];

	let accumulated = 0;
	const budgeted: SembleChunk[] = [];
	for (const chunk of result) {
		const chunkChars = chunk.content.length + chunk.file.length + 50;
		if (budgeted.length > 0 && accumulated + chunkChars > charBudget) {
			break;
		}
		budgeted.push(chunk);
		accumulated += chunkChars;
	}

	return budgeted;
}

/**
 * Checks if the `semble` CLI or uvx wrapper is available.
 */
export async function isSembleAvailable(): Promise<boolean> {
	try {
		const { stdout } = await execP("semble --version", { timeout: 3000 });
		return stdout.trim().length > 0;
	} catch {
		try {
			const { stdout } = await execP("uvx --from semble[mcp] semble --version", { timeout: 5000 });
			return stdout.trim().length > 0;
		} catch {
			return false;
		}
	}
}

async function fallbackRipgrep(input: SembleSearchInput): Promise<SembleChunk[]> {
	const targetDir = input.path ? path.resolve(input.cwd, input.path) : input.cwd;
	const limit = input.limit ?? 15;
	const escapedQuery = input.query.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

	return new Promise((resolve) => {
		const child = spawn("rg", ["--json", "-m", String(limit), "-e", escapedQuery, targetDir], {
			timeout: 10_000,
			signal: input.signal,
		});

		let stdout = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});

		child.on("close", () => {
			const chunks: SembleChunk[] = [];
			const lines = stdout.split("\n");
			let idx = 0;

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const json = JSON.parse(line);
					if (json.type === "match" && json.data) {
						const filePath = json.data.path?.text ?? "";
						const lineNum = json.data.line_number ?? 1;
						const text = json.data.lines?.text ?? "";
						const relPath = path.isAbsolute(filePath) ? path.relative(input.cwd, filePath) : filePath;

						chunks.push({
							file: relPath.replace(/\\/g, "/"),
							startLine: lineNum,
							endLine: lineNum,
							score: Math.max(0.1, 1.0 - idx * 0.05),
							content: text.trimEnd(),
							type: "text_match",
						});
						idx++;
					}
				} catch {
					// Ignore unparseable lines
				}
			}

			resolve(applyBudgetLimits(chunks, input));
		});

		child.on("error", () => {
			resolve([]);
		});
	});
}

/**
 * Executes AST search via `semble search` with graceful ripgrep fallback.
 */
export async function searchSemble(input: SembleSearchInput): Promise<SembleChunk[]> {
	const targetDir = input.path ? path.resolve(input.cwd, input.path) : input.cwd;
	const limit = input.limit ?? 20;

	// 1. Try local `semble search`
	try {
		const { stdout } = await execP(`semble search "${input.query.replace(/"/g, '\\"')}" --limit ${limit} --json`, {
			cwd: targetDir,
			timeout: 15_000,
			signal: input.signal,
		});
		const chunks = parseSembleJson(stdout, input.cwd);
		if (chunks.length > 0) {
			return applyBudgetLimits(chunks, input);
		}
	} catch {
		// Fall through to uvx
	}

	// 2. Try `uvx --from semble[mcp] semble`
	try {
		const { stdout } = await execP(
			`uvx --from "semble[mcp]" semble search "${input.query.replace(/"/g, '\\"')}" --limit ${limit} --json`,
			{
				cwd: targetDir,
				timeout: 25_000,
				signal: input.signal,
			},
		);
		const chunks = parseSembleJson(stdout, input.cwd);
		if (chunks.length > 0) {
			return applyBudgetLimits(chunks, input);
		}
	} catch {
		// Fall through to ripgrep fallback
	}

	// 3. Fallback: ripgrep
	return fallbackRipgrep(input);
}

export const SembleSearchService = {
	isAvailable: isSembleAvailable,
	search: searchSemble,
};
