import * as vscode from 'vscode';
import { registerBackendBridge, syncOllamaModels } from './backend-bridge';
import { ModelManager } from './runtime/modelManager';
import { PiSidebarViewProvider } from './sidebar/sidebarView';
import { startZiqRuntimeHost } from './runtime/runtimeHost';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const outputChannel = vscode.window.createOutputChannel('Ziq Agent');
	context.subscriptions.push(outputChannel);
	outputChannel.appendLine('[Ziq] Activating extension...');

	// 1. Register backend bridge, commands, status bar, and chat participants
	registerBackendBridge(context);
	outputChannel.appendLine('[Ziq] Backend bridge and commands registered');

	// 2. Start the single runtime owner used by every Ziq presentation client.
	const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
	const runtimeHost = await startZiqRuntimeHost(context, cwd);
	context.subscriptions.push(new vscode.Disposable(() => void runtimeHost.stop()));
	outputChannel.appendLine(`[Ziq] Live runtime started server=${runtimeHost.serverId} socket=${runtimeHost.socketPath}`);

	// 3. Discover and persist Ollama models on startup.
	try {
		outputChannel.appendLine('[Ziq] Discovering local Ollama models on startup...');
		await syncOllamaModels({ notify: false });
		outputChannel.appendLine('[Ziq] Startup Ollama discovery complete');
	} catch (err) {
		outputChannel.appendLine(`[Ziq] Startup Ollama discovery skipped: ${err instanceof Error ? err.message : String(err)}`);
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

