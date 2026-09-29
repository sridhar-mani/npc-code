import * as vscode from 'vscode';
import { ModelManager, ModelEntry } from '../runtime/modelManager';
import { PiSettings } from '../config/settings';
import * as http from 'http';
import * as https from 'https';

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

		webviewView.webview.html = this.getHtml();

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
			if (activeModel.provider === 'ollama') {
				await this.streamOllamaChat(activeModel.id, prompt, history, signal);
			} else {
				await this.streamByomChat(activeModel, prompt, history, signal);
			}
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

	private getHtml(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Pi Assistant</title>
	<style>
		* { box-sizing: border-box; }
		body {
			font-family: var(--vscode-font-family);
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
		.top-bar {
			padding: 8px 10px;
			background: var(--vscode-editor-background);
			border-bottom: 1px solid var(--vscode-panel-border, #333);
			display: flex;
			flex-direction: column;
			gap: 6px;
		}
		.toolbar-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 6px;
		}
		.model-select-wrapper {
			flex: 1;
			display: flex;
			align-items: center;
			gap: 4px;
		}
		select.model-dropdown {
			flex: 1;
			background: var(--vscode-dropdown-background);
			color: var(--vscode-dropdown-foreground);
			border: 1px solid var(--vscode-dropdown-border, #444);
			border-radius: 3px;
			padding: 4px 6px;
			font-size: 11px;
			outline: none;
			cursor: pointer;
		}
		.btn-group {
			display: flex;
			align-items: center;
			gap: 2px;
		}
		.icon-btn {
			background: none;
			border: 1px solid transparent;
			color: var(--vscode-foreground);
			opacity: 0.85;
			cursor: pointer;
			padding: 4px 6px;
			border-radius: 3px;
			font-size: 11px;
			display: flex;
			align-items: center;
			justify-content: center;
			height: 24px;
			line-height: 1;
		}
		.icon-btn:hover {
			opacity: 1;
			background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
			border-color: var(--vscode-panel-border, #444);
		}
		.btn-badge {
			font-size: 10px;
			font-weight: 500;
			padding: 2px 5px;
			border-radius: 3px;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
		}
		.status-indicator {
			font-size: 10px;
			display: flex;
			align-items: center;
			gap: 5px;
			color: var(--vscode-descriptionForeground);
		}
		.dot {
			width: 6px;
			height: 6px;
			border-radius: 50%;
			display: inline-block;
		}
		.dot-online { background: #3fb950; }
		.dot-offline { background: #f85149; }

		/* Messages Thread */
		.messages-container {
			flex: 1;
			overflow-y: auto;
			padding: 10px;
			display: flex;
			flex-direction: column;
			gap: 12px;
		}
		.welcome-intro {
			text-align: center;
			padding: 20px 10px;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
		}
		.welcome-intro h4 {
			margin: 0 0 6px 0;
			color: var(--vscode-foreground);
			font-size: 13px;
			font-weight: 600;
		}
		.welcome-buttons {
			display: flex;
			flex-direction: column;
			gap: 6px;
			margin-top: 14px;
		}
		.quick-btn {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: 1px solid var(--vscode-widget-border, transparent);
			padding: 6px 10px;
			border-radius: 4px;
			font-size: 11px;
			cursor: pointer;
			text-align: left;
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.quick-btn:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}

		/* Message Bubbles */
		.message-row {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}
		.message-header {
			font-size: 10px;
			font-weight: 600;
			text-transform: uppercase;
			color: var(--vscode-descriptionForeground);
			display: flex;
			justify-content: space-between;
			padding: 0 2px;
		}
		.bubble {
			padding: 8px 10px;
			border-radius: 6px;
			font-size: 12px;
			line-height: 1.45;
			word-break: break-word;
		}
		.bubble-user {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			align-self: flex-end;
			max-width: 90%;
		}
		.bubble-assistant {
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
			color: var(--vscode-foreground);
			width: 100%;
		}
		.bubble-compaction {
			background: rgba(88, 166, 255, 0.08);
			border: 1px dashed rgba(88, 166, 255, 0.4);
			color: var(--vscode-foreground);
			font-size: 11px;
			padding: 8px 10px;
			border-radius: 4px;
		}
		.compaction-title {
			font-weight: 600;
			color: #58a6ff;
			margin-bottom: 4px;
			display: flex;
			justify-content: space-between;
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
			gap: 4px;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			border-radius: 3px;
			padding: 2px 6px;
			font-size: 10px;
		}
		.context-pill-remove {
			cursor: pointer;
			font-weight: bold;
			opacity: 0.7;
		}
		.context-pill-remove:hover {
			opacity: 1;
		}

		/* Code block formatting */
		.code-block {
			margin: 6px 0;
			border-radius: 4px;
			background: var(--vscode-textCodeBlock-background, #1e1e1e);
			border: 1px solid var(--vscode-panel-border, #333);
			overflow: hidden;
		}
		.code-block-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			background: rgba(255, 255, 255, 0.04);
			padding: 2px 8px;
			font-size: 10px;
			color: var(--vscode-descriptionForeground);
			border-bottom: 1px solid rgba(255, 255, 255, 0.05);
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
			font-size: 10px;
			opacity: 0.7;
			padding: 2px 4px;
			border-radius: 2px;
		}
		.code-action-btn:hover {
			opacity: 1;
			background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
		}
		pre {
			margin: 0;
			padding: 8px;
			overflow-x: auto;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 11px;
			line-height: 1.4;
		}
		code {
			font-family: var(--vscode-editor-font-family, monospace);
		}
		p {
			margin: 4px 0;
		}
		p:first-child { margin-top: 0; }
		p:last-child { margin-bottom: 0; }

		/* Input Area */
		.input-section {
			padding: 8px 10px;
			background: var(--vscode-editor-background);
			border-top: 1px solid var(--vscode-panel-border, #333);
			display: flex;
			flex-direction: column;
			gap: 6px;
		}
		.chat-input-row {
			display: flex;
			gap: 6px;
			align-items: flex-end;
		}
		textarea#promptInput {
			flex: 1;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, #444);
			border-radius: 4px;
			padding: 6px 8px;
			font-family: inherit;
			font-size: 12px;
			resize: none;
			min-height: 32px;
			max-height: 110px;
			outline: none;
			line-height: 1.35;
		}
		textarea#promptInput:focus {
			border-color: var(--vscode-focusBorder);
		}
		.send-btn {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			border-radius: 4px;
			padding: 6px 12px;
			font-size: 11px;
			font-weight: 500;
			cursor: pointer;
			height: 32px;
			display: flex;
			align-items: center;
			justify-content: center;
			min-width: 50px;
		}
		.send-btn:hover {
			background: var(--vscode-button-hoverBackground);
		}
		.action-bar {
			display: flex;
			justify-content: space-between;
			align-items: center;
			font-size: 11px;
		}
		.action-group {
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.action-link {
			background: none;
			border: none;
			color: var(--vscode-descriptionForeground);
			cursor: pointer;
			padding: 2px 4px;
			font-size: 11px;
			display: flex;
			align-items: center;
			gap: 3px;
		}
		.action-link:hover {
			color: var(--vscode-foreground);
		}
	</style>
</head>
<body>
	<!-- Top Controls -->
	<div class="top-bar">
		<div class="toolbar-row">
			<div class="model-select-wrapper">
				<select id="modelSelect" class="model-dropdown" onchange="onModelChanged()">
					<option value="">Loading models...</option>
				</select>
			</div>
			<div class="btn-group">
				<button class="icon-btn" title="Add Custom Model (BYOM)" onclick="send('addModel')">[+]</button>
				<button class="icon-btn" title="Sync Ollama Models" onclick="send('syncOllama')">[Sync]</button>
				<button class="icon-btn" title="Compact Context History" onclick="triggerCompaction()">[Compact]</button>
				<button class="icon-btn" title="New Chat Session" onclick="clearChat()">[New]</button>
				<button class="icon-btn" title="Launch Terminal Agent" onclick="send('openTerminal')">[Term]</button>
			</div>
		</div>
		<div class="toolbar-row">
			<div id="ollamaStatus" class="status-indicator">
				<span class="dot dot-offline"></span>
				<span>Checking Ollama...</span>
			</div>
			<div class="status-indicator">
				<span id="turnCounter" class="btn-badge">0 turns</span>
			</div>
		</div>
	</div>

	<!-- Messages Thread -->
	<div id="messagesContainer" class="messages-container">
		<div id="welcomeBox" class="welcome-intro">
			<h4>Pi Coding Assistant</h4>
			<div>Ask questions, attach code, refactor, or run terminal tasks.</div>
			<div class="welcome-buttons">
				<button class="quick-btn" onclick="quickPrompt('Explain the architecture of this project')">
					<span>[Explain]</span> Explain project architecture
				</button>
				<button class="quick-btn" onclick="attachAndPrompt('Audit this file for potential bugs or optimizations')">
					<span>[Audit]</span> Audit current active file
				</button>
				<button class="quick-btn" onclick="send('openTerminal')">
					<span>[Terminal]</span> Open Pi interactive terminal
				</button>
			</div>
		</div>
	</div>

	<!-- Input Area -->
	<div class="input-section">
		<div id="contextPillRow" class="context-pill-container" style="display:none;"></div>
		<div class="action-bar">
			<div class="action-group">
				<button class="action-link" title="Attach active editor file or selection" onclick="requestEditorContext()">
					+ Attach Active Code
				</button>
				<button class="action-link" title="Compact history into dense memory" onclick="triggerCompaction()">
					Compact Context
				</button>
			</div>
			<span id="turnIndicator" style="color: var(--vscode-descriptionForeground); font-size:10px;">Ready</span>
		</div>
		<div class="chat-input-row">
			<textarea
				id="promptInput"
				rows="1"
				placeholder="Ask Pi a question... (Enter to send, Shift+Enter for newline)"
				onkeydown="onInputKeydown(event)"
				oninput="autoResize(this)"
			></textarea>
			<button id="sendBtn" class="send-btn" onclick="submitMessage()">Send</button>
		</div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();
		let conversationHistory = [];
		let currentAssistantContent = '';
		let currentAssistantRow = null;
		let isGenerating = false;
		let attachedContext = null;

		window.addEventListener('load', () => {
			vscode.postMessage({ command: 'ready' });
		});

		window.addEventListener('message', event => {
			const msg = event.data;
			switch (msg.type) {
				case 'updateModels':
					renderModelDropdown(msg.models, msg.activeModelId);
					updateOllamaIndicator(msg.isOllamaOnline, msg.models);
					break;
				case 'editorContext':
					setAttachedContext(msg);
					break;
				case 'streamStart':
					isGenerating = true;
					updateSendButton(true);
					document.getElementById('turnIndicator').textContent = 'Thinking with ' + (msg.modelName || 'Pi') + '...';
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
				case 'compactionStart':
					document.getElementById('turnIndicator').textContent = 'Compacting context...';
					break;
				case 'compactionDone':
					document.getElementById('turnIndicator').textContent = 'Ready';
					applyCompactedHistory(msg.summary, msg.savedCount);
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
			const select = document.getElementById('modelSelect');
			select.innerHTML = '';
			if (!models || models.length === 0) {
				const opt = document.createElement('option');
				opt.value = '';
				opt.textContent = 'No models found (click [+] or [Sync])';
				select.appendChild(opt);
				return;
			}
			models.forEach(m => {
				const opt = document.createElement('option');
				opt.value = m.id;
				const providerTag = m.provider === 'ollama' ? '[Ollama] ' : '[BYOM] ';
				opt.textContent = providerTag + m.name;
				if (m.id === activeId) opt.selected = true;
				select.appendChild(opt);
			});
		}

		function updateOllamaIndicator(isOnline, models) {
			const el = document.getElementById('ollamaStatus');
			const count = (models || []).filter(m => m.provider === 'ollama').length;
			if (isOnline) {
				el.innerHTML = '<span class="dot dot-online"></span><span>Ollama (' + count + ' models)</span>';
			} else {
				el.innerHTML = '<span class="dot dot-offline"></span><span>Ollama Offline</span>';
			}
		}

		function onModelChanged() {
			const select = document.getElementById('modelSelect');
			const modelId = select.value;
			if (modelId) {
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
			textarea.style.height = Math.min(textarea.scrollHeight, 110) + 'px';
		}

		function requestEditorContext() {
			send('getEditorContext');
		}

		function setAttachedContext(ctx) {
			attachedContext = ctx;
			const row = document.getElementById('contextPillRow');
			row.innerHTML = '';
			if (!ctx) {
				row.style.display = 'none';
				return;
			}
			row.style.display = 'flex';
			const pill = document.createElement('div');
			pill.className = 'context-pill';
			const label = ctx.selectedText
				? ctx.fileName + ' (lines ' + ctx.startLine + '-' + ctx.endLine + ')'
				: ctx.fileName;
			pill.innerHTML = '<span>[File] ' + escapeHtml(label) + '</span>' +
				'<span class="context-pill-remove" onclick="removeAttachedContext()">x</span>';
			row.appendChild(pill);
		}

		function removeAttachedContext() {
			attachedContext = null;
			setAttachedContext(null);
		}

		function submitMessage() {
			if (isGenerating) {
				send('stopGeneration');
				return;
			}
			const input = document.getElementById('promptInput');
			let rawText = input.value.trim();
			if (!rawText && !attachedContext) return;

			if (rawText === '/compact') {
				input.value = '';
				triggerCompaction();
				return;
			}
			if (rawText === '/clear') {
				input.value = '';
				clearChat();
				return;
			}

			let fullPrompt = rawText;
			let displayUserText = rawText;

			if (attachedContext) {
				const codeSnippet = attachedContext.selectedText || attachedContext.fullText || '';
				const fileInfo = attachedContext.fileName +
					(attachedContext.selectedText ? ' (lines ' + attachedContext.startLine + '-' + attachedContext.endLine + ')' : '');
				const contextPrefix = 'Context from \`' + fileInfo + '\`:\\n\`\`\`\\n' + codeSnippet + '\\n\`\`\`\\n\\n';
				fullPrompt = contextPrefix + (rawText || 'Please review or explain this code.');
				displayUserText = (rawText ? rawText + '\\n' : '') + '[Attached: ' + fileInfo + ']';
				removeAttachedContext();
			}

			input.value = '';
			input.style.height = '32px';

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

		function quickPrompt(text) {
			document.getElementById('promptInput').value = text;
			submitMessage();
		}

		function attachAndPrompt(promptText) {
			send('getEditorContext');
			setTimeout(() => {
				document.getElementById('promptInput').value = promptText;
				submitMessage();
			}, 300);
		}

		function triggerCompaction() {
			if (conversationHistory.length === 0) {
				return;
			}
			send('compact', { history: conversationHistory });
		}

		function applyCompactedHistory(summary, savedCount) {
			conversationHistory = [{
				id: Date.now().toString(),
				role: 'compaction',
				content: summary,
				timestamp: Date.now()
			}];
			updateTurnCount();

			const container = document.getElementById('messagesContainer');
			container.innerHTML = '';

			const row = document.createElement('div');
			row.className = 'message-row';
			row.innerHTML = '<div class="bubble bubble-compaction">' +
				'<div class="compaction-title"><span>[Context Compacted]</span><span>' + savedCount + ' turns summarized</span></div>' +
				'<div>' + escapeHtml(summary) + '</div>' +
				'</div>';
			container.appendChild(row);
			scrollToBottom();
		}

		function clearChat() {
			conversationHistory = [];
			updateTurnCount();
			const container = document.getElementById('messagesContainer');
			container.innerHTML = '<div id="welcomeBox" class="welcome-intro">' +
				'<h4>Pi Coding Assistant</h4>' +
				'<div>New conversation started. Ask a question or launch a task.</div>' +
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
			const row = document.createElement('div');
			row.className = 'message-row';

			const header = document.createElement('div');
			header.className = 'message-header';
			header.textContent = role === 'user' ? 'You' : 'Pi';
			row.appendChild(header);

			const bubble = document.createElement('div');
			bubble.className = 'bubble bubble-assistant';
			row.appendChild(bubble);

			container.appendChild(row);
			scrollToBottom();
			return bubble;
		}

		function createUserBubble(text) {
			const container = document.getElementById('messagesContainer');
			const row = document.createElement('div');
			row.className = 'message-row';

			const header = document.createElement('div');
			header.className = 'message-header';
			header.textContent = 'You';
			row.appendChild(header);

			const bubble = document.createElement('div');
			bubble.className = 'bubble bubble-user';
			bubble.textContent = text;
			row.appendChild(bubble);

			container.appendChild(row);
			scrollToBottom();
		}

		function renderAssistantBody(bubbleElement, rawMarkdown) {
			bubbleElement.innerHTML = renderMarkdown(rawMarkdown);
		}

		function renderMarkdown(md) {
			if (!md) return '';
			let escaped = escapeHtml(md);

			// Code blocks
			const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
			escaped = escaped.replace(codeBlockRegex, (match, lang, code) => {
				const language = lang || 'code';
				const cleanCode = code.replace(/\n$/, '');
				return '<div class="code-block">' +
					'<div class="code-block-header">' +
					'<span>' + language + '</span>' +
					'<div class="code-block-actions">' +
					'<button class="code-action-btn" onclick="copyCodeBlock(this)">Copy</button>' +
					'<button class="code-action-btn" onclick="insertCodeBlock(this)">Insert</button>' +
					'</div>' +
					'</div>' +
					'<pre><code class="code-content">' + cleanCode + '</code></pre>' +
					'</div>';
			});

			// Inline code
			escaped = escaped.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');

			// Bold
			escaped = escaped.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');

			// Newlines to <br> for remaining normal text
			escaped = escaped.replace(/\n/g, '<br>');

			return escaped;
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
			const row = document.createElement('div');
			row.className = 'message-row';
			row.innerHTML = '<div class="bubble" style="background:#5a1d1d; color:#ffb4b4; font-size:11px;">[Error] ' + escapeHtml(message) + '</div>';
			container.appendChild(row);
			scrollToBottom();
		}

		function updateSendButton(generating) {
			const btn = document.getElementById('sendBtn');
			if (generating) {
				btn.textContent = 'Stop';
				btn.style.background = '#f85149';
			} else {
				btn.textContent = 'Send';
				btn.style.background = 'var(--vscode-button-background)';
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
