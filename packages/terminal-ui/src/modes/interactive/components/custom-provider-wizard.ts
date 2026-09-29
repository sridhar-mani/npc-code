/**
 * Interactive multi-step wizard for adding a custom AI provider to models.json.
 * Mirrors the VS Code `pi.addCustomProvider` QuickPick flow in terminal form.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	Input,
	type SelectItem,
	SelectList,
	type SelectListLayoutOptions,
	Spacer,
	Text,
	type TUI,
} from "@earendil-works/pi-tui";
import { getModelsPath } from "../../../config.ts";
import { getSelectListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";

// ---------------------------------------------------------------------------
// Provider preset definitions
// ---------------------------------------------------------------------------

interface ProviderPreset {
	readonly label: string;
	readonly description: string;
	readonly defaultUrl: string;
	readonly needsApiKey: boolean;
	readonly defaultModel?: string;
}

const PROVIDER_PRESETS: readonly ProviderPreset[] = [
	{
		label: "DeepSeek",
		description: "DeepSeek V3 / R1 (api.deepseek.com)",
		defaultUrl: "https://api.deepseek.com/v1",
		needsApiKey: true,
		defaultModel: "deepseek-chat",
	},
	{
		label: "OpenRouter",
		description: "Unified gateway: Claude, GPT-4, Llama 3, Gemini",
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
		label: "vLLM / LM Studio",
		description: "Self-hosted local OpenAI-compatible inference server",
		defaultUrl: "http://localhost:8000/v1",
		needsApiKey: false,
	},
	{
		label: "Custom endpoint",
		description: "Any custom OpenAI-compatible server URL",
		defaultUrl: "https://",
		needsApiKey: true,
	},
];

const WIZARD_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 20,
	maxPrimaryColumnWidth: 40,
};

// ---------------------------------------------------------------------------
// Step discriminated union
// ---------------------------------------------------------------------------

type WizardStep =
	| { kind: "preset" }
	| { kind: "url"; preset: ProviderPreset }
	| { kind: "apikey"; preset: ProviderPreset; url: string }
	| { kind: "model"; preset: ProviderPreset; url: string; apiKey: string; fetchedModels: string[] }
	| { kind: "reasoning"; preset: ProviderPreset; url: string; apiKey: string; modelId: string }
	| { kind: "done" };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class CustomProviderWizardComponent extends Container implements Focusable {
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.activeInput.focused = value;
	}

	private readonly tui: TUI;
	private readonly doneCb: () => void;
	private activeInput: Input;
	private selectList: SelectList | undefined;
	private readonly contentContainer: Container;
	private step: WizardStep = { kind: "preset" };

	constructor(tui: TUI, done: () => void) {
		super();
		this.tui = tui;
		this.doneCb = done;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", theme.bold("Add Custom AI Provider (BYOM)")), 1, 0));
		this.addChild(new Spacer(1));

		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		this.activeInput = new Input();
		this.activeInput.onSubmit = () => this.handleInputSubmit();
		this.activeInput.onEscape = () => this.close();

		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg(
					"dim",
					`  ${keyHint("tui.select.cancel", "cancel")} · ${keyHint("tui.select.confirm", "select/confirm")}`,
				),
				0,
				0,
			),
		);
		this.addChild(new DynamicBorder());

		this.renderPresetStep();
	}

	private close(): void {
		this.doneCb();
	}

	private clearContent(): void {
		this.contentContainer.clear();
		this.selectList = undefined;
	}

	// ---------------------------------------------------------------------------
	// Step renderers
	// ---------------------------------------------------------------------------

	private renderPresetStep(): void {
		this.step = { kind: "preset" };
		this.clearContent();
		this.contentContainer.addChild(new Text(theme.fg("dim", "Step 1 / 4 — Select a provider preset:"), 1, 0));
		this.contentContainer.addChild(new Spacer(1));

		const items: SelectItem[] = PROVIDER_PRESETS.map((p) => ({
			value: p.label,
			label: p.label,
			description: p.description,
		}));
		const list = new SelectList(items, Math.min(items.length, 8), getSelectListTheme(), WIZARD_LIST_LAYOUT);
		list.onSelect = (item) => {
			const preset = PROVIDER_PRESETS.find((p) => p.label === item.value);
			if (preset) this.renderUrlStep(preset);
		};
		list.onCancel = () => this.close();
		this.selectList = list;
		this.contentContainer.addChild(list);

		// Also need a scratch input for filtering
		this.activeInput = this.buildInput("");
		this.tui.requestRender();
	}

	private renderUrlStep(preset: ProviderPreset): void {
		this.step = { kind: "url", preset };
		this.clearContent();
		this.contentContainer.addChild(
			new Text(
				theme.fg("dim", `Step 2 / 4 — Base URL for ${preset.label} (OpenAI-compatible, e.g. ending in /v1):`),
				1,
				0,
			),
		);
		this.contentContainer.addChild(new Spacer(1));
		this.activeInput = this.buildInput(preset.defaultUrl);
		this.contentContainer.addChild(this.activeInput);
		this.activeInput.focused = this._focused;
		this.tui.requestRender();
	}

	private renderApiKeyStep(preset: ProviderPreset, url: string): void {
		this.step = { kind: "apikey", preset, url };
		this.clearContent();
		const hint = preset.needsApiKey
			? `Step 3 / 4 — API key for ${preset.label}:`
			: `Step 3 / 4 — ${preset.label} does not require an API key (press Enter to skip):`;
		this.contentContainer.addChild(new Text(theme.fg("dim", hint), 1, 0));
		this.contentContainer.addChild(new Spacer(1));
		this.activeInput = this.buildInput("");
		this.contentContainer.addChild(this.activeInput);
		this.activeInput.focused = this._focused;
		this.tui.requestRender();
	}

	private renderModelStep(preset: ProviderPreset, url: string, apiKey: string, fetchedModels: string[]): void {
		this.step = { kind: "model", preset, url, apiKey, fetchedModels };
		this.clearContent();
		this.contentContainer.addChild(new Text(theme.fg("dim", "Step 4 / 4 — Select or enter a model ID:"), 1, 0));
		this.contentContainer.addChild(new Spacer(1));

		if (fetchedModels.length > 0) {
			const items: SelectItem[] = [
				...fetchedModels.slice(0, 50).map((m) => ({ value: m, label: m, description: "Discovered from endpoint" })),
				{ value: "__manual__", label: "Enter model ID manually...", description: "" },
			];
			const list = new SelectList(items, Math.min(items.length, 8), getSelectListTheme(), WIZARD_LIST_LAYOUT);
			list.onSelect = (item) => {
				if (item.value === "__manual__") {
					this.renderManualModelInput(preset, url, apiKey);
				} else {
					this.renderReasoningStep(preset, url, apiKey, String(item.value));
				}
			};
			list.onCancel = () => this.close();
			this.selectList = list;
			this.contentContainer.addChild(list);
			this.activeInput = this.buildInput("");
		} else {
			this.contentContainer.addChild(
				new Text(theme.fg("dim", "(endpoint did not expose /models — enter model ID manually)"), 1, 0),
			);
			this.contentContainer.addChild(new Spacer(1));
			this.activeInput = this.buildInput(preset.defaultModel ?? "");
			this.contentContainer.addChild(this.activeInput);
		}
		this.activeInput.focused = this._focused;
		this.tui.requestRender();
	}

	private renderManualModelInput(preset: ProviderPreset, url: string, apiKey: string): void {
		this.step = { kind: "model", preset, url, apiKey, fetchedModels: [] };
		this.clearContent();
		this.contentContainer.addChild(
			new Text(theme.fg("dim", `Enter model ID (e.g. ${preset.defaultModel ?? "deepseek-chat"}):`), 1, 0),
		);
		this.contentContainer.addChild(new Spacer(1));
		this.activeInput = this.buildInput(preset.defaultModel ?? "");
		this.contentContainer.addChild(this.activeInput);
		this.activeInput.focused = this._focused;
		this.tui.requestRender();
	}

	private renderReasoningStep(preset: ProviderPreset, url: string, apiKey: string, modelId: string): void {
		this.step = { kind: "reasoning", preset, url, apiKey, modelId };
		this.clearContent();
		this.contentContainer.addChild(
			new Text(theme.fg("dim", "Does this model support reasoning / thinking tokens?"), 1, 0),
		);
		this.contentContainer.addChild(new Spacer(1));

		const isReasoningLikely = /r1|reason|think|o1|o3/i.test(modelId);
		const items: SelectItem[] = [
			{
				value: "yes",
				label: isReasoningLikely ? "Yes (recommended)" : "Yes",
				description: "Outputs reasoning tokens (e.g. DeepSeek R1)",
			},
			{
				value: "no",
				label: !isReasoningLikely ? "No (recommended)" : "No",
				description: "Standard chat model",
			},
		];
		const list = new SelectList(items, 2, getSelectListTheme(), WIZARD_LIST_LAYOUT);
		list.onSelect = (item) => this.finalize(preset, url, apiKey, modelId, item.value === "yes");
		list.onCancel = () => this.close();
		this.selectList = list;
		this.contentContainer.addChild(list);
		this.activeInput = this.buildInput("");
		this.activeInput.focused = this._focused;
		this.tui.requestRender();
	}

	// ---------------------------------------------------------------------------
	// Input helpers
	// ---------------------------------------------------------------------------

	private buildInput(defaultValue: string): Input {
		const input = new Input();
		if (defaultValue) input.setValue(defaultValue);
		input.onSubmit = () => this.handleInputSubmit();
		input.onEscape = () => this.close();
		return input;
	}

	private handleInputSubmit(): void {
		const value = this.activeInput.getValue().trim();
		const s = this.step;

		if (s.kind === "url") {
			if (!value || (!value.startsWith("http://") && !value.startsWith("https://"))) {
				this.appendError("URL must start with http:// or https://");
				return;
			}
			this.renderApiKeyStep(s.preset, value.replace(/\/+$/, ""));
		} else if (s.kind === "apikey") {
			this.fetchAndRenderModelStep(s.preset, s.url, value);
		} else if (s.kind === "model") {
			if (!value) {
				this.appendError("Model ID is required");
				return;
			}
			this.renderReasoningStep(s.preset, s.url, s.apiKey, value);
		}
	}

	private appendError(msg: string): void {
		this.contentContainer.addChild(new Text(theme.fg("error", `  Error: ${msg}`), 0, 0));
		this.tui.requestRender();
	}

	// ---------------------------------------------------------------------------
	// Model discovery
	// ---------------------------------------------------------------------------

	private fetchAndRenderModelStep(preset: ProviderPreset, url: string, apiKey: string): void {
		this.step = { kind: "model", preset, url, apiKey, fetchedModels: [] };
		this.clearContent();
		this.contentContainer.addChild(new Spacer(1));
		this.contentContainer.addChild(new Text(theme.fg("dim", `Querying ${url}/models ...`), 1, 0));
		this.tui.requestRender();

		const headers: Record<string, string> = {};
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 4000);

		fetch(`${url}/models`, { method: "GET", headers, signal: controller.signal })
			.then(async (res) => {
				clearTimeout(timeoutId);
				let fetchedModels: string[] = [];
				if (res.ok) {
					const body = (await res.json()) as { data?: { id?: string }[] };
					if (Array.isArray(body.data)) {
						fetchedModels = body.data.map((m) => m.id ?? "").filter(Boolean);
					}
				}
				this.renderModelStep(preset, url, apiKey, fetchedModels);
			})
			.catch(() => {
				clearTimeout(timeoutId);
				this.renderModelStep(preset, url, apiKey, []);
			});
	}

	// ---------------------------------------------------------------------------
	// Finalize
	// ---------------------------------------------------------------------------

	private finalize(preset: ProviderPreset, url: string, apiKey: string, modelId: string, reasoning: boolean): void {
		this.clearContent();
		this.contentContainer.addChild(new Spacer(1));
		this.step = { kind: "done" };

		try {
			const modelsPath = getModelsPath();
			mkdirSync(dirname(modelsPath), { recursive: true });

			let config: { providers?: Record<string, unknown> } = {};
			try {
				config = JSON.parse(readFileSync(modelsPath, "utf8")) as typeof config;
			} catch {
				// File does not exist yet
			}
			config.providers ??= {};

			const host = (() => {
				try {
					return new URL(url).hostname.replace(/\./g, "-");
				} catch {
					return "custom";
				}
			})();
			const providerKey = `${host}-${modelId.replace(/[^a-z0-9]/gi, "-")}`.toLowerCase();

			config.providers[providerKey] = {
				baseUrl: url,
				api: "openai-completions",
				...(apiKey ? { apiKey } : {}),
				models: [
					{
						id: modelId,
						name: `${preset.label}: ${modelId}`,
						...(reasoning ? { thinking: true, reasoning: true } : {}),
						contextWindow: 128000,
						maxOutputTokens: 16384,
						toolCalling: true,
					},
				],
			};

			writeFileSync(modelsPath, JSON.stringify(config, null, 2));

			this.contentContainer.addChild(
				new Text(theme.fg("success", `  Saved ${providerKey}/${modelId} to models.json`), 1, 0),
			);
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(theme.fg("dim", "  Run /reload then /model to activate your new provider."), 1, 0),
			);
		} catch (err) {
			this.contentContainer.addChild(
				new Text(
					theme.fg("error", `  Failed to write models.json: ${err instanceof Error ? err.message : String(err)}`),
					1,
					0,
				),
			);
		}

		this.contentContainer.addChild(new Spacer(1));
		this.contentContainer.addChild(new Text(theme.fg("dim", `  (${keyHint("tui.select.cancel", "close")})`), 1, 0));
		this.tui.requestRender();
	}

	// ---------------------------------------------------------------------------
	// Input routing
	// ---------------------------------------------------------------------------

	handleInput(keyData: string): void {
		const kb = getKeybindings();

		if (kb.matches(keyData, "tui.select.cancel")) {
			this.close();
			return;
		}

		if (this.selectList) {
			const isNav =
				kb.matches(keyData, "tui.select.up") ||
				kb.matches(keyData, "tui.select.down") ||
				kb.matches(keyData, "tui.select.confirm") ||
				kb.matches(keyData, "tui.select.cancel");
			if (isNav) {
				this.selectList.handleInput(keyData);
				return;
			}

			// Typing on the preset step filters the list
			if (this.step.kind === "preset") {
				this.activeInput.handleInput(keyData);
				const query = this.activeInput.getValue();
				const all: SelectItem[] = PROVIDER_PRESETS.map((p) => ({
					value: p.label,
					label: p.label,
					description: p.description,
				}));
				const filtered = query ? fuzzyFilter(all, query, (item) => `${item.label} ${item.description ?? ""}`) : all;
				const newList = new SelectList(
					filtered,
					Math.min(filtered.length, 8),
					getSelectListTheme(),
					WIZARD_LIST_LAYOUT,
				);
				newList.onSelect = (item) => {
					const preset = PROVIDER_PRESETS.find((p) => p.label === item.value);
					if (preset) this.renderUrlStep(preset);
				};
				newList.onCancel = () => this.close();
				const idx = this.contentContainer.children.indexOf(this.selectList);
				if (idx !== -1) this.contentContainer.children[idx] = newList;
				this.selectList = newList;
				this.tui.requestRender();
				return;
			}
		}

		// Text-entry steps
		this.activeInput.handleInput(keyData);
	}
}
