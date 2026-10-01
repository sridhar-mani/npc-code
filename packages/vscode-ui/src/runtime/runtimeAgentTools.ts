import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-core";

export interface SubagentRunOptions {
	id?: string;
	tools?: string[];
	skills?: string[];
	worktree?: boolean;
	maxDepth?: number;
}

export interface RuntimeAgentToolHost {
	runSubagent(prompt: string, modelId?: string, options?: SubagentRunOptions): Promise<{
		id: string;
		result: string;
		sessionPath: string;
		worktreePath?: string;
		branchName?: string;
	}>;
	runSubagents(tasks: Array<{ prompt: string; modelId?: string; options?: SubagentRunOptions }>): Promise<Array<{
		id: string;
		result: string;
		sessionPath: string;
		worktreePath?: string;
		branchName?: string;
	}>>;
	getSkillSummaries(): Array<{ name: string; description: string; path: string }>;
}

export function createRuntimeAgentTools(host: RuntimeAgentToolHost, depth = 0): ToolDefinition[] {
	const maxDepth = 2;
	const tools: ToolDefinition[] = [];

	if (depth < maxDepth) {
		tools.push({
			name: "run_subagent",
			label: "Run Subagent",
			description: "Run a focused child Pi agent with a persisted session. Use worktree=true for isolated edits and skills/tools to scope the child.",
			parameters: Type.Object({
				prompt: Type.String({ description: "Focused task for the child agent." }),
				modelId: Type.Optional(Type.String({ description: "Optional provider/model or model id for the child." })),
				id: Type.Optional(Type.String({ description: "Existing subagent id to resume instead of creating a new child." })),
				worktree: Type.Optional(Type.Boolean({ description: "Run the child in an isolated git worktree." })),
				tools: Type.Optional(Type.Array(Type.String({ description: "Tool name to enable for the child." }))),
				skills: Type.Optional(Type.Array(Type.String({ description: "Skill name to expose to the child." }))),
			}),
			execute: async (_toolCallId, params: any) => {
				try {
					const result = await host.runSubagent(
						String(params.prompt),
						typeof params.modelId === "string" ? params.modelId : undefined,
						{
							id: typeof params.id === "string" ? params.id : undefined,
							worktree: params.worktree === true,
							tools: Array.isArray(params.tools) ? params.tools.map(String) : undefined,
							skills: Array.isArray(params.skills) ? params.skills.map(String) : undefined,
							maxDepth: depth + 1,
						},
					);
					return {
						content: [{ type: "text", text: result.result }],
						details: {
							subagentId: result.id,
							sessionPath: result.sessionPath,
							...(result.worktreePath ? { worktreePath: result.worktreePath } : {}),
							...(result.branchName ? { branchName: result.branchName } : {}),
						},
					};
				} catch (error) {
					return {
						content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
						details: {},
						isError: true,
					};
				}
			},
		});
		tools.push({
			name: "run_subagents",
			label: "Run Subagents in Parallel",
			description: "Run several focused child Pi agents concurrently and return all results.",
			parameters: Type.Object({
				tasks: Type.Array(Type.Object({
					prompt: Type.String(),
					modelId: Type.Optional(Type.String()),
					worktree: Type.Optional(Type.Boolean()),
					tools: Type.Optional(Type.Array(Type.String())),
					skills: Type.Optional(Type.Array(Type.String())),
				})),
			}),
			execute: async (_toolCallId, params: any) => {
				try {
					const tasks = Array.isArray(params.tasks)
						? params.tasks.map((task: any) => ({
								prompt: String(task.prompt),
								modelId: typeof task.modelId === "string" ? task.modelId : undefined,
								options: {
									worktree: task.worktree === true,
									tools: Array.isArray(task.tools) ? task.tools.map(String) : undefined,
									skills: Array.isArray(task.skills) ? task.skills.map(String) : undefined,
									maxDepth: depth + 1,
								},
							}))
						: [];
					const results = await host.runSubagents(tasks);
					return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }], details: { count: results.length } };
				} catch (error) {
					return {
						content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
						details: {},
						isError: true,
					};
				}
			},
		});
	}

	tools.push({
		name: "list_agent_skills",
		label: "List Agent Skills",
		description: "List skills available to the active Pi runtime.",
		parameters: Type.Object({}),
		execute: async () => ({
			content: [{ type: "text", text: JSON.stringify(host.getSkillSummaries(), null, 2) }],
			details: { count: host.getSkillSummaries().length },
		}),
	});

	return tools;
}
