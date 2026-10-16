import * as vscode from "vscode";

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

function getConfigValue<T>(key: string, defaultValue: T): T {
	const npcConfig = vscode.workspace.getConfiguration("npc");
	const npcVal = npcConfig.get<T>(key);
	if (npcVal !== undefined && npcVal !== null && npcVal !== "") return npcVal;
	const piConfig = vscode.workspace.getConfiguration("pi");
	const piVal = piConfig.get<T>(key);
	if (piVal !== undefined && piVal !== null) return piVal;
	return defaultValue;
}

export class PiSettings {
	static get activeModel(): string {
		return getConfigValue<string>("activeModel", "");
	}

	static async setActiveModel(modelId: string): Promise<void> {
		await vscode.workspace.getConfiguration("npc").update("activeModel", modelId, vscode.ConfigurationTarget.Global);
		await vscode.workspace.getConfiguration("pi").update("activeModel", modelId, vscode.ConfigurationTarget.Global);
	}

	static get ollamaUrl(): string {
		let url = getConfigValue<string>("ollamaUrl", "http://127.0.0.1:11434").trim();
		while (url.endsWith("/")) {
			url = url.slice(0, -1);
		}
		return url;
	}

	static get customModels(): CustomModelConfig[] {
		const npcModels = vscode.workspace.getConfiguration("npc").get<CustomModelConfig[]>("customModels") ?? [];
		const piModels = vscode.workspace.getConfiguration("pi").get<CustomModelConfig[]>("customModels") ?? [];
		const combined = [...npcModels, ...piModels];
		const seen = new Set<string>();
		return combined.filter((m) => {
			if (!m?.id || seen.has(m.id)) return false;
			seen.add(m.id);
			return true;
		});
	}

	static get autoSyncOllama(): boolean {
		return getConfigValue<boolean>("autoSyncOllama", true);
	}

	static async addCustomModel(model: CustomModelConfig): Promise<void> {
		const existing = PiSettings.customModels.filter((m) => m.id !== model.id);
		existing.push(model);
		await vscode.workspace.getConfiguration("npc").update("customModels", existing, vscode.ConfigurationTarget.Global);
		await vscode.workspace.getConfiguration("pi").update("customModels", existing, vscode.ConfigurationTarget.Global);
	}

	static get terminalCommand(): string {
		return getConfigValue<string>("terminalCommand", "npc");
	}
}
