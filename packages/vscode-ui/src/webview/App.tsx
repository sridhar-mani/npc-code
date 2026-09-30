import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ModelEntry, ChatMessage, AttachedContext, WebviewIncomingMessage } from './types';
import { getVsCodeApi } from './vscode';
import { ModelSelector } from './components/ModelSelector';
import { MessageList } from './components/MessageList';
import { Composer } from './components/Composer';

interface WebviewPersistedState {
	messages?: ChatMessage[];
	attachedContexts?: AttachedContext[];
}

export const App: React.FC = () => {
	const vscode = getVsCodeApi();
	const savedState = (vscode.getState() as WebviewPersistedState) || {};

	const [models, setModels] = useState<ModelEntry[]>([]);
	const [activeModelId, setActiveModelId] = useState<string>('');
	const [isOllamaOnline, setIsOllamaOnline] = useState<boolean>(false);

	const [messages, setMessages] = useState<ChatMessage[]>(savedState.messages || []);
	const [attachedContexts, setAttachedContexts] = useState<AttachedContext[]>(savedState.attachedContexts || []);
	const [prompt, setPrompt] = useState<string>('');

	const [isGenerating, setIsGenerating] = useState<boolean>(false);
	const [turnIndicator, setTurnIndicator] = useState<string>('Ready');
	const [streamingThinking, setStreamingThinking] = useState<string>('');
	const [streamingContent, setStreamingContent] = useState<string>('');
	const [, setActiveStreamId] = useState<string | null>(null);

	const latestStreamRef = useRef<{ thinking: string; content: string }>({ thinking: '', content: '' });

	// Persist chat state across tab switches and window reloads
	useEffect(() => {
		vscode.setState({ messages, attachedContexts });
	}, [messages, attachedContexts, vscode]);

	// Handle incoming messages from VS Code
	useEffect(() => {
		const handleMessage = (event: MessageEvent<WebviewIncomingMessage>) => {
			const msg = event.data;
			if (!msg || !msg.type) return;

			switch (msg.type) {
				case 'updateModels':
					setModels(msg.models || []);
					if (msg.activeModelId) setActiveModelId(msg.activeModelId);
					setIsOllamaOnline(Boolean(msg.isOllamaOnline));
					break;

				case 'streamStart':
					setIsGenerating(true);
					setActiveStreamId(msg.streamId || String(Date.now()));
					setTurnIndicator('Thinking…');
					latestStreamRef.current = { thinking: '', content: '' };
					setStreamingThinking('');
					setStreamingContent('');
					break;

				case 'streamThinkingStart':
					setTurnIndicator('Thinking…');
					break;

				case 'streamThinkingDelta': {
					const delta = msg.text || '';
					latestStreamRef.current.thinking += delta;
					setStreamingThinking(latestStreamRef.current.thinking);
					setTurnIndicator('Thinking…');
					break;
				}

				case 'streamThinkingEnd':
					if (msg.text) {
						if (msg.text.length >= latestStreamRef.current.thinking.length) {
							latestStreamRef.current.thinking = msg.text;
						}
						setStreamingThinking(latestStreamRef.current.thinking);
					}
					setTurnIndicator('Generating…');
					break;

				case 'streamDelta': {
					const delta = msg.text || '';
					latestStreamRef.current.content += delta;
					setStreamingContent(latestStreamRef.current.content);
					setTurnIndicator('Generating…');
					break;
				}

				case 'streamSnapshot':
					if (typeof msg.thinking === 'string' && msg.thinking.length >= latestStreamRef.current.thinking.length) {
						latestStreamRef.current.thinking = msg.thinking;
						setStreamingThinking(msg.thinking);
					}
					if (typeof msg.text === 'string' && msg.text.length >= latestStreamRef.current.content.length) {
						latestStreamRef.current.content = msg.text;
						setStreamingContent(msg.text);
					}
					break;

				case 'assistantFinal':
					if (typeof msg.thinking === 'string') {
						latestStreamRef.current.thinking = msg.thinking;
						setStreamingThinking(msg.thinking);
					}
					if (typeof msg.text === 'string') {
						latestStreamRef.current.content = msg.text;
						setStreamingContent(msg.text);
					}
					break;

				case 'streamEnd': {
					setIsGenerating(false);
					setTurnIndicator('Ready');
					const finalContent = typeof msg.text === 'string' ? msg.text : latestStreamRef.current.content;
					const finalThinking = typeof msg.thinking === 'string' ? msg.thinking : latestStreamRef.current.thinking;
					if (finalContent || finalThinking) {
						setMessages((prev) => [
							...prev,
							{
								id: String(Date.now()),
								role: 'assistant',
								content: finalContent,
								thinking: finalThinking,
								timestamp: Date.now(),
							},
						]);
					}
					latestStreamRef.current = { thinking: '', content: '' };
					setStreamingThinking('');
					setStreamingContent('');
					setActiveStreamId(null);
					break;
				}

				case 'generationStopped':
					setIsGenerating(false);
					setTurnIndicator('Ready');
					setActiveStreamId(null);
					break;

				case 'restoreHistory':
					if (Array.isArray(msg.messages) && msg.messages.length > 0) {
						setMessages(msg.messages);
						vscode.setState({ messages: msg.messages, attachedContexts });
					}
					break;

				case 'addContextItem':
					if (msg.item) {
						setAttachedContexts((prev) => {
							const existing = prev.findIndex((c) => c.name === msg.item.name);
							if (existing >= 0) {
								const copy = [...prev];
								copy[existing] = msg.item;
								return copy;
							}
							return [...prev, msg.item];
						});
					}
					break;

				case 'editorContext':
					if (msg.fileName) {
						const ctx: AttachedContext = {
							id: `editor-${Date.now()}`,
							name: `${msg.fileName}${msg.selectedText ? ` (${msg.startLine}-${msg.endLine})` : ''}`,
							path: msg.fileName,
							content: msg.selectedText || msg.fullText || '',
							icon: 'codicon-file-code',
							type: 'file',
						};
						setAttachedContexts((prev) => [...prev, ctx]);
					}
					break;

				case 'compactionStart':
					setTurnIndicator('Compacting…');
					break;

				case 'compactionDone':
					setTurnIndicator('Ready');
					if (msg.summary) {
						setMessages((prev) => [
							...prev,
							{
								id: String(Date.now()),
								role: 'system',
								content: msg.summary || 'Context compacted.',
								timestamp: Date.now(),
							},
						]);
					}
					break;

				case 'error':
					setIsGenerating(false);
					setTurnIndicator('Error');
					setMessages((prev) => [
						...prev,
						{
							id: String(Date.now()),
							role: 'system',
							content: `⚠️ Error: ${msg.message}`,
							timestamp: Date.now(),
						},
					]);
					break;
			}
		};

		window.addEventListener('message', handleMessage);
		// Notify extension host that webview is ready
		vscode.postMessage({ command: 'ready' });

		return () => window.removeEventListener('message', handleMessage);
	}, [streamingThinking, streamingContent]);

	const handleSend = useCallback(() => {
		const rawText = prompt.trim();
		if (!rawText && attachedContexts.length === 0) return;

		let fullPrompt = rawText;
		let displayUserText = rawText;

		if (attachedContexts.length > 0) {
			const contextBlocks = attachedContexts
				.map((c) => `=== Context: ${c.name} (${c.type}) ===\n\`\`\`\n${c.content}\n\`\`\``)
				.join('\n\n');
			const promptInstruction = rawText || 'Please review the attached context and fulfill the user request.';
			fullPrompt = `Provided context:\n\n${contextBlocks}\n\nTask:\n${promptInstruction}`;

			const contextNames = attachedContexts.map((c) => c.name).join(', ');
			displayUserText = `${rawText ? `${rawText}\n` : ''}[Attached: ${contextNames}]`;
		}

		const userTurn: ChatMessage = {
			id: String(Date.now()),
			role: 'user',
			content: displayUserText,
			timestamp: Date.now(),
		};

		const nextHistory = [...messages, userTurn];
		setMessages(nextHistory);
		setPrompt('');
		setAttachedContexts([]);

		vscode.postMessage({
			command: 'sendMessage',
			text: fullPrompt,
			history: nextHistory,
		});
	}, [prompt, attachedContexts, messages]);

	const handleStop = useCallback(() => {
		vscode.postMessage({ command: 'stopGeneration' });
		setIsGenerating(false);
		setTurnIndicator('Ready');
	}, []);

	const handleSelectModel = useCallback((modelId: string) => {
		setActiveModelId(modelId);
		vscode.postMessage({ command: 'switchModel', modelId });
	}, []);

	const handleAddModel = useCallback(() => {
		vscode.postMessage({ command: 'addModel' });
	}, []);

	const handleSyncOllama = useCallback(() => {
		vscode.postMessage({ command: 'syncOllama' });
	}, []);

	const handleClearSession = useCallback(() => {
		vscode.postMessage({ command: 'clearSession' });
		setMessages([]);
		setAttachedContexts([]);
		setStreamingThinking('');
		setStreamingContent('');
		setTurnIndicator('Ready');
		vscode.setState({});
	}, [vscode]);

	const handleQuickCommand = useCallback((cmd: string) => {
		if (cmd === '/compact') {
			vscode.postMessage({ command: 'compact', history: messages });
			return;
		}
		if (cmd === '/terminal') {
			vscode.postMessage({ command: 'openTerminal' });
			return;
		}
		if (cmd === '/clear') {
			handleClearSession();
			return;
		}
		const promptMap: Record<string, string> = {
			'/explain': 'Explain the architecture and main logic of this code in detail.',
			'/fix': 'Diagnose any bugs, syntax errors, or potential runtime issues and provide corrected implementations.',
			'/test': 'Generate comprehensive unit tests covering edge cases, assertions, and mocks for this code.',
			'/docs': 'Generate production-ready documentation, JSDoc/docstrings, and usage examples for this code.',
		};
		if (promptMap[cmd]) {
			if (attachedContexts.length === 0) {
				vscode.postMessage({ command: 'getEditorContext' });
			}
			setPrompt(promptMap[cmd]);
		}
	}, [attachedContexts.length, messages, handleClearSession]);

	return (
		<div className="assistant-shell">
			<header className="assistant-header">
				<div className="brand-row">
					<div className="brand">
						<div className="brand-mark" aria-hidden="true">
							<i className="codicon codicon-sparkle" />
						</div>
						<div className="brand-copy">
							<strong>Ziq</strong>
							<span>AI coding assistant</span>
						</div>
					</div>
					<div className="header-actions">
						<button
							type="button"
							className="icon-button"
							onClick={handleAddModel}
							title="Add custom model"
							aria-label="Add custom model"
						>
							<i className="codicon codicon-add" />
						</button>
						<button
							type="button"
							className="icon-button"
							onClick={handleClearSession}
							title="New session"
							aria-label="New session"
						>
							<i className="codicon codicon-clear-all" />
						</button>
						<button
							type="button"
							className="icon-button"
							onClick={() => vscode.postMessage({ command: 'openSettings' })}
							title="Settings"
							aria-label="Settings"
						>
							<i className="codicon codicon-settings-gear" />
						</button>
					</div>
				</div>

				<ModelSelector
					models={models}
					activeModelId={activeModelId}
					isOllamaOnline={isOllamaOnline}
					onSelectModel={handleSelectModel}
					onAddModel={handleAddModel}
					onSyncOllama={handleSyncOllama}
				/>
			</header>

			<MessageList
				messages={messages}
				streamingThinking={streamingThinking}
				streamingContent={streamingContent}
				isGenerating={isGenerating}
				onSuggestionClick={handleQuickCommand}
				onAttachClick={() => vscode.postMessage({ command: 'attachContextPicker' })}
				onOpenTerminal={() => vscode.postMessage({ command: 'openTerminal' })}
			/>

			<Composer
				prompt={prompt}
				onPromptChange={setPrompt}
				onSend={handleSend}
				onStop={handleStop}
				isGenerating={isGenerating}
				turnIndicator={turnIndicator}
				turnCount={messages.filter((m) => m.role === 'user').length}
				attachedContexts={attachedContexts}
				onRemoveContext={(id) => setAttachedContexts((prev) => prev.filter((c) => c.id !== id))}
				onAttachContext={() => vscode.postMessage({ command: 'attachContextPicker' })}
				onQuickCommand={handleQuickCommand}
			/>
		</div>
	);
};
