export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'compaction';
	content: string;
	timestamp: number;
}
