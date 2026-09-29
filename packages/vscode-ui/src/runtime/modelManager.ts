import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { PiSettings, CustomModelConfig } from '../config/settings';

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
		const name = await vscode.window.showInputBox({
			prompt: 'Enter a display name for the model (e.g. DeepSeek V3)',
			placeHolder: 'DeepSeek V3',
		});
		if (!name) return;

		const id = await vscode.window.showInputBox({
			prompt: 'Enter the model identifier used in API requests (e.g. deepseek-chat)',
			placeHolder: 'deepseek-chat',
		});
		if (!id) return;

		const baseUrl = await vscode.window.showInputBox({
			prompt: 'Enter API base URL (OpenAI-compatible)',
			placeHolder: 'https://api.deepseek.com/v1',
		});
		if (!baseUrl) return;

		const apiKey = await vscode.window.showInputBox({
			prompt: 'Enter API Key (optional for local endpoints)',
			password: true,
		});

		await PiSettings.addCustomModel({
			id,
			name,
			baseUrl,
			apiKey: apiKey || undefined,
		});

		await PiSettings.setActiveModel(id);
		this._onDidChangeModels.fire();
		vscode.window.showInformationMessage(`Pi: Model "${name}" added and set as active.`);
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
