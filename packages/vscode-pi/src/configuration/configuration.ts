import * as vscode from 'vscode';
import { CustomModelConfig } from '../models/types';

export class PiConfiguration {
	private static readonly GLOBAL_STATE_CUSTOM_MODELS = 'pi.customModels';
	private static readonly GLOBAL_STATE_ACTIVE_MODEL = 'pi.activeModelId';

	constructor(private readonly _context: vscode.ExtensionContext) {}

	public get ollamaUrl(): string {
		const cfg = vscode.workspace.getConfiguration('pi');
		return (cfg.get<string>('ollama.url') || 'http://127.0.0.1:11434').replace(/\/$/, '');
	}

	public get defaultModel(): string {
		const cfg = vscode.workspace.getConfiguration('pi');
		return cfg.get<string>('models.default') || '';
	}

	public get autoSyncOllama(): boolean {
		const cfg = vscode.workspace.getConfiguration('pi');
		return cfg.get<boolean>('runtime.autoSyncOllama') ?? true;
	}

	public get allowNetwork(): boolean {
		const cfg = vscode.workspace.getConfiguration('pi');
		return cfg.get<boolean>('runtime.allowNetwork') ?? true;
	}

	public get timeout(): number {
		const cfg = vscode.workspace.getConfiguration('pi');
		return cfg.get<number>('runtime.timeout') || 60000;
	}

	public get terminalCommand(): string {
		const cfg = vscode.workspace.getConfiguration('pi');
		return cfg.get<string>('terminalCommand') || 'pi';
	}

	public getActiveModelId(): string {
		return this._context.globalState.get<string>(PiConfiguration.GLOBAL_STATE_ACTIVE_MODEL) || this.defaultModel;
	}

	public async setActiveModelId(modelId: string): Promise<void> {
		await this._context.globalState.update(PiConfiguration.GLOBAL_STATE_ACTIVE_MODEL, modelId);
	}

	public getCustomModels(): CustomModelConfig[] {
		return this._context.globalState.get<CustomModelConfig[]>(PiConfiguration.GLOBAL_STATE_CUSTOM_MODELS) || [];
	}

	public async saveCustomModel(config: CustomModelConfig): Promise<void> {
		const current = this.getCustomModels();
		const idx = current.findIndex(m => m.id === config.id);
		if (idx >= 0) {
			current[idx] = config;
		} else {
			current.push(config);
		}
		await this._context.globalState.update(PiConfiguration.GLOBAL_STATE_CUSTOM_MODELS, current);
	}

	public async removeCustomModel(modelId: string): Promise<void> {
		const current = this.getCustomModels().filter(m => m.id !== modelId);
		await this._context.globalState.update(PiConfiguration.GLOBAL_STATE_CUSTOM_MODELS, current);
	}
}
