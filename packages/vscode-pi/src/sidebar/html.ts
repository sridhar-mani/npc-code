export function getSidebarHtml(cssContent: string, cspSource: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
	<title>Pi Assistant</title>
	<style>
		${cssContent}
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
				<button class="icon-btn" title="Add Custom Model (BYOM)" onclick="send('addCustomModel')">[+]</button>
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
			vscode.postMessage({ type: 'ready' });
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

		function send(type, extra = {}) {
			vscode.postMessage({ type, ...extra });
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
				const providerTag = m.providerId === 'ollama' ? '[Ollama] ' : '[BYOM] ';
				opt.textContent = providerTag + m.name;
				if (m.id === activeId) opt.selected = true;
				select.appendChild(opt);
			});
		}

		function updateOllamaIndicator(isOnline, models) {
			const el = document.getElementById('ollamaStatus');
			const count = (models || []).filter(m => m.providerId === 'ollama').length;
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
			const codeBlockRegex = /\`\`\`([-a-zA-Z0-9_]*)\n([\s\S]*?)\`\`\`/g;
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
			escaped = escaped.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

			// Bold
			escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

			// Newlines to <br>
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
