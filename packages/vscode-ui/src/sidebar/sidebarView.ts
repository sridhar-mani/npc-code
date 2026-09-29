import * as vscode from 'vscode';
import { ModelManager, ModelEntry } from '../runtime/modelManager';
import { PiSettings } from '../config/settings';
import * as http from 'http';
import * as https from 'https';
import { getSharedAgentBackend } from '../backend-bridge';
import { createVsCodeTools } from '../tools/vscode-tools';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'compaction';
	content: string;
	timestamp: number;
}

export class PiSidebarViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'pi-assistant-sidebar';
	private _view?: vscode.WebviewView;
	private _abortController?: AbortController;
	private _currentSessionId?: string;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _modelManager: ModelManager
	) {
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

		webviewView.webview.html = this.getHtml(codiconUri);
		this.postModelUpdate();

		webviewView.webview.onDidReceiveMessage(async message => {
			switch (message.command) {
				case 'ready':
					this.postModelUpdate();
					break;
				case 'sendMessage':
					await this.handleUserMessage(message.text, message.history || []);
					break;
				case 'compact':
					await this.handleCompaction(message.history || []);
					break;
				case 'stopGeneration':
					this.stopGeneration();
					break;
				case 'selectModel':
					await this._modelManager.promptSelectModel();
					break;
				case 'switchModel':
					await PiSettings.setActiveModel(message.modelId);
					this.postModelUpdate();
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
				case 'attachContextPicker': {
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
					if (!chosen) break;

					if (chosen.action === 'activeEditor') {
						if (activeEditor) {
							const doc = activeEditor.document;
							const sel = activeEditor.selection;
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
							} catch (e: any) {
								vscode.window.showErrorMessage(`Failed to read file: ${e.message}`);
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
							} catch (e: any) {
								vscode.window.showErrorMessage(`Failed to read file: ${e.message}`);
							}
						}
					}
					break;
				}
				case 'getEditorContext': {
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
					break;
				}
				case 'runInTerminal': {
					if (typeof message.code === 'string') {
						let term = vscode.window.terminals.find(t => t.name === 'Pi Terminal');
						if (!term) {
							term = vscode.window.createTerminal('Pi Terminal');
						}
						term.show();
						term.sendText(message.code);
					}
					break;
				}
				case 'insertCode': {
					const editor = vscode.window.activeTextEditor;
					if (editor && typeof message.code === 'string') {
						await editor.edit(editBuilder => {
							editBuilder.insert(editor.selection.active, message.code);
						});
					} else {
						vscode.window.showWarningMessage('No active editor open to insert code.');
					}
					break;
				}
				case 'copyCode': {
					if (typeof message.code === 'string') {
						await vscode.env.clipboard.writeText(message.code);
						vscode.window.showInformationMessage('Code copied to clipboard.');
					}
					break;
				}
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

			if (!this._currentSessionId) {
				const runtime = await backend.getModelRuntime();
				const models = runtime.getModels();
				const targetModel = models.find(m => m.id === activeModel.id || m.name === activeModel.name || `${m.provider}/${m.id}` === activeModel.id);
				const created = await backend.createSession({
					cwd,
					model: targetModel,
					customTools: createVsCodeTools(),
					enableAttributionHeaders: true,
				});
				this._currentSessionId = created.session.sessionId;
			}

			const unsubscribe = backend.subscribe(this._currentSessionId, (event: any) => {
				if (signal.aborted) return;
				if (event.type === 'message_update') {
					const delta = event.delta;
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
		} catch (err: any) {
			if (signal.aborted) {
				this._view.webview.postMessage({ type: 'streamEnd' });
			} else {
				// Fallback to direct provider connection if agent session encounters transport issues
				try {
					if (activeModel.provider === 'ollama') {
						await this.streamOllamaChat(activeModel.id, prompt, history, signal);
					} else {
						await this.streamByomChat(activeModel, prompt, history, signal);
					}
					this._view.webview.postMessage({ type: 'streamEnd' });
				} catch (fallbackErr: any) {
					this._view.webview.postMessage({
						type: 'error',
						message: fallbackErr?.message || String(fallbackErr),
					});
				}
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
				summary = await this.collectOllamaText(activeModel.id, prompt, signal);
			} else {
				summary = await this.collectByomText(activeModel, prompt, signal);
			}

			this._view.webview.postMessage({
				type: 'compactionDone',
				summary: summary.trim() || 'Conversation compacted.',
				savedCount: history.length,
			});

			vscode.window.showInformationMessage(`Pi: Compacted ${history.length} conversation turns into context memory.`);
		} catch (err: any) {
			this._view.webview.postMessage({
				type: 'error',
				message: `Compaction failed: ${err?.message || String(err)}`,
			});
		}
	}

	private streamOllamaChat(
		modelId: string,
		prompt: string,
		history: ChatMessage[],
		signal: AbortSignal
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const baseUrl = PiSettings.ollamaUrl.replace(/\/$/, '');
			const u = new URL(`${baseUrl}/api/chat`);
			const lib = u.protocol === 'https:' ? https : http;

			const messages = history
				.filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'compaction')
				.map(m => ({
					role: m.role === 'compaction' ? 'system' : m.role,
					content: m.role === 'compaction' ? `[Context memory: ${m.content}]` : m.content,
				}));
			messages.push({ role: 'user', content: prompt });

			const postData = JSON.stringify({
				model: modelId,
				messages,
				stream: true,
			});

			const req = lib.request(u, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(postData),
				},
				timeout: 60000,
			}, res => {
				if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
					reject(new Error(`Ollama returned HTTP ${res.statusCode}`));
					return;
				}

				res.setEncoding('utf8');
				let buffer = '';

				res.on('data', chunk => {
					if (signal.aborted) {
						req.destroy();
						resolve();
						return;
					}
					buffer += chunk;
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (!line.trim()) continue;
						try {
							const json = JSON.parse(line);
							if (json.message?.content && this._view) {
								this._view.webview.postMessage({
									type: 'streamDelta',
									text: json.message.content,
								});
							}
							if (json.done) {
								resolve();
							}
						} catch {
							// incomplete chunk
						}
					}
				});

				res.on('end', () => resolve());
			});

			signal.addEventListener('abort', () => {
				req.destroy();
				resolve();
			});

			req.on('error', reject);
			req.write(postData);
			req.end();
		});
	}

	private streamByomChat(
		model: ModelEntry,
		prompt: string,
		history: ChatMessage[],
		signal: AbortSignal
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const baseUrl = (model.baseUrl || '').replace(/\/$/, '');
			const u = new URL(`${baseUrl}/chat/completions`);
			const lib = u.protocol === 'https:' ? https : http;

			const messages = history
				.filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'compaction')
				.map(m => ({
					role: m.role === 'compaction' ? 'system' : m.role,
					content: m.role === 'compaction' ? `[Context memory: ${m.content}]` : m.content,
				}));
			messages.push({ role: 'user', content: prompt });

			const postData = JSON.stringify({
				model: model.id,
				messages,
				stream: true,
			});

			const customCfg = PiSettings.customModels.find(m => m.id === model.id);
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				'Content-Length': String(Buffer.byteLength(postData)),
			};
			if (customCfg?.apiKey) {
				headers['Authorization'] = `Bearer ${customCfg.apiKey}`;
			}

			const req = lib.request(u, {
				method: 'POST',
				headers,
				timeout: 60000,
			}, res => {
				if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
					reject(new Error(`Custom model returned HTTP ${res.statusCode}`));
					return;
				}

				res.setEncoding('utf8');
				let buffer = '';

				res.on('data', chunk => {
					if (signal.aborted) {
						req.destroy();
						resolve();
						return;
					}
					buffer += chunk;
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed || trimmed.startsWith(':')) continue;
						if (trimmed === 'data: [DONE]') {
							resolve();
							return;
						}
						if (trimmed.startsWith('data: ')) {
							try {
								const json = JSON.parse(trimmed.slice(6));
								const delta = json.choices?.[0]?.delta?.content;
								if (delta && this._view) {
									this._view.webview.postMessage({
										type: 'streamDelta',
										text: delta,
									});
								}
							} catch {
								// incomplete chunk
							}
						}
					}
				});

				res.on('end', () => resolve());
			});

			signal.addEventListener('abort', () => {
				req.destroy();
				resolve();
			});

			req.on('error', reject);
			req.write(postData);
			req.end();
		});
	}

	private collectOllamaText(modelId: string, prompt: string, signal: AbortSignal): Promise<string> {
		return new Promise((resolve, reject) => {
			const baseUrl = PiSettings.ollamaUrl.replace(/\/$/, '');
			const u = new URL(`${baseUrl}/api/generate`);
			const lib = u.protocol === 'https:' ? https : http;

			const postData = JSON.stringify({
				model: modelId,
				prompt,
				stream: false,
			});

			const req = lib.request(u, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(postData),
				},
				timeout: 45000,
			}, res => {
				let body = '';
				res.on('data', chunk => body += chunk);
				res.on('end', () => {
					try {
						const json = JSON.parse(body);
						resolve(json.response || '');
					} catch (e) {
						reject(e);
					}
				});
			});

			req.on('error', reject);
			req.write(postData);
			req.end();
		});
	}

	private collectByomText(model: ModelEntry, prompt: string, signal: AbortSignal): Promise<string> {
		return new Promise((resolve, reject) => {
			const baseUrl = (model.baseUrl || '').replace(/\/$/, '');
			const u = new URL(`${baseUrl}/chat/completions`);
			const lib = u.protocol === 'https:' ? https : http;

			const postData = JSON.stringify({
				model: model.id,
				messages: [{ role: 'user', content: prompt }],
				stream: false,
			});

			const customCfg = PiSettings.customModels.find(m => m.id === model.id);
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				'Content-Length': String(Buffer.byteLength(postData)),
			};
			if (customCfg?.apiKey) {
				headers['Authorization'] = `Bearer ${customCfg.apiKey}`;
			}

			const req = lib.request(u, {
				method: 'POST',
				headers,
				timeout: 45000,
			}, res => {
				let body = '';
				res.on('data', chunk => body += chunk);
				res.on('end', () => {
					try {
						const json = JSON.parse(body);
						resolve(json.choices?.[0]?.message?.content || '');
					} catch (e) {
						reject(e);
					}
				});
			});

			req.on('error', reject);
			req.write(postData);
			req.end();
		});
	}

	private getHtml(codiconUri?: vscode.Uri): string {
		const codiconLink = codiconUri
			? `<link rel="stylesheet" href="${codiconUri.toString()}">`
			: '';

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Pi Assistant</title>
	${codiconLink}
	<style>
		* { box-sizing: border-box; }
		body {
			font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
			color: var(--vscode-foreground);
			background: var(--vscode-sideBar-background);
			margin: 0;
			padding: 0;
			height: 100vh;
			display: flex;
			flex-direction: column;
			font-size: var(--vscode-font-size, 13px);
			overflow: hidden;
		}

		/* Header & Toolbar */
		.copilot-header {
			padding: 8px 10px;
			background: var(--vscode-sideBar-background);
			border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.18));
			display: flex;
			flex-direction: column;
			gap: 6px;
			flex-shrink: 0;
		}
		.header-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 6px;
		}
		.model-pill-container {
			flex: 1;
			display: flex;
			align-items: center;
			min-width: 0;
			background: var(--vscode-dropdown-background);
			border: 1px solid var(--vscode-dropdown-border, rgba(128, 128, 128, 0.25));
			border-radius: 6px;
			padding: 0 6px;
			height: 28px;
		}
		.model-pill-container i {
			color: var(--vscode-textLink-foreground, #3794ff);
			font-size: 13px;
			margin-right: 5px;
			flex-shrink: 0;
		}
		select.model-dropdown {
			flex: 1;
			background: transparent;
			color: var(--vscode-dropdown-foreground);
			border: none;
			font-size: 11px;
			outline: none;
			cursor: pointer;
			text-overflow: ellipsis;
			white-space: nowrap;
			overflow: hidden;
			padding: 0;
			font-family: inherit;
		}
		.toolbar-icons {
			display: flex;
			align-items: center;
			gap: 2px;
		}
		.icon-action-btn {
			background: none;
			border: 1px solid transparent;
			color: var(--vscode-foreground);
			opacity: 0.85;
			cursor: pointer;
			padding: 4px;
			border-radius: 4px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 26px;
			height: 26px;
			font-size: 14px;
			transition: background 0.12s, opacity 0.12s;
		}
		.icon-action-btn:hover {
			opacity: 1;
			background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
			border-color: var(--vscode-panel-border, rgba(128, 128, 128, 0.2));
		}
		.status-subrow {
			display: flex;
			align-items: center;
			justify-content: space-between;
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			padding: 0 2px;
		}
		.status-chip {
			display: flex;
			align-items: center;
			gap: 5px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.status-dot {
			width: 7px;
			height: 7px;
			border-radius: 50%;
			display: inline-block;
			flex-shrink: 0;
		}
		.dot-online { background: #3fb950; }
		.dot-offline { background: #d73a49; }
		.turns-badge {
			font-size: 10px;
			font-weight: 500;
			padding: 1px 6px;
			border-radius: 10px;
			background: var(--vscode-badge-background, rgba(128, 128, 128, 0.2));
			color: var(--vscode-badge-foreground);
		}

		/* Messages Feed */
		.messages-feed {
			flex: 1;
			overflow-y: auto;
			padding: 12px;
			display: flex;
			flex-direction: column;
			gap: 14px;
		}
		.welcome-container {
			display: flex;
			flex-direction: column;
			align-items: center;
			text-align: center;
			padding: 24px 8px;
			color: var(--vscode-descriptionForeground);
		}
		.welcome-icon-wrapper {
			width: 44px;
			height: 44px;
			border-radius: 10px;
			background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.06));
			display: flex;
			align-items: center;
			justify-content: center;
			margin-bottom: 12px;
		}
		.welcome-icon-wrapper i {
			font-size: 24px;
			color: var(--vscode-textLink-foreground, #3794ff);
		}
		.welcome-title {
			margin: 0 0 4px 0;
			color: var(--vscode-foreground);
			font-size: 15px;
			font-weight: 600;
		}
		.welcome-desc {
			font-size: 12px;
			margin: 0 0 16px 0;
			opacity: 0.85;
		}
		.cards-grid {
			width: 100%;
			display: flex;
			flex-direction: column;
			gap: 8px;
		}
		.feature-card {
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.18));
			border-radius: 6px;
			padding: 8px 12px;
			text-align: left;
			cursor: pointer;
			display: flex;
			align-items: center;
			gap: 10px;
			transition: background 0.15s, border-color 0.15s, transform 0.1s;
		}
		.feature-card:hover {
			background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05));
			border-color: var(--vscode-focusBorder);
			transform: translateY(-1px);
		}
		.card-icon {
			font-size: 18px;
			color: var(--vscode-textLink-foreground, #3794ff);
			flex-shrink: 0;
		}
		.card-texts {
			display: flex;
			flex-direction: column;
			min-width: 0;
		}
		.card-texts strong {
			font-size: 12px;
			color: var(--vscode-foreground);
		}
		.card-texts span {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		/* Message Cards */
		.message-card {
			display: flex;
			flex-direction: column;
			gap: 6px;
		}
		.message-card-header {
			display: flex;
			align-items: center;
			gap: 6px;
			font-size: 11px;
			font-weight: 600;
			color: var(--vscode-foreground);
		}
		.author-icon {
			font-size: 13px;
			color: var(--vscode-textLink-foreground, #3794ff);
		}
		.bubble {
			padding: 8px 12px;
			border-radius: 6px;
			font-size: 12px;
			line-height: 1.5;
			word-break: break-word;
		}
		.bubble-user {
			background: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.08));
			color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
			border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.15));
			align-self: flex-start;
			width: 100%;
		}
		.bubble-assistant {
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
			color: var(--vscode-foreground);
			width: 100%;
		}

		/* Context Attachment Pill */
		.context-pill-container {
			display: flex;
			flex-wrap: wrap;
			gap: 4px;
			padding: 4px 0;
		}
		.context-pill {
			display: inline-flex;
			align-items: center;
			gap: 5px;
			background: var(--vscode-badge-background, rgba(128, 128, 128, 0.2));
			color: var(--vscode-badge-foreground, var(--vscode-foreground));
			border-radius: 4px;
			padding: 2px 7px;
			font-size: 11px;
		}
		.context-pill-remove {
			cursor: pointer;
			font-weight: bold;
			opacity: 0.7;
			margin-left: 2px;
		}
		.context-pill-remove:hover {
			opacity: 1;
		}

		/* Code block formatting */
		.code-block {
			margin: 8px 0;
			border-radius: 6px;
			background: var(--vscode-textCodeBlock-background, #1e1e1e);
			border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.22));
			overflow: hidden;
		}
		.code-block-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			background: rgba(255, 255, 255, 0.04);
			padding: 4px 8px;
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			border-bottom: 1px solid rgba(128, 128, 128, 0.15);
		}
		.code-block-actions {
			display: flex;
			gap: 4px;
		}
		.code-action-btn {
			background: none;
			border: none;
			color: var(--vscode-foreground);
			cursor: pointer;
			font-size: 11px;
			opacity: 0.8;
			padding: 2px 5px;
			border-radius: 3px;
			display: inline-flex;
			align-items: center;
			gap: 3px;
		}
		.code-action-btn:hover {
			opacity: 1;
			background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
		}
		pre {
			margin: 0;
			padding: 10px;
			overflow-x: auto;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 11px;
			line-height: 1.45;
		}
		code {
			font-family: var(--vscode-editor-font-family, monospace);
		}
		p {
			margin: 4px 0;
		}
		p:first-child { margin-top: 0; }
		p:last-child { margin-bottom: 0; }

		/* Copilot Unified Input Box */
		.copilot-input-wrapper {
			padding: 10px 12px;
			background: var(--vscode-sideBar-background);
			border-top: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.18));
			flex-shrink: 0;
		}
		.copilot-input-container {
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.3));
			border-radius: 8px;
			padding: 6px 8px;
			display: flex;
			flex-direction: column;
			gap: 4px;
			transition: border-color 0.15s, box-shadow 0.15s;
		}
		.copilot-input-container:focus-within {
			border-color: var(--vscode-focusBorder);
			box-shadow: 0 0 0 1px var(--vscode-focusBorder);
		}
		textarea#promptInput {
			width: 100%;
			background: transparent;
			color: var(--vscode-input-foreground);
			border: none;
			font-family: inherit;
			font-size: 12px;
			resize: none;
			min-height: 36px;
			max-height: 130px;
			outline: none;
			line-height: 1.4;
			padding: 2px 2px;
		}
		.input-footer {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding-top: 2px;
		}
		.footer-actions-left {
			display: flex;
			align-items: center;
			gap: 4px;
		}
		.action-chip {
			background: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.06));
			border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.15));
			color: var(--vscode-descriptionForeground);
			border-radius: 4px;
			padding: 2px 6px;
			font-size: 11px;
			cursor: pointer;
			display: inline-flex;
			align-items: center;
			gap: 3px;
			transition: background 0.12s, color 0.12s;
		}
		.action-chip:hover {
			color: var(--vscode-foreground);
			background: var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.12));
		}
		.footer-actions-right {
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.send-round-btn {
			width: 26px;
			height: 26px;
			border-radius: 50%;
			border: none;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			cursor: pointer;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			font-size: 12px;
			transition: background 0.15s, transform 0.1s;
		}
		.send-round-btn:hover {
			background: var(--vscode-button-hoverBackground);
			transform: scale(1.05);
		}
		.send-round-btn.btn-stop {
			background: #d73a49;
		}
	</style>
</head>
<body>
	<!-- Copilot Style Header -->
	<div class="copilot-header">
		<div class="header-row">
			<div class="model-pill-container" title="Select or change active model">
				<i class="codicon codicon-sparkle"></i>
				<select id="modelSelect" class="model-dropdown" onchange="onModelChanged()">
					<option value="">Select or add model...</option>
				</select>
			</div>
			<div class="toolbar-icons">
				<button id="addModelBtn" class="icon-action-btn" title="Add Custom Provider / Model (BYOM)" onclick="send('addModel')">
					<i class="codicon codicon-add"></i>
				</button>
				<button class="icon-action-btn" title="Sync Models from Ollama" onclick="send('syncOllama')">
					<i class="codicon codicon-sync"></i>
				</button>
				<button class="icon-action-btn" title="New Session (/clear)" onclick="clearChat()">
					<i class="codicon codicon-clear-all"></i>
				</button>
				<button class="icon-action-btn" title="Open Pi Terminal Agent" onclick="send('openTerminal')">
					<i class="codicon codicon-terminal"></i>
				</button>
				<button class="icon-action-btn" title="Pi Extension Settings" onclick="send('openSettings')">
					<i class="codicon codicon-settings-gear"></i>
				</button>
			</div>
		</div>
		<div class="status-subrow">
			<div id="ollamaStatus" class="status-chip">
				<span class="status-dot dot-offline"></span>
				<span>Checking status...</span>
			</div>
			<span id="turnCounter" class="turns-badge">0 turns</span>
		</div>
	</div>

	<!-- Messages Thread -->
	<div id="messagesContainer" class="messages-feed">
		<div id="welcomeBox" class="welcome-container">
			<div class="welcome-icon-wrapper">
				<i class="codicon codicon-copilot"></i>
			</div>
			<h3 class="welcome-title">Pi Assistant</h3>
			<p class="welcome-desc">Enterprise AI coding companion powered by Pi & Zenteiq</p>

			<div class="cards-grid">
				<div class="feature-card" onclick="runCommand('/explain')">
					<i class="codicon codicon-symbol-structure card-icon"></i>
					<div class="card-texts">
						<strong>Explain Architecture</strong>
						<span>Analyze workspace structure and code logic</span>
					</div>
				</div>
				<div class="feature-card" onclick="runCommand('/fix')">
					<i class="codicon codicon-tools card-icon"></i>
					<div class="card-texts">
						<strong>Fix & Diagnostics</strong>
						<span>Propose fixes for active errors and warnings</span>
					</div>
				</div>
				<div class="feature-card" onclick="runCommand('/test')">
					<i class="codicon codicon-beaker card-icon"></i>
					<div class="card-texts">
						<strong>Generate Tests</strong>
						<span>Write unit tests with edge cases & mocks</span>
					</div>
				</div>
				<div class="feature-card" onclick="runCommand('/docs')">
					<i class="codicon codicon-book card-icon"></i>
					<div class="card-texts">
						<strong>Documentation & JSDoc</strong>
						<span>Generate docstrings, types, and guides</span>
					</div>
				</div>
				<div class="feature-card" onclick="send('attachContextPicker')">
					<i class="codicon codicon-file-submodule card-icon"></i>
					<div class="card-texts">
						<strong>Attach Files / Context</strong>
						<span>Attach workspace files, problems, or diff</span>
					</div>
				</div>
				<div class="feature-card" onclick="send('openTerminal')">
					<i class="codicon codicon-terminal card-icon"></i>
					<div class="card-texts">
						<strong>Pi Terminal Agent</strong>
						<span>Launch autonomous interactive coding agent</span>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Copilot Style Bottom Input Box -->
	<div class="copilot-input-wrapper">
		<div class="copilot-input-container">
			<div id="contextPillRow" class="context-pill-container" style="display:none;"></div>
			<textarea
				id="promptInput"
				rows="1"
				placeholder="Ask Pi or type / for commands... (Enter to send)"
				onkeydown="onInputKeydown(event)"
				oninput="autoResize(this)"
			></textarea>
			<div class="input-footer">
				<div class="footer-actions-left">
					<button class="action-chip" title="Attach files, workspace code, or diagnostics" onclick="send('attachContextPicker')">
						<i class="codicon codicon-attach"></i>
						<span>Attach</span>
					</button>
					<button class="action-chip" onclick="runCommand('/explain')">/explain</button>
					<button class="action-chip" onclick="runCommand('/fix')">/fix</button>
					<button class="action-chip" onclick="runCommand('/test')">/test</button>
					<button class="action-chip" onclick="runCommand('/docs')">/docs</button>
				</div>
				<div class="footer-actions-right">
					<span id="turnIndicator" style="font-size: 11px; color: var(--vscode-descriptionForeground);">Ready</span>
					<button id="sendBtn" class="send-round-btn" onclick="submitMessage()" title="Send message (Enter)">
						<i class="codicon codicon-arrow-up"></i>
					</button>
				</div>
			</div>
		</div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();
		window.vscode = vscode;
		function send(command, extra = {}) {
			vscode.postMessage({ command, ...extra });
		}
		window.send = send;

		let conversationHistory = [];
		let currentAssistantContent = '';
		let currentAssistantRow = null;
		let isGenerating = false;
		let attachedContexts = [];
		let currentActiveModelId = '';

		window.addEventListener('load', () => {
			vscode.postMessage({ command: 'ready' });
			document.getElementById('addModelBtn')?.addEventListener('click', (e) => {
				e.preventDefault();
				send('addModel');
			});
		});

		window.addEventListener('message', event => {
			const msg = event.data;
			switch (msg.type) {
				case 'updateModels':
					renderModelDropdown(msg.models, msg.activeModelId);
					updateOllamaIndicator(msg.isOllamaOnline, msg.models, msg.activeModelName);
					break;
				case 'addContextItem':
					addContextItem(msg.item);
					break;
				case 'editorContext':
					addContextItem({
						id: 'editor-' + Date.now(),
						name: msg.fileName + (msg.selectedText ? ' (' + msg.startLine + '-' + msg.endLine + ')' : ''),
						path: msg.fileName,
						content: msg.selectedText || msg.fullText || '',
						icon: 'codicon-file-code',
						type: 'file',
					});
					break;
				case 'streamStart':
					isGenerating = true;
					updateSendButton(true);
					document.getElementById('turnIndicator').textContent = 'Thinking...';
					currentAssistantContent = '';
					currentAssistantRow = createMessageContainer('assistant');
					break;
				case 'streamDelta':
					if (currentAssistantRow) {
						currentAssistantContent += msg.text;
						renderAssistantBody(currentAssistantRow, currentAssistantContent);
						scrollToBottom();
					}
					break;
				case 'streamEnd':
					isGenerating = false;
					updateSendButton(false);
					document.getElementById('turnIndicator').textContent = 'Ready';
					if (currentAssistantRow && currentAssistantContent) {
						conversationHistory.push({
							id: Date.now().toString(),
							role: 'assistant',
							content: currentAssistantContent,
							timestamp: Date.now()
						});
						updateTurnCount();
						currentAssistantRow = null;
						currentAssistantContent = '';
					}
					break;
				case 'generationStopped':
					isGenerating = false;
					updateSendButton(false);
					document.getElementById('turnIndicator').textContent = 'Ready';
					break;
				case 'error':
					isGenerating = false;
					updateSendButton(false);
					document.getElementById('turnIndicator').textContent = 'Error';
					appendErrorBubble(msg.message);
					break;
			}
		});

		function send(command, extra = {}) {
			vscode.postMessage({ command, ...extra });
		}

		function renderModelDropdown(models, activeId) {
			currentActiveModelId = activeId || '';
			const select = document.getElementById('modelSelect');
			select.innerHTML = '';
			if (models && models.length > 0) {
				models.forEach(m => {
					const opt = document.createElement('option');
					opt.value = m.id;
					const providerTag = m.provider === 'ollama' ? '[Ollama] ' : '[Custom] ';
					opt.textContent = providerTag + m.name;
					if (m.id === activeId) opt.selected = true;
					select.appendChild(opt);
				});
			} else {
				const opt = document.createElement('option');
				opt.value = '';
				opt.textContent = 'No models available';
				select.appendChild(opt);
			}

			const addOpt = document.createElement('option');
			addOpt.value = '__add_model__';
			addOpt.textContent = '+ Add Custom Provider / Model (BYOM)...';
			select.appendChild(addOpt);
		}

		function updateOllamaIndicator(isOnline, models, activeModelName) {
			const el = document.getElementById('ollamaStatus');
			const ollamaCount = (models || []).filter(m => m.provider === 'ollama').length;
			const totalCount = (models || []).length;
			if (isOnline) {
				el.innerHTML = '<span class="status-dot dot-online"></span><span>Ollama (' + ollamaCount + ' models)</span>';
				el.style.cursor = 'default';
				el.onclick = null;
				el.title = 'Ollama local daemon connected';
			} else if (totalCount > 0) {
				el.innerHTML = '<span class="status-dot dot-online"></span><span>Active: ' + escapeHtml(activeModelName || 'Configured') + '</span>';
				el.style.cursor = 'default';
				el.onclick = null;
				el.title = 'Custom AI provider active';
			} else {
				el.innerHTML = '<span class="status-dot dot-offline"></span><span>Ollama Offline \u2014 Click to add Custom Model</span>';
				el.style.cursor = 'pointer';
				el.onclick = () => send('addModel');
				el.title = 'Click to configure a custom API provider or local model';
			}
		}

		function onModelChanged() {
			const select = document.getElementById('modelSelect');
			const modelId = select.value;
			if (modelId === '__add_model__') {
				select.value = currentActiveModelId;
				send('addModel');
				return;
			}
			if (modelId) {
				currentActiveModelId = modelId;
				send('switchModel', { modelId });
			}
		}

		function onInputKeydown(e) {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				submitMessage();
			}
		}

		function autoResize(textarea) {
			textarea.style.height = 'auto';
			textarea.style.height = Math.min(textarea.scrollHeight, 130) + 'px';
		}

		function addContextItem(item) {
			if (!item || !item.content) return;
			const idx = attachedContexts.findIndex(c => c.name === item.name);
			if (idx >= 0) {
				attachedContexts[idx] = item;
			} else {
				attachedContexts.push(item);
			}
			renderContextPills();
		}

		function removeContextItem(id) {
			attachedContexts = attachedContexts.filter(c => c.id !== id);
			renderContextPills();
		}

		function renderContextPills() {
			const row = document.getElementById('contextPillRow');
			if (!row) return;
			row.innerHTML = '';
			if (attachedContexts.length === 0) {
				row.style.display = 'none';
				return;
			}
			row.style.display = 'flex';
			attachedContexts.forEach(item => {
				const pill = document.createElement('div');
				pill.className = 'context-pill';
				const iconClass = item.icon || 'codicon-file-code';
				pill.innerHTML = '<i class="codicon ' + iconClass + '"></i><span>' + escapeHtml(item.name) + '</span>' +
					'<span class="context-pill-remove" onclick="removeContextItem(\x27' + item.id + '\x27)">\u00D7</span>';
				row.appendChild(pill);
			});
		}

		function runCommand(cmd) {
			if (cmd === '/terminal') {
				send('openTerminal');
				return;
			}
			if (cmd === '/clear') {
				clearChat();
				return;
			}
			if (cmd === '/explain') {
				if (attachedContexts.length === 0) send('getEditorContext');
				setTimeout(() => {
					document.getElementById('promptInput').value = 'Explain the architecture and main logic of this code in detail.';
					submitMessage();
				}, 280);
				return;
			}
			if (cmd === '/audit') {
				if (attachedContexts.length === 0) send('getEditorContext');
				setTimeout(() => {
					document.getElementById('promptInput').value = 'Audit this code for security vulnerabilities, edge cases, performance, and best practices.';
					submitMessage();
				}, 280);
				return;
			}
			if (cmd === '/fix') {
				if (attachedContexts.length === 0) send('getEditorContext');
				setTimeout(() => {
					document.getElementById('promptInput').value = 'Diagnose any bugs, syntax errors, or potential runtime issues and provide corrected implementations.';
					submitMessage();
				}, 280);
				return;
			}
			if (cmd === '/test' || cmd === '/tests') {
				if (attachedContexts.length === 0) send('getEditorContext');
				setTimeout(() => {
					document.getElementById('promptInput').value = 'Generate comprehensive unit tests covering edge cases, assertions, and mocks for this code.';
					submitMessage();
				}, 280);
				return;
			}
			if (cmd === '/docs') {
				if (attachedContexts.length === 0) send('getEditorContext');
				setTimeout(() => {
					document.getElementById('promptInput').value = 'Generate production-ready documentation, JSDoc/docstrings, and usage examples for this code.';
					submitMessage();
				}, 280);
				return;
			}
		}

		function submitMessage() {
			if (isGenerating) {
				send('stopGeneration');
				return;
			}
			const input = document.getElementById('promptInput');
			let rawText = input.value.trim();
			if (!rawText && attachedContexts.length === 0) return;

			if (rawText.startsWith('/')) {
				const cmd = rawText.split(' ')[0].toLowerCase();
				if (['/explain', '/audit', '/fix', '/test', '/tests', '/docs', '/terminal', '/clear'].includes(cmd)) {
					input.value = '';
					runCommand(cmd);
					return;
				}
			}

			let fullPrompt = rawText;
			let displayUserText = rawText;

			if (attachedContexts.length > 0) {
				const contextBlocks = attachedContexts.map(c => {
					return '=== Context: ' + c.name + ' (' + c.type + ') ===\\n\\x60\\x60\\x60\\n' + c.content + '\\n\\x60\\x60\\x60';
				}).join('\\n\\n');

				const promptInstruction = rawText || 'Please review the attached context and fulfill the user request.';
				fullPrompt = 'Provided context:\\n\\n' + contextBlocks + '\\n\\nTask:\\n' + promptInstruction;

				const contextNames = attachedContexts.map(c => c.name).join(', ');
				displayUserText = (rawText ? rawText + '\\n' : '') + '[Attached: ' + contextNames + ']';

				attachedContexts = [];
				renderContextPills();
			}

			input.value = '';
			input.style.height = '36px';

			document.getElementById('welcomeBox')?.remove();

			createUserBubble(displayUserText);
			conversationHistory.push({
				id: Date.now().toString(),
				role: 'user',
				content: fullPrompt,
				timestamp: Date.now()
			});
			updateTurnCount();

			send('sendMessage', { text: fullPrompt, history: conversationHistory });
		}

		function clearChat() {
			conversationHistory = [];
			attachedContexts = [];
			renderContextPills();
			updateTurnCount();
			const container = document.getElementById('messagesContainer');
			container.innerHTML = '<div id="welcomeBox" class="welcome-container">' +
				'<div class="welcome-icon-wrapper"><i class="codicon codicon-copilot"></i></div>' +
				'<h3 class="welcome-title">Pi Assistant</h3>' +
				'<p class="welcome-desc">New session started. Ask a question or pick an action.</p>' +
				'</div>';
		}

		function updateTurnCount() {
			const el = document.getElementById('turnCounter');
			if (el) {
				el.textContent = conversationHistory.length + ' turns';
			}
		}

		function createMessageContainer(role) {
			const container = document.getElementById('messagesContainer');
			const card = document.createElement('div');
			card.className = 'message-card';

			const header = document.createElement('div');
			header.className = 'message-card-header';
			header.innerHTML = '<i class="codicon codicon-sparkle author-icon"></i><span>Pi</span>';
			card.appendChild(header);

			const bubble = document.createElement('div');
			bubble.className = 'bubble bubble-assistant';
			card.appendChild(bubble);

			container.appendChild(card);
			scrollToBottom();
			return bubble;
		}

		function createUserBubble(text) {
			const container = document.getElementById('messagesContainer');
			const card = document.createElement('div');
			card.className = 'message-card';

			const header = document.createElement('div');
			header.className = 'message-card-header';
			header.innerHTML = '<i class="codicon codicon-account author-icon"></i><span>You</span>';
			card.appendChild(header);

			const bubble = document.createElement('div');
			bubble.className = 'bubble bubble-user';
			bubble.textContent = text;
			card.appendChild(bubble);

			container.appendChild(card);
			scrollToBottom();
		}

		function renderAssistantBody(bubbleElement, rawMarkdown) {
			bubbleElement.innerHTML = renderMarkdown(rawMarkdown);
		}

		function renderMarkdown(md) {
			if (!md) return '';
			let escaped = escapeHtml(md);

			// Code blocks
			const codeBlockRegex = new RegExp('\\x60\\x60\\x60([a-zA-Z0-9_-]*)\\n([\\s\\S]*?)\\x60\\x60\\x60', 'g');
			escaped = escaped.replace(codeBlockRegex, (match, lang, code) => {
				const language = lang || 'code';
				const cleanCode = code.replace(new RegExp('\\n$'), '');
				const isShell = ['bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'cmd', 'bat'].includes((lang || '').toLowerCase());
				const runBtn = isShell
					? '<button class="code-action-btn" onclick="runCodeInTerminal(this)"><i class="codicon codicon-terminal"></i> Run</button>'
					: '';

				return '<div class="code-block">' +
					'<div class="code-block-header">' +
					'<span>' + language + '</span>' +
					'<div class="code-block-actions">' +
					runBtn +
					'<button class="code-action-btn" onclick="copyCodeBlock(this)"><i class="codicon codicon-copy"></i> Copy</button>' +
					'<button class="code-action-btn" onclick="insertCodeBlock(this)"><i class="codicon codicon-insert"></i> Insert</button>' +
					'</div>' +
					'</div>' +
					'<pre><code class="code-content">' + cleanCode + '</code></pre>' +
					'</div>';
			});

			// Inline code
			escaped = escaped.replace(new RegExp('\\x60([^\\x60]+)\\x60', 'g'), '<code>$1</code>');

			// Bold
			escaped = escaped.replace(new RegExp('\\*\\*([^\\*]+)\\*\\*', 'g'), '<strong>$1</strong>');

			// Newlines to <br> for remaining normal text
			escaped = escaped.replace(new RegExp('\\n', 'g'), '<br>');

			return escaped;
		}

		function runCodeInTerminal(button) {
			const codeBlock = button.closest('.code-block');
			const codeEl = codeBlock?.querySelector('.code-content');
			if (codeEl) {
				const text = codeEl.innerText || codeEl.textContent;
				send('runInTerminal', { code: text.trim() });
			}
		}

		function copyCodeBlock(button) {
			const codeBlock = button.closest('.code-block');
			const codeEl = codeBlock?.querySelector('.code-content');
			if (codeEl) {
				const text = codeEl.innerText || codeEl.textContent;
				send('copyCode', { code: text });
			}
		}

		function insertCodeBlock(button) {
			const codeBlock = button.closest('.code-block');
			const codeEl = codeBlock?.querySelector('.code-content');
			if (codeEl) {
				const text = codeEl.innerText || codeEl.textContent;
				send('insertCode', { code: text });
			}
		}

		function appendErrorBubble(message) {
			const container = document.getElementById('messagesContainer');
			const card = document.createElement('div');
			card.className = 'message-card';
			card.innerHTML = '<div class="bubble" style="background: rgba(215, 58, 73, 0.15); border: 1px solid rgba(215, 58, 73, 0.4); color: #f85149; font-size:11px;">' +
				'<i class="codicon codicon-error" style="margin-right: 4px;"></i>' + escapeHtml(message) + '</div>';
			container.appendChild(card);
			scrollToBottom();
		}

		function updateSendButton(generating) {
			const btn = document.getElementById('sendBtn');
			if (generating) {
				btn.className = 'send-round-btn btn-stop';
				btn.title = 'Stop generating';
				btn.innerHTML = '<i class="codicon codicon-debug-stop"></i>';
			} else {
				btn.className = 'send-round-btn';
				btn.title = 'Send message (Enter)';
				btn.innerHTML = '<i class="codicon codicon-arrow-up"></i>';
			}
		}

		function scrollToBottom() {
			const container = document.getElementById('messagesContainer');
			container.scrollTop = container.scrollHeight;
		}

		function escapeHtml(text) {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
		}
	</script>
</body>
</html>`;
	}
}
