import * as vscode from 'vscode';
import { PiLogger } from './logging/logger';
import { PiRuntimeService } from './runtime/PiRuntimeService';
import { registerCommands } from './commands/registerCommands';
import { PiSidebarProvider } from './sidebar/PiSidebarProvider';
import { registerChatParticipant } from './chat/registerChatParticipant';
import { registerStatusBar } from './statusbar/statusBar';

export function activate(context: vscode.ExtensionContext): void {
	const logger = new PiLogger();
	logger.info('activation', 'Pi extension activation started');

	const runtime = new PiRuntimeService({
		context,
		logger,
	});

	context.subscriptions.push(runtime, logger);

	// 1. Register commands
	registerCommands(context, runtime, logger);

	// 2. Register sidebar provider
	logger.info('sidebar', 'Registering Pi sidebar provider...');
	const sidebarProvider = new PiSidebarProvider(context.extensionUri, runtime, logger);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PiSidebarProvider.viewType, sidebarProvider),
		sidebarProvider
	);
	logger.info('sidebar', 'Registered pi-assistant.dashboard view provider');

	// 3. Register chat participant
	registerChatParticipant(context, runtime, logger);

	// 4. Register status bar item
	registerStatusBar(context, runtime);

	logger.info('activation', 'Pi extension activation complete');
}

export function deactivate(): void {
	// Clean shutdown
}
