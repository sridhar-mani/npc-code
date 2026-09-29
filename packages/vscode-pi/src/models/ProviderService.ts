import * as http from 'http';
import * as https from 'https';
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
			modelName: c.modelName,
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

	public async discoverModels(baseUrl: string, apiKey?: string, timeoutMs: number = 8000): Promise<string[]> {
		return new Promise(resolve => {
			try {
				const cleanUrl = baseUrl.replace(/\/$/, '');
				const target = cleanUrl.endsWith('/models')
					? cleanUrl
					: cleanUrl.endsWith('/v1')
						? `${cleanUrl}/models`
						: `${cleanUrl}/v1/models`;

				const u = new URL(target);
				const lib = u.protocol === 'https:' ? https : http;

				const headers: Record<string, string> = {
					'Accept': 'application/json',
				};
				if (apiKey) {
					headers['Authorization'] = `Bearer ${apiKey}`;
				}

				const req = lib.get(u, { headers, timeout: timeoutMs }, res => {
					if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
						this._logger.debug('model', `Discovery returned HTTP ${res.statusCode} from ${target}`);
						resolve([]);
						return;
					}

					let body = '';
					res.setEncoding('utf8');
					res.on('data', chunk => { body += chunk; });
					res.on('end', () => {
						try {
							const json = JSON.parse(body);
							const list = Array.isArray(json.data) ? json.data : (Array.isArray(json.models) ? json.models : []);
							const ids: string[] = list.map((item: any) => item.id || item.name).filter(Boolean);
							this._logger.info('model', `Discovered ${ids.length} models from ${target}`);
							resolve(ids);
						} catch {
							resolve([]);
						}
					});
				});

				req.on('timeout', () => {
					req.destroy();
					resolve([]);
				});

				req.on('error', err => {
					this._logger.debug('model', `Discovery error: ${err.message}`);
					resolve([]);
				});
			} catch {
				resolve([]);
			}
		});
	}
}
