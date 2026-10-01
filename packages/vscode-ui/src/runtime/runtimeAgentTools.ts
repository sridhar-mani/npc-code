import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-core";

export interface SubagentRunOptions {
\tid?: string;
\ttools?: string[];
\tskills?: string[];
\tworktree?: boolean;
\tmaxDepth?: number;
}

export interface RuntimeAgentToolHost {
\trunSubagent(prompt: string, modelId?: string, options?: SubagentRunOptions): Promise<{
\t\tid: string;
\t\tresult: string;
\t\tsessionPath: string;
\t\tworktreePath?: string;
\t\tbranchName?: string;
\t}>;
\trunSubagents(tasks: Array<{ prompt: string; modelId?: string; options?: SubagentRunOptions }>): Promise<Array<{
\t\tid: string;
\t\tresult: string;
\t\tsessionPath: string;
\t\tworktreePath?: string;
\t\tbranchName?: string;
\t}>>;
\tgetSkillSummaries(): Array<{ name: string; description: string; path: string }>;
}

export function createRuntimeAgentTools(host: RuntimeAgentToolHost, depth = 0): ToolDefinition[] {
\tconst maxDepth = 2;
\tconst tools: ToolDefinition[] = [];

\tif (depth < maxDepth) {
\t\ttools.push({
\t\t\tname: "run_subagent",
\t\t\tlabel: "Run Subagent",
\t\t\tdescription: "Run a focused child Pi agent with a persisted session. Use worktree=true for isolated edits and skills/tools to scope the child.",
\t\t\tparameters: Type.Object({
\t\t\t\tprompt: Type.String({ description: "Focused task for the child agent." }),
\t\t\t\tmodelId: Type.Optional(Type.String({ description: "Optional provider/model or model id for the child." })),
\t\t\t\tid: Type.Optional(Type.String({ description: "Existing subagent id to resume instead of creating a new child." })),
\t\t\t\tworktree: Type.Optional(Type.Boolean({ description: "Run the child in an isolated git worktree." })),
\t\t\t\ttools: Type.Optional(Type.Array(Type.String({ description: "Tool name to enable for the child." }))),
\t\t\t\tskills: Type.Optional(Type.Array(Type.String({ description: "Skill name to expose to the child." }))),
\t\t\t}),
\t\t\texecute: async (_toolCallId, params: any) => {
\t\t\t\ttry {
\t\t\t\t\tconst result = await host.runSubagent(
\t\t\t\t\t\tString(params.prompt),
\t\t\t\t\t\ttypeof params.modelId === "string" ? params.modelId : undefined,
\t\t\t\t\t\t{
\t\t\t\t\t\t\tid: typeof params.id === "string" ? params.id : undefined,
\t\t\t\t\t\t\tworktree: params.worktree === true,
\t\t\t\t\t\t\ttools: Array.isArray(params.tools) ? params.tools.map(String) : undefined,
\t\t\t\t\t\t\tskills: Array.isArray(params.skills) ? params.skills.map(String) : undefined,
\t\t\t\t\t\t\tmaxDepth: depth + 1,
\t\t\t\t\t\t},
\t\t\t\t\t);
\t\t\t\t\treturn {
\t\t\t\t\t\tcontent: [{ type: "text", text: result.result }],
\t\t\t\t\t\tdetails: {
\t\t\t\t\t\t\tsubagentId: result.id,
\t\t\t\t\t\t\tsessionPath: result.sessionPath,
\t\t\t\t\t\t\t...(result.worktreePath ? { worktreePath: result.worktreePath } : {}),
\t\t\t\t\t\t\t...(result.branchName ? { branchName: result.branchName } : {}),
\t\t\t\t\t\t},
\t\t\t\t\t};
\t\t\t\t} catch (error) {
\t\t\t\t\treturn {
\t\t\t\t\t\tcontent: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
\t\t\t\t\t\tdetails: {},
\t\t\t\t\t\tisError: true,
\t\t\t\t\t};
\t\t\t\t}
\t\t\t},
\t\t});
\t\ttools.push({
\t\t\tname: "run_subagents",
\t\t\tlabel: "Run Subagents in Parallel",
\t\t\tdescription: "Run several focused child Pi agents concurrently and return all results.",
\t\t\tparameters: Type.Object({
\t\t\t\ttasks: Type.Array(Type.Object({
\t\t\t\t\tprompt: Type.String(),
\t\t\t\t\tmodelId: Type.Optional(Type.String()),
\t\t\t\t\tworktree: Type.Optional(Type.Boolean()),
\t\t\t\t\ttools: Type.Optional(Type.Array(Type.String())),
\t\t\t\t\tskills: Type.Optional(Type.Array(Type.String())),
\t\t\t\t})),
\t\t\t}),
\t\t\texecute: async (_toolCallId, params: any) => {
\t\t\t\ttry {
\t\t\t\t\tconst tasks = Array.isArray(params.tasks)
\t\t\t\t\t\t? params.tasks.map((task: any) => ({
\t\t\t\t\t\t\t\tprompt: String(task.prompt),
\t\t\t\t\t\t\t\tmodelId: typeof task.modelId === "string" ? task.modelId : undefined,
\t\t\t\t\t\t\t\toptions: {
\t\t\t\t\t\t\t\t\tworktree: task.worktree === true,
\t\t\t\t\t\t\t\t\ttools: Array.isArray(task.tools) ? task.tools.map(String) : undefined,
\t\t\t\t\t\t\t\t\tskills: Array.isArray(task.skills) ? task.skills.map(String) : undefined,
\t\t\t\t\t\t\t\t\tmaxDepth: depth + 1,
\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t}))
\t\t\t\t\t\t: [];
\t\t\t\t\tconst results = await host.runSubagents(tasks);
\t\t\t\t\treturn { content: [{ type: "text", text: JSON.stringify(results, null, 2) }], details: { count: results.length } };
\t\t\t\t} catch (error) {
\t\t\t\t\treturn {
\t\t\t\t\t\tcontent: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
\t\t\t\t\t\tdetails: {},
\t\t\t\t\t\tisError: true,
\t\t\t\t\t};
\t\t\t\t}
\t\t\t},
\t\t});
\t}

\ttools.push({
\t\tname: "list_agent_skills",
\t\tlabel: "List Agent Skills",
\t\tdescription: "List skills available to the active Pi runtime.",
\t\tparameters: Type.Object({}),
\t\texecute: async () => ({
\t\t\tcontent: [{ type: "text", text: JSON.stringify(host.getSkillSummaries(), null, 2) }],
\t\t\tdetails: { count: host.getSkillSummaries().length },
\t\t}),
\t});

\treturn tools;
}
