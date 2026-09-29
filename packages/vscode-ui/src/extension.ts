import * as vscode from 'vscode';
import { ModelManager } from './runtime/modelManager';
import { PiSidebarViewProvider } from './sidebar/sidebarView';
import { PiChatParticipant } from './chat/chatParticipant';
import { registerPiCommands } from './commands';

let statusBarItem: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const outputChannel = vscode.window.createOutputChannel('Pi Agent');
	context.subscriptions.push(outputChannel);
	outputChannel.appendLine('[Pi] Activating Pi Coding Assistant v0.44.3...');

	const modelManager = ModelManager.getInstance();

	// 1. Register Webview Sidebar View Provider
	const sidebarProvider = new PiSidebarViewProvider(context.extensionUri, modelManager);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PiSidebarViewProvider.viewType, sidebarProvider)
	);
	outputChannel.appendLine('[Pi] Sidebar WebviewViewProvider registered');

	// 2. Register Commands
	registerPiCommands(context, modelManager, sidebarProvider);
	outputChannel.appendLine('[Pi] Commands registered');

	// 3. Register @pi Chat Participant
	PiChatParticipant.register(context, modelManager);
	outputChannel.appendLine('[Pi] Chat participant registered');

	// 4. Status Bar Item for Active Model
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.name = 'Pi Coding Assistant';
	statusBarItem.command = 'pi.selectActiveModel';
	context.subscriptions.push(statusBarItem);

	const updateStatusBar = () => {
		const active = modelManager.getActiveModel();
		const name = active ? active.name : 'Select Model';
		statusBarItem!.text = `$(sparkle) Pi: ${name}`;
		statusBarItem!.tooltip = `Active Model: ${name} (Click to switch)`;
		statusBarItem!.show();
	};

	modelManager.onDidChangeModels(updateStatusBar);
	updateStatusBar();
	outputChannel.appendLine('[Pi] Status bar registered');

	// 5. Initial background sync of models
	modelManager.syncOllama(false).catch(err => {
		outputChannel.appendLine(`[Pi] Background Ollama sync: ${String(err)}`);
	});

	outputChannel.appendLine('[Pi] Extension activation complete');
}

export function deactivate(): void {
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}
