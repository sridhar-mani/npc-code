import { defineService, type ReplicatedState } from "@earendil-works/chord";
import type { LaneTranscriptSnapshot, LaneWatchEvent } from "@earendil-works/pi-agent-core";

export interface SessionSummary {
	serverId: string;
	sessionId: string;
	name: string;
	createdAt: number;
}

export interface SessionDirectoryState {
	revision: number;
	sessions: SessionSummary[];
}

export interface SessionDirectory {
	readonly state: ReplicatedState<SessionDirectoryState>;
}

export interface SessionManagement {
	create(options: { id?: string }, context: import("@earendil-works/chord").Context): Promise<SessionSummary>;
	remove(sessionId: string, context: import("@earendil-works/chord").Context): Promise<void>;
	attach(sessionId: string, context: import("@earendil-works/chord").Context): Promise<void>;
	detach(context: import("@earendil-works/chord").Context): Promise<void>;
}

export interface ModelsState {
	catalog: {
		revision: number;
		availableModels: Array<{
			provider: string;
			modelId: string;
			name: string;
			reasoning: boolean;
		}>;
	};
	configuration: {
		model: { provider: string; modelId: string } | null;
		thinkingLevel: string;
	};
	refresh: { status: string };
}

export interface Models {
	readonly state: ReplicatedState<ModelsState>;
	select(modelRef: { provider: string; modelId: string }, context: import("@earendil-works/chord").Context): Promise<void>;
	selectThinking(level: string, context: import("@earendil-works/chord").Context): Promise<void>;
	refresh(context: import("@earendil-works/chord").Context): Promise<void>;
}

export interface AgentPromptImage {
	type: "image";
	data: string;
	mimeType: string;
}

export interface AgentPromptRequest {
	message: string;
	images: AgentPromptImage[] | null;
}

export type AgentError = { code: string; message: string };

export type AgentOperationResponse =
	| { accepted: true; operationId: string; error: null }
	| { accepted: false; operationId: string | null; error: AgentError };

export type AgentQueueResponse =
	| { accepted: true; entryId: string; error: null }
	| { accepted: false; entryId: string | null; error: AgentError };

export interface AgentController {
	prompt(request: AgentPromptRequest, context: import("@earendil-works/chord").Context): Promise<AgentOperationResponse>;
	requestAbort(operationId: string, context: import("@earendil-works/chord").Context): Promise<void>;
	steer(request: AgentPromptRequest, context: import("@earendil-works/chord").Context): Promise<AgentQueueResponse>;
	followUp(request: AgentPromptRequest, context: import("@earendil-works/chord").Context): Promise<AgentQueueResponse>;
	compact(context: import("@earendil-works/chord").Context): Promise<AgentOperationResponse>;
}

export interface TranscriptState {
	snapshot: LaneTranscriptSnapshot | null;
	event: LaneWatchEvent | null;
}

export interface Transcript {
	readonly state: ReplicatedState<TranscriptState>;
}

export const SessionDirectory = defineService<SessionDirectory>("pi.session-directory");
export const SessionManagement = defineService<SessionManagement>("pi.session-management");
export const Models = defineService<Models>("pi.models");
export const AgentController = defineService<AgentController>("pi.agent-controller");
export const Transcript = defineService<Transcript>("pi.transcript");
