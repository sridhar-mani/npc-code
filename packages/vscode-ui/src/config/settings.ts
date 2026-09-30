import * as vscode from 'vscode';

export interface CustomModelConfig {
	id: string;
	name: string;
	baseUrl: string;
	apiKey?: string;
	label?: string;
	thinking?: boolean;
	reasoning?: boolean;
	contextWindow?: number;
	maxOutputTokens?: number;
	toolCalling?: boolean;
	vision?: boolean;
	api?: string;
	isOllama?: boolean;
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
		return (config.get<string>('ollamaUrl') ?? '').replace(/\/+$/, '');
	}

	static get customModels(): CustomModelConfig[] {
		const config = vscode.workspace.getConfiguration('pi');
		return config.get<CustomModelConfig[]>('customModels') ?? [];
	}

	static get autoSyncOllama(): boolean {
		return vscode.workspace.getConfiguration('pi').get<boolean>('autoSyncOllama') ?? true;
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
