import * as vscode from 'vscode';
import { PiLogger } from '../logging/logger';

export function registerOpenSettingsCommand(
	context: vscode.ExtensionContext,
	logger: PiLogger
): vscode.Disposable {
	return vscode.commands.registerCommand('pi.openSettings', async () => {
		logger.info('command', 'Executing pi.openSettings');
		await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:zenteiq.ziq-pi-vscode');
	});
}
