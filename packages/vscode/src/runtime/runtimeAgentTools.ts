import type { CreateTaskInput, TaskRecord, ToolDefinition, UpdateTaskInput } from "@earendil-works/pi-core";
import { Type } from "typebox";

export interface SubagentRunOptions {
	id?: string;
	tools?: string[];
	skills?: string[];
	worktree?: boolean;
	maxDepth?: number;
}

export interface RuntimeAgentToolHost {
	runSubagent(
		prompt: string,
		modelId?: string,
		options?: SubagentRunOptions,
	): Promise<{
		id: string;
		result: string;
		sessionPath: string;
		worktreePath?: string;
		branchName?: string;
	}>;
	runSubagents(tasks: Array<{ prompt: string; modelId?: string; options?: SubagentRunOptions }>): Promise<
		Array<{
			id: string;
			result: string;
			sessionPath: string;
			worktreePath?: string;
			branchName?: string;
		}>
	>;
	getSkillSummaries(): Array<{ name: string; description: string; path: string }>;
	getTasks(): TaskRecord[];
	createTask(input: CreateTaskInput): TaskRecord;
	updateTask(id: string, input: UpdateTaskInput): TaskRecord;
	removeTask(id: string): boolean;
}

export function createRuntimeAgentTools(host: RuntimeAgentToolHost, depth = 0): ToolDefinition[] {
	const maxDepth = 2;
	const tools: ToolDefinition[] = [];

	if (depth < maxDepth) {
		tools.push({
			name: "run_subagent",
			label: "Run Subagent",
			description:
				"Run a focused child Pi agent with a persisted session. Use worktree=true for isolated edits and skills/tools to scope the child.",
			parameters: Type.Object({
				prompt: Type.String({ description: "Focused task for the child agent." }),
				modelId: Type.Optional(Type.String({ description: "Optional provider/model or model id for the child." })),
				id: Type.Optional(
					Type.String({ description: "Existing subagent id to resume instead of creating a new child." }),
				),
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
				tasks: Type.Array(
					Type.Object({
						prompt: Type.String(),
						modelId: Type.Optional(Type.String()),
						worktree: Type.Optional(Type.Boolean()),
						tools: Type.Optional(Type.Array(Type.String())),
						skills: Type.Optional(Type.Array(Type.String())),
					}),
				),
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
					return {
						content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
						details: { count: results.length },
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

	tools.push({
		name: "create_task",
		label: "Create Task",
		description: "Create a durable workspace task that persists outside the conversation.",
		parameters: Type.Object({
			title: Type.String({ description: "Task title." }),
			description: Type.Optional(Type.String({ description: "Task details and acceptance criteria." })),
			priority: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
			parentTaskId: Type.Optional(Type.String()),
		}),
		execute: async (_toolCallId, params: any) => ({
			content: [
				{
					type: "text",
					text: JSON.stringify(
						host.createTask({
							title: String(params.title),
							description: typeof params.description === "string" ? params.description : undefined,
							priority: typeof params.priority === "string" ? params.priority : undefined,
							parentTaskId: typeof params.parentTaskId === "string" ? params.parentTaskId : undefined,
						}),
						null,
						2,
					),
				},
			],
			details: {},
		}),
	});

	tools.push({
		name: "list_tasks",
		label: "List Tasks",
		description: "List durable workspace tasks and their current status.",
		parameters: Type.Object({}),
		execute: async () => {
			const tasks = host.getTasks();
			return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }], details: { count: tasks.length } };
		},
	});

	tools.push({
		name: "update_task",
		label: "Update Task",
		description: "Update a durable workspace task status, priority, assignment, or details.",
		parameters: Type.Object({
			id: Type.String({ description: "Task id." }),
			title: Type.Optional(Type.String()),
			description: Type.Optional(Type.String()),
			status: Type.Optional(
				Type.Union([
					Type.Literal("backlog"),
					Type.Literal("todo"),
					Type.Literal("in_progress"),
					Type.Literal("review"),
					Type.Literal("done"),
					Type.Literal("blocked"),
				]),
			),
			priority: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
			assignee: Type.Optional(Type.String()),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const task = host.updateTask(String(params.id), {
					...(typeof params.title === "string" ? { title: params.title } : {}),
					...(typeof params.description === "string" ? { description: params.description } : {}),
					...(typeof params.status === "string" ? { status: params.status } : {}),
					...(typeof params.priority === "string" ? { priority: params.priority } : {}),
					...(typeof params.assignee === "string" ? { assignee: params.assignee } : {}),
				});
				return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }], details: {} };
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
		name: "remove_task",
		label: "Remove Task",
		description: "Remove a durable workspace task.",
		parameters: Type.Object({ id: Type.String({ description: "Task id." }) }),
		execute: async (_toolCallId, params: any) => ({
			content: [{ type: "text", text: host.removeTask(String(params.id)) ? "Task removed." : "Task not found." }],
			details: {},
		}),
	});

	return tools;
}
