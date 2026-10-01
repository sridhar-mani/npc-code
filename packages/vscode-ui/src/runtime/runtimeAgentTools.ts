import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-core";

export interface RuntimeAgentToolHost {
	runSubagent(prompt: string, modelId?: string): Promise<{ id: string; result: string }>;
	getSkillSummaries(): Array<{ name: string; description: string; path: string }>;
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
				const result = await host.runSubagent(String(params.prompt), typeof params.modelId === "string" ? params.modelId : undefined);
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

	return [runSubagent, listSkills];
}
