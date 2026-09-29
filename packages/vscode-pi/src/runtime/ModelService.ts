import * as vscode from 'vscode';
import { ModelRegistry } from '../models/ModelRegistry';
import { ProviderService } from '../models/ProviderService';
import { PiModel } from '../models/types';
import { PiLogger } from '../logging/logger';

interface ProviderTemplate {
	id: string;
	label: string;
	description: string;
	defaultUrl: string;
	defaultModel?: string;
	requiresKey: boolean;
}

const PROVIDER_TEMPLATES: ProviderTemplate[] = [
	{
		id: 'deepseek',
		label: 'DeepSeek',
		description: 'https://api.deepseek.com/v1',
		defaultUrl: 'https://api.deepseek.com/v1',
		defaultModel: 'deepseek-chat',
		requiresKey: true,
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		description: 'https://openrouter.ai/api/v1',
		defaultUrl: 'https://openrouter.ai/api/v1',
		defaultModel: 'anthropic/claude-3.5-sonnet',
		requiresKey: true,
	},
	{
		id: 'groq',
		label: 'Groq',
		description: 'https://api.groq.com/openai/v1',
		defaultUrl: 'https://api.groq.com/openai/v1',
		defaultModel: 'llama-3.3-70b-versatile',
		requiresKey: true,
	},
	{
		id: 'vllm',
		label: 'vLLM / LM Studio / Local Gateway',
		description: 'http://127.0.0.1:8000/v1',
		defaultUrl: 'http://127.0.0.1:8000/v1',
		requiresKey: false,
	},
	{
		id: 'openai',
		label: 'OpenAI-Compatible Custom Endpoint',
		description: 'Specify any custom OpenAI-compatible server URL',
		defaultUrl: 'http://127.0.0.1:8080/v1',
		requiresKey: false,
	},
];

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
			description: m.providerId === 'ollama' ? 'Ollama' : (m.modelName ? `${m.providerId} (${m.modelName})` : m.providerId),
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

		// Step 1: Provider selection
		const providerItems: Array<vscode.QuickPickItem & { template: ProviderTemplate }> = PROVIDER_TEMPLATES.map(t => ({
			label: t.label,
			description: t.description,
			template: t,
		}));

		const chosenProvider = await vscode.window.showQuickPick(providerItems, {
			placeHolder: 'Step 1/6: Select Model Provider / Endpoint Type',
		});
		if (!chosenProvider) return;

		const template = chosenProvider.template;

		// Step 2: Base URL
		const baseUrl = await vscode.window.showInputBox({
			prompt: 'Step 2/6: Enter the API Base URL',
			value: template.defaultUrl,
			placeHolder: template.defaultUrl,
			validateInput: v => {
				try {
					new URL(v.trim());
					return null;
				} catch {
					return 'Please enter a valid HTTP/HTTPS URL';
				}
			},
		});
		if (!baseUrl) return;

		// Step 3: API Key
		const apiKey = await vscode.window.showInputBox({
			prompt: template.requiresKey
				? 'Step 3/6: Enter your Provider API Key'
				: 'Step 3/6: Enter API Key (optional, press Enter for unauthenticated local endpoints)',
			password: true,
			placeHolder: 'sk-...',
		});
		if (template.requiresKey && !apiKey?.trim()) {
			vscode.window.showWarningMessage('API key is required for this provider.');
			return;
		}

		// Step 4: Model Discovery via /models endpoint
		let discoveredModels: string[] = [];
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Pi: Discovering models from endpoint...',
				cancellable: false,
			},
			async () => {
				discoveredModels = await this._providerService.discoverModels(baseUrl.trim(), apiKey?.trim());
			}
		);

		// Step 5: Model Selection / Input
		let selectedModelId = '';
		if (discoveredModels.length > 0) {
			const modelChoices: vscode.QuickPickItem[] = discoveredModels.map(m => ({
				label: m,
				description: 'Discovered from endpoint',
			}));
			modelChoices.push({
				label: 'Enter custom model name manually...',
				description: '',
			});

			const picked = await vscode.window.showQuickPick(modelChoices, {
				placeHolder: `Step 4/6: Select a model discovered from endpoint (${discoveredModels.length} found)`,
			});
			if (!picked) return;

			if (picked.label === 'Enter custom model name manually...') {
				const manual = await vscode.window.showInputBox({
					prompt: 'Enter the exact upstream model name (e.g. deepseek-coder, llama-3.3-70b)',
					placeHolder: template.defaultModel || 'model-name',
				});
				if (!manual) return;
				selectedModelId = manual.trim();
			} else {
				selectedModelId = picked.label;
			}
		} else {
			const manual = await vscode.window.showInputBox({
				prompt: 'Step 4/6: Enter the upstream model ID (e.g. deepseek-chat, llama-3.3-70b)',
				value: template.defaultModel || '',
				placeHolder: template.defaultModel || 'deepseek-chat',
				validateInput: v => v.trim() ? null : 'Model ID is required',
			});
			if (!manual) return;
			selectedModelId = manual.trim();
		}

		// Step 6: Display Name
		const displayName = await vscode.window.showInputBox({
			prompt: 'Step 5/6: Enter a display name for this model in Pi',
			value: selectedModelId,
			placeHolder: selectedModelId,
			validateInput: v => v.trim() ? null : 'Display name is required',
		});
		if (!displayName) return;

		// Step 7: Capabilities Detection
		const lower = selectedModelId.toLowerCase();
		const isReasoning = lower.includes('r1') || lower.includes('reason') || lower.includes('o1') || lower.includes('o3');
		const isVision = lower.includes('vision') || lower.includes('vl') || lower.includes('4o');

		const uniqueId = `${template.id}-${selectedModelId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

		await this._providerService.addCustomModel({
			id: uniqueId,
			name: displayName.trim(),
			modelName: selectedModelId,
			baseUrl: baseUrl.trim(),
			providerId: template.id,
			capabilities: {
				reasoning: isReasoning,
				vision: isVision,
				toolCalling: true,
			},
			contextWindow: 65536,
		}, apiKey?.trim());

		this._modelRegistry.refreshCustomModels();
		await this._modelRegistry.setActiveModel(uniqueId);

		vscode.window.showInformationMessage(`Pi: Successfully configured "${displayName.trim()}" (${template.label}).`);
	}
}
