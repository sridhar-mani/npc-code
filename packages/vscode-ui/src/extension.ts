import * as vscode from 'vscode';
import { registerBackendBridge } from './backend-bridge';
import { ModelManager } from './runtime/modelManager';
import { PiSidebarViewProvider } from './sidebar/sidebarView';

export function activate(context: vscode.ExtensionContext): void {
	const outputChannel = vscode.window.createOutputChannel('Ziq Agent');
	context.subscriptions.push(outputChannel);
	outputChannel.appendLine('[Ziq] Activating extension...');

	const modelManager = ModelManager.getInstance();

	// Register dedicated webview sidebar chat interface
	const sidebarWebviewProvider = new PiSidebarViewProvider(context.extensionUri, modelManager);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PiSidebarViewProvider.viewType, sidebarWebviewProvider)
	);
	outputChannel.appendLine('[Ziq] Sidebar Webview registered');

	// Register backend bridge and commands
	registerBackendBridge(context);

	outputChannel.appendLine('[Ziq] Activation complete');
}

export function deactivate(): void {
	// ExtensionContext disposes registered resources.
}

