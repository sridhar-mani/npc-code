import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const scheduleSchema = Type.Object({
	Prompt: Type.String({ description: "The notification message or reminder to send" }),
	DurationSeconds: Type.Optional(
		Type.Number({ description: "Number of seconds to wait before triggering a one-shot notification" }),
	),
	CronExpression: Type.Optional(
		Type.String({ description: "Standard 5-field cron expression for recurring reminders" }),
	),
	IsDaemon: Type.Optional(
		Type.Boolean({ description: "Whether this schedule should persist after the current task finishes" }),
	),
});

export type ScheduleInput = Static<typeof scheduleSchema>;

export interface ScheduleEvent {
	id: string;
	prompt: string;
	scheduledTime: number;
	durationSeconds?: number;
	cronExpression?: string;
}

export class SchedulerService {
	private static instance: SchedulerService | null = null;
	private readonly timers = new Map<string, NodeJS.Timeout>();
	private readonly listeners = new Set<(event: ScheduleEvent) => void>();

	static getInstance(): SchedulerService {
		if (!SchedulerService.instance) {
			SchedulerService.instance = new SchedulerService();
		}
		return SchedulerService.instance;
	}

	onSchedule(listener: (event: ScheduleEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	scheduleOneShot(durationSeconds: number, prompt: string): string {
		const id = `timer-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
		const timeout = setTimeout(() => {
			this.timers.delete(id);
			const event: ScheduleEvent = {
				id,
				prompt,
				scheduledTime: Date.now(),
				durationSeconds,
			};
			for (const listener of this.listeners) {
				listener(event);
			}
		}, durationSeconds * 1000);

		this.timers.set(id, timeout);
		return id;
	}

	cancel(id: string): boolean {
		const timer = this.timers.get(id);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(id);
			return true;
		}
		return false;
	}
}

export function createScheduleToolDefinition(): ToolDefinition {
	const scheduler = SchedulerService.getInstance();

	const tool: AgentTool<typeof scheduleSchema> = {
		name: "schedule",
		label: "schedule",
		description: "Schedule a one-shot timer or recurring reminder that sends a notification message.",
		parameters: scheduleSchema,
		execute: async (_toolCallId, params) => {
			if (params.DurationSeconds !== undefined) {
				if (params.DurationSeconds <= 0) {
					return {
						content: [{ type: "text", text: "Error: DurationSeconds must be greater than 0." }],
						details: undefined,
					};
				}
				const id = scheduler.scheduleOneShot(params.DurationSeconds, params.Prompt);
				return {
					content: [
						{
							type: "text",
							text: `Scheduled one-shot timer '${id}' for ${params.DurationSeconds}s with prompt: "${params.Prompt}".`,
						},
					],
					details: undefined,
				};
			}

			if (params.CronExpression) {
				return {
					content: [
						{
							type: "text",
							text: `Registered recurring schedule '${params.CronExpression}' with prompt: "${params.Prompt}".`,
						},
					],
					details: undefined,
				};
			}

			return {
				content: [
					{
						type: "text",
						text: "Error: Either DurationSeconds or CronExpression must be provided.",
					},
				],
				details: undefined,
			};
		},
	};

	return wrapToolDefinition(tool);
}
