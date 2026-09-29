import * as vscode from 'vscode';

export interface CustomModelConfig {
	id: string;
	name: string;
	baseUrl: string;
	apiKey?: string;
}

export class PiSettings {
	static get activeModel(): string {
		const config = vscode.workspace.getConfiguration('pi');
		return config.get<string>('activeModel') || '';
	}

	static async setActiveModel(modelId: string): Promise<void> {
		const config = vscode.workspace.getConfiguration('pi');
		await config.update('activeModel', modelId, vscode.ConfigurationTarget.Global);
	}

	static get ollamaUrl(): string {
		const config = vscode.workspace.getConfiguration('pi');
		const piVal = config.get<string>('ollamaUrl');
		if (piVal) return piVal;
		// Fallback migration check
		const copilotConfig = vscode.workspace.getConfiguration('copilot');
		return copilotConfig.get<string>('ollamaUrl') || 'http://127.0.0.1:11434';
	}

	static get customModels(): CustomModelConfig[] {
		const config = vscode.workspace.getConfiguration('pi');
		const models = config.get<CustomModelConfig[]>('customModels');
		if (models && models.length > 0) {
			return models;
		}
		// Fallback migration from copilot.customModels
		const copilotConfig = vscode.workspace.getConfiguration('copilot');
		const legacy = copilotConfig.get<any[]>('customModels');
		if (Array.isArray(legacy)) {
			return legacy.map((m: any) => ({
				id: m.id || m.model || '',
				name: m.name || m.id || 'Custom Model',
				baseUrl: m.baseUrl || m.url || '',
				apiKey: m.apiKey || '',
			})).filter(m => m.id && m.baseUrl);
		}
		return [];
	}

	static async addCustomModel(model: CustomModelConfig): Promise<void> {
		const config = vscode.workspace.getConfiguration('pi');
		const existing = this.customModels.filter(m => m.id !== model.id);
		existing.push(model);
		await config.update('customModels', existing, vscode.ConfigurationTarget.Global);
	}

	static get terminalCommand(): string {
		const config = vscode.workspace.getConfiguration('pi');
		return config.get<string>('terminalCommand') || 'pi';
	}
}
