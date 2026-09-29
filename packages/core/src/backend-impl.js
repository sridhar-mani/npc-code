import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { ModelRuntime } from "./model-runtime.js";
import { createAgentSession } from "./sdk.js";
function toImageContent(item) {
    if (typeof item !== "string") {
        return item;
    }
    if (existsSync(item)) {
        const buffer = readFileSync(item);
        const ext = extname(item).toLowerCase();
        const mimeType = ext === ".jpg" || ext === ".jpeg"
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
export class PiAgentBackend {
    sessions = new Map();
    modelRuntime;
    options;
    constructor(options) {
        this.options = options;
        this.modelRuntime = options?.modelRuntime;
    }
    async getModelRuntime() {
        if (!this.modelRuntime) {
            this.modelRuntime = await ModelRuntime.create({
                customProviders: this.options?.customProviders,
            });
        }
        return this.modelRuntime;
    }
    async registerCustomModel(providerId, model, providerDefaults) {
        const runtime = await this.getModelRuntime();
        runtime.registerCustomModel(providerId, model, providerDefaults);
    }
    async registerCustomProvider(providerId, config) {
        const runtime = await this.getModelRuntime();
        runtime.registerProvider(providerId, config);
    }
    async createSession(options) {
        const runtime = options?.modelRuntime ?? (await this.getModelRuntime());
        const result = await createAgentSession({
            cwd: this.options?.defaultCwd,
            ...options,
            enableAttributionHeaders: options?.enableAttributionHeaders ?? this.options?.enableAttributionHeaders,
            modelRuntime: runtime,
        });
        this.sessions.set(result.session.sessionId, result.session);
        return result;
    }
    registerSession(session) {
        this.sessions.set(session.sessionId, session);
    }
    getSession(id) {
        return this.sessions.get(id);
    }
    listSessions() {
        const summaries = [];
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
    async destroySession(id) {
        const session = this.sessions.get(id);
        if (!session)
            return;
        if (session.isStreaming) {
            await session.abort();
        }
        session.dispose();
        this.sessions.delete(id);
    }
    async prompt(sessionId, text, options) {
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
        const images = options?.images?.map(toImageContent).filter((img) => img !== undefined);
        await session.prompt(promptText, {
            expandPromptTemplates: options?.expandPromptTemplates,
            streamingBehavior: options?.streamingBehavior,
            images: images && images.length > 0 ? images : undefined,
        });
    }
    async steer(sessionId, text) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error(`No session: ${sessionId}`);
        }
        await session.steer(text);
    }
    async followUp(sessionId, text) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error(`No session: ${sessionId}`);
        }
        await session.followUp(text);
    }
    async abort(sessionId) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error(`No session: ${sessionId}`);
        }
        await session.abort();
    }
    async setModel(sessionId, model, thinkingLevel) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error(`No session: ${sessionId}`);
        }
        await session.setModel(model);
        if (thinkingLevel !== undefined) {
            session.setThinkingLevel(thinkingLevel);
        }
    }
    async cycleModel(sessionId) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error(`No session: ${sessionId}`);
        }
        await session.cycleModel();
    }
    subscribe(sessionId, listener) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error(`No session: ${sessionId}`);
        }
        return session.subscribe(listener);
    }
    async compact(sessionId) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error(`No session: ${sessionId}`);
        }
        await session.compact();
    }
    async exportSession(sessionId, outputPath) {
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
//# sourceMappingURL=backend-impl.js.map