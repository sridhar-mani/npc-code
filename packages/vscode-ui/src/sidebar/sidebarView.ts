import * as vscode from 'vscode';
import { ModelManager } from '../runtime/modelManager';
import { PiSettings } from '../config/settings';
import {
	getSharedAgentBackend,
	logPi,
	createSidebarSessionManager,
	saveSidebarSessionFile,
	clearSidebarSessionFile,
	getSidebarSessionFile,
} from '../backend-bridge';
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
	private _streamSequence = 0;
	private _activeStreamId?: string;

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
				case 'clearSession':
					await this.clearSession();
					break;
				case 'streamDebug':
					logPi(
						`Webview streamDebug phase=${String(message.phase || 'unknown')} streamId=${String(message.streamId || 'none')} chars=${Number(message.chars || 0)} domChars=${Number(message.domChars || 0)} preview=${typeof message.preview === 'string' ? JSON.stringify(message.preview.slice(0, 120)) : '""'}`,
					);
					break;
				case 'selectModel':
					await this._modelManager.promptSelectModel();
					break;
				case 'switchModel':
					if (typeof message.modelId === 'string') {
						await this.switchModel(message.modelId);
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

	private async switchModel(modelId: string): Promise<void> {
		await PiSettings.setActiveModel(modelId);
		this.postModelUpdate();
		if (!this._currentSessionId) return;

		try {
			this.stopGeneration();
			const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			const backend = await getSharedAgentBackend(cwd);
			const runtime = await backend.getModelRuntime();
			const model = runtime.getModels().find(
				m => m.id === modelId || `${m.provider}/${m.id}` === modelId,
			);
			if (!model) throw new Error(`Model "${modelId}" is not registered in the Pi runtime.`);
			await backend.setModel(this._currentSessionId, model);
			logPi(`Applied model switch to existing Pi session session=${this._currentSessionId} model=${model.provider}/${model.id}`);
		} catch (error) {
			logPi(`Model switch failed: ${error instanceof Error ? error.message : String(error)}`);
			this._view?.webview.postMessage({
				type: 'error',
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private async clearSession(): Promise<void> {
		const sessionId = this._currentSessionId;
		this._currentSessionId = undefined;
		this._activeStreamId = undefined;
		if (sessionId) {
			try {
				const backend = await getSharedAgentBackend();
				await backend.destroySession(sessionId);
			} catch (error) {
				logPi(`Failed to destroy sidebar session=${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		await clearSidebarSessionFile();
		logPi("Sidebar session cleared; next message will create a new persisted session");
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
			this._view.webview.postMessage({ type: 'generationStopped', streamId: this._activeStreamId });
			this._activeStreamId = undefined;
		}
	}

	private async handleUserMessage(prompt: string, history: ChatMessage[]): Promise<void> {
		if (!this._view) return;

		const activeModel = this._modelManager.getActiveModel();
		logPi(`Sidebar user message received promptLength=${prompt.length} historyTurns=${history.length} activeModel=${activeModel?.id || "none"} promptPreview=${JSON.stringify(prompt.slice(0, 120))}`);
		if (!activeModel) {
			this._view.webview.postMessage({
				type: 'error',
				message: 'No model selected. Please select a model in the dropdown above.',
			});
			return;
		}

		if (this._abortController) {
			logPi('Sidebar ignored send while another Pi generation is still active');
			return;
		}

		this._abortController = new AbortController();
		const signal = this._abortController.signal;
		const streamId = String(++this._streamSequence);
		this._activeStreamId = streamId;
		logPi(`Sidebar stream started streamId=${streamId}`);

		this._view.webview.postMessage({
			type: 'streamStart',
			streamId,
			modelName: activeModel.name,
		});

		try {
			const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			const backend = await getSharedAgentBackend(cwd);
			logPi(`Sidebar obtained shared Pi backend session=${this._currentSessionId || "new"}`);

			if (!this._currentSessionId) {
				const runtime = await backend.getModelRuntime();
				const models = runtime.getModels();
				logPi(`Sidebar runtime models=${models.map((m) => `${m.provider}/${m.id}`).join(", ") || "none"}`);
				const targetModel = models.find(
					m => m.id === activeModel.id || m.name === activeModel.name || `${m.provider}/${m.id}` === activeModel.id
				);

				if (!targetModel) {
					throw new Error(
						`Selected model "${activeModel.id}" is not registered in the Pi runtime. ` +
						"Refresh model configuration or restart the Ziq backend.",
					);
				}

				const persistedSessionFile = getSidebarSessionFile();
				const sessionCwd = cwd ?? process.cwd();
				const sessionManager = createSidebarSessionManager(sessionCwd);
				const resumingPersistedSession = Boolean(persistedSessionFile && sessionManager.buildSessionContext().messages.length > 0);
				logPi(`Creating Pi session resuming=${resumingPersistedSession} model=${targetModel.provider}/${targetModel.id} reasoning=${Boolean((targetModel as any).reasoning)}`);
				const created = await backend.createSession({
					cwd,
					sessionManager,
					model: resumingPersistedSession ? undefined : targetModel,
					customTools: createVsCodeTools(),
					enableAttributionHeaders: true,
				});
				this._currentSessionId = created.session.sessionId;
				if (created.session.sessionFile) {
					await saveSidebarSessionFile(created.session.sessionFile);
				}
				logPi(`Sidebar Pi session created session=${this._currentSessionId} resumed=${resumingPersistedSession} file=${created.session.sessionFile ?? "none"}`);
				if (resumingPersistedSession) {
					this.restoreSessionHistory(created.session.messages);
				}
			}

			logPi(`Sidebar subscribing to Pi session events session=${this._currentSessionId} streamId=${streamId}`);
			let thinkingDeltaCount = 0;
			let textDeltaCount = 0;
			let currentAssistantThinkingLength = 0;
			let currentAssistantTextLength = 0;
			let currentAssistantThinkingPreview = '';
			let currentAssistantTextPreview = '';
			const unsubscribe = backend.subscribe(this._currentSessionId, (event: {
				type?: string;
				assistantMessageEvent?: {
					type?: string;
					delta?: string;
					content?: string;
				};
				toolName?: string;
			}) => {
				if (signal.aborted) return;
				if (event.type === 'message_update') {
					const assistantMessageEvent = event.assistantMessageEvent;
					if (!assistantMessageEvent) return;
					if (assistantMessageEvent.type === 'thinking_start' || assistantMessageEvent.type === 'thinking_end') {
						logPi(`Sidebar Pi assistant event=${assistantMessageEvent.type} session=${this._currentSessionId} streamId=${streamId}`);
					}
					switch (assistantMessageEvent.type) {
						case 'thinking_start':
							this._view?.webview.postMessage({ type: 'streamThinkingStart', streamId });
							break;
						case 'thinking_delta':
							if (typeof assistantMessageEvent.delta === 'string' && assistantMessageEvent.delta.length > 0) {
								thinkingDeltaCount++;
								currentAssistantThinkingLength += assistantMessageEvent.delta.length;
								if (currentAssistantThinkingPreview.length < 200) currentAssistantThinkingPreview += assistantMessageEvent.delta;
								if (thinkingDeltaCount === 1 || thinkingDeltaCount % 25 === 0) {
									logPi(`Sidebar Pi thinking_delta streamId=${streamId} count=${thinkingDeltaCount} chars=${assistantMessageEvent.delta.length}`);
								}
								this._view?.webview.postMessage({
									type: 'streamThinkingDelta',
									streamId,
									text: assistantMessageEvent.delta,
								});
							}
							break;
						case 'thinking_end':
							this._view?.webview.postMessage({
								type: 'streamThinkingEnd',
								streamId,
								text: assistantMessageEvent.content || '',
							});
							break;
						case 'text_delta':
							if (typeof assistantMessageEvent.delta === 'string' && assistantMessageEvent.delta.length > 0) {
								textDeltaCount++;
								currentAssistantTextLength += assistantMessageEvent.delta.length;
								if (currentAssistantTextPreview.length < 200) currentAssistantTextPreview += assistantMessageEvent.delta;
								if (textDeltaCount === 1 || textDeltaCount % 25 === 0) {
									logPi(`Sidebar Pi text_delta streamId=${streamId} count=${textDeltaCount} chars=${assistantMessageEvent.delta.length}`);
								}
								this._view?.webview.postMessage({
									type: 'streamDelta',
									streamId,
									text: assistantMessageEvent.delta,
								});
							}
							break;
					}
				} else if (event.type === 'tool_execution_start') {
					const toolName = event.toolName || 'tool';
					this._view?.webview.postMessage({ type: 'streamDelta', streamId, text: `\n\n*Running ${toolName}...*\n\n` });
				} else if (event.type === 'tool_execution_end') {
					const toolName = event.toolName || 'tool';
					this._view?.webview.postMessage({ type: 'streamDelta', streamId, text: `\n*Completed ${toolName}*\n\n` });
				} else if (event.type === 'compaction_start') {
					this._view?.webview.postMessage({ type: 'compactionStart', streamId });
				} else if (event.type === 'compaction_end') {
					this._view?.webview.postMessage({ type: 'compactionDone', streamId, summary: 'Context compacted.', savedCount: history.length });
				}
			});

			try {
				logPi(`Sidebar Pi prompt start session=${this._currentSessionId}`);
				await backend.prompt(this._currentSessionId, prompt);
				logPi(`Sidebar Pi prompt completed session=${this._currentSessionId}`);
				logPi(`Sidebar final stream state streamId=${streamId} thinkingChars=${currentAssistantThinkingLength} textChars=${currentAssistantTextLength} thinkingPreview=${JSON.stringify(currentAssistantThinkingPreview.slice(0, 200))} textPreview=${JSON.stringify(currentAssistantTextPreview.slice(0, 200))}`);
			} finally {
				unsubscribe();
			}
			this._view.webview.postMessage({
				type: 'streamEnd',
				streamId,
				thinkingDeltaCount,
				textDeltaCount,
			});
			this._activeStreamId = undefined;
		} catch (err: unknown) {
			logPi(`Sidebar Pi request FAILED session=${this._currentSessionId || "none"} error=${err instanceof Error ? err.message : String(err)}`);
			if (signal.aborted) {
				this._view.webview.postMessage({
					type: 'streamEnd',
					streamId,
					thinkingDeltaCount: 0,
					textDeltaCount: 0,
				});
				this._activeStreamId = undefined;
			} else {
				const msg = err instanceof Error ? err.message : String(err);
				this._view.webview.postMessage({
					type: 'error',
					streamId,
					message: msg,
				});
			}
		} finally {
			this._abortController = undefined;
		}
	}

	private restoreSessionHistory(messages: readonly any[]): void {
		if (!this._view) return;
		const restored = messages
			.filter((message) => message?.role === 'user' || message?.role === 'assistant')
			.map((message) => {
				const content = Array.isArray(message.content)
					? message.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text || '').join('')
					: typeof message.content === 'string' ? message.content : '';
				return {
					role: message.role,
					content,
					timestamp: message.timestamp || Date.now(),
					id: String(message.id || Date.now()),
				};
			})
			.filter((message) => message.content.length > 0);
		if (restored.length > 0) {
			logPi(`Restoring ${restored.length} persisted sidebar messages`);
			this._view.webview.postMessage({ type: 'restoreHistory', messages: restored });
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
