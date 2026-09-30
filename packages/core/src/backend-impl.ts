import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "./agent-session.ts";
import type { AgentBackend, BackendPromptOptions, SessionSummary } from "./interface.ts";
import { ModelRuntime } from "./model-runtime.ts";
import type { ProviderConfigInput, ProviderModelConfig } from "./provider-composer.ts";
import { type CreateAgentSessionOptions, type CreateAgentSessionResult, createAgentSession } from "./sdk.ts";

function toImageContent(item: string | ImageContent): ImageContent | undefined {
	if (typeof item !== "string") {
		return item;
	}
	if (existsSync(item)) {
		const buffer = readFileSync(item);
		const ext = extname(item).toLowerCase();
		const mimeType =
			ext === ".jpg" || ext === ".jpeg"
				? "image/jpeg"
				: ext === ".png"
					? "image/png"
					: ext === ".webp"
						? "image/webp"
						: ext === ".gif"
							? "image/gif"
							: "image/png";
		return {
			type: "image",
			data: buffer.toString("base64"),
			mimeType,
		};
	}
	const match = item.match(/^data:([^;]+);base64,(.+)$/);
	if (match) {
		return {
			type: "image",
			mimeType: match[1],
			data: match[2],
		};
	}
	return undefined;
}

export interface PiAgentBackendOptions {
	modelRuntime?: ModelRuntime;
	defaultCwd?: string;
	customProviders?: Record<string, ProviderConfigInput> | readonly (ProviderConfigInput & { id: string })[];
	enableAttributionHeaders?: boolean;
	/** Optional diagnostic logger used by host integrations such as the VS Code extension. */
	debugLogger?: (message: string) => void;
}

export class PiAgentBackend implements AgentBackend {
	private readonly sessions = new Map<string, AgentSession>();
	private modelRuntime?: ModelRuntime;
	private readonly options?: PiAgentBackendOptions;

	constructor(options?: PiAgentBackendOptions) {
		this.options = options;
		this.modelRuntime = options?.modelRuntime;
	}

	async getModelRuntime(): Promise<ModelRuntime> {
		if (!this.modelRuntime) {
			this.modelRuntime = await ModelRuntime.create({
				customProviders: this.options?.customProviders,
			});
		}
		return this.modelRuntime;
	}

	async registerCustomModel(
		providerId: string,
		model: ProviderModelConfig,
		providerDefaults?: Partial<ProviderConfigInput>,
	): Promise<void> {
		const runtime = await this.getModelRuntime();
		runtime.registerCustomModel(providerId, model, providerDefaults);
	}

	async registerCustomProvider(providerId: string, config: ProviderConfigInput): Promise<void> {
		const runtime = await this.getModelRuntime();
		runtime.registerProvider(providerId, config);
	}

	async createSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult> {
		const runtime = options?.modelRuntime ?? (await this.getModelRuntime());
		this.options?.debugLogger?.(
			`createSession requested model=${options?.model ? `${options.model.provider}/${options.model.id}` : "auto"} cwd=${options?.cwd ?? this.options?.defaultCwd ?? process.cwd()}`,
		);
		const result = await createAgentSession({
			cwd: this.options?.defaultCwd,
			...options,
			enableAttributionHeaders: options?.enableAttributionHeaders ?? this.options?.enableAttributionHeaders,
			modelRuntime: runtime,
			debugLogger: this.options?.debugLogger,
		});
		this.sessions.set(result.session.sessionId, result.session);
		return result;
	}

	registerSession(session: AgentSession): void {
		this.sessions.set(session.sessionId, session);
	}

	getSession(id: string): AgentSession | undefined {
		return this.sessions.get(id);
	}

	listSessions(): SessionSummary[] {
		const summaries: SessionSummary[] = [];
		for (const session of this.sessions.values()) {
			const header = session.sessionManager.getHeader();
			const createdAt = header?.timestamp ? Date.parse(header.timestamp) : Date.now();
			summaries.push({
				id: session.sessionId,
				name: session.sessionName,
				cwd: session.sessionManager.getCwd(),
				createdAt: Number.isNaN(createdAt) ? Date.now() : createdAt,
				messageCount: session.messages.length,
			});
		}
		return summaries;
	}

	async destroySession(id: string): Promise<void> {
		const session = this.sessions.get(id);
		if (!session) return;
		if (session.isStreaming) {
			await session.abort();
		}
		session.dispose();
		this.sessions.delete(id);
	}

	async prompt(sessionId: string, text: string, options?: BackendPromptOptions): Promise<void> {
		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`No session: ${sessionId}`);
		}

		let promptText = text;
		if (options?.files && options.files.length > 0) {
			const fileBlocks = options.files
				.filter((f) => existsSync(f))
				.map((f) => `### File: ${f}\n\`\`\`\n${readFileSync(f, "utf-8")}\n\`\`\``);
			if (fileBlocks.length > 0) {
				promptText = `${fileBlocks.join("\n\n")}\n\n${text}`;
			}
		}

		const images = options?.images?.map(toImageContent).filter((img): img is ImageContent => img !== undefined);

		await session.prompt(promptText, {
			expandPromptTemplates: options?.expandPromptTemplates,
			streamingBehavior: options?.streamingBehavior,
			images: images && images.length > 0 ? images : undefined,
		});
	}

	async steer(sessionId: string, text: string): Promise<void> {
		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`No session: ${sessionId}`);
		}
		await session.steer(text);
	}

	async followUp(sessionId: string, text: string): Promise<void> {
		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`No session: ${sessionId}`);
		}
		await session.followUp(text);
	}

	async abort(sessionId: string): Promise<void> {
		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`No session: ${sessionId}`);
		}
		await session.abort();
	}

	async setModel(sessionId: string, model: Model<any>, thinkingLevel?: ThinkingLevel): Promise<void> {
		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`No session: ${sessionId}`);
		}
		await session.setModel(model);
		if (thinkingLevel !== undefined) {
			session.setThinkingLevel(thinkingLevel);
		}
	}

	async cycleModel(sessionId: string): Promise<void> {
		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`No session: ${sessionId}`);
		}
		await session.cycleModel();
	}

	subscribe(sessionId: string, listener: (event: AgentSessionEvent) => void): () => void {
		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`No session: ${sessionId}`);
		}
		return session.subscribe(listener);
	}

	async compact(sessionId: string): Promise<void> {
		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`No session: ${sessionId}`);
		}
		await session.compact();
	}

	async exportSession(sessionId: string, outputPath?: string): Promise<string> {
		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`No session: ${sessionId}`);
		}
		if (outputPath?.toLowerCase().endsWith(".html")) {
			return await session.exportToHtml(outputPath);
		}
		return session.exportToJsonl(outputPath);
	}
}
