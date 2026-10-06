import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import { BackgroundTaskManager } from "../background-tasks.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const manageTaskSchema = Type.Object({
	action: Type.Union(
		[Type.Literal("list"), Type.Literal("kill"), Type.Literal("status"), Type.Literal("send_input")],
		{ description: "The task management action to perform" },
	),
	taskId: Type.Optional(Type.String({ description: "Target background task ID" })),
	input: Type.Optional(Type.String({ description: "Input text to pipe to task stdin" })),
});

export type ManageTaskInput = Static<typeof manageTaskSchema>;

export function createManageTaskToolDefinition(): ToolDefinition {
	const manager = BackgroundTaskManager.getInstance();

	const tool: AgentTool<typeof manageTaskSchema> = {
		name: "manage_task",
		label: "manage_task",
		description: "Inspect, monitor, signal, or send input to running background tasks and processes.",
		parameters: manageTaskSchema,
		execute: async (_toolCallId, params) => {
			switch (params.action) {
				case "list": {
					const tasks = manager.list();
					if (tasks.length === 0) {
						return {
							content: [{ type: "text", text: "No background tasks currently active or recorded." }],
							details: undefined,
						};
					}
					const summary = tasks
						.map((t) => `- ID: ${t.id} | Status: ${t.status} | Command: \`${t.command}\` | Log: ${t.logPath}`)
						.join("\n");
					return {
						content: [{ type: "text", text: `Active and recent background tasks:\n${summary}` }],
						details: undefined,
					};
				}
				case "status": {
					if (!params.taskId) {
						return {
							content: [{ type: "text", text: "Error: taskId is required for 'status' action." }],
							details: undefined,
						};
					}
					const task = manager.get(params.taskId);
					if (!task) {
						return {
							content: [{ type: "text", text: `Error: No task found with ID '${params.taskId}'.` }],
							details: undefined,
						};
					}
					const details = [
						`Task: ${task.record.id}`,
						`Status: ${task.record.status}`,
						`Command: ${task.record.command}`,
						`Log file: ${task.record.logPath}`,
						task.record.exitCode !== undefined ? `Exit code: ${task.record.exitCode}` : "",
						"\n--- Recent Output Tail ---",
						task.recentOutput || "(no output captured yet)",
					]
						.filter(Boolean)
						.join("\n");
					return { content: [{ type: "text", text: details }], details: undefined };
				}
				case "kill": {
					if (!params.taskId) {
						return {
							content: [{ type: "text", text: "Error: taskId is required for 'kill' action." }],
							details: undefined,
						};
					}
					const success = await manager.kill(params.taskId);
					return {
						content: [
							{
								type: "text",
								text: success
									? `Terminated task ${params.taskId}.`
									: `Failed to terminate task ${params.taskId} (already finished or not found).`,
							},
						],
						details: undefined,
					};
				}
				case "send_input": {
					if (!params.taskId || params.input === undefined) {
						return {
							content: [{ type: "text", text: "Error: taskId and input are required for 'send_input' action." }],
							details: undefined,
						};
					}
					const sent = manager.sendInput(params.taskId, params.input);
					return {
						content: [
							{
								type: "text",
								text: sent
									? `Sent input to task ${params.taskId}.`
									: `Could not send input: task is not running or stdin is unavailable.`,
							},
						],
						details: undefined,
					};
				}
			}
		},
	};

	return wrapToolDefinition(tool);
}
