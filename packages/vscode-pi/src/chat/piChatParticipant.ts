import * as vscode from 'vscode';
import { PiRuntimeService } from '../runtime/PiRuntimeService';
import { PiLogger } from '../logging/logger';

export class PiChatParticipant {
	constructor(
		private readonly _runtime: PiRuntimeService,
		private readonly _logger: PiLogger
	) {}

	public async handleRequest(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<vscode.ChatResult> {
		this._logger.info('chat', `Received chat request: "${request.prompt}"`);

		const activeModel = this._runtime.modelRegistry.getActiveModel();
		if (!activeModel) {
			response.markdown('No active model selected. Please use `/selectActiveModel` or choose a model in the Pi sidebar.');
			return {};
		}

		response.progress(`Thinking with ${activeModel.name}...`);

		const abortController = new AbortController();
		token.onCancellationRequested(() => abortController.abort());

		const history = context.history
			.filter(h => h instanceof vscode.ChatRequestTurn || h instanceof vscode.ChatResponseTurn)
			.map(h => {
				if (h instanceof vscode.ChatRequestTurn) {
					return {
						id: Date.now().toString(),
						role: 'user' as const,
						content: h.prompt,
						timestamp: Date.now(),
					};
				} else {
					const text = h.response.map(part => {
						if (part instanceof vscode.ChatResponseMarkdownPart) {
							return part.value.value;
						}
						return '';
					}).join('');
					return {
						id: Date.now().toString(),
						role: 'assistant' as const,
						content: text,
						timestamp: Date.now(),
					};
				}
			});

		try {
			await this._runtime.streamChat(
				request.prompt,
				history,
				{
					onDelta: text => {
						response.markdown(text);
					},
					onProgress: message => {
						response.progress(message);
					},
				},
				abortController.signal
			);
		} catch (err: any) {
			if (!token.isCancellationRequested) {
				this._logger.error('chat', `Chat request failed: ${err?.message || err}`);
				response.markdown(`\n\n**Error:** ${err?.message || String(err)}`);
			}
		}

		return {};
	}
}
