import * as vscode from 'vscode';
import { ModelManager } from '../runtime/modelManager';
import { TerminalAgentService } from '../terminal/terminalAgent';
import { PiSidebarViewProvider } from '../sidebar/sidebarView';

export function registerPiCommands(
	context: vscode.ExtensionContext,
	modelManager: ModelManager,
	sidebarProvider: PiSidebarViewProvider
): void {
	// 1. Open Pi Chat
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.openChat', async (queryArg?: unknown) => {
			const userPrompt =
				typeof queryArg === 'string'
					? queryArg
					: queryArg && typeof queryArg === 'object' && 'query' in queryArg
						? String((queryArg as { query: unknown }).query)
						: undefined;

			const query = userPrompt ? `@pi ${userPrompt}` : '@pi ';
			const openOptions = { query, isPartialQuery: !userPrompt };

			for (const cmd of [
				'workbench.action.chat.open',
				'workbench.action.openChat',
				'workbench.action.chat.newChat',
				'workbench.panel.chat.view.copilot.focus',
				'workbench.action.chat.toggle',
			]) {
				try {
					if (cmd.endsWith('newChat') || cmd.endsWith('focus') || cmd.endsWith('toggle')) {
						await vscode.commands.executeCommand(cmd, cmd.includes('chat.open') ? openOptions : undefined);
					} else {
						await vscode.commands.executeCommand(cmd, openOptions);
					}
					return;
				} catch {
					// Fall through to next command variant
				}
			}

			// If chat view command cannot be executed, reveal the sidebar
			await vscode.commands.executeCommand('workbench.view.extension.pi-assistant-container');
		})
	);

	// 2. Add Custom Model
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.addCustomModel', async () => {
			await modelManager.promptAddModel();
		})
	);

	// 3. Select Active Model
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.selectActiveModel', async () => {
			await modelManager.promptSelectModel();
		})
	);

	// 4. Sync Ollama Models
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.syncOllamaModels', async () => {
			await modelManager.syncOllama(true);
		})
	);

	// 5. Launch Terminal Agent
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.openTerminalAgent', () => {
			TerminalAgentService.launchTerminalAgent();
		})
	);

	// 6. Refresh Sidebar
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.refreshSidebar', () => {
			sidebarProvider.refresh();
		})
	);
}
