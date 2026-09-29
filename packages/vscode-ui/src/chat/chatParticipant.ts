import * as vscode from 'vscode';
import { ModelManager } from '../runtime/modelManager';
import { PiSettings } from '../config/settings';
import * as http from 'http';
import * as https from 'https';

export class PiChatParticipant {
	static register(context: vscode.ExtensionContext, modelManager: ModelManager): void {
		if (!vscode.chat || !vscode.chat.createChatParticipant) {
			console.warn('[Pi] Chat Participant API is unavailable in this VS Code build');
			return;
		}

		const participant = vscode.chat.createChatParticipant('pi.chat', async (request, chatContext, stream, token) => {
			const activeModel = modelManager.getActiveModel();
			if (!activeModel) {
				stream.markdown(new vscode.MarkdownString('**No active model configured.** Please select or sync a model in the Pi Assistant sidebar.'));
				return {};
			}

			stream.progress(`Thinking with ${activeModel.name}...`);

			try {
				if (activeModel.provider === 'ollama') {
					await this.streamOllamaChat(activeModel.id, request.prompt, stream, token);
				} else if (activeModel.provider === 'byom') {
					await this.streamByomChat(activeModel, request.prompt, stream, token);
				} else {
					stream.markdown(new vscode.MarkdownString(`Responding via model ${activeModel.name}`));
				}
			} catch (err: any) {
				const errMsg = err?.message || String(err);
				stream.markdown(new vscode.MarkdownString(`\n\n**Error during inference:** ${errMsg}\n\nPlease verify that the model endpoint is reachable.`));
			}

			return {};
		});

		participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'logo.png');
		context.subscriptions.push(participant);
	}

	private static streamOllamaChat(modelId: string, prompt: string, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
		return new Promise((resolve, reject) => {
			const baseUrl = PiSettings.ollamaUrl.replace(/\/$/, '');
			const u = new URL(`${baseUrl}/api/generate`);
			const lib = u.protocol === 'https:' ? https : http;

			const postData = JSON.stringify({
				model: modelId,
				prompt: prompt,
				stream: true,
			});

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
					if (token.isCancellationRequested) {
						req.destroy();
						resolve();
						return;
					}
					buffer += chunk;
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (!line.trim()) continue;
						try {
							const json = JSON.parse(line);
							if (json.response) {
								stream.markdown(json.response);
							}
							if (json.done) {
								resolve();
								return;
							}
						} catch {
							// Incomplete chunk
						}
					}
				});

				res.on('end', () => resolve());
			});

			token.onCancellationRequested(() => {
				req.destroy();
				resolve();
			});

			req.on('error', reject);
			req.on('timeout', () => {
				req.destroy();
				reject(new Error('Request timed out'));
			});

			req.write(postData);
			req.end();
		});
	}

	private static streamByomChat(model: any, prompt: string, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
		return new Promise((resolve, reject) => {
			const baseUrl = (model.baseUrl || '').replace(/\/$/, '');
			const u = new URL(`${baseUrl}/chat/completions`);
			const lib = u.protocol === 'https:' ? https : http;

			const postData = JSON.stringify({
				model: model.id,
				messages: [{ role: 'user', content: prompt }],
				stream: true,
			});

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				'Content-Length': String(Buffer.byteLength(postData)),
			};
			if (model.apiKey) {
				headers['Authorization'] = `Bearer ${model.apiKey}`;
			}

			const req = lib.request(u, {
				method: 'POST',
				headers,
				timeout: 60000,
			}, res => {
				if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
					reject(new Error(`Custom endpoint returned HTTP ${res.statusCode}`));
					return;
				}

				res.setEncoding('utf8');
				let buffer = '';

				res.on('data', chunk => {
					if (token.isCancellationRequested) {
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
									stream.markdown(delta);
								}
							} catch {
								// incomplete chunk
							}
						}
					}
				});

				res.on('end', () => resolve());
			});

			token.onCancellationRequested(() => {
				req.destroy();
				resolve();
			});

			req.on('error', reject);
			req.on('timeout', () => {
				req.destroy();
				reject(new Error('Request timed out'));
			});

			req.write(postData);
			req.end();
		});
	}
}
