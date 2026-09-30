import * as http from 'http';
import * as http from 'http';
import * as https from 'https';
import type { ModelEntry } from '../runtime/modelManager';
import type { ChatMessage } from './types';

export function streamOllamaChat(
	baseUrl: string,
	modelId: string,
	prompt: string,
	history: ChatMessage[],
	signal: AbortSignal,
	onDelta: (text: string) => void
): Promise<void> {
	// Route Ollama through its OpenAI-compatible /v1 API so the direct fallback
	// uses the same transport shape as every other custom provider.
	const model: ModelEntry = {
		id: modelId,
		name: modelId,
		provider: 'byom',
		baseUrl: toOllamaOpenAIBaseUrl(baseUrl),
	};
	return streamByomChat(model, 'ollama', prompt, history, signal, onDelta);
}

function toOllamaOpenAIBaseUrl(baseUrl: string): string {
	const clean = baseUrl.replace(/\/\+$/, '');
	return /\/v1$/i.test(clean) ? clean : `${clean}/v1`;
}

export function streamByomChat(
	model: ModelEntry,
	apiKey: string | undefined,
	prompt: string,
	history: ChatMessage[],
	signal: AbortSignal,
	onDelta: (text: string) => void
): Promise<void> {
	return new Promise((resolve, reject) => {
		const baseUrl = (model.baseUrl || '').replace(/\/$/, '');
		const u = new URL(`${baseUrl}/chat/completions`);
		const lib = u.protocol === 'https:' ? https : http;

		const messages = history
			.filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'compaction')
			.map(m => ({
				role: m.role === 'compaction' ? 'system' : m.role,
				content: m.role === 'compaction' ? `[Context memory: ${m.content}]` : m.content,
			}));
		messages.push({ role: 'user', content: prompt });

		const postData = JSON.stringify({
			model: model.id,
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

		const req = lib.request(u, {
			method: 'POST',
			headers,
			timeout: 60000,
		}, res => {
			if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
				reject(new Error(`Custom model returned HTTP ${res.statusCode}`));
				return;
			}

			res.setEncoding('utf8');
			let buffer = '';

			res.on('data', chunk => {
				if (signal.aborted) {
					req.destroy();
					resolve();
					return;
				}
				buffer += chunk;
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed.startsWith(':')) continue;
					if (trimmed === 'data: [DONE]') {
						resolve();
						return;
					}
					if (trimmed.startsWith('data: ')) {
						try {
							const json = JSON.parse(trimmed.slice(6));
							const delta = json.choices?.[0]?.delta?.content;
							if (delta) {
								onDelta(delta);
							}
						} catch {
							// incomplete chunk
						}
					}
				}
			});

			res.on('end', () => resolve());
		});

		signal.addEventListener('abort', () => {
			req.destroy();
			resolve();
		});

		req.on('error', reject);
		req.write(postData);
		req.end();
	});
}

export function collectOllamaText(
	baseUrl: string,
	modelId: string,
	prompt: string,
	signal: AbortSignal
): Promise<string> {
	const model: ModelEntry = {
		id: modelId,
		name: modelId,
		provider: 'byom',
		baseUrl: toOllamaOpenAIBaseUrl(baseUrl),
	};
	return collectByomText(model, 'ollama', prompt, signal);
}

export function collectByomText(
	model: ModelEntry,
	apiKey: string | undefined,
	prompt: string,
	signal: AbortSignal
): Promise<string> {
	return new Promise((resolve, reject) => {
		const baseUrl = (model.baseUrl || '').replace(/\/$/, '');
		const u = new URL(`${baseUrl}/chat/completions`);
		const lib = u.protocol === 'https:' ? https : http;

		const postData = JSON.stringify({
			model: model.id,
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
					resolve(json.choices?.[0]?.message?.content || '');
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
