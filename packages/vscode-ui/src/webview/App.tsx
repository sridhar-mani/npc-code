import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ModelEntry, ChatMessage, AttachedContext, WebviewIncomingMessage, ToolCallRecord, ThinkingSegment, SubagentRecord, SubagentAction, ChatActivity } from './types';
import { getVsCodeApi } from './vscode';
import { ModelSelector } from './components/ModelSelector';
import { MessageList } from './components/MessageList';
import { Composer } from './components/Composer';

interface WebviewPersistedState {
	messages?: ChatMessage[];
	attachedContexts?: AttachedContext[];
}

async function fileToBase64(file: File): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = '';
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
	}
	return btoa(binary);
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
	const [sessionName, setSessionName] = useState<string>('New Session');
	const [worktree, setWorktree] = useState<{ path: string; branch: string } | undefined>();
	const [editingEntryId, setEditingEntryId] = useState<string | undefined>();
	const [sendMode, setSendMode] = useState<'send' | 'queue' | 'steer'>('send');
	const [queuedMessages, setQueuedMessages] = useState<string[]>([]);

	const [isGenerating, setIsGenerating] = useState<boolean>(false);
	const [turnIndicator, setTurnIndicator] = useState<string>('Ready');
	const [streamingThinkingSegments, setStreamingThinkingSegments] = useState<ThinkingSegment[]>([]);
	const [streamingContent, setStreamingContent] = useState<string>('');
	const [, setActiveStreamId] = useState<string | null>(null);
	const isGeneratingRef = useRef(false);

	const latestStreamRef = useRef<{ content: string }>({ content: '' });
	const thinkingSegmentsRef = useRef<ThinkingSegment[]>([]);
	const thinkingSegmentSequenceRef = useRef(0);
	const activityRef = useRef<ChatActivity[]>([]);
	const [streamingActivity, setStreamingActivity] = useState<ChatActivity[]>([]);
	const skipNextStreamEndRef = useRef(false);
	const liveToolCallsRef = useRef<Map<string, ToolCallRecord>>(new Map());
	const [liveToolCalls, setLiveToolCalls] = useState<ToolCallRecord[]>([]);
	const [subagents, setSubagents] = useState<Record<string, SubagentRecord>>({});

	// Persist chat state across tab switches and window reloads
	useEffect(() => {
		const persistedContexts = attachedContexts
			.filter((context) => context.type !== 'image')
			.map(({ data: _data, ...context }) => context);
		vscode.setState({ messages, attachedContexts: persistedContexts });
	}, [messages, attachedContexts, vscode]);

	// Handle incoming messages from VS Code
	useEffect(() => {
		const handleMessage = (event: MessageEvent<WebviewIncomingMessage>) => {
			const msg = event.data;
			if (!msg || !msg.type) return;

			switch (msg.type) {
				case 'subagentUpdate': {
					const now = Date.now();
					setSubagents((prev) => {
						const current = prev[msg.subagentId];
						const actionId = msg.toolCallId || `${msg.subagentId}-status-${now}`;
						const actions = [...(current?.actions || [])];
						if (msg.toolCallId && msg.toolName) {
							const actionIndex = actions.findIndex((action) => action.id === msg.toolCallId);
							const action: SubagentAction = {
								id: msg.toolCallId,
								kind: 'tool',
								status: msg.toolStatus === 'error' ? 'error' : msg.toolStatus === 'completed' ? 'completed' : 'running',
								text: msg.text,
								toolName: msg.toolName,
								timestamp: now,
							};
							if (actionIndex >= 0) actions[actionIndex] = { ...actions[actionIndex], ...action };
							else actions.push(action);
						} else if (msg.text) {
							actions.push({ id: actionId, kind: 'status', status: 'running', text: msg.text, timestamp: now });
						}
						const record: SubagentRecord = {
							id: msg.subagentId,
							status: msg.status,
							prompt: msg.prompt || current?.prompt,
							text: msg.text || current?.text,
							result: msg.result || current?.result,
							toolName: msg.toolName || current?.toolName,
							actions: actions.slice(-30),
							startedAt: current?.startedAt || now,
							endedAt: msg.status === 'running' ? current?.endedAt : now,
							worktreePath: msg.worktreePath || current?.worktreePath,
						};
						const next = { ...prev, [msg.subagentId]: record };
						const activityIndex = activityRef.current.findIndex((item) => item.kind === 'subagent' && item.agent.id === msg.subagentId);
						const activity: ChatActivity = { id: `subagent-${msg.subagentId}`, kind: 'subagent', agent: record };
						if (activityIndex >= 0) {
							activityRef.current = [...activityRef.current.slice(0, activityIndex), activity, ...activityRef.current.slice(activityIndex + 1)];
						} else {
							activityRef.current = [...activityRef.current, activity];
						}
						setStreamingActivity(activityRef.current);
						return next;
					});
					break;
				}

				case 'queueAccepted':
					setTurnIndicator(msg.mode === 'queue' ? 'Queued' : 'Steering…');
					setSendMode('send');
					break;

				case 'queueUpdate':
					setQueuedMessages([...msg.steering, ...msg.followUp]);
					break;

				case 'updateModels':
					setModels(msg.models || []);
					if (msg.activeModelId) setActiveModelId(msg.activeModelId);
					setIsOllamaOnline(Boolean(msg.isOllamaOnline));
					break;

				case 'streamStart':
					isGeneratingRef.current = true;
					setIsGenerating(true);
					setActiveStreamId(msg.streamId || String(Date.now()));
					setTurnIndicator('Thinking…');
					latestStreamRef.current = { content: '' };
					thinkingSegmentsRef.current = [];
					thinkingSegmentSequenceRef.current = 0;
					activityRef.current = [];
					setStreamingActivity([]);
					setStreamingThinkingSegments([]);
					liveToolCallsRef.current = new Map();
					setLiveToolCalls([]);
					setStreamingThinkingSegments([]);
					setStreamingContent('');
					break;

				case 'streamThinkingStart':
					if (thinkingSegmentsRef.current.at(-1)?.status !== 'streaming') {
						const segment: ThinkingSegment = {
							id: `thinking-${++thinkingSegmentSequenceRef.current}`,
							text: '',
							status: 'streaming',
						};
						thinkingSegmentsRef.current = [...thinkingSegmentsRef.current, segment];
						activityRef.current = [...activityRef.current.filter((item) => !(item.kind === 'thinking' && item.thinking.id === segment.id)), { id: segment.id, kind: 'thinking', thinking: segment }];
						setStreamingThinkingSegments(thinkingSegmentsRef.current);
						setStreamingActivity(activityRef.current);
					}
					setTurnIndicator('Thinking…');
					break;

				case 'streamThinkingDelta': {
					const delta = msg.text || '';
					if (!delta) break;
					let segments = thinkingSegmentsRef.current;
					if (segments.at(-1)?.status !== 'streaming') {
						segments = [...segments, {
							id: `thinking-${++thinkingSegmentSequenceRef.current}`,
							text: '',
							status: 'streaming',
						}];
					}
					const last = segments.at(-1)!;
					const updated = { ...last, text: last.text + delta };
					thinkingSegmentsRef.current = [...segments.slice(0, -1), updated];
					const activityIndex = activityRef.current.findIndex((item) => item.kind === 'thinking' && item.thinking.id === updated.id);
					const thinkingActivity: ChatActivity = { id: updated.id, kind: 'thinking', thinking: updated };
					activityRef.current = activityIndex >= 0
						? [...activityRef.current.slice(0, activityIndex), thinkingActivity, ...activityRef.current.slice(activityIndex + 1)]
						: [...activityRef.current, thinkingActivity];
					setStreamingThinkingSegments(thinkingSegmentsRef.current);
					setStreamingActivity(activityRef.current);
					setTurnIndicator('Thinking…');
					break;
				}

				case 'streamThinkingEnd':
					thinkingSegmentsRef.current = thinkingSegmentsRef.current.map((segment, index) =>
						index === thinkingSegmentsRef.current.length - 1
							? { ...segment, status: 'complete' as const }
							: segment,
					);
					activityRef.current = activityRef.current.map((item) =>
						item.kind === 'thinking' && item.thinking.id === thinkingSegmentsRef.current.at(-1)?.id
							? { ...item, thinking: { ...item.thinking, status: 'complete' as const } }
							: item
					);
					setStreamingThinkingSegments(thinkingSegmentsRef.current);
					setStreamingActivity(activityRef.current);
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
					// Legacy snapshots are intentionally ignored. Streaming deltas are the source of truth;
					// this prevents repeatedly sending/rendering the entire accumulated transcript.
					if (typeof msg.text === 'string' && msg.text.length >= latestStreamRef.current.content.length) {
						latestStreamRef.current.content = msg.text;
						setStreamingContent(msg.text);
					}
					break;

				case 'assistantFinal':
					if (typeof msg.text === 'string') {
						latestStreamRef.current.content = msg.text;
						setStreamingContent(msg.text);
					}
					break;

				case 'streamEnd': {
					isGeneratingRef.current = false;
					setIsGenerating(false);
					if (skipNextStreamEndRef.current) {
						skipNextStreamEndRef.current = false;
						latestStreamRef.current = { content: '' };
						thinkingSegmentsRef.current = [];
						setStreamingThinkingSegments([]);
						liveToolCallsRef.current = new Map();
						setLiveToolCalls([]);
						setStreamingThinkingSegments([]);
						setStreamingContent('');
						setActiveStreamId(null);
						break;
					}
					setTurnIndicator('Ready');
					const finalContent = typeof msg.text === 'string' ? msg.text : latestStreamRef.current.content;
					const finalThinkingSegments = thinkingSegmentsRef.current.map((segment) => ({
						...segment,
						status: 'complete' as const,
						text: segment.text.length > 4000 ? `…${segment.text.slice(-4000)}` : segment.text,
					}));
					const toolCalls = liveToolCallsRef.current.size > 0
						? Array.from(liveToolCallsRef.current.values())
						: undefined;
					const finalActivity = activityRef.current.map((item) => {
						if (item.kind === 'thinking') return { ...item, thinking: { ...item.thinking, status: 'complete' as const, text: item.thinking.text.length > 4000 ? `…${item.thinking.text.slice(-4000)}` : item.thinking.text } };
						return item;
					});
					if (finalContent || finalThinkingSegments.length > 0 || toolCalls?.length) {
						setMessages((prev) => [
							...prev,
							{
								id: String(Date.now()),
								role: 'assistant',
								content: finalContent,
								thinkingSegments: finalThinkingSegments,
								activity: finalActivity,
								toolCalls,
							timestamp: Date.now(),
							},
						]);
					}
					latestStreamRef.current = { content: '' };
					liveToolCallsRef.current = new Map();
					setLiveToolCalls([]);
					setStreamingThinkingSegments([]);
					activityRef.current = [];
					setStreamingActivity([]);
					setStreamingContent('');
					setActiveStreamId(null);
					break;
				}

				case 'generationStopped':
					isGeneratingRef.current = false;
					setIsGenerating(false);
					setTurnIndicator('Ready');
					setActiveStreamId(null);
					break;

				case 'sessionInfo':
					setSessionName(msg.name || 'New Session');
					setWorktree(msg.worktree);
					break;

				case 'restoreHistory':
					if (Array.isArray(msg.messages) && msg.messages.length > 0) {
						if (isGeneratingRef.current) skipNextStreamEndRef.current = true;
						setMessages(msg.messages);
						vscode.setState({ messages: msg.messages, attachedContexts });
						setEditingEntryId(undefined);
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
					isGeneratingRef.current = false;
					setIsGenerating(false);
					setTurnIndicator('Error');
					setMessages((prev) => [
						...prev,
						{
							id: String(Date.now()),
							role: 'system',
							content: `Error: ${msg.message}`,
							timestamp: Date.now(),
						},
					]);
					break;

				case 'toolExecutionStart': {
					thinkingSegmentsRef.current = thinkingSegmentsRef.current.map((segment) => ({ ...segment, status: 'complete' as const }));
					activityRef.current = activityRef.current.map((item) =>
						item.kind === 'thinking' ? { ...item, thinking: { ...item.thinking, status: 'complete' as const } } : item
					);
					if (msg.toolName === 'run_subagent' || msg.toolName === 'run_subagents') {
						setStreamingThinkingSegments(thinkingSegmentsRef.current);
						setStreamingActivity(activityRef.current);
						setTurnIndicator('Delegating…');
						break;
					}
					const record: ToolCallRecord = {
						id: msg.toolCallId,
						name: msg.toolName,
						args: msg.args,
						status: 'running',
					};
					liveToolCallsRef.current.set(msg.toolCallId, record);
					activityRef.current = [...activityRef.current, { id: msg.toolCallId, kind: 'tool', tool: record }];
					setLiveToolCalls(Array.from(liveToolCallsRef.current.values()));
					setStreamingActivity(activityRef.current);
					setTurnIndicator(`Running ${msg.toolName}…`);
					break;
				}

				case 'toolExecutionEnd': {
					if (msg.toolName === 'run_subagent' || msg.toolName === 'run_subagents') {
						setTurnIndicator('Generating…');
						break;
					}
					const existing = liveToolCallsRef.current.get(msg.toolCallId);
					const updated: ToolCallRecord = {
						id: msg.toolCallId,
						name: msg.toolName,
						args: existing?.args,
						status: msg.isError ? 'error' : 'completed',
						result: msg.result,
						isError: msg.isError,
					};
					liveToolCallsRef.current.set(msg.toolCallId, updated);
					activityRef.current = activityRef.current.map((item) =>
						item.kind === 'tool' && item.tool.id === msg.toolCallId ? { ...item, tool: updated } : item
					);
					setLiveToolCalls(Array.from(liveToolCallsRef.current.values()));
					setStreamingActivity(activityRef.current);
					setTurnIndicator('Generating…');
					break;
				}
			}
		};

		window.addEventListener('message', handleMessage);
		// Notify extension host that webview is ready
		vscode.postMessage({ command: 'ready' });

		return () => window.removeEventListener('message', handleMessage);
	}, []);

	const handleSend = useCallback(() => {
		const rawText = prompt.trim();
		if (!rawText && attachedContexts.length === 0) return;

		const nativeFiles = attachedContexts
			.filter((context) => context.nativeAttachment && context.type === 'file' && context.path)
			.map((context) => ({ kind: 'file' as const, path: context.path!, name: context.name }));
		const nativeImages = attachedContexts
			.filter((context) => context.nativeAttachment && context.type === 'image' && context.data && context.mimeType)
			.map((context) => ({ kind: 'image' as const, data: context.data!, mimeType: context.mimeType!, name: context.name }));
		const inlineContexts = attachedContexts.filter((context) => !context.nativeAttachment || context.type === 'text');

		let fullPrompt = rawText;
		if (inlineContexts.length > 0) {
			const contextBlocks = inlineContexts
				.map((context) => `=== Context: ${context.name} (${context.type}) ===\n\`\`\`\n${context.content}\n\`\`\``)
				.join('\n\n');
			const promptInstruction = rawText || 'Please review the attached context and fulfill the user request.';
			fullPrompt = `Provided context:\n\n${contextBlocks}\n\nTask:\n${promptInstruction}`;
		} else if (!fullPrompt && (nativeFiles.length > 0 || nativeImages.length > 0)) {
			fullPrompt = 'Please review the attached files/images and fulfill the user request.';
		}

		const userTurn: ChatMessage = {
			id: String(Date.now()),
			entryId: editingEntryId,
			role: 'user',
			content: [
				rawText,
				...nativeFiles.map((attachment) => `[Attached file: ${attachment.name}]`),
				...nativeImages.map((attachment) => `[Attached image: ${attachment.name}]`),
				...inlineContexts.map((context) => `[Attached: ${context.name}]`),
			].filter(Boolean).join('\n') || 'Attached context',
			timestamp: Date.now(),
		};

		const editedIndex = editingEntryId ? messages.findIndex((item) => item.entryId === editingEntryId) : -1;
		const nextHistory = editedIndex >= 0
			? [...messages.slice(0, editedIndex), userTurn]
			: [...messages, userTurn];
		setMessages(nextHistory);
		setPrompt('');
		setAttachedContexts([]);
		setEditingEntryId(undefined);

		vscode.postMessage({
			command: 'sendMessage',
			text: fullPrompt,
			history: nextHistory,
			attachments: [...nativeFiles, ...nativeImages],
			editEntryId: editingEntryId,
			mode: editingEntryId ? 'send' : sendMode,
		});
	}, [prompt, attachedContexts, messages, vscode, editingEntryId, sendMode]);

	const handleDropFiles = useCallback(async (files: FileList | File[]) => {
		for (const file of Array.from(files).slice(0, 5)) {
			try {
				if (file.type.startsWith('image/')) {
					const data = await fileToBase64(file);
					setAttachedContexts((prev) => [...prev, {
						id: `image-${Date.now()}-${Math.random()}`,
						name: file.name || 'Pasted image',
						content: '',
						data,
						mimeType: file.type,
						icon: 'codicon-file-media',
						type: 'image',
						nativeAttachment: true,
					}]);
				} else if (file.size <= 300_000) {
					const content = await file.text();
					setAttachedContexts((prev) => [...prev, {
						id: `drop-${Date.now()}-${Math.random()}`,
						name: file.name || 'Dropped file',
						content,
						icon: 'codicon-file',
						type: 'text',
					}]);
				} else {
					setMessages((prev) => [...prev, {
						id: String(Date.now()),
						role: 'system',
						content: `Skipped ${file.name}: dropped text files are limited to 300 KB.`,
						timestamp: Date.now(),
					}]);
				}
			} catch (error) {
				setMessages((prev) => [...prev, {
					id: String(Date.now()),
					role: 'system',
					content: `Could not attach ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
					timestamp: Date.now(),
				}]);
			}
		}
	}, []);

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

	const handleEditMessage = useCallback((message: ChatMessage) => {
		setEditingEntryId(message.entryId);
		setPrompt(message.content);
		setSendMode('send');
	}, []);

	const handleNewSession = useCallback(() => {
		vscode.postMessage({ command: 'newSession' });
		setMessages([]);
		setAttachedContexts([]);
		setStreamingThinkingSegments([]);
		activityRef.current = [];
		setStreamingActivity([]);
		setStreamingContent('');
		setTurnIndicator('Ready');
		setSessionName('New Session');
		setWorktree(undefined);
		setSubagents({});
		setEditingEntryId(undefined);
		setSendMode('send');
		vscode.setState({});
	}, [vscode]);

	const handleClearSession = handleNewSession;


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
							<small className="session-name">{sessionName}</small>
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
							title="Start a new session"
							aria-label="Start a new session"
						>
							<i className="codicon codicon-new-file" />
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

			{worktree && (
				<div className="worktree-banner" role="status">
					<div className="worktree-copy">
						<strong>Isolated worktree</strong>
						<span>{worktree.branch}</span>
					</div>
					<div className="worktree-actions">
						<button type="button" onClick={() => vscode.postMessage({ command: 'mergeWorktree' })}>Merge</button>
						<button type="button" onClick={() => vscode.postMessage({ command: 'discardWorktree' })}>Discard</button>
					</div>
				</div>
			)}

			
			<MessageList
				messages={messages}
				onEditMessage={handleEditMessage}
				streamingThinkingSegments={streamingThinkingSegments}
				streamingActivity={streamingActivity}
				streamingContent={streamingContent}
				isGenerating={isGenerating}
				liveToolCalls={liveToolCalls}
				liveSubagents={Object.values(subagents)}
				onSuggestionClick={handleQuickCommand}
				onAttachClick={() => vscode.postMessage({ command: 'attachContextPicker' })}
				onOpenTerminal={() => vscode.postMessage({ command: 'openTerminal' })}
			/>

			{queuedMessages.length > 0 && (
				<div className="queue-strip" role="status">
					<strong>{queuedMessages.length} queued</strong>
					{queuedMessages.slice(0, 3).map((item, index) => (
						<span key={index} className="queue-item">{item}</span>
					))}
				</div>
			)}
			<Composer
				prompt={prompt}
				sendMode={sendMode}
				onSendModeChange={setSendMode}
				onCreateSkill={() => vscode.postMessage({ command: 'createSkill' })}
				onPromptChange={setPrompt}
				onSend={handleSend}
				onStop={handleStop}
				isGenerating={isGenerating}
				turnIndicator={turnIndicator}
				turnCount={messages.filter((m) => m.role === 'user').length}
				attachedContexts={attachedContexts}
				onRemoveContext={(id) => setAttachedContexts((prev) => prev.filter((c) => c.id !== id))}
				onAttachContext={() => vscode.postMessage({ command: 'attachContextPicker' })}
				onDropFiles={handleDropFiles}
				onQuickCommand={handleQuickCommand}
			/>
		</div>
	);
};
