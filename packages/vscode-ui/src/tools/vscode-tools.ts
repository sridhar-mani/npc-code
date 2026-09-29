import * as vscode from 'vscode';
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
					details: {},
				};
			}
			return {
				content: [{
					type: 'text',
					text: JSON.stringify(active, null, 2),
				}],
				details: {},
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
				details: {},
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
				details: { count: files.length },
			};
		},
	};

	const searchTextTool: ToolDefinition = {
		name: 'vscode_search_text',
		label: 'Search Text in Workspace',
		description: 'Search for text or regex patterns across files in the VS Code workspace.',
		parameters: Type.Object({
			query: Type.String({ description: 'Text or regex pattern to search for' }),
			isRegex: Type.Optional(Type.Boolean({ description: 'Whether the query is a regular expression' })),
			maxResults: Type.Optional(Type.Number({ description: 'Maximum results to return (default: 50)' })),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const maxResults = params?.maxResults ?? 50;
				const matches: { path: string; line: number; preview: string }[] = [];
				if (typeof (vscode.workspace as any).findTextInFiles === 'function') {
					await (vscode.workspace as any).findTextInFiles(
						{
							pattern: params.query,
							isRegExp: Boolean(params?.isRegex),
						},
						{
							maxResults,
						},
						(result: any) => {
							if (matches.length < maxResults) {
								matches.push({
									path: vscode.workspace.asRelativePath(result.uri),
									line: result.ranges?.[0]?.start?.line !== undefined ? result.ranges[0].start.line + 1 : 1,
									preview: result.preview?.text?.trim() || '',
								});
							}
						},
					);
				}
				return {
					content: [{
						type: 'text',
						text: matches.length > 0
							? matches.map((m) => `${m.path}:${m.line}: ${m.preview}`).join('\n')
							: 'No matching text found across workspace.',
					}],
					details: { matchCount: matches.length },
				};
			} catch (err: any) {
				return {
					content: [{ type: 'text', text: `Search failed: ${err?.message || String(err)}` }],
					details: {},
					isError: true,
				};
			}
		},
	};

	const fetchUrlTool: ToolDefinition = {
		name: 'vscode_fetch_url',
		label: 'Fetch URL Content',
		description: 'Inspect or fetch HTTP/HTTPS URL content and verify API status.',
		parameters: Type.Object({
			url: Type.String({ description: 'HTTP or HTTPS URL to inspect or fetch' }),
			method: Type.Optional(Type.String({ description: 'HTTP method (default: GET)' })),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 10000);
				const res = await fetch(params.url, {
					method: params.method || 'GET',
					signal: controller.signal,
				});
				clearTimeout(timeoutId);
				const text = await res.text();
				const truncated = text.length > 20000 ? text.slice(0, 20000) + '\n... [truncated]' : text;
				return {
					content: [{
						type: 'text',
						text: `HTTP ${res.status} ${res.statusText}\n\n${truncated}`,
					}],
					details: { status: res.status, statusText: res.statusText },
				};
			} catch (err: any) {
				return {
					content: [{ type: 'text', text: `Failed to fetch URL: ${err?.message || String(err)}` }],
					details: {},
					isError: true,
				};
			}
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
					details: {},
				};
			} catch (err: any) {
				return {
					content: [{ type: 'text', text: `Failed to read file: ${err?.message || String(err)}` }],
					details: {},
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
				details: {},
			};
		},
	};

	const openFileTool: ToolDefinition = {
		name: 'vscode_open_file',
		label: 'Open File',
		description: 'Open a workspace file in VS Code and optionally reveal a line range.',
		parameters: Type.Object({
			path: Type.String(),
			startLine: Type.Optional(Type.Number()),
			endLine: Type.Optional(Type.Number()),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const document = await vscode.workspace.openTextDocument(WorkspaceContext.toUri(params.path));
				const editor = await vscode.window.showTextDocument(document, { preview: false });
				if (params.startLine !== undefined) {
					const start = Math.max(0, params.startLine - 1);
					const end = Math.max(start, (params.endLine ?? params.startLine) - 1);
					editor.revealRange(new vscode.Range(start, 0, Math.min(end + 1, document.lineCount), 0), vscode.TextEditorRevealType.InCenter);
				}
				return { content: [{ type: 'text', text: JSON.stringify({ opened: true, path: params.path }) }], details: {} };
			} catch (err: any) {
				return { content: [{ type: 'text', text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const saveFileTool: ToolDefinition = {
		name: 'vscode_save_file',
		label: 'Save File',
		description: 'Save a workspace document through the VS Code API so open buffers remain synchronized.',
		parameters: Type.Object({ path: Type.String() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const document = await vscode.workspace.openTextDocument(WorkspaceContext.toUri(params.path));
				return { content: [{ type: 'text', text: JSON.stringify({ saved: await document.save(), path: params.path }) }], details: {} };
			} catch (err: any) {
				return { content: [{ type: 'text', text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const applyEditTool: ToolDefinition = {
		name: 'vscode_apply_workspace_edit',
		label: 'Apply Workspace Edit',
		description: 'Apply explicit text replacements through VS Code WorkspaceEdit, preserving synchronization with open editors.',
		parameters: Type.Object({
			edits: Type.Array(Type.Object({
				path: Type.String(),
				startLine: Type.Number(),
				startCharacter: Type.Number(),
				endLine: Type.Number(),
				endCharacter: Type.Number(),
				newText: Type.String(),
			})),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const edit = new vscode.WorkspaceEdit();
				for (const item of params.edits ?? []) {
					edit.replace(
						WorkspaceContext.toUri(item.path),
						new vscode.Range(item.startLine, item.startCharacter, item.endLine, item.endCharacter),
						item.newText,
					);
				}
				return { content: [{ type: 'text', text: JSON.stringify({ applied: await vscode.workspace.applyEdit(edit), count: params.edits?.length ?? 0 }) }], details: {} };
			} catch (err: any) {
				return { content: [{ type: 'text', text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const hoverTool: ToolDefinition = {
		name: 'vscode_get_hover',
		label: 'Get Hover Information',
		description: 'Use VS Code language providers to retrieve hover/type information at a source position.',
		parameters: Type.Object({ path: Type.String(), line: Type.Number(), character: Type.Number() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await vscode.commands.executeCommand<vscode.Hover[]>(
					'vscode.executeHoverProvider',
					WorkspaceContext.toUri(params.path),
					new vscode.Position(params.line, params.character),
				);
				return { content: [{ type: 'text', text: JSON.stringify(result ?? []) }], details: {} };
			} catch (err: any) {
				return { content: [{ type: 'text', text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const definitionsTool: ToolDefinition = {
		name: 'vscode_get_definitions',
		label: 'Get Definitions',
		description: 'Resolve symbol definitions using VS Code language providers.',
		parameters: Type.Object({ path: Type.String(), line: Type.Number(), character: Type.Number() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
					'vscode.executeDefinitionProvider',
					WorkspaceContext.toUri(params.path),
					new vscode.Position(params.line, params.character),
				);
				return { content: [{ type: 'text', text: JSON.stringify(result ?? []) }], details: {} };
			} catch (err: any) {
				return { content: [{ type: 'text', text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const referencesTool: ToolDefinition = {
		name: 'vscode_get_references',
		label: 'Get References',
		description: 'Find symbol references using VS Code language providers.',
		parameters: Type.Object({ path: Type.String(), line: Type.Number(), character: Type.Number() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await vscode.commands.executeCommand<vscode.Location[]>(
					'vscode.executeReferenceProvider',
					WorkspaceContext.toUri(params.path),
					new vscode.Position(params.line, params.character),
				);
				return { content: [{ type: 'text', text: JSON.stringify(result ?? []) }], details: {} };
			} catch (err: any) {
				return { content: [{ type: 'text', text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	return [
		activeEditorTool,
		diagnosticsTool,
		searchWorkspaceTool,
		searchTextTool,
		fetchUrlTool,
		readFileTool,
		terminalTool,
		openFileTool,
		saveFileTool,
		applyEditTool,
		hoverTool,
		definitionsTool,
		referencesTool,
	];
}
