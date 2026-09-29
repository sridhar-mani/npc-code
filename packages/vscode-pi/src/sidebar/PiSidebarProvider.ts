import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PiRuntimeService } from '../runtime/PiRuntimeService';
import { getSidebarHtml } from './html';
import { SidebarMessage } from './messages';
import { PiLogger } from '../logging/logger';

export class PiSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = 'pi-assistant.dashboard';
	private _view?: vscode.WebviewView;
	private _abortController?: AbortController;
	private _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _runtime: PiRuntimeService,
		private readonly _logger: PiLogger
	) {
		this._disposables.push(
			this._runtime.onDidChangeState(() => {
				this.postStateUpdate();
			})
		);
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		let cssContent = '';
		try {
			const cssPath = path.join(this._extensionUri.fsPath, 'src', 'sidebar', 'styles.css');
			if (fs.existsSync(cssPath)) {
				cssContent = fs.readFileSync(cssPath, 'utf8');
			}
		} catch {
			// CSS fallback handled
		}

		webviewView.webview.html = getSidebarHtml(cssContent, webviewView.webview.cspSource);

		webviewView.webview.onDidReceiveMessage(async (message: SidebarMessage) => {
			this._logger.debug('sidebar', `Received message: ${message.type}`);
			switch (message.type) {
				case 'ready':
					await this._runtime.initialize();
					this.postStateUpdate();
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
				case 'switchModel':
					if (typeof message.modelId === 'string' && message.modelId) {
						await this._runtime.modelRegistry.setActiveModel(message.modelId);
					}
					break;
				case 'addCustomModel':
					await vscode.commands.executeCommand('pi.addCustomModel');
					break;
				case 'selectActiveModel':
					await vscode.commands.executeCommand('pi.selectActiveModel');
					break;
				case 'syncOllama':
					await vscode.commands.executeCommand('pi.syncOllamaModels');
					break;
				case 'openTerminal':
					await vscode.commands.executeCommand('pi.openTerminalAgent');
					break;
				case 'openSettings':
					await vscode.commands.executeCommand('pi.openSettings');
					break;
				case 'getEditorContext': {
					const editor = vscode.window.activeTextEditor;
					if (editor) {
						const doc = editor.document;
						const sel = editor.selection;
						const selectedText = !sel.isEmpty ? doc.getText(sel) : '';
						const relPath = vscode.workspace.asRelativePath(doc.uri);
						this._view?.webview.postMessage({
							type: 'editorContext',
							fileName: relPath,
							selectedText: selectedText || undefined,
							fullText: !selectedText ? doc.getText() : undefined,
							startLine: !sel.isEmpty ? sel.start.line + 1 : 1,
							endLine: !sel.isEmpty ? sel.end.line + 1 : doc.lineCount,
						});
					} else {
						vscode.window.showInformationMessage('No active editor file detected.');
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

	public postStateUpdate(): void {
		if (!this._view) return;
		const state = this._runtime.getState();

		this._view.webview.postMessage({
			type: 'updateModels',
			activeModelId: state.activeModel ? state.activeModel.id : '',
			activeModelName: state.activeModel ? state.activeModel.name : 'Select a Model',
			models: state.models,
			isOllamaOnline: state.ollama.connected,
		});
	}

	private stopGeneration(): void {
		if (this._abortController) {
			this._abortController.abort();
			this._abortController = undefined;
		}
		if (this._view) {
			this._view.webview.postMessage({ type: 'generationStopped' });
		}
	}

	private async handleUserMessage(prompt: string, history: any[]): Promise<void> {
		if (!this._view) return;

		const state = this._runtime.getState();
		if (!state.activeModel) {
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
			modelName: state.activeModel.name,
		});

		try {
			await this._runtime.streamChat(
				prompt,
				history,
				{
					onDelta: text => {
						if (this._view) {
							this._view.webview.postMessage({ type: 'streamDelta', text });
						}
					},
				},
				signal
			);
			this._view.webview.postMessage({ type: 'streamEnd' });
		} catch (err: any) {
			if (signal.aborted) {
				this._view.webview.postMessage({ type: 'streamEnd' });
			} else {
				this._view.webview.postMessage({
					type: 'error',
					message: err?.message || String(err),
				});
			}
		} finally {
			this._abortController = undefined;
		}
	}

	private async handleCompaction(history: any[]): Promise<void> {
		if (!this._view || history.length === 0) return;

		const state = this._runtime.getState();
		if (!state.activeModel) {
			vscode.window.showWarningMessage('Please select an active model to run compaction.');
			return;
		}

		this._view.webview.postMessage({ type: 'compactionStart' });

		try {
			const signal = new AbortController().signal;
			const summary = await this._runtime.compactHistory(history, signal);

			this._view.webview.postMessage({
				type: 'compactionDone',
				summary: summary.trim() || 'Conversation compacted into dense context.',
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

	public dispose(): void {
		this._disposables.forEach(d => d.dispose());
		this._disposables = [];
	}
}
