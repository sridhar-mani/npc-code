import * as vscode from 'vscode';
import { PiRuntimeService } from '../runtime/PiRuntimeService';
import { PiLogger } from '../logging/logger';
import { PiChatParticipant } from './piChatParticipant';

export function registerChatParticipant(
	context: vscode.ExtensionContext,
	runtime: PiRuntimeService,
	logger: PiLogger
): void {
	if (typeof (vscode.chat as any)?.createChatParticipant !== 'function') {
		logger.warn('chat', 'vscode.chat.createChatParticipant is not supported in this VS Code version');
		return;
	}

	logger.info('chat', 'Registering @pi chat participant');
	const participantHandler = new PiChatParticipant(runtime, logger);

	const participant = vscode.chat.createChatParticipant('pi.chat', (req, ctx, resp, tok) => {
		return participantHandler.handleRequest(req, ctx, resp, tok);
	});

	participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'pi-sidebar.svg');

	context.subscriptions.push(participant);
	logger.info('chat', 'Registered @pi chat participant successfully');
}
