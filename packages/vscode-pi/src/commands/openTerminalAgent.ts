import * as vscode from 'vscode';
import { PiRuntimeService } from '../runtime/PiRuntimeService';
import { PiLogger } from '../logging/logger';

export function registerOpenTerminalAgentCommand(
	context: vscode.ExtensionContext,
	runtime: PiRuntimeService,
	logger: PiLogger
): vscode.Disposable {
	return vscode.commands.registerCommand('pi.openTerminalAgent', async () => {
		logger.info('command', 'Executing pi.openTerminalAgent');
		const activeModel = runtime.modelRegistry.getActiveModel();
		runtime.terminalService.openTerminal(activeModel?.id);
	});
}
