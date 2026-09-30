export function getWebviewClientScript(): string {
	return `
		const vscode = acquireVsCodeApi();
		window.vscode = vscode;

		function send(command, extra = {}) {
			vscode.postMessage({ command, ...extra });
		}
		window.send = send;

		let conversationHistory = [];
		let currentAssistantContent = '';
		let currentAssistantThinking = '';
		let currentAssistantThinkingBlock = null;
		let currentAssistantThinkingBody = null;
		let currentAssistantRow = null;
		let currentStreamId = null;
		let isGenerating = false;
		let attachedContexts = [];
		let currentActiveModelId = '';

		// Listen to messages from extension host
		window.addEventListener('message', event => {
			const msg = event.data;
			switch (msg.type) {
				case 'updateModels':
					renderModelDropdown(msg.models, msg.activeModelId);
					updateOllamaIndicator(msg.isOllamaOnline, msg.models, msg.activeModelName);
					break;
				case 'restoreHistory':
					if (Array.isArray(msg.messages)) {
						conversationHistory = msg.messages;
						renderConversationHistory(conversationHistory);
						updateTurnCount();
					}
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
					currentStreamId = msg.streamId || String(Date.now());
					updateSendButton(true);
					setTurnIndicator('Thinking...');
					currentAssistantContent = '';
					currentAssistantThinking = '';
					currentAssistantThinkingBlock = null;
					currentAssistantThinkingBody = null;
					currentAssistantRow = createMessageContainer('assistant');
					break;
				case 'streamThinkingStart':
					if (msg.streamId !== currentStreamId) break;
					if (currentAssistantRow) {
						const block = createThinkingBlock(currentAssistantRow);
						currentAssistantThinkingBlock = block.details;
						currentAssistantThinkingBody = block.body;
					}
					break;
				case 'streamThinkingDelta':
					if (msg.streamId !== currentStreamId) break;
					if (currentAssistantThinkingBody && typeof msg.text === 'string') {
						currentAssistantThinking += msg.text;
						currentAssistantThinkingBody.innerHTML = renderMarkdown(currentAssistantThinking);
						setTurnIndicator('Thinking...');
						scrollToBottom();
					}
					break;
				case 'streamThinkingEnd':
					if (msg.streamId !== currentStreamId) break;
					if (typeof msg.text === 'string' && msg.text.length > 0 && currentAssistantThinking.length === 0 && currentAssistantThinkingBody) {
						currentAssistantThinking = msg.text;
						currentAssistantThinkingBody.innerHTML = renderMarkdown(currentAssistantThinking);
					}
					if (currentAssistantThinkingBlock) currentAssistantThinkingBlock.open = false;
					setTurnIndicator('Generating...');
					break;
				case 'streamDelta':
					if (msg.streamId !== currentStreamId) break;
					if (currentAssistantRow) {
						currentAssistantContent += msg.text;
						renderAssistantBody(currentAssistantRow, currentAssistantContent);
						scrollToBottom();
					}
					break;
				case 'streamEnd':
					if (msg.streamId !== currentStreamId) break;
					isGenerating = false;
					updateSendButton(false);
					setTurnIndicator('Ready');
					if (currentAssistantRow) {
						const thinkingNode = currentAssistantRow.parentElement?.querySelector('.thinking-block');
						const hasVisibleResponse = Boolean(currentAssistantContent || currentAssistantThinking || thinkingNode);
						if (currentAssistantContent) {
							conversationHistory.push({
								id: Date.now().toString(),
								role: 'assistant',
								content: currentAssistantContent,
								timestamp: Date.now()
							});
							updateTurnCount();
						}
						if (!hasVisibleResponse) {
							currentAssistantRow.parentElement?.remove();
						}
						currentAssistantRow = null;
						currentAssistantContent = '';
						currentAssistantThinking = '';
						currentAssistantThinkingBlock = null;
						currentAssistantThinkingBody = null;
					}
					currentStreamId = null;
					break;
				case 'generationStopped':
					if (msg.streamId && msg.streamId !== currentStreamId) break;
					isGenerating = false;
					updateSendButton(false);
					setTurnIndicator('Ready');
					currentStreamId = null;
					currentAssistantRow = null;
					currentAssistantContent = '';
					currentAssistantThinking = '';
					currentAssistantThinkingBlock = null;
					currentAssistantThinkingBody = null;
					break;
				case 'error':
					if (msg.streamId && msg.streamId !== currentStreamId) break;
					isGenerating = false;
					updateSendButton(false);
					setTurnIndicator('Error');
					appendErrorBubble(msg.message);
					currentStreamId = null;
					currentAssistantRow = null;
					currentAssistantThinkingBlock = null;
					currentAssistantThinkingBody = null;
					break;
			}
		});

		function setTurnIndicator(text) {
			const el = document.getElementById('turnIndicator');
			if (el) el.textContent = text;
		}

		function renderModelDropdown(models, activeId) {
			currentActiveModelId = activeId || '';
			const select = document.getElementById('modelSelect');
			if (!select) return;
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
			if (!el) return;
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
			if (!select) return;
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

		function autoResize(textarea) {
			if (!textarea) return;
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
				pill.innerHTML = '<i class="codicon ' + iconClass + '"></i><span>' + escapeHtml(item.name) + '</span>';
				const removeBtn = document.createElement('span');
				removeBtn.className = 'context-pill-remove';
				removeBtn.textContent = '\u00D7';
				removeBtn.addEventListener('click', () => removeContextItem(item.id));
				pill.appendChild(removeBtn);
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
			const promptMap = {
				'/explain': 'Explain the architecture and main logic of this code in detail.',
				'/audit': 'Audit this code for security vulnerabilities, edge cases, performance, and best practices.',
				'/fix': 'Diagnose any bugs, syntax errors, or potential runtime issues and provide corrected implementations.',
				'/test': 'Generate comprehensive unit tests covering edge cases, assertions, and mocks for this code.',
				'/tests': 'Generate comprehensive unit tests covering edge cases, assertions, and mocks for this code.',
				'/docs': 'Generate production-ready documentation, JSDoc/docstrings, and usage examples for this code.',
			};
			if (promptMap[cmd]) {
				if (attachedContexts.length === 0) send('getEditorContext');
				setTimeout(() => {
					const input = document.getElementById('promptInput');
					if (input) {
						input.value = promptMap[cmd];
						submitMessage();
					}
				}, 280);
			}
		}

		function submitMessage() {
			if (isGenerating) {
				send('stopGeneration');
				return;
			}
			const input = document.getElementById('promptInput');
			if (!input) return;
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
			send('clearSession');
			conversationHistory = [];
			attachedContexts = [];
			renderContextPills();
			updateTurnCount();
			const container = document.getElementById('messagesContainer');
			if (!container) return;
			container.innerHTML = '<div id="welcomeBox" class="welcome-container">' +
				'<div class="welcome-icon-wrapper"><i class="codicon codicon-copilot"></i></div>' +
				'<h3 class="welcome-title">Ziq Assistant</h3>' +
				'<p class="welcome-desc">New session started. Ask a question or pick an action.</p>' +
				'</div>';
		}

		function updateTurnCount() {
			const el = document.getElementById('turnCounter');
			if (el) {
				el.textContent = conversationHistory.length + ' turns';
			}
		}

		function renderConversationHistory(messages) {
			const container = document.getElementById('messagesContainer');
			if (!container) return;
			container.innerHTML = '';
			messages.forEach(message => {
				if (message.role === 'user') {
					createUserBubble(message.content);
				} else if (message.role === 'assistant') {
					const bubble = createMessageContainer('assistant');
					renderAssistantBody(bubble, message.content);
				}
			});
		}

		function createMessageContainer(role) {
			const container = document.getElementById('messagesContainer');
			const card = document.createElement('div');
			card.className = 'message-card';

			const header = document.createElement('div');
			header.className = 'message-card-header';
			header.innerHTML = '<i class="codicon codicon-sparkle author-icon"></i><span>Ziq</span>';
			card.appendChild(header);

			const bubble = document.createElement('div');
			bubble.className = 'bubble bubble-assistant';
			card.appendChild(bubble);

			container?.appendChild(card);
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

			container?.appendChild(card);
			scrollToBottom();
		}

		function createThinkingBlock(bubbleElement) {
			const existing = bubbleElement.parentElement?.querySelector('.thinking-block');
			if (existing) {
				const body = existing.querySelector('.thinking-content');
				return { details: existing, body };
			}
			const details = document.createElement('details');
			details.className = 'thinking-block';
			details.open = true;
			const summary = document.createElement('summary');
			summary.innerHTML = '<i class="codicon codicon-sparkle"></i><span>Thinking</span>';
			details.appendChild(summary);
			const body = document.createElement('div');
			body.className = 'thinking-content';
			details.appendChild(body);
			bubbleElement.parentElement?.insertBefore(details, bubbleElement);
			return { details, body };
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
					? '<button class="code-action-btn" data-action="run"><i class="codicon codicon-terminal"></i> Run</button>'
					: '';

				return '<div class="code-block">' +
					'<div class="code-block-header">' +
					'<span>' + language + '</span>' +
					'<div class="code-block-actions">' +
					runBtn +
					'<button class="code-action-btn" data-action="copy"><i class="codicon codicon-copy"></i> Copy</button>' +
					'<button class="code-action-btn" data-action="insert"><i class="codicon codicon-insert"></i> Insert</button>' +
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

		function appendErrorBubble(message) {
			const container = document.getElementById('messagesContainer');
			if (!container) return;
			const card = document.createElement('div');
			card.className = 'message-card';
			card.innerHTML = '<div class="bubble" style="background: rgba(215, 58, 73, 0.15); border: 1px solid rgba(215, 58, 73, 0.4); color: #f85149; font-size:11px;">' +
				'<i class="codicon codicon-error" style="margin-right: 4px;"></i>' + escapeHtml(message) + '</div>';
			container.appendChild(card);
			scrollToBottom();
		}

		function updateSendButton(generating) {
			const btn = document.getElementById('sendBtn');
			if (!btn) return;
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
			if (container) {
				container.scrollTop = container.scrollHeight;
			}
		}

		function escapeHtml(text) {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
		}

		// Initialize DOM Event Listeners Immediately
		function initWebview() {
			// Model dropdown change
			document.getElementById('modelSelect')?.addEventListener('change', onModelChanged);

			// Toolbar buttons
			document.getElementById('addModelBtn')?.addEventListener('click', (e) => {
				e.preventDefault();
				send('addModel');
			});
			document.getElementById('syncOllamaBtn')?.addEventListener('click', (e) => {
				e.preventDefault();
				send('syncOllama');
			});
			document.getElementById('clearBtn')?.addEventListener('click', (e) => {
				e.preventDefault();
				clearChat();
			});
			document.getElementById('terminalBtn')?.addEventListener('click', (e) => {
				e.preventDefault();
				send('openTerminal');
			});
			document.getElementById('settingsBtn')?.addEventListener('click', (e) => {
				e.preventDefault();
				send('openSettings');
			});

			// Input box: Enter key & resize
			const promptInput = document.getElementById('promptInput');
			if (promptInput) {
				promptInput.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						submitMessage();
					}
				});
				promptInput.addEventListener('input', () => {
					autoResize(promptInput);
				});
			}

			// Send button
			document.getElementById('sendBtn')?.addEventListener('click', (e) => {
				e.preventDefault();
				submitMessage();
			});

			// Attach button
			document.getElementById('attachBtn')?.addEventListener('click', (e) => {
				e.preventDefault();
				send('attachContextPicker');
			});

			// Action chips in input footer
			document.querySelectorAll('.command-chip[data-command], .action-chip[data-command]').forEach(chip => {
				chip.addEventListener('click', (e) => {
					e.preventDefault();
					const cmd = chip.getAttribute('data-command');
					if (cmd) runCommand(cmd);
				});
			});

			// Welcome cards
			document.querySelectorAll('.suggestion-card[data-command], .feature-card[data-command]').forEach(card => {
				card.addEventListener('click', (e) => {
					e.preventDefault();
					const cmd = card.getAttribute('data-command');
					if (cmd) runCommand(cmd);
				});
			});
			document.querySelectorAll('.suggestion-card[data-action], .feature-card[data-action]').forEach(card => {
				card.addEventListener('click', (e) => {
					e.preventDefault();
					const action = card.getAttribute('data-action');
					if (action) send(action);
				});
			});

			// Delegated click handler on messagesContainer for code blocks (Run, Copy, Insert)
			document.getElementById('messagesContainer')?.addEventListener('click', (e) => {
				const target = e.target;
				const btn = target.closest?.('.code-action-btn');
				if (!btn) return;
				const action = btn.getAttribute('data-action');
				const codeBlock = btn.closest('.code-block');
				const codeEl = codeBlock?.querySelector('.code-content');
				if (!codeEl) return;
				const text = codeEl.innerText || codeEl.textContent || '';

				if (action === 'run') {
					send('runInTerminal', { code: text.trim() });
				} else if (action === 'copy') {
					send('copyCode', { code: text });
				} else if (action === 'insert') {
					send('insertCode', { code: text });
				}
			});

			// Notify extension host that webview is ready to receive model updates
			send('ready');
		}

		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', initWebview);
		} else {
			initWebview();
		}
	`;
}
