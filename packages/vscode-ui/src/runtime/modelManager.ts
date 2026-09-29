import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { PiSettings } from '../config/settings';

export interface ModelEntry {
	id: string;
	name: string;
	provider: 'ollama' | 'byom' | 'builtin';
	baseUrl?: string;
	details?: string;
}

export class ModelManager {
	private static instance: ModelManager;
	private ollamaModels: ModelEntry[] = [];
	private isOllamaConnected: boolean = false;
	private _onDidChangeModels = new vscode.EventEmitter<void>();
	readonly onDidChangeModels = this._onDidChangeModels.event;

	private constructor() {}

	static getInstance(): ModelManager {
		if (!ModelManager.instance) {
			ModelManager.instance = new ModelManager();
		}
		return ModelManager.instance;
	}

	get isOllamaOnline(): boolean {
		return this.isOllamaConnected;
	}

	async syncOllama(notify: boolean = false): Promise<void> {
		const urlString = PiSettings.ollamaUrl.replace(/\/$/, '') + '/api/tags';
		try {
			const data = await this.httpGetJson(urlString);
			if (data && Array.isArray(data.models)) {
				this.ollamaModels = data.models.map((m: any) => ({
					id: m.name,
					name: m.name,
					provider: 'ollama',
					details: m.details?.parameter_size ? `${m.details.parameter_size}, ${m.details.quantization_level || ''}` : undefined,
				}));
				this.isOllamaConnected = true;
				if (notify) {
					vscode.window.showInformationMessage(`Pi: Successfully detected ${this.ollamaModels.length} Ollama models.`);
				}
			} else {
				this.ollamaModels = [];
				this.isOllamaConnected = true;
			}
		} catch (err) {
			this.ollamaModels = [];
			this.isOllamaConnected = false;
			if (notify) {
				vscode.window.showWarningMessage(`Pi: Could not connect to Ollama at ${PiSettings.ollamaUrl}`);
			}
		}

		// Ensure active model is valid
		const currentActive = PiSettings.activeModel;
		if (!currentActive) {
			const all = this.getAllModels();
			if (all.length > 0) {
				await PiSettings.setActiveModel(all[0].id);
			}
		}

		this._onDidChangeModels.fire();
	}

	getAllModels(): ModelEntry[] {
		const custom = PiSettings.customModels.map(m => ({
			id: m.id,
			name: m.name || m.id,
			provider: 'byom' as const,
			baseUrl: m.baseUrl,
		}));

		return [...this.ollamaModels, ...custom];
	}

	getActiveModel(): ModelEntry | undefined {
		const id = PiSettings.activeModel;
		const all = this.getAllModels();
		return all.find(m => m.id === id) || all[0];
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

		const currentActive = PiSettings.activeModel;
		const items = all.map(m => ({
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

		const cleanUrl = baseUrl.trim().replace(/\/+$/, '');

		await PiSettings.addCustomModel({
			id: id.trim(),
			name: name.trim(),
			baseUrl: cleanUrl,
			apiKey: apiKey?.trim() || undefined,
		});

		await PiSettings.setActiveModel(id.trim());
		this._onDidChangeModels.fire();
		vscode.window.showInformationMessage(`Pi: Successfully configured "${name.trim()}" as active model!`);
	}

	private httpGetJson(urlStr: string): Promise<any> {
		return new Promise((resolve, reject) => {
			const u = new URL(urlStr);
			const lib = u.protocol === 'https:' ? https : http;
			const req = lib.get(u, { timeout: 3000 }, res => {
				if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
					let body = '';
					res.on('data', chunk => body += chunk);
					res.on('end', () => {
						try {
							resolve(JSON.parse(body));
						} catch (e) {
							reject(e);
						}
					});
				} else {
					reject(new Error(`HTTP ${res.statusCode}`));
				}
			});
			req.on('error', reject);
			req.on('timeout', () => {
				req.destroy();
				reject(new Error('Timeout'));
			});
		});
	}
}
