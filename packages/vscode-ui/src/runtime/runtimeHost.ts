import * as vscode from "vscode";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRemoteServiceEndpoint, RemoteServiceProvider, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, type AgentMessage, type SessionMetadata } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	DefaultResourceLoader,
	ModelRuntime,
	PiAgentBackend,
	SessionManager,
	SettingsManager,
	getAgentDir,
	type AgentSession,
	type BackendPromptOptions,
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
import {
	WorktreeManager,
	type AgentFeaturesSettings,
	type WorktreeSession,
} from "@earendil-works/pi-core";
import { createRuntimeAgentTools } from "./runtimeAgentTools";
import { WorkspaceCheckpointManager } from "./runtimeEditManager";
import { WorkspaceContext } from "../context/workspace";
import {
	AgentController,
	Models,
	SessionDirectory,
	SessionManagement,
	PresentationPlugins,
	Transcript,
	type SessionDirectoryState,
	type SessionSummary,
} from "./runtimeServices";

const SERVER_ID_STATE_KEY = "ziq.runtime.serverId";
const SERVER_DIR = process.env.PI_SERVER_DIR || join(homedir(), ".pi", "server");

export interface ZiqRuntimeAttachment {
	readonly sessionId: string;
	readonly sessionName: string;
	subscribe(listener: (event: any) => void): () => void;
	prompt(text: string, options?: BackendPromptOptions): Promise<void>;
	steer(text: string): Promise<void>;
	followUp(text: string): Promise<void>;
	editMessage(entryId: string, text: string, options?: BackendPromptOptions): Promise<void>;
	abort(): Promise<void>;
	compact(): Promise<void>;
	setModel(modelId: string): Promise<void>;
	waitForIdle(): Promise<void>;
	isStreaming(): boolean;
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
	thinkingFormat?: string;
	supportsReasoningEffort?: string[];
	temperature?: number;
	top_p?: number;
	headers?: Record<string, string>;
	requestHeaders?: Record<string, string>;
	vision?: boolean;
	api?: string;
	isOllama?: boolean;
}

interface RuntimeOperation {
	id: string;
	startedAt: number;
	checkpointId: string;
	streamingMessage?: AssistantMessage;
	runningTools: Map<string, Record<string, unknown>>;
	completion: Promise<void>;
	resolveCompletion: () => void;
}

interface SessionServices {
	transcriptState: ReturnType<typeof replicatedState<any>>;
	modelsState: ReturnType<typeof replicatedState<any>>;
}

function normalizeEndpointUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	try {
		const parsed = new URL(trimmed);
		let pathname = parsed.pathname;
		if (pathname.endsWith("/chat/completions")) {
			pathname = pathname.slice(0, -"/chat/completions".length);
		} else if (pathname.endsWith("/completions")) {
			pathname = pathname.slice(0, -"/completions".length);
		}
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
		const thinkingFormat = entry.thinkingFormat || (reasoning ? "qwen-chat-template" : undefined);
		const hasCompat = isLocal || Boolean(entry.isOllama) || reasoning || Boolean(thinkingFormat);
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
			compat: hasCompat
				? {
						...(thinkingFormat ? { thinkingFormat } : {}),
						...(isLocal ? { maxTokensField: "max_tokens" } : {}),
						supportsStore: false,
						supportsDeveloperRole: false,
						supportsReasoningEffort: Boolean(entry.supportsReasoningEffort && entry.supportsReasoningEffort.length > 0),
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
	private readonly settingsManager: SettingsManager;
	private resourceLoader: DefaultResourceLoader;
	private activeWorktree?: WorktreeSession;
	private readonly workspaceCheckpoints = new WorkspaceCheckpointManager();
	private readonly turnCheckpoints = new Map<string, string>();
	private readonly subagents = new Map<string, AgentSession>();

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
		this.settingsManager = SettingsManager.inMemory({ agentFeatures: this.readAgentFeatureSettings() });
		this.resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir: getAgentDir(),
			settingsManager: this.settingsManager,
			additionalSkillPaths: [join(cwd, ".agents", "skills"), join(cwd, ".github", "skills")],
		});
	}

	private readAgentFeatureSettings(): AgentFeaturesSettings {
		const config = vscode.workspace.getConfiguration("pi");
		return {
			guardrails: {
				enabled: config.get<boolean>("agentFeatures.guardrails.enabled") ?? false,
				hooksEnabled: config.get<boolean>("agentFeatures.guardrails.hooksEnabled") ?? false,
				defaultTier: config.get<"config" | "allow" | "ask" | "deny">("agentFeatures.guardrails.defaultTier") ?? "config",
			},
			switchyard: {
				enabled: config.get<boolean>("agentFeatures.switchyard.enabled") ?? false,
				efficientModel: config.get<string>("agentFeatures.switchyard.efficientModel") ?? "",
				capableModel: config.get<string>("agentFeatures.switchyard.capableModel") ?? "",
				evaluatorModel: config.get<string>("agentFeatures.switchyard.evaluatorModel") ?? "",
				picker: config.get<"efficient_first" | "capable_first">("agentFeatures.switchyard.picker") ?? "efficient_first",
			},
			personalization: {
				enabled: config.get<boolean>("agentFeatures.personalization.enabled") ?? false,
				autoLearn: config.get<boolean>("agentFeatures.personalization.autoLearn") ?? false,
				maxTokens: config.get<number>("agentFeatures.personalization.maxTokens") ?? 1200,
			},
			semble: {
				enabled: config.get<boolean>("agentFeatures.semble.enabled") ?? false,
				maxResults: config.get<number>("agentFeatures.semble.maxResults") ?? 8,
			},
			worktree: {
				enabled: config.get<boolean>("agentFeatures.worktree.enabled") ?? false,
				rootDir: config.get<string>("agentFeatures.worktree.rootDir") ?? "",
				cleanupOnDispose: config.get<boolean>("agentFeatures.worktree.cleanupOnDispose") ?? false,
			},
		};
	}

	syncFeatureSettings(): void {
		this.settingsManager.applyOverrides({ agentFeatures: this.readAgentFeatureSettings() });
		if (this.session) {
			const names = new Set(this.session.getActiveToolNames());
			if (this.readAgentFeatureSettings().semble?.enabled) names.add("semble");
			else names.delete("semble");
			this.session.setActiveToolsByName([...names]);
			if (!this.currentOperation) {
				void this.rebuildSessionForFeatureSettings().catch((error) => {
					console.error("Ziq: failed to rebuild session after feature settings change", error);
				});
			}
		}
	}

	private async rebuildSessionForFeatureSettings(): Promise<void> {
		const previous = this.session;
		if (!previous) return;
		this.sessionUnsubscribe?.();
		this.sessionUnsubscribe = undefined;
		this.session = undefined;
		this.sessionServices = undefined;
		const sessionManager = previous.sessionManager;
		const model = previous.model;
		const thinkingLevel = previous.thinkingLevel;
		const effectiveCwd = this.activeWorktree?.isIsolated ? this.activeWorktree.worktreePath : this.cwd;
		await this.backend.destroySession(previous.sessionId);
		this.resourceLoader = this.createResourceLoader(effectiveCwd);
		const created = await this.backend.createSession({
			cwd: effectiveCwd,
			sessionManager,
			model,
			thinkingLevel,
			resourceLoader: this.resourceLoader,
			customTools: [...createVsCodeTools(), ...createRuntimeAgentTools(this)],
			settingsManager: this.settingsManager,
			toolObserver: {
				beforeToolCall: ({ toolName, input }) => this.workspaceCheckpoints.captureToolInput(toolName, input),
			},
			enableAttributionHeaders: true,
		});
		this.session = created.session;
		this.sessionCreatedAt = Date.now();
		this.bindSession(this.session);
		this.refreshDirectoryState();
	}

	async start(): Promise<void> {
		await this.resourceLoader.reload();
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
		await this.disposeActiveWorktree();
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

			const featureSettings = this.readAgentFeatureSettings();
			const worktree = await this.prepareWorktree(forceNew, requestedSessionId, featureSettings);
			const effectiveCwd = worktree.worktreePath;
			this.resourceLoader = this.createResourceLoader(effectiveCwd);

			const models = this.modelRuntime.getModels();
			const configured = PiSettings.activeModel;
			const target =
				models.find((model) => model.id === requestedModelId || (model.provider + "/" + model.id) === requestedModelId) ||
				models.find((model) => model.id === configured || (model.provider + "/" + model.id) === configured) ||
				models[0];

			const useWorktree = worktree.isIsolated;
			const sessionManager = (forceNew || useWorktree)
				? SessionManager.create(effectiveCwd, undefined, requestedSessionId ? { id: requestedSessionId } : undefined)
				: SessionManager.continueRecent(effectiveCwd);
			const resumed = !forceNew && sessionManager.buildSessionContext().messages.length > 0;

			const isModelReasoning = Boolean((target as any)?.reasoning);
			const created = await this.backend.createSession({
				cwd: effectiveCwd,
				sessionManager,
				model: resumed ? undefined : target,
				thinkingLevel: isModelReasoning ? "medium" : undefined,
				resourceLoader: this.resourceLoader,
				customTools: [...createVsCodeTools(), ...createRuntimeAgentTools(this)],
				settingsManager: this.settingsManager,
				toolObserver: {
					beforeToolCall: ({ toolName, input }) => this.workspaceCheckpoints.captureToolInput(toolName, input),
				},
				enableAttributionHeaders: true,
			});

			this.session = created.session;

			// Resumed sessions persist the historical model selection. If that model
			// is no longer present in the current runtime catalog (for example an
			// Ollama model that was removed), keep the conversation but switch the
			// live session to the current compatible target instead of sending the
			// stale model id to the provider.
			const restoredModel = created.session.model;
			if (resumed && restoredModel && target) {
				const availableRestoredModel = this.modelRuntime.getModel(restoredModel.provider, restoredModel.id);
				const restoredModelDiffersFromActive =
					restoredModel.provider !== target.provider || restoredModel.id !== target.id;
				if (!availableRestoredModel || restoredModelDiffersFromActive) {
					await created.session.setModel(target);
					if ((target as any)?.reasoning && created.session.thinkingLevel === "off") {
						created.session.setThinkingLevel("medium");
					}
				}
			}

			this.sessionCreatedAt = Date.now();
			if (useWorktree) {
				WorkspaceContext.setRuntimeRoot(effectiveCwd);
			}
			this.bindSession(this.session);
			this.refreshDirectoryState();
			return this.session;
		});
	}

	async createNewSession(id?: string): Promise<SessionSummary> {
		await this.ensureSession(undefined, true, id);
		return this.describeSession();
	}

	async removeSession(): Promise<void> {
		await this.serialize(async () => {
			if (!this.session) {
				await this.disposeActiveWorktree();
				return;
			}
			this.sessionUnsubscribe?.();
			this.sessionUnsubscribe = undefined;
			await this.backend.destroySession(this.session.sessionId);
			this.session = undefined;
			this.sessionServices = undefined;
			this.currentOperation = undefined;
			this.queuedMessages = [];
			this.refreshDirectoryState();
			await this.disposeActiveWorktree();
		});
	}

	async attachLocal(): Promise<ZiqRuntimeAttachment> {
		const session = await this.ensureSession();
		return {
			sessionId: session.sessionId,
			sessionName: this.sessionDisplayName(),
			subscribe: (listener) => session.subscribe(listener),
			prompt: (text, options) => this.prompt(text, options),
			steer: async (text) => { await this.steer(text); },
			followUp: async (text) => { await this.followUp(text); },
			editMessage: (entryId, text, options) => this.editUserMessage(entryId, text, options),
			abort: () => this.abort(),
			compact: () => this.compact(),
			setModel: (modelId) => this.setModel(modelId),
			waitForIdle: () => this.waitForIdle(),
			isStreaming: () => this.currentOperation !== undefined,
			dispose: () => {},
		};
	}

	describeSession(): SessionSummary {
		if (!this.session) throw new Error("No live Ziq Session");
		return {
			serverId: this.serverId,
			sessionId: this.session.sessionId,
			name: this.sessionDisplayName(),
			createdAt: this.sessionCreatedAt,
		};
	}

private async startPrompt(text: string, options?: BackendPromptOptions): Promise<{ operationId: string; run: Promise<void> }> {
		const session = await this.ensureSession();
		if (this.currentOperation) throw new Error("Agent is already running; send a steering message instead.");

		const operationId = randomUUID();
		const checkpointId = randomUUID();
		this.workspaceCheckpoints.begin(checkpointId);
		let resolveCompletion!: () => void;
		const completion = new Promise<void>((resolve) => {
			resolveCompletion = resolve;
		});
		this.currentOperation = {
			id: operationId,
			startedAt: Date.now(),
			checkpointId,
			runningTools: new Map(),
			completion,
			resolveCompletion,
		};
		this.emitRuntimeSnapshot();

		const run = this.backend.prompt(session.sessionId, text, options)
			.then(() => {
				const entryId = this.findLastUserEntryId();
				this.workspaceCheckpoints.finish(checkpointId);
				if (entryId) this.turnCheckpoints.set(entryId, checkpointId);
			})
			.catch((error) => {
				this.workspaceCheckpoints.finish(checkpointId);
				this.finishOperation(operationId, "failed", error);
				throw error;
			});
		return { operationId, run };
	}

	private async prompt(text: string, options?: BackendPromptOptions): Promise<void> {
		const { run } = await this.startPrompt(text, options);
		await run;
	}

	private async steer(text: string): Promise<string> {
		const session = await this.ensureSession();
		const entryId = "queue-" + randomUUID();
		this.queuedMessages.push({
			entryId,
			kind: "steer",
			message: { role: "user", content: text, timestamp: Date.now() } as AgentMessage,
		});
		this.emitRuntimeSnapshot();
		await session.steer(text);
		return entryId;
	}

	private async followUp(text: string): Promise<string> {
		const session = await this.ensureSession();
		const entryId = "queue-" + randomUUID();
		this.queuedMessages.push({
			entryId,
			kind: "followUp",
			message: { role: "user", content: text, timestamp: Date.now() } as AgentMessage,
		});
		this.emitRuntimeSnapshot();
		await session.followUp(text);
		return entryId;
	}

	private async waitForIdle(): Promise<void> {
		await this.currentOperation?.completion;
	}

	private createResourceLoader(cwd: string): DefaultResourceLoader {
		return new DefaultResourceLoader({
			cwd,
			agentDir: getAgentDir(),
			settingsManager: this.settingsManager,
			additionalSkillPaths: [join(cwd, ".agents", "skills"), join(cwd, ".github", "skills")],
		});
	}

	private async prepareWorktree(
		forceNew: boolean,
		requestedSessionId: string | undefined,
		settings: AgentFeaturesSettings,
	): Promise<WorktreeSession> {
		if (!settings.worktree.enabled) {
			WorkspaceContext.setRuntimeRoot(undefined);
			return { worktreePath: this.cwd, branchName: "", isIsolated: false };
		}
		if (this.activeWorktree?.isIsolated && !forceNew) return this.activeWorktree;
		if (forceNew) await this.disposeActiveWorktree();
		const created = await WorktreeManager.createWorktree({
			repoPath: this.cwd,
			sessionId: requestedSessionId ?? randomUUID(),
			taskName: "ziq-session",
			worktreeRootDir: settings.worktree.rootDir || undefined,
		});
		this.activeWorktree = created;
		return created;
	}

	private async disposeActiveWorktree(): Promise<void> {
		WorkspaceContext.setRuntimeRoot(undefined);
		if (!this.activeWorktree?.isIsolated) {
			this.activeWorktree = undefined;
			return;
		}
		const worktree = this.activeWorktree;
		const settings = this.readAgentFeatureSettings();
		if (settings.worktree.cleanupOnDispose) {
			await WorktreeManager.removeWorktree(this.cwd, worktree.worktreePath, worktree.branchName);
		}
		this.activeWorktree = undefined;
	}

	async mergeActiveWorktree(commitMessage?: string): Promise<boolean> {
		if (!this.activeWorktree?.isIsolated) return true;
		const worktree = this.activeWorktree;
		const merged = await WorktreeManager.mergeWorktree(this.cwd, worktree.worktreePath, worktree.branchName, commitMessage);
		if (merged) {
			this.activeWorktree = undefined;
			WorkspaceContext.setRuntimeRoot(undefined);
		}
		return merged;
	}

	async discardActiveWorktree(): Promise<void> {
		if (!this.activeWorktree?.isIsolated) return;
		const worktree = this.activeWorktree;
		await WorktreeManager.removeWorktree(this.cwd, worktree.worktreePath, worktree.branchName);
		this.activeWorktree = undefined;
		WorkspaceContext.setRuntimeRoot(undefined);
	}

	getActiveWorktree(): WorktreeSession | undefined {
		return this.activeWorktree;
	}

	private findLastUserEntryId(): string | undefined {
		if (!this.session) return undefined;
		for (const entry of [...this.session.sessionManager.getBranch()].reverse()) {
			if (entry.type === "message" && entry.message.role === "user") return entry.id;
		}
		return undefined;
	}

	async editUserMessage(entryId: string, text: string, options?: BackendPromptOptions): Promise<void> {
		if (this.currentOperation) throw new Error("Wait for the current response to finish before editing a previous message.");
		const session = await this.ensureSession();
		const entry = session.sessionManager.getEntry(entryId);
		if (!entry || entry.type !== "message" || entry.message.role !== "user") {
			throw new Error("Invalid user message entry for editing.");
		}
		const checkpointId = this.turnCheckpoints.get(entryId);
		if (!checkpointId) {
			throw new Error("This message predates the active workspace checkpoint. Start a new session before editing it so Ziq can restore the workspace safely.");
		}
		await this.workspaceCheckpoints.restore(checkpointId);
		await session.rewindBeforeEntry(entryId);
		await this.prompt(text, options);
	}

	getSessionHistory(): Array<{ entryId: string; role: "user" | "assistant"; content: string; timestamp: number }> {
		if (!this.session) return [];
		const result: Array<{ entryId: string; role: "user" | "assistant"; content: string; timestamp: number }> = [];
		for (const projected of this.session.sessionManager.buildSessionProjection().entries) {
			for (const message of projected.messages) {
				if (message.role !== "user" && message.role !== "assistant") continue;
				const content = Array.isArray(message.content)
					? message.content.filter((block: any) => block?.type === "text").map((block: any) => block.text || "").join("")
					: typeof message.content === "string" ? message.content : "";
				if (!content) continue;
				result.push({
					entryId: projected.sourceEntry.id,
					role: message.role,
					content,
					timestamp: message.timestamp || Date.now(),
				});
			}
		}
		return result;
	}

	getSkillSummaries(): Array<{ name: string; description: string; path: string }> {
		return this.resourceLoader.getSkills().skills.map((skill: any) => ({
			name: skill.name,
			description: skill.description || "",
			path: skill.filePath,
		}));
	}

	async createSkill(name: string, description: string, instructions: string): Promise<string> {
		const safeName = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
		if (!safeName) throw new Error("Skill name is required.");
		const skillRoot = this.activeWorktree?.isIsolated ? this.activeWorktree.worktreePath : this.cwd;
		const directory = join(skillRoot, ".agents", "skills", safeName);
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(directory));
		const content = "---\nname: " + safeName + "\ndescription: " + description.trim() + "\n---\n\n" + instructions.trim() + "\n";
		await vscode.workspace.fs.writeFile(vscode.Uri.file(join(directory, "SKILL.md")), Buffer.from(content, "utf8"));
		await this.resourceLoader.reload();
		this.session?.refreshContext();
		return join(directory, "SKILL.md");
	}

	async runSubagent(prompt: string, modelId?: string): Promise<{ id: string; result: string }> {
		const id = randomUUID();
		const sessionManager = SessionManager.inMemory(this.cwd);
		const parentModel = this.session?.model;
		const model = (modelId
			? this.modelRuntime.getModels().find((candidate) => candidate.id === modelId || candidate.provider + "/" + candidate.id === modelId)
			: parentModel) ?? this.modelRuntime.getModels()[0];
		if (!model) throw new Error("No model available for subagent.");
		const created = await this.backend.createSession({
			cwd: this.cwd,
			sessionManager,
			model,
			thinkingLevel: (model as any).reasoning ? "medium" : "off",
			resourceLoader: this.resourceLoader,
			customTools: createVsCodeTools(),
			settingsManager: this.settingsManager,
			enableAttributionHeaders: true,
		});
		this.subagents.set(id, created.session);
		try {
			await created.session.prompt(prompt);
			const assistant = [...created.session.messages].reverse().find((message: any) => message.role === "assistant") as any;
			const result = Array.isArray(assistant?.content)
				? assistant.content.filter((block: any) => block?.type === "text").map((block: any) => block.text || "").join("")
				: typeof assistant?.content === "string" ? assistant.content : "";
			return { id, result };
		} finally {
			this.subagents.delete(id);
			await this.backend.destroySession(created.session.sessionId);
		}
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
		if ((model as any).reasoning && session.thinkingLevel === "off") {
			session.setThinkingLevel("medium");
		}
		this.refreshModelsState();
		this.emitRuntimeSnapshot();
	}

	private bindSession(session: AgentSession): void {
		this.sessionUnsubscribe = session.subscribe((event: any) => {
			switch (event.type) {
				case "message_start": {
					const messageText = this.messageText(event.message);
					this.queuedMessages = this.queuedMessages.filter((item) => this.messageText(item.message) !== messageText);
					this.refreshDirectoryState();
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
		const operation = this.currentOperation;
		this.currentOperation = undefined;
		operation.resolveCompletion();
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
		const tipId = projection.entries.at(-1)?.sourceEntry.id ?? null;
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
		this.directoryState = replicatedState<SessionDirectoryState>({ revision: 1, sessions: [] });
		this.refreshDirectoryState();

		return {
			attachClient: (presentation: RoutedServerPresentation) => {
				const provider = new RemoteServiceProvider([
					{ service: SessionDirectory, mode: "singleton" },
					{ service: SessionManagement, mode: "singleton" },
					{ service: PresentationPlugins, mode: "singleton" },
				]);
				(provider as any).provide(SessionDirectory, { state: this.directoryState });
				(provider as any).provide(SessionManagement, {
					create: async (options: { id?: string }) => {
						if (!this.session) await this.createNewSession(options?.id);
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
				(provider as any).provide(PresentationPlugins, {
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
				(provider as any).provide(Models, this.modelsService());
				(provider as any).provide(Transcript, { state: this.sessionServices.transcriptState });
				(provider as any).provide(AgentController, this.agentService());
				return this.providerAttachment(provider);
			},
			close: async () => {},
		};
	}

	private promptAttachmentsToOptions(attachments?: readonly import("./runtimeServices").PromptAttachment[]): BackendPromptOptions | undefined {
		if (!attachments || attachments.length === 0) return undefined;
		const files = attachments.filter((item): item is Extract<import("./runtimeServices").PromptAttachment, { kind: "file" }> => item.kind === "file").map((item) => item.path);
		const images = attachments
			.filter((item): item is Extract<import("./runtimeServices").PromptAttachment, { kind: "image" }> => item.kind === "image")
			.map((item) => ({ type: "image" as const, data: item.data, mimeType: item.mimeType }));
		return {
			...(files.length > 0 ? { files } : {}),
			...(images.length > 0 ? { images } : {}),
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
			editMessage: async (request: { entryId: string; message: string }) => {
				await this.editUserMessage(request.entryId, request.message);
				return { accepted: true, error: null };
			},
			prompt: async (request: { message: string; attachments?: import("./runtimeServices").PromptAttachment[] }) => {
				const options = this.promptAttachmentsToOptions(request.attachments);
				const result = await this.startPrompt(request.message, options);
				return { accepted: true, operationId: result.operationId, error: null };
			},
			requestAbort: async (operationId: string) => {
				if (this.currentOperation?.id === operationId) await this.abort();
			},
			steer: async (request: { message: string }) => {
				const entryId = await this.steer(request.message);
				return { accepted: true, entryId, error: null };
			},
			followUp: async (request: { message: string }) => {
				const entryId = await this.followUp(request.message);
				return { accepted: true, entryId, error: null };
			},
			nextRun: async (request: { message: string }) => {
				const entryId = await this.followUp(request.message);
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
		const anyMsg = message as any;
		if (typeof anyMsg.content === "string") return anyMsg.content;
		if (Array.isArray(anyMsg.content)) {
			return anyMsg.content
				.filter((block: any) => block?.type === "text")
				.map((block: any) => block.text || "")
				.join("");
		}
		return "";
	}

	private sessionDisplayName(): string {
		if (!this.session) return "New Session";
		if (this.session.sessionName?.trim()) return this.session.sessionName.trim();
		for (const message of this.session.messages) {
			if (message.role !== "user") continue;
			const text = this.messageText(message).replace(/\s+/g, " ").trim();
			if (text) return text.length > 60 ? text.slice(0, 57) + "…" : text;
		}
		return "New Session";
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
