/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation & Pi Authors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
	type AgentBackend,
	type AgentSessionEvent,
	type BackendPromptOptions,
	ModelRuntime,
	PiAgentBackend,
	type ProviderConfigInput,
	type ProviderModelConfig,
} from "@earendil-works/pi-core";

export interface CustomModelEntry {
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
	supportsReasoningEffort?: string[];
	toolCalling?: boolean;
	vision?: boolean;
	api?: string;
	isOllama?: boolean;
}

export interface OllamaModelTag {
	name: string;
	model: string;
	modified_at?: string;
	size?: number;
	digest?: string;
	details?: {
		parent_model?: string;
		format?: string;
		family?: string;
		families?: string[];
		parameter_size?: string;
		quantization_level?: string;
		context_length?: number;
		embedding_length?: number;
	};
	capabilities?: string[];
}

let activeModelId: string | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let sidebarProvider: PiAssistantSidebarProvider | undefined;
let sharedBackend: PiAgentBackend | undefined;

/**
 * Returns the currently active model ID.
 */
export function getActiveModelId(): string | undefined {
	return activeModelId;
}

/**
 * Sets the active model ID and refreshes status bar & sidebar.
 */
export async function setActiveModelId(modelId: string, context?: vscode.ExtensionContext): Promise<void> {
	activeModelId = modelId;
	if (context) {
		await context.globalState.update("pi.activeModelId", modelId);
	}
	updateStatusBar();
	sidebarProvider?.refresh();
}

/**
 * Converts VS Code custom model entries into pi-core ProviderConfigInput records.
 */
export function convertCustomModelsToProviders(
	models: readonly CustomModelEntry[],
	fallbackApiKey?: string,
): Record<string, ProviderConfigInput> {
	const providers: Record<string, ProviderConfigInput> = {};

	for (const entry of models) {
		if (!entry.id) continue;
		const providerId = `custom-${entry.id}`;
		const baseUrl = entry.baseUrl || entry.url || "http://localhost:11434/v1";
		const apiKey = entry.apiKey || fallbackApiKey || (entry.isOllama ? "ollama" : "");
		const api = (entry.api || "openai-completions") as any;

		const modelConfig: ProviderModelConfig = {
			type: "chat",
			id: entry.id,
			name: entry.name || entry.label || entry.id,
			api,
			baseUrl,
			reasoning: Boolean(entry.thinking || entry.reasoning),
			contextWindow: entry.contextWindow || entry.maxInputTokens || 128000,
			maxTokens: entry.maxOutputTokens || 16384,
			input: entry.vision ? ["text", "image"] : ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			headers: entry.headers || entry.requestHeaders,
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
			apiKey,
			api,
			models: [modelConfig],
			headers: entry.headers || entry.requestHeaders,
		};
	}

	return providers;
}

/**
 * Reads all custom models configured in VS Code settings.
 * Checks both `copilot.customModels` and `github.copilot.chat.customEndpoints`.
 */
export function readVscodeCustomModels(): CustomModelEntry[] {
	const config = vscode.workspace.getConfiguration("copilot");
	const fromCopilot = config.get<CustomModelEntry[]>("customModels") ?? [];
	const fallbackApiKey = config.get<string>("apiKey") ?? process.env.OPENAI_API_KEY;

	const chatConfig = vscode.workspace.getConfiguration("github.copilot.chat");
	const customEndpoints = chatConfig.get<any[]>("customEndpoints") ?? [];

	const results: CustomModelEntry[] = [...fromCopilot];

	for (const endpoint of customEndpoints) {
		if (Array.isArray(endpoint.models)) {
			for (const m of endpoint.models) {
				if (m.id && !results.some((r) => r.id === m.id)) {
					results.push({
						id: m.id,
						name: m.name,
						url: m.url || endpoint.url,
						apiKey: endpoint.apiKey || fallbackApiKey,
						contextWindow: m.maxInputTokens,
						maxOutputTokens: m.maxOutputTokens,
						thinking: m.thinking,
						temperature: m.temperature,
						top_p: m.top_p,
						toolCalling: m.toolCalling,
						vision: m.vision,
					});
				}
			}
		}
	}

	return results;
}

/**
 * Creates an AgentBackend initialized with custom providers read from VS Code settings.
 */
export async function createBackendFromVscodeSettings(cwd?: string): Promise<{
	backend: PiAgentBackend;
	runtime: ModelRuntime;
}> {
	const customModels = readVscodeCustomModels();
	const config = vscode.workspace.getConfiguration("copilot");
	const fallbackApiKey = config.get<string>("apiKey") ?? process.env.OPENAI_API_KEY;
	const customProviders = convertCustomModelsToProviders(customModels, fallbackApiKey);

	const runtime = await ModelRuntime.create({
		customProviders,
	});

	const backend = new PiAgentBackend({
		modelRuntime: runtime,
		defaultCwd: cwd,
		customProviders,
		enableAttributionHeaders: true,
	});

	return { backend, runtime };
}

/**
 * Gets or creates the shared PiAgentBackend instance.
 */
export async function getSharedAgentBackend(cwd?: string): Promise<PiAgentBackend> {
	if (!sharedBackend) {
		const { backend } = await createBackendFromVscodeSettings(cwd);
		sharedBackend = backend;
	}
	return sharedBackend;
}

/**
 * Dynamically adds or updates custom model configuration in VS Code settings and registers it in the backend.
 */
export async function addCustomModel(
	entry: CustomModelEntry,
	target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Promise<void> {
	const config = vscode.workspace.getConfiguration("copilot");
	const current = config.get<CustomModelEntry[]>("customModels") ?? [];
	const index = current.findIndex((m) => m.id === entry.id);
	const updated = [...current];
	if (index >= 0) {
		updated[index] = entry;
	} else {
		updated.push(entry);
	}
	await config.update("customModels", updated, target);

	if (sharedBackend) {
		const providers = convertCustomModelsToProviders([entry], entry.apiKey);
		for (const [providerId, provider] of Object.entries(providers)) {
			await sharedBackend.registerCustomProvider(providerId, provider);
		}
	}

	if (!activeModelId) {
		await setActiveModelId(entry.id);
	} else {
		updateStatusBar();
		sidebarProvider?.refresh();
	}
}

/**
 * Gets configured Ollama base endpoint URL.
 */
export function getOllamaBaseUrl(): string {
	const config = vscode.workspace.getConfiguration("copilot");
	const configured = config.get<string>("ollamaUrl") || process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
	return configured.replace(/\/+$/, "");
}

/**
 * Queries the local Ollama service for installed models and registers them automatically.
 */
export async function syncOllamaModels(options?: { notify?: boolean }): Promise<CustomModelEntry[]> {
	const ollamaUrl = getOllamaBaseUrl();
	const tagsEndpoint = `${ollamaUrl}/api/tags`;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 4000);

		const response = await fetch(tagsEndpoint, {
			method: "GET",
			signal: controller.signal,
		});
		clearTimeout(timeoutId);

		if (!response.ok) {
			if (options?.notify) {
				vscode.window.showErrorMessage(`Ollama service returned HTTP ${response.status} from ${tagsEndpoint}`);
			}
			return [];
		}

		const data = (await response.json()) as { models?: OllamaModelTag[] };
		const tags = data.models ?? [];

		// Filter out pure embedding models (e.g. nomic-embed-text)
		const chatTags = tags.filter((tag) => {
			const caps = tag.capabilities;
			if (caps && Array.isArray(caps)) {
				if (caps.includes("completion") || caps.includes("chat")) return true;
				if (caps.length === 1 && caps[0] === "embedding") return false;
			}
			return true;
		});

		if (chatTags.length === 0) {
			if (options?.notify) {
				vscode.window.showInformationMessage("Ollama is running, but no chat models are currently installed.");
			}
			return [];
		}

		const entries: CustomModelEntry[] = chatTags.map((tag) => {
			const name = tag.name || tag.model;
			const isReasoning = Boolean(
				tag.capabilities?.includes("thinking") ||
					/r1|reason|think/i.test(name) ||
					/r1|reason|think/i.test(tag.details?.family || ""),
			);
			const contextWindow = tag.details?.context_length || 128000;
			const hasVision = Boolean(tag.capabilities?.includes("vision"));
			const supportsTools = tag.capabilities?.includes("tools") ?? true;

			return {
				id: name,
				name,
				label: `Ollama: ${name}`,
				baseUrl: `${ollamaUrl}/v1`,
				apiKey: "ollama",
				api: "openai-completions",
				thinking: isReasoning,
				reasoning: isReasoning,
				contextWindow,
				maxOutputTokens: 8192,
				vision: hasVision,
				toolCalling: supportsTools,
				isOllama: true,
			};
		});

		// Save into configuration
		const config = vscode.workspace.getConfiguration("copilot");
		const current = config.get<CustomModelEntry[]>("customModels") ?? [];
		// Keep non-Ollama models and update Ollama models
		const nonOllama = current.filter((m) => !m.isOllama && !entries.some((e) => e.id === m.id));
		const merged = [...nonOllama, ...entries];
		await config.update("customModels", merged, vscode.ConfigurationTarget.Global);

		// Register in shared backend if active
		if (sharedBackend) {
			const providers = convertCustomModelsToProviders(entries, "ollama");
			for (const [providerId, provider] of Object.entries(providers)) {
				await sharedBackend.registerCustomProvider(providerId, provider);
			}
		}

		// Set default active model if not set or previous model not in list
		if (!activeModelId || !merged.some((m) => m.id === activeModelId)) {
			// Prefer high-capability models
			const preferred =
				entries.find((e) => /qwen|coder|llama|deepseek/i.test(e.id)) || entries[0];
			if (preferred) {
				await setActiveModelId(preferred.id);
			}
		} else {
			updateStatusBar();
			sidebarProvider?.refresh();
		}

		if (options?.notify) {
			const names = entries.map((e) => e.name || e.id).join(", ");
			vscode.window.showInformationMessage(
				`Successfully synced ${entries.length} Ollama model(s): ${names}`,
			);
		}

		return entries;
	} catch (err: any) {
		const isOffline = err?.name === "AbortError" || err?.code === "ECONNREFUSED" || err?.message?.includes("fetch failed");
		if (options?.notify) {
			vscode.window.showWarningMessage(
				`Unable to connect to Ollama at ${ollamaUrl}. Make sure the Ollama daemon is running ("ollama serve").`,
			);
		}
		if (isOffline) {
			sidebarProvider?.setOllamaOffline(true);
		}
		return [];
	}
}

/**
 * Provider presets for the interactive custom provider setup wizard.
 */
interface ProviderPreset {
	label: string;
	description: string;
	defaultUrl: string;
	needsApiKey: boolean;
	defaultModel?: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
	{
		label: "DeepSeek",
		description: "DeepSeek V3 / R1 (api.deepseek.com)",
		defaultUrl: "https://api.deepseek.com/v1",
		needsApiKey: true,
		defaultModel: "deepseek-chat",
	},
	{
		label: "OpenRouter",
		description: "Unified AI gateway with Claude, GPT-4, Llama 3, Gemini",
		defaultUrl: "https://openrouter.ai/api/v1",
		needsApiKey: true,
		defaultModel: "meta-llama/llama-3.3-70b-instruct",
	},
	{
		label: "Groq",
		description: "Ultra-fast inference (Llama 3.3, Qwen, DeepSeek)",
		defaultUrl: "https://api.groq.com/openai/v1",
		needsApiKey: true,
		defaultModel: "llama-3.3-70b-versatile",
	},
	{
		label: "Local Ollama",
		description: "Locally running Ollama OpenAI endpoint (localhost:11434)",
		defaultUrl: "http://127.0.0.1:11434/v1",
		needsApiKey: false,
	},
	{
		label: "vLLM / LM Studio / Local OpenAI",
		description: "Self-hosted local OpenAI-compatible inference server",
		defaultUrl: "http://localhost:8000/v1",
		needsApiKey: false,
	},
	{
		label: "Custom OpenAI-Compatible Endpoint",
		description: "Any custom OpenAI-compatible server URL",
		defaultUrl: "https://",
		needsApiKey: true,
	},
];

/**
 * Interactive step-by-step wizard to configure and register a custom provider or model.
 */
export async function promptAndAddCustomProvider(): Promise<void> {
	// Step 1: Select Provider Preset
	const selectedPreset = await vscode.window.showQuickPick(
		PROVIDER_PRESETS.map((p) => ({
			label: p.label,
			description: p.description,
			preset: p,
		})),
		{
			title: "Add Custom AI Provider (Step 1/5: Select Provider Type)",
			placeHolder: "Select a provider preset or custom endpoint",
		},
	);
	if (!selectedPreset) return;

	const preset = selectedPreset.preset;

	// Step 2: Base URL
	const baseUrl = await vscode.window.showInputBox({
		title: `Base URL (Step 2/5: ${preset.label})`,
		prompt: "Enter the OpenAI-compatible Base URL (ending in /v1)",
		value: preset.defaultUrl,
		validateInput: (val) => {
			if (!val || val.trim().length === 0) return "Base URL is required";
			if (!val.startsWith("http://") && !val.startsWith("https://")) {
				return "URL must begin with http:// or https://";
			}
			return null;
		},
	});
	if (!baseUrl) return;
	const cleanBaseUrl = baseUrl.trim().replace(/\/+$/, "");

	// Step 3: API Key
	let apiKey: string | undefined;
	if (preset.needsApiKey) {
		apiKey = await vscode.window.showInputBox({
			title: "API Key (Step 3/5)",
			prompt: `Enter API Key for ${preset.label} (leave blank if authentication is not required)`,
			password: true,
		});
	}

	// Step 4: Model Discovery or Manual Input
	let modelId: string | undefined;
	let fetchedModels: string[] = [];

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Querying available models from ${cleanBaseUrl}...`,
			cancellable: false,
		},
		async () => {
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 4000);
				const headers: Record<string, string> = {};
				if (apiKey && apiKey.trim().length > 0) {
					headers["Authorization"] = `Bearer ${apiKey.trim()}`;
				}
				const res = await fetch(`${cleanBaseUrl}/models`, {
					method: "GET",
					headers,
					signal: controller.signal,
				});
				clearTimeout(timeoutId);
				if (res.ok) {
					const body = (await res.json()) as any;
					if (Array.isArray(body.data)) {
						fetchedModels = body.data.map((m: any) => m.id).filter(Boolean);
					}
				}
			} catch {}
		},
	);

	if (fetchedModels.length > 0) {
		const pickItems = [
			...fetchedModels.slice(0, 50).map((m) => ({ label: m, description: "From endpoint" })),
			{ label: "$(edit) Enter model ID manually...", description: "Specify a custom model name" },
		];
		const modelPick = await vscode.window.showQuickPick(pickItems, {
			title: "Model Selection (Step 4/5)",
			placeHolder: "Select a model discovered from the endpoint, or enter manually",
		});
		if (!modelPick) return;

		if (modelPick.label.includes("Enter model ID manually")) {
			modelId = await vscode.window.showInputBox({
				title: "Enter Model ID",
				prompt: "Enter the model identifier (e.g. deepseek-chat, qwen2.5-coder:32b)",
				value: preset.defaultModel || "",
				validateInput: (val) => (val.trim().length === 0 ? "Model ID is required" : null),
			});
		} else {
			modelId = modelPick.label;
		}
	} else {
		modelId = await vscode.window.showInputBox({
			title: "Model ID (Step 4/5)",
			prompt: "Enter the model ID (e.g. deepseek-chat, gpt-4o, llama-3.3-70b-versatile)",
			value: preset.defaultModel || "",
			placeHolder: "deepseek-chat",
			validateInput: (val) => (val.trim().length === 0 ? "Model ID is required" : null),
		});
	}

	if (!modelId) return;
	const cleanModelId = modelId.trim();

	// Step 5: Capabilities & Reasoning
	const isReasoningLikely = /r1|reason|think|o1|o3/i.test(cleanModelId);
	const reasoningPick = await vscode.window.showQuickPick(
		[
			{
				label: isReasoningLikely ? "Yes (Recommended)" : "Yes",
				description: "Model outputs reasoning / thinking tokens (like DeepSeek R1)",
				thinking: true,
			},
			{
				label: !isReasoningLikely ? "No (Recommended)" : "No",
				description: "Standard chat model without dedicated thinking tokens",
				thinking: false,
			},
		],
		{ title: "Does this model support reasoning / thinking? (Step 5/5)" },
	);
	if (!reasoningPick) return;

	const entry: CustomModelEntry = {
		id: cleanModelId,
		name: cleanModelId,
		label: `${preset.label}: ${cleanModelId}`,
		baseUrl: cleanBaseUrl,
		apiKey: apiKey?.trim() || undefined,
		thinking: reasoningPick.thinking,
		reasoning: reasoningPick.thinking,
		contextWindow: 128000,
		maxOutputTokens: 16384,
		toolCalling: true,
	};

	await addCustomModel(entry);

	const action = await vscode.window.showInformationMessage(
		`Custom model "${cleanModelId}" from ${preset.label} registered successfully!`,
		"Set as Active Model & Open Chat",
		"Done",
	);

	if (action === "Set as Active Model & Open Chat") {
		await setActiveModelId(cleanModelId);
		await vscode.commands.executeCommand("pi.openChat");
	}
}

/**
 * Interactive quick pick to switch the current active model.
 */
export async function promptSelectActiveModel(): Promise<void> {
	const customModels = readVscodeCustomModels();

	if (customModels.length === 0) {
		const choice = await vscode.window.showInformationMessage(
			"No AI models are currently registered. Would you like to sync local Ollama models or add a custom provider?",
			"Sync Ollama Models",
			"Add Custom Provider",
		);
		if (choice === "Sync Ollama Models") {
			await syncOllamaModels({ notify: true });
		} else if (choice === "Add Custom Provider") {
			await promptAndAddCustomProvider();
		}
		return;
	}

	const items = customModels.map((m) => {
		const isCurrent = m.id === activeModelId;
		const prefix = isCurrent ? "$(check) " : "";
		const tags: string[] = [];
		if (m.isOllama) tags.push("Ollama");
		if (m.thinking || m.reasoning) tags.push("Reasoning");
		if (m.contextWindow) tags.push(`${Math.round(m.contextWindow / 1000)}k ctx`);

		return {
			label: `${prefix}${m.name || m.label || m.id}`,
			description: tags.join(" • "),
			detail: `Endpoint: ${m.baseUrl || m.url || "default"}`,
			modelId: m.id,
		};
	});

	items.push({
		label: "$(add) Add Custom Provider / Model...",
		description: "Configure a new OpenAI-compatible API or local model",
		detail: "",
		modelId: "__add__",
	});

	items.push({
		label: "$(sync) Refresh Local Ollama Models...",
		description: "Scan local Ollama daemon for new models",
		detail: "",
		modelId: "__sync_ollama__",
	});

	const selected = await vscode.window.showQuickPick(items, {
		title: "Select Active AI Model for Pi",
		placeHolder: "Choose a model to use for chat and code assistance",
	});

	if (!selected) return;

	if (selected.modelId === "__add__") {
		await promptAndAddCustomProvider();
	} else if (selected.modelId === "__sync_ollama__") {
		await syncOllamaModels({ notify: true });
	} else {
		await setActiveModelId(selected.modelId);
		vscode.window.showInformationMessage(`Active model switched to: ${selected.label.replace("$(check) ", "")}`);
	}
}

/**
 * Updates status bar text and tooltip.
 */
function updateStatusBar(): void {
	if (!statusBarItem) return;
	const currentName = activeModelId || "Select Model";
	statusBarItem.text = `$(sparkle) Pi: ${currentName}`;
	statusBarItem.tooltip = `Pi Coding Assistant | Active Model: ${currentName}\n(Click to switch model)`;
}

/**
 * Tree view item for the Pi Assistant Sidebar.
 */
class PiTreeItem extends vscode.TreeItem {
	constructor(
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
		command?: vscode.Command,
		icon?: string,
		descriptionText?: string,
	) {
		super(label, collapsibleState);
		if (command) {
			this.command = command;
		}
		if (icon) {
			this.iconPath = new vscode.ThemeIcon(icon);
		}
		if (descriptionText) {
			this.description = descriptionText;
		}
	}
}

/**
 * TreeDataProvider backing the "pi-assistant-welcome" view in the activity bar sidebar.
 */
export class PiAssistantSidebarProvider implements vscode.TreeDataProvider<PiTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<PiTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private isOllamaOffline = false;

	setOllamaOffline(offline: boolean) {
		this.isOllamaOffline = offline;
		this.refresh();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: PiTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: PiTreeItem): Promise<PiTreeItem[]> {
		if (element) {
			return [];
		}

		const items: PiTreeItem[] = [];
		const models = readVscodeCustomModels();
		const ollamaModels = models.filter((m) => m.isOllama);
		const customModels = models.filter((m) => !m.isOllama);

		// 1. Active Model
		const currentModelName = activeModelId || (models[0]?.id ?? "None configured");
		items.push(
			new PiTreeItem(
				`Active: ${currentModelName}`,
				vscode.TreeItemCollapsibleState.None,
				{
					command: "pi.selectActiveModel",
					title: "Switch Model",
				},
				"sparkle",
				"Click to change",
			),
		);

		// 2. Ollama Status
		const ollamaStatusDesc = this.isOllamaOffline
			? "Offline (localhost:11434)"
			: `${ollamaModels.length} models detected`;
		items.push(
			new PiTreeItem(
				`Ollama Service`,
				vscode.TreeItemCollapsibleState.None,
				{
					command: "pi.syncOllamaModels",
					title: "Refresh Ollama Models",
				},
				this.isOllamaOffline ? "error" : "server",
				ollamaStatusDesc,
			),
		);

		// 3. Custom Models
		items.push(
			new PiTreeItem(
				`Custom Models (BYOM)`,
				vscode.TreeItemCollapsibleState.None,
				{
					command: "pi.addCustomProvider",
					title: "Add Custom Provider",
				},
				"globe",
				`${customModels.length} registered`,
			),
		);

		// 4. Quick Actions Section
		items.push(
			new PiTreeItem(
				"Open Pi Chat",
				vscode.TreeItemCollapsibleState.None,
				{
					command: "pi.openChat",
					title: "Open Chat",
				},
				"comment-discussion",
			),
		);

		items.push(
			new PiTreeItem(
				"Sync Ollama Models",
				vscode.TreeItemCollapsibleState.None,
				{
					command: "pi.syncOllamaModels",
					title: "Sync Ollama Models",
				},
				"sync",
			),
		);

		items.push(
			new PiTreeItem(
				"Add Custom Provider / Model",
				vscode.TreeItemCollapsibleState.None,
				{
					command: "pi.addCustomProvider",
					title: "Add Custom Provider",
				},
				"add",
			),
		);

		items.push(
			new PiTreeItem(
				"Launch Terminal Agent",
				vscode.TreeItemCollapsibleState.None,
				{
					command: "pi.openTerminalAgent",
					title: "Launch Terminal Agent",
				},
				"terminal",
			),
		);

		return items;
	}
}

/**
 * Wires AgentBackend subscription events to a VS Code ChatResponseStream.
 */
export function wireAgentBackendToChatStream(
	backend: AgentBackend,
	sessionId: string,
	stream: vscode.ChatResponseStream,
	token?: vscode.CancellationToken,
): () => void {
	if (token) {
		token.onCancellationRequested(() => {
			void backend.abort(sessionId);
		});
	}

	return backend.subscribe(sessionId, (event: AgentSessionEvent) => {
		switch (event.type) {
			case "message_update": {
				const delta = (event as any).delta;
				if (typeof delta === "string" && delta.length > 0) {
					stream.markdown(delta);
				}
				break;
			}
			case "tool_execution_start": {
				const toolName = (event as any).toolName ?? "tool";
				stream.progress(`Running: ${toolName}...`);
				break;
			}
			case "tool_execution_end": {
				const toolName = (event as any).toolName ?? "tool";
				stream.progress(`Completed: ${toolName}`);
				break;
			}
			case "compaction_start": {
				stream.markdown(new vscode.MarkdownString("\n\n*Compacting conversation...*\n\n"));
				break;
			}
			case "compaction_end": {
				stream.markdown(new vscode.MarkdownString("\n\n*Conversation compacted.*\n\n"));
				break;
			}
			case "agent_settled": {
				// Turn finished
				break;
			}
			default:
				break;
		}
	});
}

export interface HandleChatRequestOptions {
	backend?: AgentBackend;
	sessionId?: string;
	request: vscode.ChatRequest;
	context: vscode.ChatContext;
	stream: vscode.ChatResponseStream;
	token: vscode.CancellationToken;
	cwd?: string;
}

/**
 * Handles a VS Code chat request using the AgentBackend with active model selection.
 */
export async function handleChatRequest(options: HandleChatRequestOptions): Promise<vscode.ChatResult> {
	const { request, stream, token, cwd } = options;
	const backend = options.backend ?? (await getSharedAgentBackend(cwd));

	let sessionId = options.sessionId;
	if (!sessionId) {
		const runtime = backend.getModelRuntime ? await backend.getModelRuntime() : undefined;
		let targetModel: any;

		// 1. Check if user selected active model in VS Code
		const desiredModelId = activeModelId;
		if (desiredModelId && runtime) {
			const models = runtime.getModels();
			targetModel = models.find(
				(m: { id?: string; name?: string; provider?: string }) =>
					m.id === desiredModelId ||
					m.name === desiredModelId ||
					`${m.provider}/${m.id}` === desiredModelId,
			);
		}

		const created = await backend.createSession({
			cwd,
			enableAttributionHeaders: true,
			model: targetModel,
		});
		sessionId = created.session.sessionId;
	}

	// Wire stream
	const unsubscribe = wireAgentBackendToChatStream(backend, sessionId, stream, token);

	// Extract file references
	const files: string[] = [];
	if (request.references && Array.isArray(request.references)) {
		for (const ref of request.references) {
			if (typeof ref.value === "object" && ref.value && "fsPath" in ref.value) {
				files.push((ref.value as vscode.Uri).fsPath);
			}
		}
	}

	const promptOptions: BackendPromptOptions = {
		files: files.length > 0 ? files : undefined,
	};

	try {
		await backend.prompt(sessionId, request.prompt, promptOptions);
	} catch (err: any) {
		stream.markdown(
			new vscode.MarkdownString(
				`\n\n**Error during inference:** ${err?.message || String(err)}\n\nPlease ensure the active model is reachable or run "Pi: Sync Ollama Models" / "Pi: Select Active Model".`,
			),
		);
	} finally {
		unsubscribe();
	}

	return {};
}

/**
 * Registers configuration listeners, custom model commands, Ollama auto-sync, and UI entrypoints in the extension.
 */
export function registerBackendBridge(context: vscode.ExtensionContext): void {
	// Restore saved active model from global state
	const savedActiveModel = context.globalState.get<string>("pi.activeModelId");
	if (savedActiveModel) {
		activeModelId = savedActiveModel;
	}

	// 1. Register Sidebar Tree View Provider
	sidebarProvider = new PiAssistantSidebarProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider("pi-assistant-welcome", sidebarProvider),
	);

	// 2. Register Commands
	context.subscriptions.push(
		vscode.commands.registerCommand("pi.syncOllamaModels", async () => {
			await syncOllamaModels({ notify: true });
			sidebarProvider?.refresh();
			updateStatusBar();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("pi.addCustomProvider", async () => {
			await promptAndAddCustomProvider();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("pi.addCustomModel", async () => {
			await promptAndAddCustomProvider();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("pi.selectActiveModel", async () => {
			await promptSelectActiveModel();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("pi.refreshSidebar", () => {
			sidebarProvider?.refresh();
		}),
	);

	// 3. Open chat shortcut command — opens VS Code chat pre-targeted to the @pi participant.
	//    Uses IChatViewOpenOptions (query + isPartialQuery) from workbench.action.chat.open,
	//    as documented in VS Code's chatActions.ts. Falls back through legacy/sidebar commands
	//    for older VS Code versions or environments without Copilot Chat.
	context.subscriptions.push(
		vscode.commands.registerCommand("pi.openChat", async (queryArg?: unknown) => {
			// Build the initial query: if a prompt was passed inject it after @pi, otherwise
			// just target the participant so the user sees the @pi context immediately.
			const userPrompt =
				typeof queryArg === "string"
					? queryArg
					: queryArg && typeof queryArg === "object" && "query" in queryArg
						? String((queryArg as { query: unknown }).query)
						: undefined;

			// Prefix with @pi to target this extension's chat participant (id: pi.chat, name: pi).
			// isPartialQuery:true means VS Code pre-fills the input but does not auto-submit,
			// letting the user confirm or extend the prompt.
			const query = userPrompt ? `@pi ${userPrompt}` : "@pi ";
			const openOptions = { query, isPartialQuery: !userPrompt };

			// 1. Primary: workbench.action.chat.open with IChatViewOpenOptions
			try {
				await vscode.commands.executeCommand("workbench.action.chat.open", openOptions);
				return;
			} catch (e) {
				console.warn("[Pi] workbench.action.chat.open failed:", e);
			}

			// 2. Fallback: workbench.action.openChat (alias used in some VS Code builds)
			try {
				await vscode.commands.executeCommand("workbench.action.openChat", openOptions);
				return;
			} catch (e) {
				console.warn("[Pi] workbench.action.openChat failed:", e);
			}

			// 3. Fallback: open a new chat session without query pre-fill
			try {
				await vscode.commands.executeCommand("workbench.action.chat.newChat");
				return;
			} catch (e) {
				console.warn("[Pi] workbench.action.chat.newChat failed:", e);
			}

			// 4. Fallback: focus the Copilot chat panel view
			try {
				await vscode.commands.executeCommand("workbench.panel.chat.view.copilot.focus");
				return;
			} catch (e) {
				console.warn("[Pi] workbench.panel.chat.view.copilot.focus failed:", e);
			}

			// 5. Fallback: toggle chat (older VS Code versions)
			try {
				await vscode.commands.executeCommand("workbench.action.chat.toggle");
				return;
			} catch (e) {
				console.warn("[Pi] workbench.action.chat.toggle failed:", e);
			}

			// 6. Fallback: quick chat toggle
			try {
				await vscode.commands.executeCommand("workbench.action.quickchat.toggle");
				return;
			} catch (e) {
				console.warn("[Pi] workbench.action.quickchat.toggle failed:", e);
			}

			// 7. Last resort: focus Pi's own sidebar container
			try {
				await vscode.commands.executeCommand("workbench.view.extension.pi-assistant-sidebar");
			} catch (e) {
				console.warn("[Pi] workbench.view.extension.pi-assistant-sidebar failed:", e);
			}
		}),
	);

	// 4. Launch terminal agent command
	context.subscriptions.push(
		vscode.commands.registerCommand("pi.openTerminalAgent", () => {
			let terminal = vscode.window.terminals.find((t) => t.name === "Pi Agent");
			if (!terminal) {
				terminal = vscode.window.createTerminal({ name: "Pi Agent" });
			}
			terminal.show();
			terminal.sendText("pi");
		}),
	);

	// 5. Persistent Status Bar Item for instant access and active model indicator
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.name = "Pi Coding Assistant";
	statusBarItem.command = "pi.selectActiveModel";
	updateStatusBar();
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	// 6. Stable Chat Participant Registration (@pi)
	if (vscode.chat?.createChatParticipant) {
		try {
			const piParticipant = vscode.chat.createChatParticipant(
				"pi.chat",
				async (request, context, stream, token) => {
					return handleChatRequest({
						request,
						context,
						stream,
						token,
					});
				},
			);
			piParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, "assets", "logo.png");
			context.subscriptions.push(piParticipant);
		} catch (err) {
			console.error("Failed to register stable pi.chat participant:", err);
		}
	}

	// 7. Auto-sync Ollama models on extension startup (silent)
	void syncOllamaModels({ notify: false });

	// 8. Config change listener
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (
				e.affectsConfiguration("copilot.customModels") ||
				e.affectsConfiguration("copilot.apiKey") ||
				e.affectsConfiguration("copilot.ollamaUrl")
			) {
				sharedBackend = undefined;
				sidebarProvider?.refresh();
				updateStatusBar();
			}
		}),
	);
}
