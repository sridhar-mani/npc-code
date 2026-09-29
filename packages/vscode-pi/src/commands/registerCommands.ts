import * as vscode from 'vscode';
import { PiRuntimeService } from '../runtime/PiRuntimeService';
import { PiLogger } from '../logging/logger';
import { registerOpenChatCommand } from './openChat';
import { registerAddCustomModelCommand } from './addCustomModel';
import { registerSelectActiveModelCommand } from './selectActiveModel';
import { registerSyncOllamaModelsCommand } from './syncOllamaModels';
import { registerOpenTerminalAgentCommand } from './openTerminalAgent';
import { registerOpenSettingsCommand } from './openSettings';

export function registerCommands(
	context: vscode.ExtensionContext,
	runtime: PiRuntimeService,
	logger: PiLogger
): void {
	logger.info('command', 'Registering Pi commands...');

	context.subscriptions.push(
		registerOpenChatCommand(context, runtime, logger),
		registerAddCustomModelCommand(context, runtime, logger),
		registerSelectActiveModelCommand(context, runtime, logger),
		registerSyncOllamaModelsCommand(context, runtime, logger),
		registerOpenTerminalAgentCommand(context, runtime, logger),
		registerOpenSettingsCommand(context, logger)
	);

	logger.info('command', 'Registered: pi.openChat, pi.addCustomModel, pi.selectActiveModel, pi.syncOllamaModels, pi.openTerminalAgent, pi.openSettings');
}
