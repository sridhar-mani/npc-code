import * as vscode from 'vscode';
import { registerBackendBridge, syncOllamaModels, getSharedAgentBackend } from './backend-bridge';
import { ModelManager } from './runtime/modelManager';
import { PiSidebarViewProvider } from './sidebar/sidebarView';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const outputChannel = vscode.window.createOutputChannel('Ziq Agent');
	context.subscriptions.push(outputChannel);
	outputChannel.appendLine('[Ziq] Activating extension...');

	// 1. Register backend bridge, commands, status bar, and chat participants
	registerBackendBridge(context);
	outputChannel.appendLine('[Ziq] Backend bridge and commands registered');

	// 2. Discover and persist Ollama models on startup (awaited before sidebar view hydration)
	try {
		outputChannel.appendLine('[Ziq] Discovering local Ollama models on startup...');
		await syncOllamaModels({ notify: false });
		outputChannel.appendLine('[Ziq] Startup Ollama discovery complete');
	} catch (err) {
		outputChannel.appendLine(`[Ziq] Startup Ollama discovery skipped: ${err instanceof Error ? err.message : String(err)}`);
	}

	// 3. Pre-warm shared agent backend with the discovered custom providers
	const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	try {
		await getSharedAgentBackend(cwd);
		outputChannel.appendLine('[Ziq] Shared backend initialized with custom providers');
	} catch (err) {
		outputChannel.appendLine(`[Ziq] Shared backend initialization warning: ${err instanceof Error ? err.message : String(err)}`);
	}

	// 4. Register dedicated webview sidebar chat interface
	const modelManager = ModelManager.getInstance();
	const sidebarWebviewProvider = new PiSidebarViewProvider(context.extensionUri, modelManager);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PiSidebarViewProvider.viewType, sidebarWebviewProvider)
	);
	outputChannel.appendLine('[Ziq] Sidebar Webview registered');

	outputChannel.appendLine('[Ziq] Activation complete');
}

export function deactivate(): void {
	// ExtensionContext disposes registered resources.
}

