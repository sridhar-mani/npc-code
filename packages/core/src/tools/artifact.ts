import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import { ArtifactManager } from "../artifacts.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const artifactSchema = Type.Object({
	action: Type.Union([Type.Literal("save"), Type.Literal("read"), Type.Literal("list")], {
		description: "The artifact management action to perform",
	}),
	name: Type.Optional(Type.String({ description: "The artifact filename (e.g., 'analysis_report.md', 'plan.md')" })),
	content: Type.Optional(Type.String({ description: "Markdown or code content of the artifact to save" })),
	summary: Type.Optional(Type.String({ description: "A concise summary of what this artifact contains" })),
	requestFeedback: Type.Optional(
		Type.Boolean({ description: "Whether to prompt the user for explicit feedback on this artifact" }),
	),
});

export type ArtifactInput = Static<typeof artifactSchema>;

export function createArtifactToolDefinition(cwd: string): ToolDefinition {
	const manager = new ArtifactManager(cwd);

	const tool: AgentTool<typeof artifactSchema> = {
		name: "artifact",
		label: "artifact",
		description:
			"Save, inspect, or list structured persistent artifacts (specifications, architecture plans, reviews, analysis reports) in the workspace.",
		parameters: artifactSchema,
		execute: async (_toolCallId, params) => {
			switch (params.action) {
				case "list": {
					const items = manager.listArtifacts();
					if (items.length === 0) {
						return { content: [{ type: "text", text: "No artifacts have been saved yet." }], details: undefined };
					}
					const listText = items
						.map(
							(a) => `- **${a.name}**: ${a.metadata.summary} (updated: ${new Date(a.updatedAt).toISOString()})`,
						)
						.join("\n");
					return { content: [{ type: "text", text: `Saved Artifacts:\n${listText}` }], details: undefined };
				}
				case "read": {
					if (!params.name) {
						return {
							content: [{ type: "text", text: "Error: 'name' is required to read an artifact." }],
							details: undefined,
						};
					}
					const found = manager.getArtifact(params.name);
					if (!found) {
						return {
							content: [{ type: "text", text: `Error: Artifact '${params.name}' not found.` }],
							details: undefined,
						};
					}
					return {
						content: [
							{
								type: "text",
								text: `# Artifact: ${found.record.name}\nSummary: ${found.record.metadata.summary}\n\n${found.content}`,
							},
						],
						details: undefined,
					};
				}
				case "save": {
					if (!params.name || params.content === undefined) {
						return {
							content: [
								{ type: "text", text: "Error: Both 'name' and 'content' are required to save an artifact." },
							],
							details: undefined,
						};
					}
					const record = manager.saveArtifact(params.name, params.content, {
						summary: params.summary,
						requestFeedback: params.requestFeedback,
					});
					return {
						content: [
							{
								type: "text",
								text: `Successfully saved artifact '${record.name}' (${record.path}).\nSummary: ${record.metadata.summary}`,
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
