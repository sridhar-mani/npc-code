import { existsSync, readFileSync } from "node:fs";
import {
	AirgapGuard,
	ContinuousAstDependencyGraph,
	EvidencePreservingReducer,
	ExecCriticScaffold,
	executeFusedCommand,
	OpenResearchEngine,
	PrAutoPilot,
	ProceduralGraph,
	type ToolDefinition,
} from "@earendil-works/pi-core";
import { Type } from "typebox";
import * as vscode from "vscode";
import { DiagnosticsContext } from "../context/diagnostics";
import { EditorContext } from "../context/editor";
import { TerminalContext } from "../context/terminal";
import { WorkspaceContext } from "../context/workspace";

export function createVsCodeTools(): ToolDefinition[] {
	const activeEditorTool: ToolDefinition = {
		name: "vscode_get_active_editor",
		label: "Get Active Editor",
		description: "Get information about the currently open document and selection in the VS Code editor.",
		parameters: Type.Object({
			includeFullText: Type.Optional(
				Type.Boolean({ description: "Whether to include the full text of the active document" }),
			),
		}),
		execute: async (_toolCallId, params: any) => {
			const active = EditorContext.getActiveDocument(params?.includeFullText);
			if (!active) {
				return {
					content: [{ type: "text", text: "No active editor found in VS Code." }],
					details: {},
				};
			}
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(active, null, 2),
					},
				],
				details: {},
			};
		},
	};

	const diagnosticsTool: ToolDefinition = {
		name: "vscode_get_diagnostics",
		label: "Get Diagnostics",
		description: "Retrieve current errors, warnings, and problems reported in the VS Code workspace.",
		parameters: Type.Object({
			limit: Type.Optional(Type.Number({ description: "Maximum number of diagnostics to retrieve (default: 30)" })),
		}),
		execute: async (_toolCallId, params: any) => {
			const limit = params?.limit ?? 30;
			const summary = DiagnosticsContext.formatDiagnosticsForPrompt(limit);
			return {
				content: [{ type: "text", text: summary }],
				details: {},
			};
		},
	};

	const searchWorkspaceTool: ToolDefinition = {
		name: "vscode_search_workspace",
		label: "Search Workspace Files",
		description: "Search for files across the open VS Code workspace using a glob pattern.",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: 'Glob search pattern (e.g. "**/*.ts", "src/**")' })),
			maxResults: Type.Optional(Type.Number({ description: "Maximum results to return (default: 50)" })),
		}),
		execute: async (_toolCallId, params: any) => {
			const query = params?.query ?? "**/*";
			const maxResults = params?.maxResults ?? 50;
			const files = await WorkspaceContext.findFiles(query, maxResults);
			return {
				content: [
					{
						type: "text",
						text: files.length > 0 ? files.join("\n") : "No matching files found.",
					},
				],
				details: { count: files.length },
			};
		},
	};

	const searchTextTool: ToolDefinition = {
		name: "vscode_search_text",
		label: "Search Text in Workspace",
		description: "Search for text or regex patterns across files in the VS Code workspace.",
		parameters: Type.Object({
			query: Type.String({ description: "Text or regex pattern to search for" }),
			isRegex: Type.Optional(Type.Boolean({ description: "Whether the query is a regular expression" })),
			maxResults: Type.Optional(Type.Number({ description: "Maximum results to return (default: 50)" })),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const maxResults = params?.maxResults ?? 50;
				const matches: { path: string; line: number; preview: string }[] = [];
				if (typeof (vscode.workspace as any).findTextInFiles === "function") {
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
									preview: result.preview?.text?.trim() || "",
								});
							}
						},
					);
				}
				return {
					content: [
						{
							type: "text",
							text:
								matches.length > 0
									? matches.map((m) => `${m.path}:${m.line}: ${m.preview}`).join("\n")
									: "No matching text found across workspace.",
						},
					],
					details: { matchCount: matches.length },
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Search failed: ${err?.message || String(err)}` }],
					details: {},
					isError: true,
				};
			}
		},
	};

	const fetchUrlTool: ToolDefinition = {
		name: "vscode_fetch_url",
		label: "Fetch URL Content",
		description: "Inspect or fetch HTTP/HTTPS URL content and verify API status.",
		parameters: Type.Object({
			url: Type.String({ description: "HTTP or HTTPS URL to inspect or fetch" }),
			method: Type.Optional(Type.String({ description: "HTTP method (default: GET)" })),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 10000);
				const res = await fetch(params.url, {
					method: params.method || "GET",
					signal: controller.signal,
				});
				clearTimeout(timeoutId);
				const text = await res.text();
				const truncated = text.length > 20000 ? text.slice(0, 20000) + "\n... [truncated]" : text;
				return {
					content: [
						{
							type: "text",
							text: `HTTP ${res.status} ${res.statusText}\n\n${truncated}`,
						},
					],
					details: { status: res.status, statusText: res.statusText },
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Failed to fetch URL: ${err?.message || String(err)}` }],
					details: {},
					isError: true,
				};
			}
		},
	};

	const readFileTool: ToolDefinition = {
		name: "vscode_read_file",
		label: "Read File",
		description: "Read the contents of a workspace file using VS Code filesystem abstraction.",
		parameters: Type.Object({
			path: Type.String({ description: "Relative or absolute file path to read" }),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const content = await WorkspaceContext.readFile(params.path);
				return {
					content: [{ type: "text", text: content }],
					details: {},
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Failed to read file: ${err?.message || String(err)}` }],
					details: {},
					isError: true,
				};
			}
		},
	};

	const terminalTool: ToolDefinition = {
		name: "vscode_execute_terminal",
		label: "Execute in Terminal",
		description: "Send a command to be executed in the VS Code integrated terminal.",
		parameters: Type.Object({
			command: Type.String({ description: "Shell command string to run in terminal" }),
		}),
		execute: async (_toolCallId, params: any) => {
			TerminalContext.executeInTerminal(params.command);
			return {
				content: [{ type: "text", text: `Dispatched command to NPC Terminal: ${params.command}` }],
				details: {},
			};
		},
	};

	const openFileTool: ToolDefinition = {
		name: "vscode_open_file",
		label: "Open File",
		description: "Open a workspace file in VS Code and optionally reveal a line range.",
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
					editor.revealRange(
						new vscode.Range(start, 0, Math.min(end + 1, document.lineCount), 0),
						vscode.TextEditorRevealType.InCenter,
					);
				}
				return {
					content: [{ type: "text", text: JSON.stringify({ opened: true, path: params.path }) }],
					details: {},
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const saveFileTool: ToolDefinition = {
		name: "vscode_save_file",
		label: "Save File",
		description: "Save a workspace document through the VS Code API so open buffers remain synchronized.",
		parameters: Type.Object({ path: Type.String() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const document = await vscode.workspace.openTextDocument(WorkspaceContext.toUri(params.path));
				return {
					content: [{ type: "text", text: JSON.stringify({ saved: await document.save(), path: params.path }) }],
					details: {},
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const applyEditTool: ToolDefinition = {
		name: "vscode_apply_workspace_edit",
		label: "Apply Workspace Edit",
		description:
			"Apply explicit text replacements through VS Code WorkspaceEdit, preserving synchronization with open editors.",
		parameters: Type.Object({
			edits: Type.Array(
				Type.Object({
					path: Type.String(),
					startLine: Type.Number(),
					startCharacter: Type.Number(),
					endLine: Type.Number(),
					endCharacter: Type.Number(),
					newText: Type.String(),
				}),
			),
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
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								applied: await vscode.workspace.applyEdit(edit),
								count: params.edits?.length ?? 0,
							}),
						},
					],
					details: {},
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const hoverTool: ToolDefinition = {
		name: "vscode_get_hover",
		label: "Get Hover Information",
		description: "Use VS Code language providers to retrieve hover/type information at a source position.",
		parameters: Type.Object({ path: Type.String(), line: Type.Number(), character: Type.Number() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await vscode.commands.executeCommand<vscode.Hover[]>(
					"vscode.executeHoverProvider",
					WorkspaceContext.toUri(params.path),
					new vscode.Position(params.line, params.character),
				);
				return { content: [{ type: "text", text: JSON.stringify(result ?? []) }], details: {} };
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const definitionsTool: ToolDefinition = {
		name: "vscode_get_definitions",
		label: "Get Definitions",
		description: "Resolve symbol definitions using VS Code language providers.",
		parameters: Type.Object({ path: Type.String(), line: Type.Number(), character: Type.Number() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
					"vscode.executeDefinitionProvider",
					WorkspaceContext.toUri(params.path),
					new vscode.Position(params.line, params.character),
				);
				return { content: [{ type: "text", text: JSON.stringify(result ?? []) }], details: {} };
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const listLanguageModelTools: ToolDefinition = {
		name: "vscode_list_language_model_tools",
		label: "List VS Code Agent Tools",
		description:
			"List Language Model Tools currently exposed by the VS Code host. This lets NPC discover current extension-contributed agent tools without hardcoding a static tool inventory.",
		parameters: Type.Object({}),
		execute: async () => {
			try {
				const tools = ((vscode as any).lm?.tools ?? []) as Array<{
					name?: string;
					description?: string;
					inputSchema?: unknown;
					tags?: readonly string[];
				}>;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								tools.map((tool) => ({
									name: tool.name,
									description: tool.description,
									inputSchema: tool.inputSchema,
									tags: tool.tags,
								})),
								null,
								2,
							),
						},
					],
					details: { count: tools.length },
				};
			} catch (err: any) {
				return {
					content: [
						{ type: "text", text: `Failed to list VS Code language model tools: ${err?.message || String(err)}` },
					],
					details: {},
					isError: true,
				};
			}
		},
	};

	const invokeLanguageModelTool: ToolDefinition = {
		name: "vscode_invoke_language_model_tool",
		label: "Invoke VS Code Agent Tool",
		description:
			"Invoke a VS Code Language Model Tool by its exact name after discovering it with vscode_list_language_model_tools.",
		parameters: Type.Object({
			name: Type.String(),
			input: Type.Optional(Type.Any()),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const lm = (vscode as any).lm;
				if (!lm?.invokeTool) {
					throw new Error("VS Code Language Model Tool API is unavailable in this VS Code host.");
				}
				const result = await lm.invokeTool(String(params?.name || ""), {
					input: params?.input ?? {},
					toolInvocationToken: undefined,
				});
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					details: {},
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `VS Code tool invocation failed: ${err?.message || String(err)}` }],
					details: {},
					isError: true,
				};
			}
		},
	};

	const referencesTool: ToolDefinition = {
		name: "vscode_get_references",
		label: "Get References",
		description: "Find symbol references using VS Code language providers.",
		parameters: Type.Object({ path: Type.String(), line: Type.Number(), character: Type.Number() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await vscode.commands.executeCommand<vscode.Location[]>(
					"vscode.executeReferenceProvider",
					WorkspaceContext.toUri(params.path),
					new vscode.Position(params.line, params.character),
				);
				return { content: [{ type: "text", text: JSON.stringify(result ?? []) }], details: {} };
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const workspaceFoldersTool: ToolDefinition = {
		name: "vscode_get_workspace_folders",
		label: "Get Workspace Folders",
		description:
			"List the folders currently open in the VS Code workspace, including display names and filesystem paths.",
		parameters: Type.Object({}),
		execute: async () => {
			const folders = WorkspaceContext.getFolders().map((folder) => ({
				name: folder.name,
				path: folder.uri.fsPath,
				uri: folder.uri.toString(),
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(folders, null, 2) }],
				details: { count: folders.length },
			};
		},
	};

	const openEditorsTool: ToolDefinition = {
		name: "vscode_get_open_editors",
		label: "Get Open Editors",
		description: "List open text editors/documents in VS Code with paths, languages, and unsaved state.",
		parameters: Type.Object({}),
		execute: async () => {
			const editors = vscode.window.visibleTextEditors.map((editor) => ({
				path: vscode.workspace.asRelativePath(editor.document.uri),
				languageId: editor.document.languageId,
				isDirty: editor.document.isDirty,
				lineCount: editor.document.lineCount,
				selection: {
					startLine: editor.selection.start.line + 1,
					startCharacter: editor.selection.start.character + 1,
					endLine: editor.selection.end.line + 1,
					endCharacter: editor.selection.end.character + 1,
				},
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(editors, null, 2) }],
				details: { count: editors.length },
			};
		},
	};

	const selectionTool: ToolDefinition = {
		name: "vscode_get_selection",
		label: "Get Editor Selection",
		description: "Get the current VS Code editor selection and the selected source text.",
		parameters: Type.Object({}),
		execute: async () => {
			const active = vscode.window.activeTextEditor;
			if (!active) return { content: [{ type: "text", text: "No active editor." }], details: {} };
			const selection = active.selection;
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								path: vscode.workspace.asRelativePath(active.document.uri),
								startLine: selection.start.line + 1,
								startCharacter: selection.start.character + 1,
								endLine: selection.end.line + 1,
								endCharacter: selection.end.character + 1,
								text: active.document.getText(selection),
							},
							null,
							2,
						),
					},
				],
				details: {},
			};
		},
	};

	const listDirectoryTool: ToolDefinition = {
		name: "vscode_list_directory",
		label: "List Directory",
		description: "List files and directories from the VS Code workspace filesystem.",
		parameters: Type.Object({
			path: Type.Optional(
				Type.String({ description: "Workspace-relative or absolute directory path; defaults to workspace root." }),
			),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const root = params?.path || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				if (!root) throw new Error("No VS Code workspace is open.");
				const entries = await vscode.workspace.fs.readDirectory(WorkspaceContext.toUri(root));
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								entries.map(([name, type]) => ({
									name,
									type:
										type === vscode.FileType.Directory
											? "directory"
											: type === vscode.FileType.SymbolicLink
												? "symlink"
												: "file",
								})),
								null,
								2,
							),
						},
					],
					details: { count: entries.length, path: root },
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const writeFileTool: ToolDefinition = {
		name: "vscode_write_file",
		label: "Write File",
		description: "Write complete UTF-8 content to a workspace file through the VS Code filesystem API.",
		parameters: Type.Object({
			path: Type.String(),
			content: Type.String(),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const uri = WorkspaceContext.toUri(params.path);
				await vscode.workspace.fs.writeFile(uri, Buffer.from(String(params.content), "utf8"));
				return {
					content: [
						{ type: "text", text: JSON.stringify({ written: true, path: vscode.workspace.asRelativePath(uri) }) },
					],
					details: {},
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const createFileTool: ToolDefinition = {
		name: "vscode_create_file",
		label: "Create File",
		description: "Create a new workspace file and fail if the target already exists.",
		parameters: Type.Object({
			path: Type.String(),
			content: Type.Optional(Type.String()),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const uri = WorkspaceContext.toUri(params.path);
				let exists = false;
				try {
					await vscode.workspace.fs.stat(uri);
					exists = true;
				} catch (error) {
					const code = String((error as any)?.code || "");
					const message = String((error as any)?.message || "");
					if (code && code !== "FileNotFound" && code !== "ENOENT" && !/not found/i.test(message)) throw error;
				}
				if (exists) throw new Error(`File already exists: ${params.path}`);
				await vscode.workspace.fs.writeFile(uri, Buffer.from(String(params?.content ?? ""), "utf8"));
				return {
					content: [
						{ type: "text", text: JSON.stringify({ created: true, path: vscode.workspace.asRelativePath(uri) }) },
					],
					details: {},
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const deleteFileTool: ToolDefinition = {
		name: "vscode_delete_file",
		label: "Delete File",
		description: "Delete a workspace file or directory through the VS Code filesystem API.",
		parameters: Type.Object({
			path: Type.String(),
			recursive: Type.Optional(Type.Boolean()),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const uri = WorkspaceContext.toUri(params.path);
				await vscode.workspace.fs.delete(uri, { recursive: Boolean(params?.recursive), useTrash: true });
				return {
					content: [
						{ type: "text", text: JSON.stringify({ deleted: true, path: vscode.workspace.asRelativePath(uri) }) },
					],
					details: {},
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const renameFileTool: ToolDefinition = {
		name: "vscode_rename_file",
		label: "Rename File",
		description: "Rename or move a workspace file through the VS Code filesystem API.",
		parameters: Type.Object({
			oldPath: Type.String(),
			newPath: Type.String(),
			overwrite: Type.Optional(Type.Boolean()),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const oldUri = WorkspaceContext.toUri(params.oldPath);
				const newUri = WorkspaceContext.toUri(params.newPath);
				await vscode.workspace.fs.rename(oldUri, newUri, { overwrite: Boolean(params?.overwrite) });
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								renamed: true,
								from: vscode.workspace.asRelativePath(oldUri),
								to: vscode.workspace.asRelativePath(newUri),
							}),
						},
					],
					details: {},
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const documentSymbolsTool: ToolDefinition = {
		name: "vscode_get_document_symbols",
		label: "Get Document Symbols",
		description:
			"Retrieve classes, functions, methods, variables, and other document symbols from VS Code language services.",
		parameters: Type.Object({ path: Type.String() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await vscode.commands.executeCommand<vscode.SymbolInformation[] | vscode.DocumentSymbol[]>(
					"vscode.executeDocumentSymbolProvider",
					WorkspaceContext.toUri(params.path),
				);
				return {
					content: [{ type: "text", text: JSON.stringify(result ?? [], null, 2) }],
					details: { count: result?.length ?? 0 },
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const workspaceSymbolsTool: ToolDefinition = {
		name: "vscode_find_symbols",
		label: "Find Workspace Symbols",
		description:
			"Search for symbol definitions (classes, interfaces, functions, methods) across the workspace using VS Code workspace symbol providers.",
		parameters: Type.Object({
			query: Type.String({ description: "Symbol name or prefix to search for" }),
			maxResults: Type.Optional(Type.Number({ description: "Maximum symbols to return (default: 50)" })),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const query = params?.query ?? "";
				const maxResults = params?.maxResults ?? 50;
				const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
					"vscode.executeWorkspaceSymbolProvider",
					query,
				);
				const formatted = (symbols ?? []).slice(0, maxResults).map((s) => ({
					name: s.name,
					kind: vscode.SymbolKind[s.kind] ?? s.kind,
					containerName: s.containerName,
					path: vscode.workspace.asRelativePath(s.location.uri),
					range: {
						startLine: s.location.range.start.line + 1,
						startCharacter: s.location.range.start.character + 1,
						endLine: s.location.range.end.line + 1,
						endCharacter: s.location.range.end.character + 1,
					},
				}));
				return {
					content: [
						{
							type: "text",
							text:
								formatted.length > 0
									? JSON.stringify(formatted, null, 2)
									: `No symbols found matching "${query}".`,
						},
					],
					details: { count: formatted.length },
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const signatureHelpTool: ToolDefinition = {
		name: "vscode_get_signature_help",
		label: "Get Signature Help",
		description: "Retrieve function/method signature and parameter help at a source position.",
		parameters: Type.Object({ path: Type.String(), line: Type.Number(), character: Type.Number() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await vscode.commands.executeCommand<vscode.SignatureHelp>(
					"vscode.executeSignatureHelpProvider",
					WorkspaceContext.toUri(params.path),
					new vscode.Position(Math.max(0, params.line - 1), Math.max(0, params.character - 1)),
				);
				return { content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }], details: {} };
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const typeDefinitionTool: ToolDefinition = {
		name: "vscode_get_type_definition",
		label: "Get Type Definitions",
		description: "Resolve the type definition for the symbol at a source position.",
		parameters: Type.Object({ path: Type.String(), line: Type.Number(), character: Type.Number() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
					"vscode.executeTypeDefinitionProvider",
					WorkspaceContext.toUri(params.path),
					new vscode.Position(Math.max(0, params.line - 1), Math.max(0, params.character - 1)),
				);
				return {
					content: [{ type: "text", text: JSON.stringify(result ?? [], null, 2) }],
					details: { count: result?.length ?? 0 },
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const implementationsTool: ToolDefinition = {
		name: "vscode_get_implementations",
		label: "Get Implementations",
		description: "Find implementations of the symbol at a source position using VS Code language services.",
		parameters: Type.Object({ path: Type.String(), line: Type.Number(), character: Type.Number() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
					"vscode.executeImplementationProvider",
					WorkspaceContext.toUri(params.path),
					new vscode.Position(Math.max(0, params.line - 1), Math.max(0, params.character - 1)),
				);
				return {
					content: [{ type: "text", text: JSON.stringify(result ?? [], null, 2) }],
					details: { count: result?.length ?? 0 },
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const declarationTool: ToolDefinition = {
		name: "vscode_get_declarations",
		label: "Get Declarations",
		description: "Resolve declarations of the symbol at a source position.",
		parameters: Type.Object({ path: Type.String(), line: Type.Number(), character: Type.Number() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
					"vscode.executeDeclarationProvider",
					WorkspaceContext.toUri(params.path),
					new vscode.Position(Math.max(0, params.line - 1), Math.max(0, params.character - 1)),
				);
				return {
					content: [{ type: "text", text: JSON.stringify(result ?? [], null, 2) }],
					details: { count: result?.length ?? 0 },
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const codeActionsTool: ToolDefinition = {
		name: "vscode_get_code_actions",
		label: "Get Code Actions",
		description:
			"Retrieve quick fixes, refactorings, and other code actions for a source range. Optionally apply one returned action by index.",
		parameters: Type.Object({
			path: Type.String(),
			startLine: Type.Number(),
			startCharacter: Type.Optional(Type.Number()),
			endLine: Type.Optional(Type.Number()),
			endCharacter: Type.Optional(Type.Number()),
			applyIndex: Type.Optional(Type.Integer()),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const uri = WorkspaceContext.toUri(params.path);
				const start = new vscode.Position(
					Math.max(0, params.startLine - 1),
					Math.max(0, (params.startCharacter ?? 1) - 1),
				);
				const end = new vscode.Position(
					Math.max(0, (params.endLine ?? params.startLine) - 1),
					Math.max(0, (params.endCharacter ?? params.startCharacter ?? 1) - 1),
				);
				const result = await vscode.commands.executeCommand<vscode.CodeAction[]>(
					"vscode.executeCodeActionProvider",
					uri,
					new vscode.Range(start, end),
					{ kind: undefined, trigger: 2 },
				);
				const actions = result ?? [];
				if (params.applyIndex !== undefined) {
					const index = Number(params.applyIndex);
					const action = actions[index];
					if (!action) throw new Error(`No code action exists at index ${index}.`);
					if (action.edit) await vscode.workspace.applyEdit(action.edit);
					if (action.command) {
						await vscode.commands.executeCommand(action.command.command, ...(action.command.arguments ?? []));
					}
					return {
						content: [{ type: "text", text: JSON.stringify({ applied: true, title: action.title, index }) }],
						details: {},
					};
				}
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								actions.map((action, index) => ({
									index,
									title: action.title,
									kind: action.kind?.value,
									diagnostics: action.diagnostics?.map((d) => ({
										message: d.message,
										startLine: d.range.start.line + 1,
										endLine: d.range.end.line + 1,
									})),
								})),
								null,
								2,
							),
						},
					],
					details: { count: actions.length },
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const formatDocumentTool: ToolDefinition = {
		name: "vscode_format_document",
		label: "Format Document",
		description: "Run the VS Code document formatting provider for a file and optionally apply the returned edits.",
		parameters: Type.Object({
			path: Type.String(),
			startLine: Type.Optional(Type.Number()),
			endLine: Type.Optional(Type.Number()),
			apply: Type.Optional(Type.Boolean()),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const uri = WorkspaceContext.toUri(params.path);
				const document = await vscode.workspace.openTextDocument(uri);
				let edits: vscode.TextEdit[] | undefined;
				if (params.startLine !== undefined) {
					const start = new vscode.Position(Math.max(0, params.startLine - 1), 0);
					const endLine = Math.min(
						document.lineCount - 1,
						Math.max(params.endLine ?? params.startLine, params.startLine) - 1,
					);
					const end = new vscode.Position(Math.max(0, endLine), document.lineAt(Math.max(0, endLine)).text.length);
					edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
						"vscode.executeFormatRangeProvider",
						uri,
						new vscode.Range(start, end),
					);
				} else {
					edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
						"vscode.executeFormatDocumentProvider",
						uri,
					);
				}
				if (params.apply !== false && edits?.length) {
					const edit = new vscode.WorkspaceEdit();
					for (const item of edits) edit.replace(uri, item.range, item.newText);
					await vscode.workspace.applyEdit(edit);
				}
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								path: vscode.workspace.asRelativePath(uri),
								editCount: edits?.length ?? 0,
								applied: params.apply !== false,
							}),
						},
					],
					details: { editCount: edits?.length ?? 0 },
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const completionTool: ToolDefinition = {
		name: "vscode_get_completions",
		label: "Get Completions",
		description: "Retrieve language-service completion items at a source position.",
		parameters: Type.Object({
			path: Type.String(),
			line: Type.Number(),
			character: Type.Number(),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await vscode.commands.executeCommand<any>(
					"vscode.executeCompletionItemProvider",
					WorkspaceContext.toUri(params.path),
					new vscode.Position(Math.max(0, params.line - 1), Math.max(0, params.character - 1)),
				);
				const items = result?.items ?? result ?? [];
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								(items as any[]).slice(0, 100).map((item: any) => ({
									label: typeof item.label === "string" ? item.label : item.label?.label,
									kind: item.kind,
									detail: item.detail,
									documentation:
										typeof item.documentation === "string" ? item.documentation : item.documentation?.value,
								})),
								null,
								2,
							),
						},
					],
					details: { count: Array.isArray(items) ? items.length : 0 },
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const documentLinksTool: ToolDefinition = {
		name: "vscode_get_document_links",
		label: "Get Document Links",
		description: "Retrieve links discovered by VS Code language providers in a document.",
		parameters: Type.Object({ path: Type.String() }),
		execute: async (_toolCallId, params: any) => {
			try {
				const result = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
					"vscode.executeLinkProvider",
					WorkspaceContext.toUri(params.path),
				);
				return {
					content: [{ type: "text", text: JSON.stringify(result ?? [], null, 2) }],
					details: { count: result?.length ?? 0 },
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const configurationTool: ToolDefinition = {
		name: "vscode_get_configuration",
		label: "Get VS Code Configuration",
		description: "Read a VS Code configuration value from the active workspace.",
		parameters: Type.Object({
			section: Type.String({ description: "Configuration key, such as editor.formatOnSave or typescript.tsdk." }),
			key: Type.Optional(Type.String({ description: "Optional nested configuration key." })),
		}),
		execute: async (_toolCallId, params: any) => {
			try {
				const value = vscode.workspace.getConfiguration(params.section || undefined).get(params.key);
				return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: {} };
			} catch (err: any) {
				return { content: [{ type: "text", text: err?.message || String(err) }], details: {}, isError: true };
			}
		},
	};

	const isFeatureActive = (featureKey: string, defaultValue: boolean): boolean => {
		const npcVal = vscode.workspace.getConfiguration("npc").get<boolean>(`agentFeatures.${featureKey}.enabled`);
		if (typeof npcVal === "boolean") return npcVal;
		const piVal = vscode.workspace.getConfiguration("pi").get<boolean>(`agentFeatures.${featureKey}.enabled`);
		if (typeof piVal === "boolean") return piVal;
		return defaultValue;
	};

	const openResearchEngine = new OpenResearchEngine();
	const openResearchTool: ToolDefinition = {
		name: "vscode_open_research",
		label: "Open Research",
		description:
			"Conduct autonomous research across ArXiv papers, Wikipedia, and open web technical documentation to gather technical background, architecture patterns, and citations.",
		parameters: Type.Object({
			query: Type.String({ description: "Research topic, concept, library, or academic query" }),
			sources: Type.Optional(
				Type.Array(Type.Union([Type.Literal("arxiv"), Type.Literal("wikipedia"), Type.Literal("web")]), {
					description: "Sources to query (default: ['arxiv', 'wikipedia', 'web'])",
				}),
			),
			maxResults: Type.Optional(Type.Number({ description: "Maximum results per source (default: 3)" })),
		}),
		execute: async (_toolCallId, params: any) => {
			if (!isFeatureActive("openResearch", true)) {
				return {
					content: [{ type: "text", text: "Open Research feature is currently disabled in NPC settings (npc.agentFeatures.openResearch.enabled = false). Toggle it in VS Code settings or terminal to enable." }],
					details: { disabled: true },
					isError: true,
				};
			}
			try {
				const result = await openResearchEngine.research(params.query, {
					maxResults: params.maxResults ?? 3,
					sources: params.sources,
				});
				return {
					content: [{ type: "text", text: openResearchEngine.formatMarkdown(result) }],
					details: {
						query: result.query,
						sourceCount: result.sources.length,
					},
				};
			} catch (err: any) {
				return { content: [{ type: "text", text: `Research failed: ${err?.message || String(err)}` }], details: {}, isError: true };
			}
		},
	};

	const proceduralGraph = new ProceduralGraph({
		nodes: [
			{ id: "localize", label: "Localize Defect or Feature", category: "reasoning" },
			{ id: "research", label: "Research Specifications & APIs", category: "tool" },
			{ id: "ast_impact", label: "Analyze AST Blast Radius", category: "tool" },
			{ id: "test_qualification", label: "Qualify Reproduction Tests", category: "status" },
			{ id: "patch", label: "Apply Code Modifications", category: "tool" },
			{ id: "verify", label: "Execute Verification Suite", category: "tool" },
			{ id: "commit", label: "Commit Verified Solution", category: "status" },
		],
		edges: [
			{
				source: "start",
				relation: "leads_to",
				target: "localize",
				attributes: { guidance: "Locate target source files, definitions, and failing traces first." },
			},
			{
				source: "localize",
				relation: "leads_to",
				target: "ast_impact",
				attributes: { guidance: "Assess caller blast radius and dependencies before making edits." },
			},
			{
				source: "localize",
				relation: "leads_to",
				target: "research",
				attributes: {
					condition: "when requirements or APIs are unfamiliar",
					guidance: "Perform open research to collect primary specs and citations.",
				},
			},
			{
				source: "ast_impact",
				relation: "leads_to",
				target: "test_qualification",
				attributes: { guidance: "Write reproduction tests verifying base failure before writing code fixes." },
			},
			{
				source: "test_qualification",
				relation: "leads_to",
				target: "patch",
				attributes: { guidance: "Apply minimal, focused code edits to satisfy the reproduction test." },
			},
			{
				source: "patch",
				relation: "requires",
				target: "verify",
				attributes: { guidance: "Run diagnostics, linters, and unit tests immediately following edits." },
			},
			{
				source: "verify",
				relation: "fallback",
				target: "patch",
				attributes: {
					condition: "tests or linter fail",
					guidance: "Inspect compiler output and refine patch without touching qualified test targets.",
				},
			},
			{
				source: "verify",
				relation: "leads_to",
				target: "commit",
				attributes: {
					condition: "all checks pass",
					guidance: "Stage only changed files and record a concise semantic commit.",
				},
			},
		],
	});

	const proceduralGuidanceTool: ToolDefinition = {
		name: "vscode_procedural_guidance",
		label: "Procedural Graph Guidance",
		description:
			"Obtain step-level situational guidance, recommended next procedures, and pitfall warnings based on the procedural execution graph.",
		parameters: Type.Object({
			recentSteps: Type.Array(Type.String(), {
				description: "List of recently executed step names or tool calls (e.g., ['localize', 'patch'])",
			}),
			maxHops: Type.Optional(Type.Number({ description: "Maximum forward hops in the graph (default: 2)" })),
		}),
		execute: async (_toolCallId, params: any) => {
			if (!isFeatureActive("proceduralGuidance", true)) {
				return {
					content: [{ type: "text", text: "Procedural Guidance feature is currently disabled in NPC settings (npc.agentFeatures.proceduralGuidance.enabled = false). Toggle it in VS Code settings or terminal to enable." }],
					details: { disabled: true },
					isError: true,
				};
			}
			try {
				const guidance = proceduralGraph.generateSituationalGuidance(params.recentSteps, params.maxHops ?? 2);
				return {
					content: [{ type: "text", text: guidance.formattedPromptContext }],
					details: {
						activeNodeId: guidance.activeNodeId,
						recommendedCount: guidance.recommendedNextProcedures.length,
						pitfallsCount: guidance.pitfallsToAvoid.length,
					},
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Procedural guidance failed: ${err?.message || String(err)}` }],
					details: {},
					isError: true,
				};
			}
		},
	};

	const astGraph = new ContinuousAstDependencyGraph();
	const astImpactTool: ToolDefinition = {
		name: "vscode_ast_impact_radius",
		label: "Analyze AST Impact Radius",
		description:
			"Analyze the caller blast radius, direct callers, and transitive dependencies of a file or symbol using AST graph traversal.",
		parameters: Type.Object({
			filePath: Type.String({ description: "Relative or absolute path to the target source file" }),
			symbolName: Type.Optional(Type.String({ description: "Optional symbol name (function, class, interface) to isolate" })),
		}),
		execute: async (_toolCallId, params: any) => {
			if (!isFeatureActive("astImpact", true)) {
				return {
					content: [{ type: "text", text: "AST Impact Radius feature is currently disabled in NPC settings (npc.agentFeatures.astImpact.enabled = false). Toggle it in VS Code settings or terminal to enable." }],
					details: { disabled: true },
					isError: true,
				};
			}
			try {
				const resolved = WorkspaceContext.resolvePath(params.filePath);
				if (existsSync(resolved)) {
					const content = readFileSync(resolved, "utf-8");
					astGraph.indexFile(params.filePath, content);
				}
				const result = astGraph.getImpactRadius(params.filePath, params.symbolName);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					details: {
						targetFile: result.targetFile,
						blastRadiusScore: result.blastRadiusScore,
						affectedFilesCount: result.affectedFiles.length,
					},
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `AST impact analysis failed: ${err?.message || String(err)}` }],
					details: {},
					isError: true,
				};
			}
		},
	};

	const actionFusionTool: ToolDefinition = {
		name: "vscode_action_fusion",
		label: "Action Fusion Execution",
		description:
			"Execute a fused follow-up verification command immediately after a mutation without requiring an extra LLM turn.",
		parameters: Type.Object({
			command: Type.String({ description: "Shell command to execute for verification (e.g., 'npm test', 'tsc --noEmit')" }),
			cwd: Type.Optional(Type.String({ description: "Optional working directory (defaults to workspace root)" })),
		}),
		execute: async (_toolCallId, params: any) => {
			if (!isFeatureActive("actionFusion", true)) {
				return {
					content: [{ type: "text", text: "Action Fusion feature is currently disabled in NPC settings (npc.agentFeatures.actionFusion.enabled = false). Toggle it in VS Code settings or terminal to enable." }],
					details: { disabled: true },
					isError: true,
				};
			}
			try {
				const root = params.cwd ? WorkspaceContext.resolvePath(params.cwd) : (WorkspaceContext.getRuntimeRoot() || process.cwd());
				const result = await executeFusedCommand(root, params.command);
				return {
					content: [{ type: "text", text: result.summary || result.output }],
					details: {
						command: result.command,
						exitCode: result.exitCode,
						executed: result.executed,
					},
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Action fusion execution failed: ${err?.message || String(err)}` }],
					details: {},
					isError: true,
				};
			}
		},
	};

	const execCriticTool: ToolDefinition = {
		name: "vscode_execcritic_qualify",
		label: "ExecCritic Test Qualification",
		description:
			"Qualify a candidate reproduction test using fail-closed base execution. The test must fail against the unfixed base code to confirm it reproduces the issue, producing a frozen test manifest.",
		parameters: Type.Object({
			testPaths: Type.Array(Type.String(), { description: "Array of test file paths reproducing the defect" }),
			testCommand: Type.String({ description: "Shell command to run the reproduction test (e.g. 'npm test -- test/bug.test.ts')" }),
		}),
		execute: async (_toolCallId, params: any) => {
			if (!isFeatureActive("execCritic", true)) {
				return {
					content: [{ type: "text", text: "ExecCritic test qualification feature is currently disabled in NPC settings (npc.agentFeatures.execCritic.enabled = false). Toggle it in VS Code settings or terminal to enable." }],
					details: { disabled: true },
					isError: true,
				};
			}
			try {
				const repoPath = WorkspaceContext.getRuntimeRoot() || process.cwd();
				const scaffold = new ExecCriticScaffold({ repoPath });
				const result = await scaffold.qualifyReproductionTest(params.testPaths, params.testCommand);
				return {
					content: [{ type: "text", text: result.reason + (result.manifest ? `\nManifest ID: ${result.manifest.id} (base exit code: ${result.manifest.baseExitCode})` : "") }],
					details: {
						qualified: result.qualified,
						manifestId: result.manifest?.id,
						baseExitCode: result.manifest?.baseExitCode,
					},
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `ExecCritic qualification failed: ${err?.message || String(err)}` }],
					details: {},
					isError: true,
				};
			}
		},
	};

	const airgapGuard = new AirgapGuard(false);
	const airgapTool: ToolDefinition = {
		name: "vscode_airgap_guard",
		label: "Airgap Egress Guard",
		description:
			"Inspect, configure, or audit outbound network egress permissions to enforce zero-trust flight mode or verify allowed network destinations.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("check_url"), Type.Literal("status"), Type.Literal("set_enabled")], {
				description: "Action to perform: 'check_url' to test destination, 'status' to view flight mode, 'set_enabled' to toggle",
			}),
			url: Type.Optional(Type.String({ description: "URL to evaluate when action is 'check_url'" })),
			enabled: Type.Optional(Type.Boolean({ description: "Boolean value when action is 'set_enabled'" })),
		}),
		execute: async (_toolCallId, params: any) => {
			if (params.action !== "status" && !isFeatureActive("airgap", false)) {
				return {
					content: [{ type: "text", text: "Airgap Egress Guard feature is currently disabled in NPC settings (npc.agentFeatures.airgap.enabled = false). Toggle it in VS Code settings or terminal to enable." }],
					details: { disabled: true },
					isError: true,
				};
			}
			try {
				if (params.action === "set_enabled" && typeof params.enabled === "boolean") {
					airgapGuard.setAirgapEnabled(params.enabled);
					return {
						content: [{ type: "text", text: `Airgap mode set to: ${params.enabled}` }],
						details: { enabled: params.enabled },
					};
				}
				if (params.action === "check_url" && params.url) {
					const evalResult = airgapGuard.evaluateUrl(params.url);
					return {
						content: [{ type: "text", text: JSON.stringify(evalResult, null, 2) }],
						details: { allowed: evalResult.allowed, target: evalResult.target },
					};
				}
				return {
					content: [{ type: "text", text: `Airgap mode is currently: ${airgapGuard.isAirgapEnabled() ? "ENABLED (Zero Egress)" : "DISABLED (Open Network)"}` }],
					details: { enabled: airgapGuard.isAirgapEnabled() },
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Airgap evaluation failed: ${err?.message || String(err)}` }],
					details: {},
					isError: true,
				};
			}
		},
	};

	const prAutopilot = new PrAutoPilot();
	const prAutopilotTool: ToolDefinition = {
		name: "vscode_pr_autopilot",
		label: "PR Autopilot Generator",
		description:
			"Generate a maintainer-ready GitHub pull request markdown document with test receipts, executive summary, modified files, and rollback instructions.",
		parameters: Type.Object({
			title: Type.String({ description: "Pull request title" }),
			summary: Type.String({ description: "Concise summary of rationale and changes" }),
			branchName: Type.String({ description: "Source branch name" }),
			targetBranch: Type.Optional(Type.String({ description: "Target branch name (default: 'main')" })),
			modifiedFiles: Type.Array(Type.String(), { description: "List of modified file paths" }),
			testReceipts: Type.Optional(
				Type.Array(
					Type.Object({
						command: Type.String(),
						exitCode: Type.Number(),
						durationMs: Type.Number(),
						passedCount: Type.Number(),
						failedCount: Type.Number(),
					}),
					{ description: "Formal execution receipts from verification suites" },
				),
			),
			rollbackInstructions: Type.Optional(Type.String({ description: "Rollback and backout instructions" })),
		}),
		execute: async (_toolCallId, params: any) => {
			if (!isFeatureActive("prAutopilot", true)) {
				return {
					content: [{ type: "text", text: "PR Autopilot feature is currently disabled in NPC settings (npc.agentFeatures.prAutopilot.enabled = false). Toggle it in VS Code settings or terminal to enable." }],
					details: { disabled: true },
					isError: true,
				};
			}
			try {
				const md = prAutopilot.renderPullRequestMarkdown({
					title: params.title,
					summary: params.summary,
					branchName: params.branchName,
					targetBranch: params.targetBranch || "main",
					modifiedFiles: params.modifiedFiles,
					testReceipts: params.testReceipts || [],
					rollbackInstructions: params.rollbackInstructions,
				});
				return {
					content: [{ type: "text", text: md }],
					details: { title: params.title, filesCount: params.modifiedFiles.length },
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `PR Autopilot failed: ${err?.message || String(err)}` }],
					details: {},
					isError: true,
				};
			}
		},
	};

	const evidenceReducer = new EvidencePreservingReducer(1024);
	const reduceOutputTool: ToolDefinition = {
		name: "vscode_reduce_output",
		label: "Evidence Preserving Reducer",
		description:
			"Compress large terminal or test outputs into deterministic failure receipts and summaries to prevent context window dilution.",
		parameters: Type.Object({
			command: Type.String({ description: "Command that generated the output (e.g. 'npm test')" }),
			output: Type.String({ description: "Raw terminal output to compress" }),
			exitCode: Type.Optional(Type.Number({ description: "Exit code of the process" })),
		}),
		execute: async (_toolCallId, params: any) => {
			if (!isFeatureActive("reduceOutput", true)) {
				return {
					content: [{ type: "text", text: "Evidence Reducer feature is currently disabled in NPC settings (npc.agentFeatures.reduceOutput.enabled = false). Toggle it in VS Code settings or terminal to enable." }],
					details: { disabled: true },
					isError: true,
				};
			}
			try {
				const res = evidenceReducer.reduceOutput(params.command, params.output, params.exitCode);
				return {
					content: [{ type: "text", text: res.text }],
					details: { reduced: res.reduced, receipt: res.receipt },
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Output reduction failed: ${err?.message || String(err)}` }],
					details: {},
					isError: true,
				};
			}
		},
	};

	return [
		openResearchTool,
		proceduralGuidanceTool,
		astImpactTool,
		actionFusionTool,
		execCriticTool,
		airgapTool,
		prAutopilotTool,
		reduceOutputTool,
		workspaceFoldersTool,
		openEditorsTool,
		selectionTool,
		listDirectoryTool,
		writeFileTool,
		createFileTool,
		deleteFileTool,
		renameFileTool,
		documentSymbolsTool,
		workspaceSymbolsTool,
		signatureHelpTool,
		typeDefinitionTool,
		implementationsTool,
		declarationTool,
		codeActionsTool,
		formatDocumentTool,
		completionTool,
		documentLinksTool,
		configurationTool,
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
		listLanguageModelTools,
		invokeLanguageModelTool,
	];
}
