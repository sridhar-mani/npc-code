export interface ModelEntry {
	id: string;
	name: string;
	provider: string;
	baseUrl?: string;
	details?: string;
	reasoning?: boolean;
}

export interface ToolCallRecord {
	/** Unique tool call ID from the backend */
	id: string;
	name: string;
	status: 'running' | 'completed' | 'error';
	args?: Record<string, unknown> | string;
	/** Full or preview result text, only present when status !== 'running' */
	result?: string;
	isError?: boolean;
}

export interface ChatMessage {
	id: string;
	entryId?: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	thinking?: string;
	timestamp: number;
	/** Tool calls that were made during this assistant turn */
	toolCalls?: ToolCallRecord[];
}

export type AttachedContextKind = "file" | "image" | "text";

export interface AttachedContext {
	id: string;
	name: string;
	path?: string;
	content: string;
	icon?: string;
	type: AttachedContextKind;
	mimeType?: string;
	data?: string;
	nativeAttachment?: boolean;
}

export type WebviewIncomingMessage =
	| { type: 'queueAccepted'; mode: 'queue' | 'steer' }
	| { type: 'queueUpdate'; steering: string[]; followUp: string[] }
	| { type: 'updateModels'; models: ModelEntry[]; activeModelId?: string; activeModelName?: string; isOllamaOnline?: boolean }
	| { type: 'streamStart'; streamId?: string; modelName?: string }
	| { type: 'streamThinkingStart'; streamId?: string }
	| { type: 'streamThinkingDelta'; streamId?: string; text: string }
	| { type: 'streamThinkingEnd'; streamId?: string; text?: string }
	| { type: 'streamDelta'; streamId?: string; text: string }
	| { type: 'streamSnapshot'; streamId?: string; thinking?: string; text?: string }
	| { type: 'assistantFinal'; streamId?: string; thinking?: string; text?: string }
	| { type: 'streamEnd'; streamId?: string; thinking?: string; text?: string; thinkingDeltaCount?: number; textDeltaCount?: number }
	| { type: 'generationStopped'; streamId?: string }
	| { type: 'compactionStart'; streamId?: string }
	| { type: 'compactionDone'; streamId?: string; summary?: string }
	| { type: 'restoreHistory'; messages: ChatMessage[] }
	| { type: 'sessionInfo'; sessionId: string; name: string; worktree?: { path: string; branch: string } }
	| { type: 'addContextItem'; item: AttachedContext }
	| { type: 'editorContext'; fileName: string; selectedText?: string; fullText?: string; startLine?: number; endLine?: number }
	| { type: 'error'; message: string; streamId?: string }
	| { type: 'toolExecutionStart'; streamId?: string; toolCallId: string; toolName: string; args?: any }
	| { type: 'toolExecutionEnd'; streamId?: string; toolCallId: string; toolName: string; result?: string; isError: boolean };
