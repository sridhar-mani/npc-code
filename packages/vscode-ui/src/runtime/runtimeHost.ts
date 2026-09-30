import * as vscode from "vscode";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
	createRemoteServiceEndpoint,
	defineService,
	RemoteServiceProvider,
	replicatedState,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, type AgentMessage, type SessionMetadata } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	ModelRuntime,
	PiAgentBackend,
	SessionManager,
	type AgentSession,
	type ProviderConfigInput,
	type ProviderModelConfig,
} from "@earendil-works/pi-core";
import {
	type RoutedServerPresentation,
	type RoutedServerServiceAttachment,
	type RoutedServerServiceHost,
	type RoutedSessionAttachment,
	type RoutedSessionHandle,
	type ServerHost,
	Server as PiServer,
} from "@earendil-works/pi-server";
import { createUnixServer, getUnixSocketPath } from "@earendil-works/pi-server/unix";
import { PiSettings } from "../config/settings";
import { createVsCodeTools } from "../tools/vscode-tools";

const SERVER_ID_STATE_KEY = "ziq.runtime.serverId";
const SERVER_DIR = process.env.PI_SERVER_DIR || join(homedir(), ".pi", "server");

export interface ZiqRuntimeAttachment {
	readonly sessionId: string;
	subscribe(listener: (event: any) => void): () => void;
	prompt(text: string): Promise<void>;
	steer(text: string): Promise<void>;
	followUp(text: string): Promise<void>;
	abort(): Promise<void>;
	compact(): Promise<void>;
	setModel(modelId: string): Promise<void>;
	dispose(): void;
}

interface CustomModelEntry {
	id: string;
	name?: string;
	label?: string;
	url?: string;
	baseUrl?: string;
	apiKey?: string;
	contextWindow?: number;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	thinking?: boolean;
	reasoning?: boolean;
	temperature?: number;
	top_p?: number;
	headers?: Record<string, string>;
	requestHeaders?: Record<string, string>;
	vision?: boolean;
	api?: string;
	isOllama?: boolean;
}

interface SessionDirectoryEntry {
	serverId: string;
	sessionId: string;
	createdAt: number;
}

interface RuntimeOperation {
	id: string;
	startedAt: number;
	streamingMessage?: AssistantMessage;
	runningTools: Map<string, Record<string, unknown>>;
}

interface SessionServices {
	transcriptState: ReturnType<typeof replicatedState<any>>;
	modelsState: ReturnType<typeof replicatedState<any>>;
}

const SessionDirectory = defineService<any>("pi.session-directory");
const SessionManagement = defineService<any>("pi.session-management");
const PresentationPlugins = defineService<any>("pi.presentation-plugins");
const Models = defineService<any>("pi.models");
const AgentController = defineService<any>("pi.agent-controller");
const Transcript = defineService<any>("pi.transcript");

function normalizeEndpointUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	try {
		const parsed = new URL(trimmed);
		let pathname = parsed.pathname;
		while (pathname.endsWith("/")) pathname = pathname.slice(0, -1);
		return parsed.origin + pathname;
	} catch {
		return trimmed.replace(/\/+$/, "");
	}
}

function isLocalEndpoint(value: string): boolean {
	try {
		const hostname = new URL(value).hostname.toLowerCase();
		return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0" || hostname.endsWith(".local");
	} catch {
		return false;
	}
}

function readCustomModels(): CustomModelEntry[] {
	const values = vscode.workspace.getConfiguration("pi").get<CustomModelEntry[]>("customModels") ?? [];
	const seen = new Set<string>();
	return values.filter((item) => {
		if (!item?.id || seen.has(item.id)) return false;
		seen.add(item.id);
		return true;
	});
}

function convertCustomModels(models: readonly CustomModelEntry[]): Record<string, ProviderConfigInput> {
	const providers: Record<string, ProviderConfigInput> = {};
	for (const entry of models) {
		const providerId = "custom-" + entry.id;
		const isLocal = Boolean(entry.isOllama || (entry.baseUrl && isLocalEndpoint(entry.baseUrl)));
		const baseUrl = normalizeEndpointUrl(entry.baseUrl || entry.url || "http://127.0.0.1:11434/v1");
		const reasoning = Boolean(entry.thinking || entry.reasoning);
		const modelConfig: ProviderModelConfig = {
			type: "chat",
			id: entry.id,
			name: entry.name || entry.label || entry.id,
			api: (entry.api || "openai-completions") as any,
			baseUrl,
			reasoning,
			contextWindow: entry.contextWindow || entry.maxInputTokens || 128000,
			maxTokens: entry.maxOutputTokens || 16384,
			input: entry.vision ? ["text", "image"] : ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			headers: entry.headers || entry.requestHeaders,
			compat: isLocal
				? {
						supportsStore: false,
						supportsDeveloperRole: false,
						supportsReasoningEffort: false,
						maxTokensField: "max_tokens",
					}
				: undefined,
			samplingParams:
				entry.temperature !== undefined || entry.top_p !== undefined
					? {
							...(entry.temperature !== undefined ? { temperature: entry.temperature } : {}),
							...(entry.top_p !== undefined ? { top_p: entry.top_p } : {}),
						}
					: undefined,
		};
		providers[providerId] = {
			name: entry.label || entry.name || entry.id,
			baseUrl,
			apiKey: entry.apiKey || (isLocal ? "ollama" : ""),
			api: (entry.api || "openai-completions") as any,
			models: [modelConfig],
			headers: entry.headers || entry.requestHeaders,
		};
	}
	return providers;
}

export class ZiqRuntimeHost {
	readonly backend: PiAgentBackend;
	readonly serverId: string;
	readonly socketPath: string;

	private readonly cwd: string;
	private readonly modelRuntime: ModelRuntime;

	private server?: PiServer;
	private session?: AgentSession;
	private sessionCreatedAt = 0;
	private sessionServices?: SessionServices;
	private directoryState?: ReturnType<typeof replicatedState<any>>;
	private sessionUnsubscribe?: () => void;
	private currentOperation?: RuntimeOperation;
	private queuedMessages: Array<{ entryId: string; kind: "steer" | "followUp"; message: AgentMessage }> = [];
	private mutationTail = Promise.resolve();

	constructor(cwd: string, modelRuntime: ModelRuntime, backend: PiAgentBackend, serverId: string) {
		this.cwd = cwd;
		this.modelRuntime = modelRuntime;
		this.backend = backend;
		this.serverId = serverId;
		this.socketPath = getUnixSocketPath(serverId, SERVER_DIR);
	}

	async start(): Promise<void> {
		await mkdir(SERVER_DIR, { recursive: true, mode: 0o700 });

		const host: ServerHost<SessionMetadata> = {
			serverServices: this.createServerServices(),
			resolveSession: async (sessionId) => {
				const current = this.session;
				if (!current || current.sessionId !== sessionId) {
					throw new Error("Unknown Ziq Session: " + sessionId);
				}
				return {
					id: current.sessionId,
					createdAt: this.sessionCreatedAt,
					storageVersion: 1,
					cwd: this.cwd,
				};
			},
			openSession: async () => this.openRoutedSession(),
		};

		this.server = createUnixServer(host, {
			serverId: this.serverId,
			path: this.socketPath,
		});
		await this.server.start();
	}

	async stop(): Promise<void> {
		if (this.server) {
			await this.server.close();
			this.server = undefined;
		}
		this.sessionUnsubscribe?.();
		this.sessionUnsubscribe = undefined;
		if (this.session) {
			await this.backend.destroySession(this.session.sessionId);
			this.session = undefined;
		}
	}

	async reloadModels(): Promise<void> {
		for (const [providerId, provider] of Object.entries(convertCustomModels(readCustomModels()))) {
			await this.backend.registerCustomProvider(providerId, provider);
		}
		this.refreshModelsState();
	}

	async ensureSession(requestedModelId?: string, forceNew = false, requestedSessionId?: string): Promise<AgentSession> {
		return this.serialize(async () => {
			if (this.session && !forceNew) return this.session;

			if (this.session) {
				this.sessionUnsubscribe?.();
				this.sessionUnsubscribe = undefined;
				await this.backend.destroySession(this.session.sessionId);
				this.session = undefined;
				this.sessionServices = undefined;
			}

			const models = this.modelRuntime.getModels();
			const configured = PiSettings.activeModel;
			const target =
				models.find((model) => model.id === requestedModelId || (model.provider + "/" + model.id) === requestedModelId) ||
				models.find((model) => model.id === configured || (model.provider + "/" + model.id) === configured) ||
				models[0];

			const sessionManager = forceNew
				? SessionManager.create(this.cwd, undefined, requestedSessionId ? { id: requestedSessionId } : undefined)
				: SessionManager.continueRecent(this.cwd);
			const resumed = !forceNew && sessionManager.buildSessionContext().messages.length > 0;

			const created = await this.backend.createSession({
				cwd: this.cwd,
				sessionManager,
				model: resumed ? undefined : target,
				customTools: createVsCodeTools(),
				enableAttributionHeaders: true,
			});

			this.session = created.session;
			this.sessionCreatedAt = Date.now();
			this.bindSession(this.session);
			this.refreshDirectoryState();
			return this.session;
		});
	}

	async createNewSession(id?: string): Promise<SessionDirectoryEntry> {
		await this.ensureSession(undefined, true, id);
		return this.describeSession();
	}

	async removeSession(): Promise<void> {
		await this.serialize(async () => {
			if (!this.session) return;
			this.sessionUnsubscribe?.();
			this.sessionUnsubscribe = undefined;
			await this.backend.destroySession(this.session.sessionId);
			this.session = undefined;
			this.sessionServices = undefined;
			this.currentOperation = undefined;
			this.queuedMessages = [];
			this.refreshDirectoryState();
		});
	}

	async attachLocal(): Promise<ZiqRuntimeAttachment> {
		const session = await this.ensureSession();
		return {
			sessionId: session.sessionId,
			subscribe: (listener) => session.subscribe(listener),
			prompt: (text) => this.prompt(text),
			steer: (text) => this.steer(text),
			followUp: (text) => this.followUp(text),
			abort: () => this.abort(),
			compact: () => this.compact(),
			setModel: (modelId) => this.setModel(modelId),
			dispose: () => {},
		};
	}

	describeSession(): SessionDirectoryEntry {
		if (!this.session) throw new Error("No live Ziq Session");
		return {
			serverId: this.serverId,
			sessionId: this.session.sessionId,
			createdAt: this.sessionCreatedAt,
		};
	}

	private async startPrompt(text: string): Promise<{ operationId: string; run: Promise<void> }> {
		const session = await this.ensureSession();
		if (this.currentOperation) {
			await this.steer(text);
			return { operationId: this.currentOperation.id, run: Promise.resolve() };
		}

		const operationId = randomUUID();
		this.currentOperation = {
			id: operationId,
			startedAt: Date.now(),
			runningTools: new Map(),
		};
		this.emitRuntimeSnapshot();

		const run = session.prompt(text).catch((error) => {
			this.finishOperation(operationId, "failed", error);
			throw error;
		});
		return { operationId, run };
	}

	private async prompt(text: string): Promise<void> {
		const { run } = await this.startPrompt(text);
		await run;
	}

	private async steer(text: string): Promise<void> {
		const session = await this.ensureSession();
		const entryId = "queue-" + randomUUID();
		this.queuedMessages.push({
			entryId,
			kind: "steer",
			message: { role: "user", content: text, timestamp: Date.now() } as AgentMessage,
		});
		this.emitRuntimeSnapshot();
		await session.steer(text);
	}

	private async followUp(text: string): Promise<void> {
		const session = await this.ensureSession();
		const entryId = "queue-" + randomUUID();
		this.queuedMessages.push({
			entryId,
			kind: "followUp",
			message: { role: "user", content: text, timestamp: Date.now() } as AgentMessage,
		});
		this.emitRuntimeSnapshot();
		await session.followUp(text);
	}

	private async abort(): Promise<void> {
		await this.session?.abort();
	}

	private async compact(): Promise<void> {
		const session = await this.ensureSession();
		await session.compact();
		this.emitRuntimeSnapshot();
	}

	private async setModel(modelId: string): Promise<void> {
		const session = await this.ensureSession();
		const model = this.modelRuntime.getModels().find((candidate) => candidate.id === modelId || (candidate.provider + "/" + candidate.id) === modelId);
		if (!model) throw new Error("Unknown model: " + modelId);
		await session.setModel(model);
		this.refreshModelsState();
		this.emitRuntimeSnapshot();
	}

	private bindSession(session: AgentSession): void {
		this.sessionUnsubscribe = session.subscribe((event: any) => {
			switch (event.type) {
				case "message_start": {
					const messageText = this.messageText(event.message);
					this.queuedMessages = this.queuedMessages.filter((item) => this.messageText(item.message) !== messageText);
					this.emitRuntimeSnapshot();
					break;
				}
				case "message_update":
					if (event.message?.role === "assistant" && this.currentOperation) {
						this.currentOperation.streamingMessage = event.message;
						this.emitRuntimeEvent(this.toLaneWatchEvent(event));
						this.emitRuntimeSnapshot();
					}
					break;
				case "tool_execution_start":
					if (this.currentOperation) {
						this.currentOperation.runningTools.set(event.toolCallId, {
							toolName: event.toolName,
							toolCallId: event.toolCallId,
							args: event.args,
							status: "running",
						});
						this.emitRuntimeEvent(this.toLaneWatchEvent(event));
						this.emitRuntimeSnapshot();
					}
					break;
				case "tool_execution_end":
					if (this.currentOperation) {
						this.currentOperation.runningTools.delete(event.toolCallId);
						this.emitRuntimeEvent(this.toLaneWatchEvent(event));
						this.emitRuntimeSnapshot();
					}
					break;
				case "message_end":
				case "entry_appended":
				case "compaction_start":
				case "compaction_end":
					this.emitRuntimeEvent(undefined);
					this.emitRuntimeSnapshot();
					break;
				case "agent_end":
					if (!event.willRetry && this.currentOperation) {
						this.finishOperation(this.currentOperation.id, "completed");
					}
					break;
				default:
					this.emitRuntimeSnapshot();
			}
		});

		this.refreshModelsState();
		this.emitRuntimeSnapshot();
	}

	private finishOperation(operationId: string, status: "completed" | "failed", error?: unknown): void {
		if (!this.currentOperation || this.currentOperation.id !== operationId) return;
		this.currentOperation = undefined;
		this.emitRuntimeSnapshot();
		this.emitRuntimeEvent({
			type: "run_end",
			runId: operationId,
			fromTipId: null,
			tipId: null,
			endedAt: Date.now(),
			...(status === "failed"
				? {
						status: "failed",
						error: {
							code: "operation_failed",
							message: error instanceof Error ? error.message : String(error),
						},
					}
				: { status: "completed" }),
		});
	}

	private toLaneWatchEvent(event: any): any {
		if (event?.type === "message_update") {
			const frame =
				event.assistantMessageEvent?.type === "text_delta"
					? { type: "text_delta", contentIndex: 0, delta: event.assistantMessageEvent.delta }
					: undefined;
			return {
				type: "message_update",
				runId: this.currentOperation?.id || randomUUID(),
				message: event.message,
				...(frame ? { frame } : {}),
			};
		}
		if (event?.type === "tool_execution_start") {
			return {
				type: "tool_start",
				runId: this.currentOperation?.id || randomUUID(),
				turnId: this.currentOperation?.id || randomUUID(),
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
			};
		}
		if (event?.type === "tool_execution_end") {
			return {
				type: "tool_end",
				runId: this.currentOperation?.id || randomUUID(),
				turnId: this.currentOperation?.id || randomUUID(),
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: event.result,
				isError: event.isError,
				terminate: true,
			};
		}
		return undefined;
	}

	private emitRuntimeEvent(event: any): void {
		if (!event || !this.sessionServices) return;
		this.sessionServices.transcriptState.change(BACKGROUND_CONTEXT, (draft: any) => {
			draft.event = event;
		});
	}

	private emitRuntimeSnapshot(): void {
		if (!this.session || !this.sessionServices) return;
		this.sessionServices.transcriptState.change(BACKGROUND_CONTEXT, (draft: any) => {
			draft.snapshot = this.buildLaneSnapshot();
		});
	}

	private buildLaneSnapshot(): any {
		const session = this.session!;
		const projection = session.sessionManager.buildSessionProjection();
		const stats = session.getSessionStats();
		const model = session.model;
		const runningTools = this.currentOperation ? [...this.currentOperation.runningTools.values()] : [];
		const tipId = projection.entries.at(-1)?.id ?? null;
		return {
			lane: "main",
			transcript: projection.entries,
			tipId,
			configuration: {
				model: model ? { provider: model.provider, modelId: model.id } : { provider: "", modelId: "" },
				thinkingLevel: session.thinkingLevel,
				activeToolNames: session.getActiveToolNames(),
			},
			stats,
			operation: this.currentOperation
				? {
						id: this.currentOperation.id,
						kind: "run",
						startedAt: this.currentOperation.startedAt,
						fromTipId: tipId,
						status: "running",
						...(this.currentOperation.streamingMessage ? { streamingMessage: this.currentOperation.streamingMessage } : {}),
						runningTools,
					}
				: null,
			queues: this.queuedMessages.map((item) => ({
				entryId: item.entryId,
				kind: item.kind,
				type: "message",
				message: item.message,
			})),
			faulted: false,
		};
	}

	private refreshModelsState(): void {
		if (!this.sessionServices) return;
		const selected = this.session?.model;
		const available = this.modelRuntime.getAvailableSnapshot();
		const catalog = (available.length > 0 ? available : this.modelRuntime.getModels()).map((model: any) => ({
			provider: model.provider,
			modelId: model.id,
			name: model.name,
			reasoning: Boolean(model.reasoning),
		}));
		this.sessionServices.modelsState.change(BACKGROUND_CONTEXT, (draft: any) => {
			draft.catalog = { revision: (draft.catalog?.revision || 0) + 1, availableModels: catalog };
			draft.configuration = {
				model: selected ? { provider: selected.provider, modelId: selected.id } : null,
				thinkingLevel: this.session?.thinkingLevel || "off",
			};
			draft.refresh = { status: "idle" };
		});
	}

	private createServerServices(): RoutedServerServiceHost {
		this.directoryState = replicatedState<any>({ revision: 1, sessions: [] });
		this.refreshDirectoryState();

		return {
			attachClient: (presentation: RoutedServerPresentation) => {
				const provider = new RemoteServiceProvider([
					{ service: SessionDirectory, mode: "singleton" },
					{ service: SessionManagement, mode: "singleton" },
					{ service: PresentationPlugins, mode: "singleton" },
				]);
				provider.provide(SessionDirectory, { state: this.directoryState });
				provider.provide(SessionManagement, {
					create: async (options: { id?: string }) => {
						await this.createNewSession(options?.id);
						return this.describeSession();
					},
					remove: async () => {
						const sessionId = this.session?.sessionId;
						if (sessionId) await presentation.prepareSessionRemoval(sessionId, BACKGROUND_CONTEXT);
						await this.removeSession();
					},
					attach: async (sessionId: string) => presentation.attachSession(sessionId, BACKGROUND_CONTEXT),
					detach: async () => presentation.detachSession(BACKGROUND_CONTEXT),
				});
				provider.provide(PresentationPlugins, {
					prepareSession: async () => ({ presentationFacetBundles: [] }),
					reload: async () => ({ presentationFacetBundles: [] }),
				});
				return this.providerAttachment(provider);
			},
		};
	}

	private async openRoutedSession(): Promise<RoutedSessionHandle> {
		await this.ensureSession();
		return {
			attachClient: async () => {
				if (!this.session) throw new Error("No live Session");
				this.sessionServices = this.sessionServices || {
					transcriptState: replicatedState<any>({ snapshot: this.buildLaneSnapshot(), event: null }),
					modelsState: replicatedState<any>({
						catalog: { revision: 0, availableModels: [] },
						configuration: { model: null, thinkingLevel: "off" },
						refresh: { status: "idle" },
					}),
				};
				this.refreshModelsState();
				this.emitRuntimeSnapshot();

				const provider = new RemoteServiceProvider([
					{ service: Models, mode: "singleton" },
					{ service: AgentController, mode: "singleton" },
					{ service: Transcript, mode: "singleton" },
				]);
				provider.provide(Models, this.modelsService());
				provider.provide(Transcript, { state: this.sessionServices.transcriptState });
				provider.provide(AgentController, this.agentService());
				return this.providerAttachment(provider);
			},
			close: async () => {},
		};
	}

	private modelsService(): any {
		return {
			state: this.sessionServices!.modelsState,
			cycleThinking: async () => {},
			getThinkingLevels: async () => ["off", "minimal", "low", "medium", "high"],
			refresh: async () => this.refreshModelsState(),
			select: async (modelRef: { provider: string; modelId: string }) => {
				const model = this.modelRuntime.getModel(modelRef.provider, modelRef.modelId);
				if (!model) throw new Error("Unknown model: " + modelRef.provider + "/" + modelRef.modelId);
				await this.ensureSession();
				await this.session!.setModel(model);
				this.refreshModelsState();
				this.emitRuntimeSnapshot();
			},
			selectThinking: async (level: string) => {
				this.session?.setThinkingLevel(level as any);
				this.refreshModelsState();
				this.emitRuntimeSnapshot();
			},
		};
	}

	private agentService(): any {
		return {
			prompt: async (request: { message: string }) => {
				const result = await this.startPrompt(request.message);
				return { accepted: true, operationId: result.operationId, error: null };
			},
			requestAbort: async (operationId: string) => {
				if (this.currentOperation?.id === operationId) await this.abort();
			},
			steer: async (request: { message: string }) => {
				const entryId = "queue-" + randomUUID();
				await this.steer(request.message);
				return { accepted: true, entryId, error: null };
			},
			followUp: async (request: { message: string }) => {
				const entryId = "queue-" + randomUUID();
				await this.followUp(request.message);
				return { accepted: true, entryId, error: null };
			},
			nextRun: async (request: { message: string }) => {
				const entryId = "queue-" + randomUUID();
				await this.followUp(request.message);
				return { accepted: true, entryId, error: null };
			},
			cancelQueued: async (entryId: string) => {
				const index = this.queuedMessages.findIndex((item) => item.entryId === entryId);
				if (index < 0) return { outcome: "not_found" };
				this.queuedMessages.splice(index, 1);
				this.emitRuntimeSnapshot();
				return { outcome: "cancelled" };
			},
			resume: async () => ({
				accepted: false,
				operationId: null,
				error: { code: "unsupported", message: "Resume is not exposed by the VS Code AgentSession adapter." },
			}),
			compact: async () => {
				await this.compact();
				return { accepted: true, operationId: randomUUID(), error: null };
			},
			navigate: async () => ({
				accepted: false,
				operationId: null,
				error: { code: "unsupported", message: "Navigation is not exposed by the VS Code AgentSession adapter." },
			}),
		};
	}

	private providerAttachment(provider: RemoteServiceProvider): RoutedServerServiceAttachment & RoutedSessionAttachment {
		const endpoint = createRemoteServiceEndpoint(provider);
		let released = false;
		return {
			invokeService(call, publish, context) {
				if (released) return Promise.reject(new Error("Service attachment is released"));
				return endpoint.invoke(call, publish, context);
			},
			release() {
				if (released) return;
				released = true;
				endpoint.dispose();
				provider.dispose();
			},
		};
	}

	private messageText(message: AgentMessage): string {
		if (typeof message.content === "string") return message.content;
		return message.content
			.filter((block: any) => block?.type === "text")
			.map((block: any) => block.text || "")
			.join("");
	}

	private refreshDirectoryState(): void {
		if (!this.directoryState) return;
		this.directoryState.replace(BACKGROUND_CONTEXT, {
			revision: Date.now(),
			sessions: this.session ? [this.describeSession()] : [],
		});
	}

	private async serialize<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.mutationTail.catch(() => {}).then(operation);
		this.mutationTail = next.then(() => undefined, () => undefined);
		return next;
	}
}

let runtimeHostPromise: Promise<ZiqRuntimeHost> | undefined;

export async function startZiqRuntimeHost(context: vscode.ExtensionContext, cwd = process.cwd()): Promise<ZiqRuntimeHost> {
	if (runtimeHostPromise) return runtimeHostPromise;
	runtimeHostPromise = (async () => {
		const modelRuntime = await ModelRuntime.create({
			customProviders: convertCustomModels(readCustomModels()),
		});
		const providers = convertCustomModels(readCustomModels());
		const backend = new PiAgentBackend({
			modelRuntime,
			defaultCwd: cwd,
			customProviders: providers,
			enableAttributionHeaders: true,
		});
		let serverId = context.globalState.get<string>(SERVER_ID_STATE_KEY);
		if (!serverId) {
			serverId = randomUUID();
			await context.globalState.update(SERVER_ID_STATE_KEY, serverId);
		}
		const host = new ZiqRuntimeHost(cwd, modelRuntime, backend, serverId);
		await host.start();
		return host;
	})().catch((error) => {
		runtimeHostPromise = undefined;
		throw error;
	});
	return runtimeHostPromise;
}

export async function getZiqRuntimeHost(): Promise<ZiqRuntimeHost> {
	if (!runtimeHostPromise) throw new Error("Ziq runtime host has not been started");
	return runtimeHostPromise;
}
