import * as vscode from 'vscode';
import { PiRuntimeService } from '../runtime/PiRuntimeService';
import { PiLogger } from '../logging/logger';

export function registerAddCustomModelCommand(
	context: vscode.ExtensionContext,
	runtime: PiRuntimeService,
	logger: PiLogger
): vscode.Disposable {
	return vscode.commands.registerCommand('pi.addCustomModel', async () => {
		logger.info('command', 'Executing pi.addCustomModel');
		await runtime.modelService.promptAddCustomModel();
	});
}
