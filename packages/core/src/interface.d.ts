import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "./agent-session.ts";
import type { CreateAgentSessionOptions, CreateAgentSessionResult } from "./sdk.ts";
export interface AgentBackend {
    createSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>;
    getSession(id: string): AgentSession | undefined;
    listSessions(): SessionSummary[];
    destroySession(id: string): Promise<void>;
    prompt(sessionId: string, text: string, options?: BackendPromptOptions): Promise<void>;
    steer(sessionId: string, text: string): Promise<void>;
    followUp(sessionId: string, text: string): Promise<void>;
    abort(sessionId: string): Promise<void>;
    setModel(sessionId: string, model: Model<any>, thinkingLevel?: ThinkingLevel): Promise<void>;
    cycleModel(sessionId: string): Promise<void>;
    registerCustomModel?(providerId: string, model: any, providerDefaults?: any): Promise<void>;
    registerCustomProvider?(providerId: string, config: any): Promise<void>;
    getModelRuntime?(): Promise<any>;
    subscribe(sessionId: string, listener: (event: AgentSessionEvent) => void): () => void;
    compact(sessionId: string): Promise<void>;
    exportSession(sessionId: string, outputPath?: string): Promise<string>;
}
export interface BackendPromptOptions {
    images?: Array<string | ImageContent>;
    files?: string[];
    expandPromptTemplates?: boolean;
    streamingBehavior?: "steer" | "followUp";
}
export type PromptOptions = BackendPromptOptions;
export interface SessionSummary {
    id: string;
    name?: string;
    cwd: string;
    createdAt: number;
    messageCount: number;
}
//# sourceMappingURL=interface.d.ts.map