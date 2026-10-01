import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { type SembleChunk, SembleSearchService } from "../semble/semble-search.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const sembleSchema = Type.Object({
	query: Type.String({ description: "Search query or code symbol to locate in AST" }),
	path: Type.Optional(Type.String({ description: "Target directory or file path to search within" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of code chunks to return (default: 20)" })),
	maxTokens: Type.Optional(Type.Number({ description: "Optional token budget limit for packed code results" })),
	maxCharacters: Type.Optional(Type.Number({ description: "Optional character budget limit for results" })),
});

export type SembleToolInput = Static<typeof sembleSchema>;

export interface SembleToolOptions {
	readonly defaultLimit?: number;
}

export const sembleToolSystemPromptContribution = {
	snippet: "Search codebase using syntax-aware AST chunking (functions, classes, methods) with ripgrep fallback",
	guidelines: [],
} as const;

export function createSembleToolDefinition(cwd: string, options?: SembleToolOptions): ToolDefinition<typeof sembleSchema> {
	return {
		name: "semble",
		label: "semble",
		description:
			"Search codebase using Semble syntax-aware AST chunking (functions, classes, methods). Falls back gracefully to ripgrep regex matching when Semble is unavailable.",
		parameters: sembleSchema,
		execute: async (
			_toolCallId: string,
			input: SembleToolInput,
			signal?: AbortSignal,
			_onUpdate?,
			ctx?: ExtensionContext,
		) => {
			const targetCwd = ctx?.cwd || cwd;
			const chunks: SembleChunk[] = await SembleSearchService.search({
				cwd: targetCwd,
				query: input.query,
				path: input.path,
				limit: input.limit ?? options?.defaultLimit,
				maxTokens: input.maxTokens,
				maxCharacters: input.maxCharacters,
				signal,
			});

			if (chunks.length === 0) {
				return {
					content: [{ type: "text" as const, text: `No matches found for query: "${input.query}"` }],
					details: undefined,
				};
			}

			const formatted = chunks
				.map((chunk, idx) => {
					const header = `[#${idx + 1}] ${chunk.file}:${chunk.startLine}-${chunk.endLine} (${chunk.type ?? "chunk"}, score: ${chunk.score.toFixed(2)})`;
					return `${header}\n\`\`\`\n${chunk.content}\n\`\`\``;
				})
				.join("\n\n");

			return {
				content: [{ type: "text" as const, text: formatted }],
				details: undefined,
			};
		},
	};
}

export function createSembleTool(cwd: string, options?: SembleToolOptions): AgentTool {
	return wrapToolDefinition(createSembleToolDefinition(cwd, options));
}
