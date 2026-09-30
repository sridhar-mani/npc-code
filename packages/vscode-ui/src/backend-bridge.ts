/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation & Pi Authors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
	createSharedSessionManager,
	ModelRuntime,
	PiAgentBackend,
	type AgentBackend,
	type AgentSessionEvent,
	type ProviderConfigInput,
	type ProviderModelConfig,
} from "@earendil-works/pi-core";
import { createVsCodeTools } from "./tools/vscode-tools";
import { EditorContext } from "./context/editor";
import { WorkspaceContext } from "./context/workspace";
import { DiagnosticsContext } from "./context/diagnostics";
import { PiSettings } from "./config/settings";

const piLog = vscode.window.createOutputChannel("Pi Agent", { log: true });
export const logPi = (message: string): void => {
	piLog.appendLine(`[${new Date().toISOString()}] [Pi] ${message}`);
};

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
let piExtensionContext: vscode.ExtensionContext | undefined;

/**
 * Returns the currently active model ID.
 */
export function getActiveModelId(): string | undefined {
	return PiSettings.activeModel || activeModelId;
}

/**
 * Sets the active model ID and refreshes status bar & sidebar.
 */
export async function setActiveModelId(modelId: string, context?: vscode.ExtensionContext): Promise<void> {
	activeModelId = modelId;
	await PiSettings.setActiveModel(modelId);
	if (context) {
		await context.globalState.update("pi.activeModelId", modelId);
	}
	const config = vscode.workspace.getConfiguration("pi");
	await config.update("activeModel", modelId, vscode.ConfigurationTarget.Global);
	updateStatusBar();
	sidebarProvider?.refresh();
}

/**
 * Normalizes an endpoint URL by stripping any trailing slashes without regex.
 */
export function normalizeEndpointUrl(urlStr: string): string {
	const trimmed = urlStr.trim();
	if (!trimmed) return "";
	try {
		const parsed = new URL(trimmed);
		let pathname = parsed.pathname;
		while (pathname.endsWith("/")) {
			pathname = pathname.slice(0, -1);
		}
		return `${parsed.origin}${pathname}`;
	} catch {
		let end = trimmed.length;
		while (end > 0 && trimmed.charCodeAt(end - 1) === 47 /* '/' */) {
			end--;
		}
		return trimmed.slice(0, end);
	}
}

/**
 * Checks whether an endpoint URL points to a local daemon/service (e.g. Ollama, LM Studio, vLLM)
 * using the standard URL parser hostname without regex heuristics.
 */
export function isLocalEndpoint(urlStr: string): boolean {
	try {
		const parsed = new URL(urlStr);
		const host = parsed.hostname.toLowerCase();
		return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0" || host.endsWith(".local");
	} catch {
		return false;
	}
}

/**
 * Resets the shared agent backend so subsequent calls create a fresh instance with updated providers.
 */
export function resetSharedAgentBackend(): void {
	sharedBackend = undefined;
}

/**
 * Converts VS Code custom model entries into pi-core ProviderConfigInput records.
 * Supports both local daemons (Ollama, LM Studio) and remote model endpoints (DeepSeek, OpenRouter, etc.).
 */
export function convertCustomModelsToProviders(
	models: readonly CustomModelEntry[],
): Record<string, ProviderConfigInput> {
	const providers: Record<string, ProviderConfigInput> = {};

	for (const entry of models) {
		if (!entry.id) continue;
		const providerId = `custom-${entry.id}`;
		const isLocal = entry.isOllama || (entry.baseUrl ? isLocalEndpoint(entry.baseUrl) : false);
		const defaultLocalUrl = `${getOllamaBaseUrl()}/v1`;
		const rawBaseUrl = entry.baseUrl || entry.url || defaultLocalUrl;
		const baseUrl = normalizeEndpointUrl(rawBaseUrl);
		const apiKey = entry.apiKey || (isLocal ? "ollama" : "");
		const api = (entry.api || "openai-completions") as any;

		const isReasoning = Boolean(entry.thinking || entry.reasoning);
		const isOllama = Boolean(entry.isOllama);
		const modelNameForCompat = `${entry.id} ${entry.name || ""} ${entry.label || ""}`;
		const ollamaThinkingFormat = isOllama && isReasoning
			? (/qwen/i.test(modelNameForCompat) ? "qwen" : /deepseek|r1/i.test(modelNameForCompat) ? "deepseek" : undefined)
			: undefined;
		const modelConfig: ProviderModelConfig = {
			type: "chat",
			id: entry.id,
			name: entry.name || entry.label || entry.id,
			api,
			baseUrl,
			reasoning: isReasoning,
			contextWindow: entry.contextWindow || entry.maxInputTokens || 128000,
			maxTokens: entry.maxOutputTokens || 16384,
			input: entry.vision ? ["text", "image"] : ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			headers: entry.headers || entry.requestHeaders,
			compat: isLocal || isOllama
				? {
						...(isOllama && ollamaThinkingFormat ? { thinkingFormat: ollamaThinkingFormat } : {}),
						...(isLocal ? { maxTokensField: "max_tokens" } : {}),
						supportsStore: false,
						supportsDeveloperRole: false,
						supportsReasoningEffort: false,
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
			apiKey,
			api,
			models: [modelConfig],
			headers: entry.headers || entry.requestHeaders,
		};
	}

	return providers;
}

/**
 * Reads Pi's own model configuration.
 * Ziq/Pi must not depend on GitHub Copilot configuration or storage.
 */
export function readVscodeCustomModels(): CustomModelEntry[] {
	const config = vscode.workspace.getConfiguration("pi");
	const fromPi = config.get<CustomModelEntry[]>("customModels") ?? [];

	const results: CustomModelEntry[] = [];
	const seen = new Set<string>();

	for (const m of fromPi) {
		if (m && m.id && !seen.has(m.id)) {
			seen.add(m.id);
			results.push(m);
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
	const customProviders = convertCustomModelsToProviders(customModels);

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
 * Gets or creates the shared PiAgentBackend instance initialized with all configured custom providers.
 */
let startupModelSync: Promise<CustomModelEntry[]> | undefined;

export async function getSharedAgentBackend(cwd?: string): Promise<PiAgentBackend> {
	if (startupModelSync) {
		await startupModelSync;
	}
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
	const config = vscode.workspace.getConfiguration("pi");
	const current = config.get<CustomModelEntry[]>("customModels") ?? [];
	const index = current.findIndex((m) => m.id === entry.id);
	const updated = [...current];
	if (index >= 0) {
		updated[index] = entry;
	} else {
		updated.push(entry);
	}
	await config.update("customModels", updated, target);

	resetSharedAgentBackend();
	if (sharedBackend) {
		const providers = convertCustomModelsToProviders([entry]);
		for (const [providerId, provider] of Object.entries(providers)) {
			await sharedBackend.registerCustomProvider(providerId, provider);
		}
	}

	if (!PiSettings.activeModel) {
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
	const configured = PiSettings.ollamaUrl || process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
	return normalizeEndpointUrl(configured);
}

/**
 * Queries the local Ollama service for installed models and registers them automatically.
 */
export async function syncOllamaModels(options?: { notify?: boolean }): Promise<CustomModelEntry[]> {
	const ollamaUrl = getOllamaBaseUrl();
	const tagsEndpoint = `${ollamaUrl}/api/tags`;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 3000);

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
				tag.capabilities?.includes("reasoning")
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
		const config = vscode.workspace.getConfiguration("pi");
		const current = config.get<CustomModelEntry[]>("customModels") ?? [];
		// Keep non-Ollama models and update Ollama models
		const nonOllama = current.filter((m) => !m.isOllama && !entries.some((e) => e.id === m.id));
		const merged = [...nonOllama, ...entries];
		await config.update("customModels", merged, vscode.ConfigurationTarget.Global);

		// Invalidate shared backend and update existing if present
		resetSharedAgentBackend();
		if (sharedBackend) {
			const providers = convertCustomModelsToProviders(entries);
			for (const [providerId, provider] of Object.entries(providers)) {
				await sharedBackend.registerCustomProvider(providerId, provider);
			}
		}

		// Set default active model if not set or previous model not in list
		const currentActive = PiSettings.activeModel || getActiveModelId();
		if (!currentActive || !merged.some((m) => m.id === currentActive)) {
			if (entries.length > 0) {
				await setActiveModelId(entries[0].id);
			}
			
		} else {
			if (!activeModelId && currentActive) {
				await setActiveModelId(currentActive);
			}
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
		description: "Locally running Ollama OpenAI-compatible endpoint",
		defaultUrl: `${PiSettings.ollamaUrl}/v1`,
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
	interface ExtendedPresetItem extends vscode.QuickPickItem {
		preset?: ProviderPreset;
		customUrl?: string;
	}

	const defaultPresetItems: ExtendedPresetItem[] = PROVIDER_PRESETS.map((p) => ({
		label: p.label,
		description: p.description,
		detail: p.defaultUrl,
		preset: p,
	}));

	const selection = await new Promise<{ preset: ProviderPreset; customUrl?: string } | undefined>((resolve) => {
		const quickPick = vscode.window.createQuickPick<ExtendedPresetItem>();
		quickPick.title = "Add Custom AI Provider (Step 1/5: Select Provider or Enter URL)";
		quickPick.placeholder = "Select preset or enter endpoint URL (e.g. https://integrate.api.nvidia.com/v1)";
		quickPick.ignoreFocusOut = true;
		quickPick.items = defaultPresetItems;

		const updateOptions = (input: string) => {
			const trimmed = input.trim();
			if (!trimmed) {
				quickPick.items = defaultPresetItems;
				return;
			}
			const isUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://");
			const customItem: ExtendedPresetItem = {
				label: isUrl ? `$(globe) Use Endpoint URL: ${trimmed}` : `$(globe) Custom Provider: ${trimmed}`,
				description: "Press Enter to proceed with this endpoint",
				alwaysShow: true,
				customUrl: isUrl ? trimmed : undefined,
				preset: {
					label: isUrl ? "Custom Endpoint" : trimmed,
					description: trimmed,
					defaultUrl: isUrl ? trimmed : "https://",
					needsApiKey: !isLocalEndpoint(trimmed),
				},
			};
			const matchingPresets = defaultPresetItems.filter(
				(item) => item.label.toLowerCase().includes(trimmed.toLowerCase()) ||
				          item.description?.toLowerCase().includes(trimmed.toLowerCase())
			);
			quickPick.items = [customItem, ...matchingPresets];
		};

		quickPick.onDidChangeValue((val) => updateOptions(val));

		quickPick.onDidAccept(() => {
			const active = quickPick.selectedItems[0];
			if (active) {
				quickPick.hide();
				resolve({
					preset: active.preset || {
						label: "Custom Endpoint",
						description: active.label,
						defaultUrl: active.customUrl || quickPick.value.trim(),
						needsApiKey: !isLocalEndpoint(active.customUrl || quickPick.value.trim()),
					},
					customUrl: active.customUrl,
				});
				return;
			}
			const trimmed = quickPick.value.trim();
			if (trimmed.length > 0) {
				quickPick.hide();
				const isUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://");
				resolve({
					preset: {
						label: isUrl ? "Custom Endpoint" : trimmed,
						description: trimmed,
						defaultUrl: isUrl ? trimmed : "https://",
						needsApiKey: !isLocalEndpoint(trimmed),
					},
					customUrl: isUrl ? trimmed : undefined,
				});
				return;
			}
		});

		quickPick.onDidHide(() => {
			quickPick.dispose();
			resolve(undefined);
		});

		quickPick.show();
	});

	if (!selection) return;

	const preset = selection.preset;
	let cleanBaseUrl: string | undefined = selection.customUrl ? normalizeEndpointUrl(selection.customUrl) : undefined;

	// Step 2: Base URL (skipped if URL was already typed into Step 1)
	if (!cleanBaseUrl) {
		const baseUrl = await vscode.window.showInputBox({
			title: `Base URL (Step 2/5: ${preset.label})`,
			prompt: "Enter the API Base URL (e.g. https://api.deepseek.com/v1 or http://127.0.0.1:11434/v1)",
			value: preset.defaultUrl,
			ignoreFocusOut: true,
			validateInput: (val) => {
				if (!val || val.trim().length === 0) return "Base URL is required";
				if (!val.startsWith("http://") && !val.startsWith("https://")) {
					return "URL must begin with http:// or https://";
				}
				return null;
			},
		});
		if (!baseUrl) return;
		cleanBaseUrl = normalizeEndpointUrl(baseUrl);
	}

	// Step 3: API Key
	let apiKey: string | undefined;
	const isLocal = isLocalEndpoint(cleanBaseUrl);
	apiKey = await vscode.window.showInputBox({
		title: "API Key (Step 3/5)",
		prompt: isLocal
			? `API Key for ${preset.label} (Optional for local endpoints: press Enter to skip)`
			: `Enter API Key for ${preset.label} (leave blank if authentication is not required)`,
		password: true,
		ignoreFocusOut: true,
	});

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

	// Step 5: Wire API Protocol & Capabilities
	const apiPick = await vscode.window.showQuickPick(
		[
			{
				label: "openai-completions",
				description: "Standard OpenAI-compatible completions API (Ollama, vLLM, LM Studio, DeepSeek, Groq, OpenRouter)",
			},
			{
				label: "anthropic-messages",
				description: "Anthropic Messages protocol (Claude, compatible proxies)",
			},
			{
				label: "openai-responses",
				description: "OpenAI Responses protocol (GPT-5, modern OpenAI gateways)",
			},
		],
		{ title: "Select Wire API Protocol (Step 5/6)" },
	);
	const selectedApi = apiPick?.label || "openai-completions";

	// Step 6: Reasoning / Thinking Tokens
	const reasoningPick = await vscode.window.showQuickPick(
		[
			{
				label: "No",
				description: "Standard chat model without dedicated thinking tokens",
				thinking: false,
			},
			{
				label: "Yes",
				description: "Model outputs reasoning / thinking tokens (like DeepSeek R1)",
				thinking: true,
			},
		],
		{ title: "Does this model support reasoning / thinking? (Step 6/6)" },
	);
	if (!reasoningPick) return;

	const entry: CustomModelEntry = {
		id: cleanModelId,
		name: cleanModelId,
		label: `${preset.label}: ${cleanModelId}`,
		baseUrl: cleanBaseUrl,
		apiKey: apiKey?.trim() || undefined,
		api: selectedApi,
		thinking: reasoningPick.thinking,
		reasoning: reasoningPick.thinking,
		contextWindow: 128000,
		maxOutputTokens: 16384,
		toolCalling: true,
		isOllama: isLocal,
	};

	await addCustomModel(entry);

	const action = await vscode.window.showInformationMessage(
		`Custom model "${cleanModelId}" (${selectedApi}) from ${preset.label} registered successfully!`,
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
		const isCurrent = m.id === PiSettings.activeModel;
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
 * Updates status bar text and tooltip with model status and endpoint URL.
 */
function updateStatusBar(): void {
	if (!statusBarItem) return;
	const currentName = PiSettings.activeModel || "Select Model";
	const models = readVscodeCustomModels();
	const activeModel = models.find((m) => m.id === PiSettings.activeModel);
	const endpointUrl = activeModel?.baseUrl || (activeModel?.isOllama ? getOllamaBaseUrl() : undefined);
	const modelStatus = PiSettings.activeModel ? "Ready" : "Not configured";

	statusBarItem.text = `$(sparkle) Pi · ${currentName}`;
	const tooltipLines = [
		`Pi Coding Assistant`,
		`Status: ${modelStatus}`,
		`Active Model: ${currentName}`,
		endpointUrl ? `Endpoint URL: ${endpointUrl}` : undefined,
		`(Click to switch model)`,
	].filter(Boolean);
	statusBarItem.tooltip = tooltipLines.join("\n");
}

/**
 * Tree view item for the Pi Assistant Sidebar.
 */
class PiTreeItem extends vscode.TreeItem {
	children?: PiTreeItem[];

	constructor(
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
		command?: vscode.Command,
		icon?: string,
		descriptionText?: string,
		children?: PiTreeItem[],
	) {
		super(label, collapsibleState);
		this.children = children;
		if (command) this.command = command;
		if (icon) this.iconPath = new vscode.ThemeIcon(icon);
		if (descriptionText) this.description = descriptionText;
		this.tooltip = descriptionText ? `${label} — ${descriptionText}` : label;
	}
}

/**
 * TreeDataProvider backing the "pi-assistant-welcome" view in the activity bar sidebar.
 * Presentation only: commands and backend behavior remain unchanged.
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
		if (element) return element.children ?? [];

		const models = readVscodeCustomModels();
		const ollamaModels = models.filter((m) => m.isOllama);
		const activeModel = models.find((m) => m.id === activeModelId);
		const currentModelName = activeModelId || "No model selected";
		const endpointUrl = activeModel?.baseUrl || (activeModel?.isOllama ? getOllamaBaseUrl() : undefined);

		const chat = new PiTreeItem(
			"Start a conversation",
			vscode.TreeItemCollapsibleState.None,
			{ command: "pi.openChat", title: "Open Pi Chat" },
			"comment-discussion",
			"Open Pi Chat",
		);

		const modelStatus = activeModelId ? "Ready" : "Choose a model to begin";
		const modelItem = new PiTreeItem(
			currentModelName,
			vscode.TreeItemCollapsibleState.None,
			{ command: "pi.selectActiveModel", title: "Select Active Model" },
			"sparkle",
			modelStatus,
		);
		modelItem.tooltip = endpointUrl
			? `Active model: ${currentModelName}\nStatus: ${modelStatus}\nEndpoint: ${endpointUrl}\nClick to switch model`
			: `Active model: ${currentModelName}\nStatus: ${modelStatus}\nClick to switch model`;

		const modelActions = new PiTreeItem(
			"Models",
			vscode.TreeItemCollapsibleState.Expanded,
			undefined,
			"layers",
			`${models.length} configured`,
			[
				modelItem,
				new PiTreeItem(
					"Add model",
					vscode.TreeItemCollapsibleState.None,
					{ command: "pi.addCustomProvider", title: "Add Custom Provider" },
					"add",
					"Connect an OpenAI-compatible provider",
				),
			],
		);

		const ollamaStatus = this.isOllamaOffline
			? "Offline · click to refresh"
			: ollamaModels.length
				? `${ollamaModels.length} local model${ollamaModels.length === 1 ? "" : "s"} available`
				: "No local models detected";

		const localActions = new PiTreeItem(
			"Local models",
			vscode.TreeItemCollapsibleState.Expanded,
			undefined,
			"server",
			ollamaStatus,
			[
				new PiTreeItem(
					this.isOllamaOffline ? "Ollama unavailable" : "Ollama",
					vscode.TreeItemCollapsibleState.None,
					{ command: "pi.syncOllamaModels", title: "Sync Ollama Models" },
					this.isOllamaOffline ? "error" : "circle-filled",
					this.isOllamaOffline ? "http://127.0.0.1:11434" : `${ollamaModels.length} detected`,
				),
				new PiTreeItem(
					"Refresh local models",
					vscode.TreeItemCollapsibleState.None,
					{ command: "pi.syncOllamaModels", title: "Refresh Ollama Models" },
					"sync",
				),
			],
		);

		const workspaceActions = new PiTreeItem(
			"Workspace",
			vscode.TreeItemCollapsibleState.Expanded,
			undefined,
			"folder",
			"Tools for the current project",
			[
				new PiTreeItem(
					"Terminal agent",
					vscode.TreeItemCollapsibleState.None,
					{ command: "pi.openTerminalAgent", title: "Launch Terminal Agent" },
					"terminal",
					"Open Pi in the integrated terminal",
				),
			],
		);

		return [
			chat,
			modelActions,
			localActions,
			workspaceActions,
		];
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
				const assistantMessageEvent = (event as any).assistantMessageEvent;
				if (assistantMessageEvent?.type === "text_delta") {
					const delta = assistantMessageEvent.delta;
					if (typeof delta === "string" && delta.length > 0) {
						stream.markdown(delta);
					}
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

async function handleChatRequest(
	request: vscode.ChatRequest,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
	const cwd = WorkspaceContext.getPrimaryWorkspaceFolder();
	const backend = await getSharedAgentBackend(cwd);
	const runtime = await backend.getModelRuntime();
	const activeId = getActiveModelId();
	let targetModel;
	if (activeId) {
		const models = runtime.getModels();
		targetModel = models.find(
			(m) =>
				m.id === activeId ||
				m.name === activeId ||
				`${m.provider}/${m.id}` === activeId ||
				m.provider === `custom-${activeId}`,
		);
	}

	const created = await backend.createSession({
		cwd,
		model: targetModel,
		enableAttributionHeaders: true,
		customTools: createVsCodeTools(),
	});
	const sessionId = created.session.sessionId;
	const unsubscribe = wireAgentBackendToChatStream(backend, sessionId, stream, token);
	const files = (request.references ?? [])
		.map((ref) => (typeof ref.value === "object" && ref.value && "fsPath" in ref.value ? (ref.value as vscode.Uri).fsPath : undefined))
		.filter((value): value is string => Boolean(value));
	try {
		await backend.prompt(
			sessionId,
			`${getAutomaticVsCodeContext()}\n\n[User request]\n${request.prompt}`,
			{ files: files.length > 0 ? files : undefined },
		);
	} catch (err: any) {
		stream.markdown(new vscode.MarkdownString(`\n\n**Error during Pi inference:** ${err?.message || String(err)}`));
	} finally {
		unsubscribe();
	}
	return {};
}


/**
 * Registers configuration listeners, custom model commands, Ollama auto-sync, and UI entrypoints in the extension.
 */
function getAutomaticVsCodeContext(): string {
	const active = EditorContext.getActiveDocument(false);
	const folders = WorkspaceContext.getFolders();
	const openEditors = EditorContext.getOpenDocuments().slice(0, 20);
	const diagnostics = DiagnosticsContext.getDiagnostics(20);
	return [
		'[VS Code context]',
		`workspace: ${folders.length ? folders.map((f) => f.uri.fsPath).join(', ') : 'no workspace'}`,
		`active file: ${active?.fileName ?? 'none'}`,
		`language: ${active?.languageId ?? 'unknown'}`,
		`selection: ${active?.startLine && active?.endLine ? `${active.startLine}-${active.endLine}` : 'none'}`,
		active?.selectedText ? `selected text:\n${active.selectedText}` : '',
		openEditors.length ? `open editors: ${openEditors.map((e) => e.fileName).join(', ')}` : '',
		diagnostics.length
			? `diagnostics:\n${diagnostics.map((d) => `- [${d.severity}] ${d.file}:${d.line}:${d.character} ${d.message}`).join('\n')}`
			: 'diagnostics: none',
		'Use vscode_* tools for exact contents, symbols, language-service data and edits.',
	].filter(Boolean).join('\n');
}

export function registerBackendBridge(context: vscode.ExtensionContext): void {
	// Restore saved active model from settings or global state.
	const savedActiveModel = context.globalState.get<string>("pi.activeModelId");
	activeModelId = PiSettings.activeModel || savedActiveModel || undefined;

	/**
	 * Register commands independently so an optional UI contribution cannot prevent
	 * the core Pi commands from becoming available to VS Code.
	 */
	const registerPiCommand = (commandId: string, handler: (...args: any[]) => unknown): void => {
		try {
			context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
			piLog.appendLine(`[Pi] Registered command: ${commandId}`);
		} catch (err) {
			const msg = err instanceof Error ? err.stack ?? err.message : String(err);
			piLog.appendLine(`[Pi] Failed to register command ${commandId}: ${msg}`);
			console.error(`[Pi] Failed to register command ${commandId}:`, err);
		}
	};

	// Register the commands before any optional sidebar/status-bar/chat UI setup.
	registerPiCommand("pi.syncOllamaModels", async () => {
		await syncOllamaModels({ notify: true });
		sidebarProvider?.refresh();
		updateStatusBar();
	});

	registerPiCommand("pi.addCustomProvider", async () => {
		await promptAndAddCustomProvider();
	});

	registerPiCommand("pi.addCustomModel", async () => {
		await promptAndAddCustomProvider();
	});

	registerPiCommand("pi.selectActiveModel", async () => {
		await promptSelectActiveModel();
	});

	registerPiCommand("pi.showLogs", () => {
		piLog.show(true);
		logPi("Pi diagnostic log channel opened");
	});

	registerPiCommand("pi.openChat", async () => {
		for (const commandId of [
			"pi-assistant-sidebar.focus",
			"workbench.view.extension.pi-assistant-container",
			"workbench.view.extension.pi-assistant-sidebar",
		]) {
			try {
				await vscode.commands.executeCommand(commandId);
				return;
			} catch {}
		}
	});

	registerPiCommand("pi.openTerminalAgent", () => {
		let terminal = vscode.window.terminals.find((t) => t.name === "Ziq Agent");
		if (!terminal) {
			terminal = vscode.window.createTerminal({ name: "Ziq Agent" });
		}
		terminal.show();
		terminal.sendText("pi");
	});

	// Optional sidebar registration must not block command availability.
	try {
		sidebarProvider = new PiAssistantSidebarProvider();
		context.subscriptions.push(
			vscode.window.registerTreeDataProvider("pi-assistant-welcome", sidebarProvider),
		);
		piLog.appendLine("[Pi] Sidebar registered");
	} catch (err) {
		const msg = err instanceof Error ? err.stack ?? err.message : String(err);
		piLog.appendLine("[Pi] Sidebar registration failed: " + msg);
		console.error("[Pi] Sidebar registration failed:", err);
		sidebarProvider = undefined;
	}

	// Optional status-bar registration must not block command availability.
	try {
		statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		statusBarItem.name = "Ziq Coding Assistant";
		statusBarItem.command = "pi.selectActiveModel";
		updateStatusBar();
		statusBarItem.show();
		context.subscriptions.push(statusBarItem);
	} catch (err) {
		const msg = err instanceof Error ? err.stack ?? err.message : String(err);
		piLog.appendLine("[Pi] Status bar registration failed: " + msg);
		console.error("[Pi] Status bar registration failed:", err);
	}

	// Stable Chat Participant registration (@pi).
	if (vscode.chat?.createChatParticipant) {
		try {
			const piParticipant = vscode.chat.createChatParticipant(
				"pi.chat",
				async (request, _requestContext, stream, token) => {
					return handleChatRequest(request, stream, token);
				},
			);
			piParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, "assets", "logo.png");
			context.subscriptions.push(piParticipant);
			piLog.appendLine("[Pi] Chat participant registered");
		} catch (err) {
			const msg = err instanceof Error ? err.stack ?? err.message : String(err);
			piLog.appendLine("[Pi] Chat participant registration failed: " + msg);
			console.error("[Pi] Chat participant registration failed:", err);
		}
	} else {
		piLog.appendLine("[Pi] Chat participant API is unavailable in this VS Code build");
	}

	// Auto-sync Ollama models on extension startup (silent).
	if (PiSettings.autoSyncOllama) {
		startupModelSync = syncOllamaModels({ notify: false }).finally(() => {
			startupModelSync = undefined;
		});
	}

	// Config change listener.
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (
				e.affectsConfiguration("pi.customModels") ||
				e.affectsConfiguration("pi.ollamaUrl") ||
				e.affectsConfiguration("pi.activeModel") ||
				e.affectsConfiguration("pi.autoSyncOllama") ||
				e.affectsConfiguration("pi")
			) {
				resetSharedAgentBackend();

				if (
					e.affectsConfiguration("pi.ollamaUrl") ||
					e.affectsConfiguration("pi.autoSyncOllama")
				) {
					if (PiSettings.autoSyncOllama) {
						startupModelSync = syncOllamaModels({ notify: false }).finally(() => {
							startupModelSync = undefined;
						});
					}
				}

				sidebarProvider?.refresh();
				updateStatusBar();
			}
		}),
	);
	piLog.appendLine("[Pi] Backend bridge registration completed");
}
