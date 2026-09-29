import * as http from 'http';
import * as https from 'https';
import { PiModel } from './types';
import { PiLogger } from '../logging/logger';

export interface OllamaSyncResult {
	connected: boolean;
	models: PiModel[];
	error?: string;
}

export class OllamaService {
	constructor(
		private readonly _baseUrl: string,
		private readonly _timeoutMs: number,
		private readonly _logger: PiLogger
	) {}

	public async listModels(): Promise<OllamaSyncResult> {
		return new Promise(resolve => {
			try {
				const u = new URL(`${this._baseUrl}/api/tags`);
				const lib = u.protocol === 'https:' ? https : http;

				const req = lib.get(u, { timeout: this._timeoutMs }, res => {
					if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
						this._logger.warn('ollama', `Server returned status code: ${res.statusCode}`);
						resolve({ connected: false, models: [], error: `HTTP ${res.statusCode}` });
						return;
					}

					let body = '';
					res.setEncoding('utf8');
					res.on('data', chunk => { body += chunk; });
					res.on('end', () => {
						try {
							const json = JSON.parse(body);
							const rawModels = Array.isArray(json.models) ? json.models : [];
							const models: PiModel[] = [];

							for (const rm of rawModels) {
								const name = rm.name || rm.model || '';
								if (!name) continue;

								// Filter out embedding-only models
								const lower = name.toLowerCase();
								if (lower.includes('embed') || lower.includes('nomic-bert') || lower.includes('bge-')) {
									continue;
								}

								models.push({
									id: name,
									name: name,
									providerId: 'ollama',
									capabilities: {
										reasoning: lower.includes('r1') || lower.includes('reason') || lower.includes('deepseek-r1'),
										vision: lower.includes('vision') || lower.includes('llava') || lower.includes('vl'),
										toolCalling: true,
									},
									contextWindow: 32768,
									baseUrl: this._baseUrl,
								});
							}

							this._logger.info('ollama', `Discovered ${models.length} models from ${this._baseUrl}`);
							resolve({ connected: true, models });
						} catch (err: any) {
							this._logger.warn('ollama', `Invalid JSON response: ${err?.message || err}`);
							resolve({ connected: false, models: [], error: 'Invalid JSON response' });
						}
					});
				});

				req.on('timeout', () => {
					req.destroy();
					this._logger.warn('ollama', `Connection timed out after ${this._timeoutMs}ms`);
					resolve({ connected: false, models: [], error: 'Timeout' });
				});

				req.on('error', err => {
					this._logger.warn('ollama', `Connection error: ${err.message}`);
					resolve({ connected: false, models: [], error: err.message });
				});
			} catch (err: any) {
				this._logger.warn('ollama', `Malformed URL or request failure: ${err?.message || err}`);
				resolve({ connected: false, models: [], error: err?.message || String(err) });
			}
		});
	}
}
