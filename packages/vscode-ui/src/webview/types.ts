export interface ModelEntry {
	id: string;
	name: string;
	provider: 'ollama' | 'byom' | 'builtin';
	baseUrl?: string;
	details?: string;
}

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	thinking?: string;
	timestamp: number;
}

export interface AttachedContext {
	id: string;
	name: string;
	path?: string;
	content: string;
	icon?: string;
	type: string;
}

export type WebviewIncomingMessage =
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
	| { type: 'addContextItem'; item: AttachedContext }
	| { type: 'editorContext'; fileName: string; selectedText?: string; fullText?: string; startLine?: number; endLine?: number }
	| { type: 'error'; message: string; streamId?: string };
