import * as vscode from 'vscode';
import { PiRuntimeService } from '../runtime/PiRuntimeService';
import { PiLogger } from '../logging/logger';

export function registerSyncOllamaModelsCommand(
	context: vscode.ExtensionContext,
	runtime: PiRuntimeService,
	logger: PiLogger
): vscode.Disposable {
	return vscode.commands.registerCommand('pi.syncOllamaModels', async () => {
		logger.info('command', 'Executing pi.syncOllamaModels');
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Pi: Syncing Ollama models...',
				cancellable: false,
			},
			async () => {
				await runtime.modelRegistry.syncOllama(true);
			}
		);
	});
}
