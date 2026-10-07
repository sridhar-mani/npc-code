import type { ToolDefinition } from "@earendil-works/pi-core";
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
				content: [{ type: "text", text: `Dispatched command to Pi Terminal: ${params.command}` }],
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
			"List Language Model Tools currently exposed by the VS Code host. This lets Pi discover current extension-contributed agent tools without hardcoding a static tool inventory.",
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

	return [
		workspaceFoldersTool,
		openEditorsTool,
		selectionTool,
		listDirectoryTool,
		writeFileTool,
		createFileTool,
		deleteFileTool,
		renameFileTool,
		documentSymbolsTool,
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
