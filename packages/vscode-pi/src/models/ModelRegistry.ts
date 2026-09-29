import * as vscode from 'vscode';
import { PiModel } from './types';
import { OllamaService } from './OllamaService';
import { ProviderService } from './ProviderService';
import { PiConfiguration } from '../configuration/configuration';
import { PiLogger } from '../logging/logger';

export class ModelRegistry implements vscode.Disposable {
	private _models: PiModel[] = [];
	private _activeModelId: string = '';
	private _isOllamaOnline: boolean = false;
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	public readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

	constructor(
		private readonly _config: PiConfiguration,
		private readonly _ollamaService: OllamaService,
		private readonly _providerService: ProviderService,
		private readonly _logger: PiLogger
	) {
		this._activeModelId = this._config.getActiveModelId();
	}

	public get models(): readonly PiModel[] {
		return this._models;
	}

	public get isOllamaOnline(): boolean {
		return this._isOllamaOnline;
	}

	public getActiveModel(): PiModel | undefined {
		if (this._activeModelId) {
			const found = this._models.find(m => m.id === this._activeModelId);
			if (found) return found;
		}
		return this._models[0];
	}

	public async setActiveModel(modelId: string): Promise<void> {
		this._activeModelId = modelId;
		await this._config.setActiveModelId(modelId);
		this._logger.info('model', `Active model set to: ${modelId}`);
		this._onDidChange.fire();
	}

	public async syncOllama(forceNotify: boolean = false): Promise<void> {
		this._logger.info('ollama', 'Starting Ollama model sync...');
		const res = await this._ollamaService.listModels();
		this._isOllamaOnline = res.connected;

		const customModels = this._providerService.getCustomModels();
		this._models = [...res.models, ...customModels];

		if (!this._activeModelId && this._models.length > 0) {
			this._activeModelId = this._models[0].id;
			await this._config.setActiveModelId(this._activeModelId);
		}

		this._onDidChange.fire();

		if (forceNotify) {
			if (res.connected) {
				vscode.window.showInformationMessage(`Pi: Discovered ${res.models.length} Ollama models.`);
			} else {
				vscode.window.showWarningMessage(`Pi: Could not connect to Ollama at ${this._config.ollamaUrl} (${res.error || 'offline'}).`);
			}
		}
	}

	public refreshCustomModels(): void {
		const customModels = this._providerService.getCustomModels();
		const ollamaModels = this._models.filter(m => m.providerId === 'ollama');
		this._models = [...ollamaModels, ...customModels];
		this._onDidChange.fire();
	}

	public dispose(): void {
		this._onDidChange.dispose();
	}
}
