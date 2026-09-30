import * as vscode from 'vscode';
import { ModelManager, type ModelEntry } from '../runtime/modelManager';
import { PiSettings } from '../config/settings';
import { getSharedAgentBackend, setActiveModelId } from '../backend-bridge';
import { createVsCodeTools } from '../tools/vscode-tools';
import type { ChatMessage } from './types';
import { collectOllamaText, collectByomText } from './chatStream';
import { getWebviewHtml } from './webviewHtml';

export type { ChatMessage } from './types';

export class PiSidebarViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'pi-assistant-sidebar';

	private readonly _extensionUri: vscode.Uri;
	private readonly _modelManager: ModelManager;
	private _view?: vscode.WebviewView;
	private _abortController?: AbortController;
	private _currentSessionId?: string;

	constructor(extensionUri: vscode.Uri, modelManager: ModelManager) {
		this._extensionUri = extensionUri;
		this._modelManager = modelManager;
		this._modelManager.onDidChangeModels(() => {
			this.postModelUpdate();
		});
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		const codiconUri = webviewView.webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, 'assets', 'codicons', 'codicon.css')
		);

		webviewView.webview.html = getWebviewHtml(codiconUri, webviewView.webview.cspSource);
		this.postModelUpdate();

		webviewView.webview.onDidReceiveMessage(async (message: Record<string, unknown>) => {
			const command = String(message.command || '');
			switch (command) {
				case 'ready':
					this.postModelUpdate();
					break;
				case 'sendMessage':
					await this.handleUserMessage(
						String(message.text || ''),
						(message.history as ChatMessage[]) || []
					);
					break;
				case 'compact':
					await this.handleCompaction((message.history as ChatMessage[]) || []);
					break;
				case 'stopGeneration':
					this.stopGeneration();
					break;
				case 'selectModel':
					await this._modelManager.promptSelectModel();
					break;
				case 'switchModel':
					if (typeof message.modelId === 'string') {
						await PiSettings.setActiveModel(message.modelId);
						await setActiveModelId(message.modelId);
						if (this._currentSessionId) {
							try {
								const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
								const backend = await getSharedAgentBackend(cwd);
								const runtime = await backend.getModelRuntime();
								const models = runtime.getModels();
								const targetModel = models.find(
									m =>
										m.id === message.modelId ||
										m.name === message.modelId ||
										`${m.provider}/${m.id}` === message.modelId ||
										m.provider === `custom-${message.modelId}`
								);
								if (targetModel) {
									await backend.setModel(this._currentSessionId, targetModel);
								}
							} catch {}
						}
						this.postModelUpdate();
					}
					break;
				case 'addModel':
					await this._modelManager.promptAddModel();
					break;
				case 'syncOllama':
					await this._modelManager.syncOllama(true);
					break;
				case 'openTerminal':
					vscode.commands.executeCommand('pi.openTerminalAgent');
					break;
				case 'openSettings':
					vscode.commands.executeCommand('workbench.action.openSettings', '@ext:zenteiq.ziq-vscode-ui');
					break;
				case 'attachContextPicker':
					await this.handleAttachContextPicker();
					break;
				case 'getEditorContext':
					this.handleGetEditorContext();
					break;
				case 'runInTerminal':
					if (typeof message.code === 'string') {
						let term = vscode.window.terminals.find(t => t.name === 'Ziq Terminal');
						if (!term) {
							term = vscode.window.createTerminal('Ziq Terminal');
						}
						term.show();
						term.sendText(message.code);
					}
					break;
				case 'insertCode': {
					const editor = vscode.window.activeTextEditor;
					if (editor && typeof message.code === 'string') {
						await editor.edit(editBuilder => {
							editBuilder.insert(editor.selection.active, message.code as string);
						});
					} else {
						vscode.window.showWarningMessage('No active editor open to insert code.');
					}
					break;
				}
				case 'copyCode':
					if (typeof message.code === 'string') {
						await vscode.env.clipboard.writeText(message.code);
						vscode.window.showInformationMessage('Code copied to clipboard.');
					}
					break;
			}
		});
	}

	public refresh(): void {
		this.postModelUpdate();
	}

	private postModelUpdate(): void {
		if (!this._view) return;
		const activeModel = this._modelManager.getActiveModel();
		const models = this._modelManager.getAllModels();
		const isOnline = this._modelManager.isOllamaOnline;

		this._view.webview.postMessage({
			type: 'updateModels',
			activeModelId: activeModel ? activeModel.id : '',
			activeModelName: activeModel ? activeModel.name : 'Select a Model',
			models,
			isOllamaOnline: isOnline,
		});
	}

	private stopGeneration(): void {
		if (this._currentSessionId) {
			void getSharedAgentBackend().then(b => b.abort(this._currentSessionId!)).catch(() => {});
		}
		if (this._abortController) {
			this._abortController.abort();
			this._abortController = undefined;
		}
		if (this._view) {
			this._view.webview.postMessage({ type: 'generationStopped' });
		}
	}

	private async handleUserMessage(prompt: string, history: ChatMessage[]): Promise<void> {
		if (!this._view) return;

		const activeModel = this._modelManager.getActiveModel();
		if (!activeModel) {
			this._view.webview.postMessage({
				type: 'error',
				message: 'No model selected. Please select a model in the dropdown above.',
			});
			return;
		}

		this._abortController = new AbortController();
		const signal = this._abortController.signal;

		this._view.webview.postMessage({
			type: 'streamStart',
			modelName: activeModel.name,
		});

		try {
			const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			const backend = await getSharedAgentBackend(cwd);

			const runtime = await backend.getModelRuntime();
			const models = runtime.getModels();
			const targetModel = models.find(
				m =>
					m.id === activeModel.id ||
					m.name === activeModel.name ||
					`${m.provider}/${m.id}` === activeModel.id ||
					m.provider === `custom-${activeModel.id}`
			);

			if (!targetModel) {
				throw new Error(
					`Selected model "${activeModel.id}" is not registered in the Pi runtime. ` +
					"Refresh model configuration or restart the Ziq backend.",
				);
			}

			if (!this._currentSessionId) {
				const created = await backend.createSession({
					cwd,
					model: targetModel,
					customTools: createVsCodeTools(),
					enableAttributionHeaders: true,
				});
				this._currentSessionId = created.session.sessionId;
			} else if (targetModel) {
				await backend.setModel(this._currentSessionId, targetModel);
			}

			const unsubscribe = backend.subscribe(this._currentSessionId, (event: any) => {
				if (signal.aborted) return;
				if (event.type === 'message_update') {
					const ame = event.assistantMessageEvent;
					const delta =
						ame && (ame.type === 'text_delta' || ame.type === 'thinking_delta')
							? ame.delta
							: typeof event.delta === 'string'
								? event.delta
								: '';
					if (typeof delta === 'string' && delta.length > 0) {
						this._view?.webview.postMessage({ type: 'streamDelta', text: delta });
					}
				} else if (event.type === 'tool_execution_start') {
					const toolName = event.toolName || 'tool';
					this._view?.webview.postMessage({ type: 'streamDelta', text: `\n\n*Running ${toolName}...*\n\n` });
				} else if (event.type === 'tool_execution_end') {
					const toolName = event.toolName || 'tool';
					this._view?.webview.postMessage({ type: 'streamDelta', text: `\n*Completed ${toolName}*\n\n` });
				} else if (event.type === 'compaction_start') {
					this._view?.webview.postMessage({ type: 'compactionStart' });
				} else if (event.type === 'compaction_end') {
					this._view?.webview.postMessage({ type: 'compactionDone', summary: 'Context compacted.', savedCount: history.length });
				}
			});

			try {
				await backend.prompt(this._currentSessionId, prompt);
			} finally {
				unsubscribe();
			}
			this._view.webview.postMessage({ type: 'streamEnd' });
		} catch (err: unknown) {
			if (signal.aborted) {
				this._view.webview.postMessage({ type: 'streamEnd' });
			} else {
				const msg = err instanceof Error ? err.message : String(err);
				this._view.webview.postMessage({
					type: 'error',
					message: msg,
				});
			}
		} finally {
			this._abortController = undefined;
		}
	}

	private async handleCompaction(history: ChatMessage[]): Promise<void> {
		if (!this._view || history.length === 0) return;

		const activeModel = this._modelManager.getActiveModel();
		if (!activeModel) {
			vscode.window.showWarningMessage('Please select an active model to run compaction.');
			return;
		}

		this._view.webview.postMessage({ type: 'compactionStart' });

		const prompt = `Please provide a concise, high-density summary of the following prior conversation so it can serve as a compact context memory block for the assistant:\n\n` +
			history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

		try {
			let summary = '';
			const signal = new AbortController().signal;

			if (activeModel.provider === 'ollama') {
				summary = await collectOllamaText(PiSettings.ollamaUrl, activeModel.id, prompt, signal);
			} else {
				const customCfg = PiSettings.customModels.find(m => m.id === activeModel.id);
				summary = await collectByomText(activeModel, customCfg?.apiKey, prompt, signal);
			}

			this._view.webview.postMessage({
				type: 'compactionDone',
				summary: summary.trim() || 'Conversation compacted.',
				savedCount: history.length,
			});

			vscode.window.showInformationMessage(`Ziq: Compacted ${history.length} conversation turns into context memory.`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			this._view.webview.postMessage({
				type: 'error',
				message: `Compaction failed: ${msg}`,
			});
		}
	}

	private handleGetEditorContext(): void {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const doc = editor.document;
			const sel = editor.selection;
			const selectedText = !sel.isEmpty ? doc.getText(sel) : '';
			const relPath = vscode.workspace.asRelativePath(doc.uri);
			this._view?.webview.postMessage({
				type: 'addContextItem',
				item: {
					id: 'active-' + Date.now(),
					name: relPath + (!sel.isEmpty ? ` (${sel.start.line + 1}-${sel.end.line + 1})` : ''),
					path: relPath,
					content: selectedText || doc.getText(),
					icon: 'codicon-file-code',
					type: 'file',
				},
			});
		} else {
			vscode.window.showInformationMessage('No active editor file detected.');
		}
	}

	private async handleAttachContextPicker(): Promise<void> {
		interface ContextOption extends vscode.QuickPickItem {
			action: string;
		}

		const activeEditor = vscode.window.activeTextEditor;
		const activeDocName = activeEditor ? vscode.workspace.asRelativePath(activeEditor.document.uri) : undefined;
		const hasSelection = activeEditor && !activeEditor.selection.isEmpty;

		const options: ContextOption[] = [
			{
				label: '$(file-code) Active Editor File',
				description: activeDocName || 'No open file',
				detail: hasSelection ? 'Attach selected code lines' : 'Attach complete file content',
				action: 'activeEditor',
			},
			{
				label: '$(search) Choose Workspace File...',
				description: 'Search & attach any file across workspace',
				detail: 'Quickly find and attach files by filename',
				action: 'workspaceFile',
			},
			{
				label: '$(warning) Diagnostics & Problems',
				description: 'Active compiler / linter issues',
				detail: 'Attach active errors and warnings to prompt fixes',
				action: 'diagnostics',
			},
			{
				label: '$(folder-opened) Browse File from Disk...',
				description: 'Open file system picker',
				detail: 'Attach arbitrary file from your machine',
				action: 'browseFile',
			},
		];

		const chosen = await vscode.window.showQuickPick(options, {
			placeHolder: 'Select context to attach to conversation',
			ignoreFocusOut: true,
		});
		if (!chosen) return;

		if (chosen.action === 'activeEditor') {
			this.handleGetEditorContext();
		} else if (chosen.action === 'workspaceFile') {
			const uris = await vscode.workspace.findFiles('**/*', '**/node_modules/**,**/.git/**,**/dist/**,**/build/**', 60);
			const fileItems = uris.map(u => ({
				label: vscode.workspace.asRelativePath(u),
				uri: u,
			}));
			const pickedFile = await vscode.window.showQuickPick(fileItems, {
				placeHolder: 'Type to filter workspace files...',
				ignoreFocusOut: true,
			});
			if (pickedFile) {
				try {
					const bytes = await vscode.workspace.fs.readFile(pickedFile.uri);
					const content = Buffer.from(bytes).toString('utf8');
					this._view?.webview.postMessage({
						type: 'addContextItem',
						item: {
							id: 'ws-' + Date.now(),
							name: pickedFile.label,
							path: pickedFile.label,
							content,
							icon: 'codicon-file',
							type: 'file',
						},
					});
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : String(e);
					vscode.window.showErrorMessage(`Failed to read file: ${msg}`);
				}
			}
		} else if (chosen.action === 'diagnostics') {
			const allDiags = vscode.languages.getDiagnostics();
			const lines: string[] = [];
			for (const [uri, diags] of allDiags) {
				if (diags.length > 0) {
					const rel = vscode.workspace.asRelativePath(uri);
					for (const d of diags) {
						const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'Error' : 'Warning';
						lines.push(`[${sev}] ${rel}:${d.range.start.line + 1}:${d.range.start.character + 1} - ${d.message}`);
					}
				}
			}
			if (lines.length > 0) {
				this._view?.webview.postMessage({
					type: 'addContextItem',
					item: {
						id: 'diag-' + Date.now(),
						name: `Problems (${lines.length})`,
						path: 'diagnostics',
						content: lines.slice(0, 30).join('\n'),
						icon: 'codicon-warning',
						type: 'problems',
					},
				});
			} else {
				vscode.window.showInformationMessage('No active problems or errors found in workspace.');
			}
		} else if (chosen.action === 'browseFile') {
			const picked = await vscode.window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
			});
			if (picked && picked[0]) {
				try {
					const bytes = await vscode.workspace.fs.readFile(picked[0]);
					const content = Buffer.from(bytes).toString('utf8');
					const rel = vscode.workspace.asRelativePath(picked[0]);
					this._view?.webview.postMessage({
						type: 'addContextItem',
						item: {
							id: 'browse-' + Date.now(),
							name: rel,
							path: rel,
							content,
							icon: 'codicon-file',
							type: 'file',
						},
					});
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : String(e);
					vscode.window.showErrorMessage(`Failed to read file: ${msg}`);
				}
			}
		}
	}
}
