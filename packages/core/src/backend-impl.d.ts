import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "./agent-session.ts";
import type { AgentBackend, BackendPromptOptions, SessionSummary } from "./interface.ts";
import { ModelRuntime } from "./model-runtime.ts";
import type { ProviderConfigInput, ProviderModelConfig } from "./provider-composer.ts";
import { type CreateAgentSessionOptions, type CreateAgentSessionResult } from "./sdk.ts";
export interface PiAgentBackendOptions {
	modelRuntime?: ModelRuntime;
	defaultCwd?: string;
	customProviders?:
		| Record<string, ProviderConfigInput>
		| readonly (ProviderConfigInput & {
				id: string;
		  })[];
	enableAttributionHeaders?: boolean;
}
export declare class PiAgentBackend implements AgentBackend {
	private readonly sessions;
	private modelRuntime?;
	private readonly options?;
	constructor(options?: PiAgentBackendOptions);
	getModelRuntime(): Promise<ModelRuntime>;
	registerCustomModel(
		providerId: string,
		model: ProviderModelConfig,
		providerDefaults?: Partial<ProviderConfigInput>,
	): Promise<void>;
	registerCustomProvider(providerId: string, config: ProviderConfigInput): Promise<void>;
	createSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>;
	registerSession(session: AgentSession): void;
	getSession(id: string): AgentSession | undefined;
	listSessions(): SessionSummary[];
	destroySession(id: string): Promise<void>;
	prompt(sessionId: string, text: string, options?: BackendPromptOptions): Promise<void>;
	steer(sessionId: string, text: string): Promise<void>;
	followUp(sessionId: string, text: string): Promise<void>;
	abort(sessionId: string): Promise<void>;
	setModel(sessionId: string, model: Model<any>, thinkingLevel?: ThinkingLevel): Promise<void>;
	cycleModel(sessionId: string): Promise<void>;
	subscribe(sessionId: string, listener: (event: AgentSessionEvent) => void): () => void;
	compact(sessionId: string): Promise<void>;
	exportSession(sessionId: string, outputPath?: string): Promise<string>;
}
//# sourceMappingURL=backend-impl.d.ts.map
