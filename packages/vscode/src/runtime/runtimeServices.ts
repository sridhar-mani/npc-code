import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";
import type { LaneTranscriptSnapshot, LaneWatchEvent } from "@earendil-works/pi-agent-core";

export interface SessionSummary {
	serverId: string;
	sessionId: string;
	name: string;
	createdAt: number;
	path?: string;
}

export interface SessionDirectoryState {
	revision: number;
	sessions: SessionSummary[];
}

export interface SessionDirectory {
	readonly state: ReplicatedState<SessionDirectoryState>;
}

export interface SessionManagement {
	create(options: { id?: string }, context: Context): Promise<SessionSummary>;
	list(
		context: Context,
	): Promise<
		Array<{ path: string; id: string; name: string; createdAt: number; modifiedAt: number; firstMessage: string }>
	>;
	switch(sessionPath: string, context: Context): Promise<SessionSummary>;
	fork(sessionPath: string | null, name: string | null, context: Context): Promise<SessionSummary>;
	rename(sessionPath: string, name: string, context: Context): Promise<SessionSummary>;
	remove(sessionId: string, context: Context): Promise<void>;
	attach(sessionId: string, context: Context): Promise<void>;
	detach(context: Context): Promise<void>;
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
	select(
		modelRef: { provider: string; modelId: string },
		context: import("@earendil-works/chord").Context,
	): Promise<void>;
	selectThinking(level: string, context: import("@earendil-works/chord").Context): Promise<void>;
	refresh(context: import("@earendil-works/chord").Context): Promise<void>;
}

export interface AgentPromptImage {
	type: "image";
	data: string;
	mimeType: string;
}

export type PromptAttachment =
	| { kind: "file"; path: string; name: string }
	| { kind: "image"; data: string; mimeType: string; name: string };

export interface AgentPromptRequest {
	message: string;
	attachments?: PromptAttachment[];
}

export type AgentError = { code: string; message: string };

export type AgentOperationResponse =
	| { accepted: true; operationId: string; error: null }
	| { accepted: false; operationId: string | null; error: AgentError };

export type AgentQueueResponse =
	| { accepted: true; entryId: string; error: null }
	| { accepted: false; entryId: string | null; error: AgentError };

export interface PresentationPlugins {
	prepareSession(
		sessionId: string,
		context: import("@earendil-works/chord").Context,
	): Promise<{ presentationFacetBundles: unknown[] }>;
	reload(context: import("@earendil-works/chord").Context): Promise<{ presentationFacetBundles: unknown[] }>;
}

export interface AgentController {
	editMessage(
		request: { entryId: string; message: string },
		context: import("@earendil-works/chord").Context,
	): Promise<AgentOperationResponse>;
	prompt(
		request: AgentPromptRequest,
		context: import("@earendil-works/chord").Context,
	): Promise<AgentOperationResponse>;
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

export const PresentationPlugins = defineService<PresentationPlugins>("pi.presentation-plugins");
