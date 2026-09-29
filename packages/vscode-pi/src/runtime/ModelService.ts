import * as vscode from 'vscode';
import { ModelRegistry } from '../models/ModelRegistry';
import { ProviderService } from '../models/ProviderService';
import { PiModel } from '../models/types';
import { PiLogger } from '../logging/logger';

export class ModelService {
	constructor(
		private readonly _modelRegistry: ModelRegistry,
		private readonly _providerService: ProviderService,
		private readonly _logger: PiLogger
	) {}

	public async promptSelectModel(): Promise<PiModel | undefined> {
		const models = this._modelRegistry.models;
		if (models.length === 0) {
			vscode.window.showWarningMessage('No models available. Please sync Ollama or add a custom model.');
			return undefined;
		}

		const items: Array<vscode.QuickPickItem & { model: PiModel }> = models.map(m => ({
			label: m.name,
			description: m.providerId === 'ollama' ? 'Ollama' : 'Custom / BYOM',
			detail: m.baseUrl ? `Endpoint: ${m.baseUrl}` : undefined,
			model: m,
		}));

		const chosen = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select active model for Pi Assistant',
		});

		if (chosen) {
			await this._modelRegistry.setActiveModel(chosen.model.id);
			vscode.window.showInformationMessage(`Active model set to: ${chosen.model.name}`);
			return chosen.model;
		}
		return undefined;
	}

	public async promptAddCustomModel(): Promise<void> {
		this._logger.info('model', 'Starting custom model wizard');

		const name = await vscode.window.showInputBox({
			prompt: 'Step 1/3: Enter a display name for the model (e.g. DeepSeek-Coder, Qwen-32B)',
			placeHolder: 'My Custom Model',
			validateInput: v => v.trim() ? null : 'Model name is required',
		});
		if (!name) return;

		const baseUrl = await vscode.window.showInputBox({
			prompt: 'Step 2/3: Enter the API Base URL (OpenAI-compatible endpoint)',
			placeHolder: 'http://127.0.0.1:8000/v1 or https://api.deepseek.com/v1',
			validateInput: v => {
				try {
					new URL(v.trim());
					return null;
				} catch {
					return 'Please enter a valid URL';
				}
			},
		});
		if (!baseUrl) return;

		const apiKey = await vscode.window.showInputBox({
			prompt: 'Step 3/3: Enter API Key (optional, press Enter if local / unauthenticated)',
			password: true,
			placeHolder: 'sk-...',
		});

		const id = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');

		await this._providerService.addCustomModel({
			id,
			name: name.trim(),
			baseUrl: baseUrl.trim(),
			providerId: 'byom',
			capabilities: {
				reasoning: false,
				vision: false,
				toolCalling: true,
			},
		}, apiKey ? apiKey.trim() : undefined);

		this._modelRegistry.refreshCustomModels();
		await this._modelRegistry.setActiveModel(id);

		vscode.window.showInformationMessage(`Pi: Successfully added custom model "${name.trim()}".`);
	}
}
