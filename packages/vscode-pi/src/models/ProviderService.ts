import { PiConfiguration } from '../configuration/configuration';
import { PiSecretStorage } from '../configuration/secrets';
import { CustomModelConfig, PiModel } from './types';
import { PiLogger } from '../logging/logger';

export class ProviderService {
	constructor(
		private readonly _config: PiConfiguration,
		private readonly _secrets: PiSecretStorage,
		private readonly _logger: PiLogger
	) {}

	public getCustomModels(): PiModel[] {
		const raw = this._config.getCustomModels();
		return raw.map(c => ({
			id: c.id,
			name: c.name,
			providerId: c.providerId || 'byom',
			capabilities: {
				reasoning: Boolean(c.capabilities?.reasoning),
				vision: Boolean(c.capabilities?.vision),
				toolCalling: c.capabilities?.toolCalling !== undefined ? Boolean(c.capabilities.toolCalling) : true,
			},
			contextWindow: c.contextWindow || 32768,
			baseUrl: c.baseUrl,
		}));
	}

	public async addCustomModel(config: CustomModelConfig, apiKey?: string): Promise<void> {
		await this._config.saveCustomModel(config);
		if (apiKey) {
			await this._secrets.setApiKey(config.id, apiKey);
		}
		this._logger.info('model', `Registered custom model ${config.id} (${config.name})`);
	}

	public async removeCustomModel(modelId: string): Promise<void> {
		await this._config.removeCustomModel(modelId);
		await this._secrets.deleteApiKey(modelId);
		this._logger.info('model', `Removed custom model ${modelId}`);
	}

	public async getApiKey(modelId: string): Promise<string | undefined> {
		return this._secrets.getApiKey(modelId);
	}
}
