import * as vscode from 'vscode';
import { PiRuntimeService } from '../runtime/PiRuntimeService';
import { PiLogger } from '../logging/logger';

export function registerSelectActiveModelCommand(
	context: vscode.ExtensionContext,
	runtime: PiRuntimeService,
	logger: PiLogger
): vscode.Disposable {
	return vscode.commands.registerCommand('pi.selectActiveModel', async () => {
		logger.info('command', 'Executing pi.selectActiveModel');
		await runtime.modelService.promptSelectModel();
	});
}
