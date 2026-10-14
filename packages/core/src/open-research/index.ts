/**
 * packages/core/src/open-research/index.ts
 *
 * Open Research Engine: Multi-source academic, documentation, and web research loop.
 * Queries ArXiv, Wikipedia, and open web endpoints to synthesize research dossiers,
 * citations, and architectural insights for the agent.
 */

import { type Static, Type } from "typebox";

export interface ResearchSourceItem {
	readonly title: string;
	readonly url: string;
	readonly snippet: string;
	readonly source: "arxiv" | "wikipedia" | "web";
}

export interface OpenResearchResult {
	readonly query: string;
	readonly sources: ResearchSourceItem[];
	readonly summary: string;
	readonly keyFindings: string[];
	readonly suggestedNextSteps: string[];
}

export interface ResearchOptions {
	readonly maxResults?: number;
	readonly sources?: Array<"arxiv" | "wikipedia" | "web">;
	readonly signal?: AbortSignal;
}

export class OpenResearchEngine {
	private readonly timeoutMs: number;

	constructor(timeoutMs = 8000) {
		this.timeoutMs = timeoutMs;
	}

	private createTimeoutSignal(parentSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
		const onParentAbort = () => controller.abort();
		if (parentSignal) {
			parentSignal.addEventListener("abort", onParentAbort, { once: true });
		}
		const cleanup = () => {
			clearTimeout(timeoutId);
			if (parentSignal) {
				parentSignal.removeEventListener("abort", onParentAbort);
			}
		};
		return { signal: controller.signal, cleanup };
	}

	/**
	 * Query ArXiv API for research papers and academic abstracts.
	 */
	async searchArxiv(query: string, maxResults = 3, signal?: AbortSignal): Promise<ResearchSourceItem[]> {
		const { signal: fetchSignal, cleanup } = this.createTimeoutSignal(signal);
		try {
			const encodedQuery = encodeURIComponent(query.trim());
			const url = `https://export.arxiv.org/api/query?search_query=all:${encodedQuery}&start=0&max_results=${maxResults}`;
			const response = await fetch(url, {
				headers: { "User-Agent": "NPC-OpenResearch/1.0" },
				signal: fetchSignal,
			});
			if (!response.ok) return [];
			const xml = await response.text();

			const items: ResearchSourceItem[] = [];
			const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
			let match: RegExpExecArray | null = entryRegex.exec(xml);

			while (match !== null && items.length < maxResults) {
				const entryContent = match[1];
				const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(entryContent);
				const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(entryContent);
				const idMatch = /<id>([\s\S]*?)<\/id>/.exec(entryContent);

				if (titleMatch && idMatch) {
					const title = titleMatch[1].replace(/\s+/g, " ").trim();
					const snippet = (summaryMatch ? summaryMatch[1].replace(/\s+/g, " ").trim() : "").slice(0, 500);
					const rawId = idMatch[1].trim();
					items.push({
						title,
						url: rawId,
						snippet,
						source: "arxiv",
					});
				}
				match = entryRegex.exec(xml);
			}
			return items;
		} catch {
			return [];
		} finally {
			cleanup();
		}
	}

	/**
	 * Query Wikipedia API for foundational definitions and background summaries.
	 */
	async searchWikipedia(query: string, maxResults = 3, signal?: AbortSignal): Promise<ResearchSourceItem[]> {
		const { signal: fetchSignal, cleanup } = this.createTimeoutSignal(signal);
		try {
			const encodedQuery = encodeURIComponent(query.trim());
			const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}&utf8=&format=json&srlimit=${maxResults}`;
			const response = await fetch(url, {
				headers: { "User-Agent": "NPC-OpenResearch/1.0" },
				signal: fetchSignal,
			});
			if (!response.ok) return [];
			const data = (await response.json()) as {
				query?: { search?: Array<{ title?: string; snippet?: string; pageid?: number }> };
			};
			const searchResults = data?.query?.search ?? [];

			return searchResults.slice(0, maxResults).map((res) => {
				const cleanSnippet = (res.snippet ?? "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"');
				const title = res.title ?? "Wikipedia Article";
				return {
					title,
					url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`,
					snippet: cleanSnippet,
					source: "wikipedia",
				};
			});
		} catch {
			return [];
		} finally {
			cleanup();
		}
	}

	/**
	 * Query open web instant answer services.
	 */
	async searchWeb(query: string, maxResults = 3, signal?: AbortSignal): Promise<ResearchSourceItem[]> {
		const { signal: fetchSignal, cleanup } = this.createTimeoutSignal(signal);
		try {
			const encodedQuery = encodeURIComponent(query.trim());
			const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;
			const response = await fetch(url, {
				headers: { "User-Agent": "NPC-OpenResearch/1.0" },
				signal: fetchSignal,
			});
			if (!response.ok) return [];
			const data = (await response.json()) as {
				Heading?: string;
				Abstract?: string;
				AbstractURL?: string;
				RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
			};

			const items: ResearchSourceItem[] = [];
			if (data.Abstract && data.AbstractURL) {
				items.push({
					title: data.Heading || query,
					url: data.AbstractURL,
					snippet: data.Abstract,
					source: "web",
				});
			}

			for (const topic of data.RelatedTopics ?? []) {
				if (items.length >= maxResults) break;
				if (topic.Text && topic.FirstURL) {
					items.push({
						title: topic.Text.slice(0, 80),
						url: topic.FirstURL,
						snippet: topic.Text,
						source: "web",
					});
				}
			}
			return items;
		} catch {
			return [];
		} finally {
			cleanup();
		}
	}

	/**
	 * Run an open research session across multiple sources and synthesize findings.
	 */
	async research(query: string, options?: ResearchOptions): Promise<OpenResearchResult> {
		const maxResults = options?.maxResults ?? 4;
		const sources = options?.sources ?? ["arxiv", "wikipedia", "web"];
		const signal = options?.signal;

		const fetches: Array<Promise<ResearchSourceItem[]>> = [];
		if (sources.includes("arxiv")) {
			fetches.push(this.searchArxiv(query, maxResults, signal));
		}
		if (sources.includes("wikipedia")) {
			fetches.push(this.searchWikipedia(query, maxResults, signal));
		}
		if (sources.includes("web")) {
			fetches.push(this.searchWeb(query, maxResults, signal));
		}

		const results = await Promise.all(fetches);
		const allItems = results.flat();

		const keyFindings: string[] = [];
		for (const item of allItems) {
			if (item.snippet && item.snippet.length > 30) {
				keyFindings.push(`[${item.source.toUpperCase()}] ${item.title}: ${item.snippet.slice(0, 200)}...`);
			}
		}

		const summary =
			allItems.length > 0
				? `Found ${allItems.length} relevant reference(s) for "${query}" across ${sources.join(", ")}.`
				: `No online results found for "${query}". Check connectivity or broaden the query.`;

		const suggestedNextSteps = [
			`Inspect primary citations from returned URLs`,
			`Use 'vscode_fetch_url' to download full text of high-relevance papers/articles`,
			`Apply validated architectural findings directly into project source files`,
		];

		return {
			query,
			sources: allItems,
			summary,
			keyFindings: keyFindings.slice(0, 6),
			suggestedNextSteps,
		};
	}

	/**
	 * Format research result as clean, readable Markdown for agent context.
	 */
	formatMarkdown(result: OpenResearchResult): string {
		const lines: string[] = [
			`# Research Dossier: ${result.query}`,
			"",
			`> ${result.summary}`,
			"",
			"## Key Insights & Snippets",
		];

		if (result.keyFindings.length === 0) {
			lines.push("No snippets available.");
		} else {
			for (const finding of result.keyFindings) {
				lines.push(`- ${finding}`);
			}
		}

		lines.push("", "## References & Citations");
		if (result.sources.length === 0) {
			lines.push("No references retrieved.");
		} else {
			for (const src of result.sources) {
				lines.push(`- **[${src.source.toUpperCase()}]** [${src.title}](${src.url})`);
			}
		}

		lines.push("", "## Recommended Actions");
		for (const step of result.suggestedNextSteps) {
			lines.push(`1. ${step}`);
		}

		return lines.join("\n");
	}
}

export const OpenResearchParamsSchema = Type.Object({
	query: Type.String({ description: "Research topic, concept, or academic query" }),
	sources: Type.Optional(
		Type.Array(Type.Union([Type.Literal("arxiv"), Type.Literal("wikipedia"), Type.Literal("web")]), {
			description: "Sources to query (default: ['arxiv', 'wikipedia', 'web'])",
		}),
	),
	maxResults: Type.Optional(Type.Number({ description: "Maximum results per source (default: 3)" })),
});

export type OpenResearchParams = Static<typeof OpenResearchParamsSchema>;

export function createOpenResearchTool(engine = new OpenResearchEngine()) {
	return {
		name: "open_research",
		label: "Open Research",
		description:
			"Conduct autonomous research across ArXiv papers, Wikipedia, and open web documentation to gather architectural background and technical references.",
		parameters: OpenResearchParamsSchema,
		execute: async (_toolCallId: string, params: OpenResearchParams) => {
			const result = await engine.research(params.query, {
				maxResults: params.maxResults ?? 3,
				sources: params.sources,
			});
			return {
				content: [{ type: "text" as const, text: engine.formatMarkdown(result) }],
				details: {
					query: result.query,
					sourceCount: result.sources.length,
				},
			};
		},
	};
}
