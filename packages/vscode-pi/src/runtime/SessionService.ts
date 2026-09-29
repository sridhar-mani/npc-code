import * as http from 'http';
import * as https from 'https';
import { PiModel } from '../models/types';
import { ProviderService } from '../models/ProviderService';
import { PiLogger } from '../logging/logger';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'compaction';
	content: string;
	timestamp: number;
}

export interface StreamCallbacks {
	onDelta: (text: string) => void;
	onProgress?: (message: string) => void;
}

function resolveChatCompletionsUrl(baseUrl: string): URL {
	const clean = (baseUrl || '').replace(/\/$/, '');
	if (clean.endsWith('/chat/completions')) {
		return new URL(clean);
	}
	if (clean.endsWith('/v1')) {
		return new URL(`${clean}/chat/completions`);
	}
	return new URL(`${clean}/v1/chat/completions`);
}

export class SessionService {
	constructor(
		private readonly _providerService: ProviderService,
		private readonly _logger: PiLogger
	) {}

	public async streamChat(
		model: PiModel,
		prompt: string,
		history: ChatMessage[],
		callbacks: StreamCallbacks,
		signal: AbortSignal,
		systemInstructions?: string
	): Promise<string> {
		if (model.providerId === 'ollama') {
			return this.streamOllama(model, prompt, history, callbacks, signal, systemInstructions);
		} else {
			return this.streamByom(model, prompt, history, callbacks, signal, systemInstructions);
		}
	}

	public async compactHistory(
		model: PiModel,
		history: ChatMessage[],
		signal: AbortSignal
	): Promise<string> {
		this._logger.info('runtime', `Compacting ${history.length} conversation turns with model ${model.id}`);
		const prompt = 'Please provide a concise, high-density summary of the following prior conversation so it can serve as a compact context memory block for the assistant:\n\n' +
			history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

		if (model.providerId === 'ollama') {
			return this.collectOllama(model, prompt, signal);
		} else {
			return this.collectByom(model, prompt, signal);
		}
	}

	private streamOllama(
		model: PiModel,
		prompt: string,
		history: ChatMessage[],
		callbacks: StreamCallbacks,
		signal: AbortSignal,
		systemInstructions?: string
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const baseUrl = (model.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
			const u = new URL(`${baseUrl}/api/chat`);
			const lib = u.protocol === 'https:' ? https : http;

			const messages: Array<{ role: string; content: string }> = [];

			if (systemInstructions) {
				messages.push({ role: 'system', content: systemInstructions });
			}

			for (const m of history) {
				if (m.role === 'compaction') {
					messages.push({ role: 'system', content: `[Prior Context Summary: ${m.content}]` });
				} else if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') {
					messages.push({ role: m.role, content: m.content });
				}
			}
			messages.push({ role: 'user', content: prompt });

			const postData = JSON.stringify({
				model: model.modelName || model.id,
				messages,
				stream: true,
			});

			let fullResponse = '';

			const req = lib.request(u, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(postData),
				},
				timeout: 60000,
			}, res => {
				if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
					reject(new Error(`Ollama returned HTTP ${res.statusCode}`));
					return;
				}

				res.setEncoding('utf8');
				let buffer = '';

				res.on('data', chunk => {
					if (signal.aborted) {
						req.destroy();
						resolve(fullResponse);
						return;
					}
					buffer += chunk;
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (!line.trim()) continue;
						try {
							const json = JSON.parse(line);
							if (json.message?.content) {
								fullResponse += json.message.content;
								callbacks.onDelta(json.message.content);
							}
							if (json.done) {
								resolve(fullResponse);
								return;
							}
						} catch {
							// Incomplete chunk
						}
					}
				});

				res.on('end', () => resolve(fullResponse));
			});

			signal.addEventListener('abort', () => {
				req.destroy();
				resolve(fullResponse);
			});

			req.on('error', reject);
			req.write(postData);
			req.end();
		});
	}

	private async streamByom(
		model: PiModel,
		prompt: string,
		history: ChatMessage[],
		callbacks: StreamCallbacks,
		signal: AbortSignal,
		systemInstructions?: string
	): Promise<string> {
		const apiKey = await this._providerService.getApiKey(model.id);

		return new Promise((resolve, reject) => {
			let u: URL;
			try {
				u = resolveChatCompletionsUrl(model.baseUrl || '');
			} catch (err: any) {
				reject(new Error(`Invalid model Base URL: ${err?.message || err}`));
				return;
			}

			const lib = u.protocol === 'https:' ? https : http;

			const messages: Array<{ role: string; content: string }> = [];

			if (systemInstructions) {
				messages.push({ role: 'system', content: systemInstructions });
			}

			for (const m of history) {
				if (m.role === 'compaction') {
					messages.push({ role: 'system', content: `[Prior Context Summary: ${m.content}]` });
				} else if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') {
					messages.push({ role: m.role, content: m.content });
				}
			}
			messages.push({ role: 'user', content: prompt });

			const postData = JSON.stringify({
				model: model.modelName || model.id,
				messages,
				stream: true,
			});

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				'Content-Length': String(Buffer.byteLength(postData)),
			};
			if (apiKey) {
				headers['Authorization'] = `Bearer ${apiKey}`;
			}

			let fullResponse = '';

			const req = lib.request(u, {
				method: 'POST',
				headers,
				timeout: 60000,
			}, res => {
				if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
					reject(new Error(`Endpoint ${u.origin} returned HTTP ${res.statusCode}`));
					return;
				}

				res.setEncoding('utf8');
				let buffer = '';

				res.on('data', chunk => {
					if (signal.aborted) {
						req.destroy();
						resolve(fullResponse);
						return;
					}
					buffer += chunk;
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed || trimmed.startsWith(':')) continue;
						if (trimmed === 'data: [DONE]') {
							resolve(fullResponse);
							return;
						}
						if (trimmed.startsWith('data: ')) {
							try {
								const json = JSON.parse(trimmed.slice(6));
								const delta = json.choices?.[0]?.delta;
								const text = delta?.content || delta?.reasoning_content;
								if (text) {
									fullResponse += text;
									callbacks.onDelta(text);
								}
							} catch {
								// Incomplete chunk
							}
						}
					}
				});

				res.on('end', () => resolve(fullResponse));
			});

			signal.addEventListener('abort', () => {
				req.destroy();
				resolve(fullResponse);
			});

			req.on('error', reject);
			req.write(postData);
			req.end();
		});
	}

	private collectOllama(model: PiModel, prompt: string, signal: AbortSignal): Promise<string> {
		return new Promise((resolve, reject) => {
			const baseUrl = (model.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
			const u = new URL(`${baseUrl}/api/generate`);
			const lib = u.protocol === 'https:' ? https : http;

			const postData = JSON.stringify({
				model: model.modelName || model.id,
				prompt,
				stream: false,
			});

			const req = lib.request(u, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(postData),
				},
				timeout: 45000,
			}, res => {
				let body = '';
				res.on('data', chunk => { body += chunk; });
				res.on('end', () => {
					try {
						const json = JSON.parse(body);
						resolve(json.response || '');
					} catch (e) {
						reject(e);
					}
				});
			});

			signal.addEventListener('abort', () => {
				req.destroy();
				resolve('');
			});

			req.on('error', reject);
			req.write(postData);
			req.end();
		});
	}

	private async collectByom(model: PiModel, prompt: string, signal: AbortSignal): Promise<string> {
		const apiKey = await this._providerService.getApiKey(model.id);

		return new Promise((resolve, reject) => {
			let u: URL;
			try {
				u = resolveChatCompletionsUrl(model.baseUrl || '');
			} catch (err: any) {
				reject(new Error(`Invalid model Base URL: ${err?.message || err}`));
				return;
			}

			const lib = u.protocol === 'https:' ? https : http;

			const postData = JSON.stringify({
				model: model.modelName || model.id,
				messages: [{ role: 'user', content: prompt }],
				stream: false,
			});

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				'Content-Length': String(Buffer.byteLength(postData)),
			};
			if (apiKey) {
				headers['Authorization'] = `Bearer ${apiKey}`;
			}

			const req = lib.request(u, {
				method: 'POST',
				headers,
				timeout: 45000,
			}, res => {
				let body = '';
				res.on('data', chunk => { body += chunk; });
				res.on('end', () => {
					try {
						const json = JSON.parse(body);
						const choice = json.choices?.[0];
						const text = choice?.message?.content || choice?.message?.reasoning_content || '';
						resolve(text);
					} catch (e) {
						reject(e);
					}
				});
			});

			signal.addEventListener('abort', () => {
				req.destroy();
				resolve('');
			});

			req.on('error', reject);
			req.write(postData);
			req.end();
		});
	}
}
