import * as vscode from 'vscode';
import { PiSettings } from '../config/settings';
import {
	readVscodeCustomModels,
	syncOllamaModels,
	addCustomModel,
	setActiveModelId,
	getActiveModelId,
	normalizeEndpointUrl,
} from '../backend-bridge';

export interface ModelEntry {
	id: string;
	name: string;
	provider: 'ollama' | 'byom' | 'builtin';
	baseUrl?: string;
	details?: string;
}

export class ModelManager {
	private static instance: ModelManager;
	private isOllamaConnected: boolean = false;
	private _onDidChangeModels = new vscode.EventEmitter<void>();
	readonly onDidChangeModels = this._onDidChangeModels.event;

	private constructor() {
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('pi')) {
				this._onDidChangeModels.fire();
			}
		});
	}

	static getInstance(): ModelManager {
		if (!ModelManager.instance) {
			ModelManager.instance = new ModelManager();
		}
		return ModelManager.instance;
	}

	get isOllamaOnline(): boolean {
		return this.isOllamaConnected || this.getAllModels().some((m) => m.provider === 'ollama');
	}

	async syncOllama(notify: boolean = false): Promise<void> {
		try {
			const models = await syncOllamaModels({ notify });
			this.isOllamaConnected = models.length > 0;
		} catch (err) {
			this.isOllamaConnected = false;
			if (notify) {
				vscode.window.showWarningMessage(`Pi: Could not connect to Ollama at ${PiSettings.ollamaUrl}`);
			}
		}

		// Ensure active model is valid
		const currentActive = PiSettings.activeModel || getActiveModelId();
		const all = this.getAllModels();
		if (!currentActive || !all.some((m) => m.id === currentActive)) {
			if (all.length > 0) {
				await PiSettings.setActiveModel(all[0].id);
				await setActiveModelId(all[0].id);
			}
		}

		this._onDidChangeModels.fire();
	}

	getAllModels(): ModelEntry[] {
		const custom = readVscodeCustomModels();
		return custom.map((m) => ({
			id: m.id,
			name: m.name || m.label || m.id,
			provider: m.isOllama ? ('ollama' as const) : ('byom' as const),
			baseUrl: m.baseUrl || m.url,
			details: m.isOllama
				? 'Ollama'
				: m.contextWindow
					? `${Math.round(m.contextWindow / 1000)}k ctx`
					: undefined,
		}));
	}

	getActiveModel(): ModelEntry | undefined {
		const id = PiSettings.activeModel || getActiveModelId();
		const all = this.getAllModels();
		return all.find((m) => m.id === id) || all[0];
	}

	async promptSelectModel(): Promise<void> {
		const all = this.getAllModels();
		if (all.length === 0) {
			const res = await vscode.window.showWarningMessage(
				'No models available. Sync Ollama or add a custom model?',
				'Sync Ollama',
				'Add Model'
			);
			if (res === 'Sync Ollama') await this.syncOllama(true);
			if (res === 'Add Model') await this.promptAddModel();
			return;
		}

		const currentActive = PiSettings.activeModel || getActiveModelId();
		const items = all.map((m) => ({
			label: m.name,
			description: m.provider === 'ollama' ? 'Ollama' : 'Custom (BYOM)',
			detail: m.id === currentActive ? '✓ Currently Active' : (m.details || m.baseUrl),
			modelId: m.id,
		}));

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select active model for Pi Assistant',
		});

		if (selected) {
			await PiSettings.setActiveModel(selected.modelId);
			await setActiveModelId(selected.modelId);
			this._onDidChangeModels.fire();
			vscode.window.showInformationMessage(`Pi: Active model set to ${selected.label}`);
		}
	}

	async promptAddModel(): Promise<void> {
		interface ProviderPreset extends vscode.QuickPickItem {
			defaultUrl?: string;
			defaultModel?: string;
			defaultName?: string;
		}

		const presets: ProviderPreset[] = [
			{
				label: '$(cloud) DeepSeek',
				description: 'https://api.deepseek.com/v1',
				detail: 'DeepSeek Chat (V3) or DeepSeek Reasoner (R1)',
				defaultUrl: 'https://api.deepseek.com/v1',
				defaultModel: 'deepseek-chat',
				defaultName: 'DeepSeek V3',
			},
			{
				label: '$(cloud) OpenRouter',
				description: 'https://openrouter.ai/api/v1',
				detail: 'Unified gateway for DeepSeek, Anthropic, Meta, and hundreds of models',
				defaultUrl: 'https://openrouter.ai/api/v1',
				defaultModel: 'deepseek/deepseek-r1',
				defaultName: 'OpenRouter R1',
			},
			{
				label: '$(zap) Groq',
				description: 'https://api.groq.com/openai/v1',
				detail: 'Ultra-fast inference (Llama 3.3, Mixtral)',
				defaultUrl: 'https://api.groq.com/openai/v1',
				defaultModel: 'llama-3.3-70b-versatile',
				defaultName: 'Groq Llama 3.3',
			},
			{
				label: '$(sparkle) OpenAI',
				description: 'https://api.openai.com/v1',
				detail: 'GPT-4o, GPT-4o-mini, o1',
				defaultUrl: 'https://api.openai.com/v1',
				defaultModel: 'gpt-4o',
				defaultName: 'OpenAI GPT-4o',
			},
			{
				label: '$(globe) Custom OpenAI-Compatible Endpoint',
				description: 'LM Studio, vLLM, Ollama OpenAI API, LocalAI, etc.',
				detail: 'Specify custom base URL, model name, and optional API key',
				defaultUrl: 'http://localhost:1234/v1',
				defaultModel: 'model',
				defaultName: 'Custom Model',
			},
		];

		const selectedPreset = await vscode.window.showQuickPick(presets, {
			placeHolder: 'Select a custom provider preset or choose custom endpoint',
			ignoreFocusOut: true,
		});
		if (!selectedPreset) return;

		const baseUrl = await vscode.window.showInputBox({
			prompt: '1/4: Enter OpenAI-compatible Base URL',
			value: selectedPreset.defaultUrl || 'http://localhost:1234/v1',
			ignoreFocusOut: true,
			validateInput: val => (val && val.trim() ? null : 'Base URL cannot be empty'),
		});
		if (!baseUrl) return;

		const id = await vscode.window.showInputBox({
			prompt: '2/4: Enter Model Identifier (passed in API request)',
			value: selectedPreset.defaultModel || '',
			placeHolder: 'e.g. deepseek-chat, gpt-4o, llama-3.3-70b',
			ignoreFocusOut: true,
			validateInput: val => (val && val.trim() ? null : 'Model Identifier cannot be empty'),
		});
		if (!id) return;

		const name = await vscode.window.showInputBox({
			prompt: '3/4: Enter Friendly Display Name in VS Code',
			value: selectedPreset.defaultName || id,
			placeHolder: 'e.g. DeepSeek V3',
			ignoreFocusOut: true,
			validateInput: val => (val && val.trim() ? null : 'Display Name cannot be empty'),
		});
		if (!name) return;

		const apiKey = await vscode.window.showInputBox({
			prompt: '4/4: Enter API Key (optional for local/unauthenticated endpoints)',
			placeHolder: 'sk-... (or leave empty for local endpoints)',
			password: true,
			ignoreFocusOut: true,
		});

		const cleanUrl = normalizeEndpointUrl(baseUrl);

		await addCustomModel({
			id: id.trim(),
			name: name.trim(),
			baseUrl: cleanUrl,
			apiKey: apiKey?.trim() || undefined,
		});

		await setActiveModelId(id.trim());
		this._onDidChangeModels.fire();
		vscode.window.showInformationMessage(`Pi: Successfully configured "${name.trim()}" as active model!`);
	}
}
