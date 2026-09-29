import * as vscode from 'vscode';
import { PiRuntimeService } from '../runtime/PiRuntimeService';
import { PiLogger } from '../logging/logger';

export function registerOpenChatCommand(
	context: vscode.ExtensionContext,
	_runtime: PiRuntimeService,
	logger: PiLogger
): vscode.Disposable {
	return vscode.commands.registerCommand('pi.openChat', async () => {
		logger.info('command', 'Executing pi.openChat');
		try {
			// Focus Pi Assistant's dedicated dashboard view in the activity bar
			await vscode.commands.executeCommand('pi-assistant.dashboard.focus');
		} catch (err: any) {
			logger.warn('command', `Could not focus dashboard view: ${err?.message || err}`);
		}
	});
}
