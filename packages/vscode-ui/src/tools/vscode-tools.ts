import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-core';
import { EditorContext } from '../context/editor';
import { WorkspaceContext } from '../context/workspace';
import { DiagnosticsContext } from '../context/diagnostics';
import { TerminalContext } from '../context/terminal';

export function createVsCodeTools(): ToolDefinition[] {
	const activeEditorTool: ToolDefinition = {
		name: 'vscode_get_active_editor',
		label: 'Get Active Editor',
		description: 'Get information about the currently open document and selection in the VS Code editor.',
		parameters: Type.Object({
			includeFullText: Type.Optional(Type.Boolean({ description: 'Whether to include the full text of the active document' })),
		}),
		execute: async (_toolCallId, params: any) => {
			const active = EditorContext.getActiveDocument(params?.includeFullText);
			if (!active) {
				return {
					content: [{ type: 'text', text: 'No active editor found in VS Code.' }],
				};
			}
			return {
				content: [{
					type: 'text',
					text: JSON.stringify(active, null, 2),
				}],
			};
		},
	};

	const diagnosticsTool: ToolDefinition = {
		name: 'vscode_get_diagnostics',
		label: 'Get Diagnostics',
		description: 'Retrieve current errors, warnings, and problems reported in the VS Code workspace.',
		parameters: Type.Object({
			limit: Type.Optional(Type.Number({ description: 'Maximum number of diagnostics to retrieve (default: 30)' })),
		}),
		execute: async (_toolCallId, params: any) => {
			const limit = params?.limit ?? 30;
			const summary = DiagnosticsContext.formatDiagnosticsForPrompt(limit);
			return {
				content: [{ type: 'text', text: summary }],
			};
		},
	};

	const searchWorkspaceTool: ToolDefinition = {
		name: 'vscode_search_workspace',
		label: 'Search Workspace Files',
		description: 'Search for files across the open VS Code workspace using a glob pattern.',
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: 'Glob search pattern (e.g. "**/*.ts", "src/**")' })),
			maxResults: Type.Optional(Type.Number({ description: 'Maximum results to return (default: 50)' })),
		}),
		execute: async (_toolCallId, params: any) => {
			const query = params?.query ?? '**/*';
			const maxResults = params?.maxResults ?? 50;
			const files = await WorkspaceContext.findFiles(query, maxResults);
			return {
				content: [{
					type: 'text',
					text: files.length > 0 ? files.join('\n') : 'No matching files found.',
				}],
			};
		},
	};

	const readFileTool: ToolDefinition = {
		name: 'vscode_read_file',
		label: 'Read File',
		description: 'Read the contents of a workspace file using VS Code filesystem abstraction.',
		parameters: Type.Object({
			path: Type.String({ description: 'Relative or absolute file path to read' }),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const content = await WorkspaceContext.readFile(params.path);
				return {
					content: [{ type: 'text', text: content }],
				};
			} catch (err: any) {
				return {
					content: [{ type: 'text', text: `Failed to read file: ${err?.message || String(err)}` }],
					isError: true,
				};
			}
		},
	};

	const terminalTool: ToolDefinition = {
		name: 'vscode_execute_terminal',
		label: 'Execute in Terminal',
		description: 'Send a command to be executed in the VS Code integrated terminal.',
		parameters: Type.Object({
			command: Type.String({ description: 'Shell command string to run in terminal' }),
		}),
		execute: async (_toolCallId, params: any) => {
			TerminalContext.executeInTerminal(params.command);
			return {
				content: [{ type: 'text', text: `Dispatched command to Pi Terminal: ${params.command}` }],
			};
		},
	};

	return [activeEditorTool, diagnosticsTool, searchWorkspaceTool, readFileTool, terminalTool];
}
