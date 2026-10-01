import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-core";

export interface RuntimeAgentToolHost {
	runSubagent(prompt: string, modelId?: string): Promise<{ id: string; result: string }>;
	getSkillSummaries(): Array<{ name: string; description: string; path: string }>;
	getTasks(): unknown[];
	createTask(input: { title: string; description?: string; status?: string; priority?: string; assignee?: string; parentTaskId?: string }): unknown;
	updateTask(id: string, input: Record<string, unknown>): unknown;
	removeTask(id: string): boolean;
}

export function createRuntimeAgentTools(host: RuntimeAgentToolHost): ToolDefinition[] {
	const runSubagent: ToolDefinition = {
		name: "run_subagent",
		label: "Run Subagent",
		description: "Run a focused child Pi agent with isolated conversation state and return its result.",
		parameters: Type.Object({
			prompt: Type.String({ description: "Focused task for the child agent." }),
			modelId: Type.Optional(Type.String({ description: "Optional provider/model or model id for the child." })),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await host.runSubagent(
					String(params.prompt),
					typeof params.modelId === "string" ? params.modelId : undefined,
				);
				return { content: [{ type: "text", text: result.result }], details: { subagentId: result.id } };
			} catch (error) {
				return {
					content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
					details: {},
					isError: true,
				};
			}
		},
	};

	const listSkills: ToolDefinition = {
		name: "list_agent_skills",
		label: "List Agent Skills",
		description: "List skills available to the active Pi runtime.",
		parameters: Type.Object({}),
		execute: async () => ({
			content: [{ type: "text", text: JSON.stringify(host.getSkillSummaries(), null, 2) }],
			details: { count: host.getSkillSummaries().length },
		}),
	};

	const createTask: ToolDefinition = {
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
			content: [{ type: "text", text: JSON.stringify(host.createTask({
				title: String(params.title),
				description: typeof params.description === "string" ? params.description : undefined,
				priority: typeof params.priority === "string" ? params.priority : undefined,
				parentTaskId: typeof params.parentTaskId === "string" ? params.parentTaskId : undefined,
			}), null, 2) }],
			details: {},
		}),
	};

	const listTasks: ToolDefinition = {
		name: "list_tasks",
		label: "List Tasks",
		description: "List durable workspace tasks and their current status.",
		parameters: Type.Object({}),
		execute: async () => {
			const tasks = host.getTasks();
			return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }], details: { count: tasks.length } };
		},
	};

	const updateTask: ToolDefinition = {
		name: "update_task",
		label: "Update Task",
		description: "Update a durable workspace task status, priority, assignment, or details.",
		parameters: Type.Object({
			id: Type.String({ description: "Task id." }),
			title: Type.Optional(Type.String()),
			description: Type.Optional(Type.String()),
			status: Type.Optional(Type.Union([
				Type.Literal("backlog"), Type.Literal("todo"), Type.Literal("in_progress"),
				Type.Literal("review"), Type.Literal("done"), Type.Literal("blocked"),
			])),
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
				return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], details: {}, isError: true };
			}
		},
	};

	const removeTask: ToolDefinition = {
		name: "remove_task",
		label: "Remove Task",
		description: "Remove a durable workspace task.",
		parameters: Type.Object({ id: Type.String({ description: "Task id." }) }),
		execute: async (_toolCallId, params: any) => ({
			content: [{ type: "text", text: host.removeTask(String(params.id)) ? "Task removed." : "Task not found." }],
			details: {},
		}),
	};

	return [runSubagent, listSkills, createTask, listTasks, updateTask, removeTask];
}
