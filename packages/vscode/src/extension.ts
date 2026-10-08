import * as vscode from "vscode";
import { registerBackendBridge, syncOllamaModels } from "./backend-bridge";
import { PiSettings } from "./config/settings";
import { ModelManager } from "./runtime/modelManager";
import { startNpcRuntimeHost } from "./runtime/runtimeHost";
import { PiSidebarViewProvider } from "./sidebar/sidebarView";
import { PiTaskBoardViewProvider } from "./tasks/taskBoardView";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const outputChannel = vscode.window.createOutputChannel("NPC Agent");
	context.subscriptions.push(outputChannel);
	outputChannel.appendLine("[NPC] Activating extension...");

	// 1. Register backend bridge, commands, status bar, and chat participants
	registerBackendBridge(context);
	outputChannel.appendLine("[NPC] Backend bridge and commands registered");

	// 2. Start the single runtime owner used by every NPC presentation client.
	const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
	const runtimeHost = await startNpcRuntimeHost(context, cwd);
	context.subscriptions.push(new vscode.Disposable(() => void runtimeHost.stop()));
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("pi.agentFeatures")) {
				runtimeHost.syncFeatureSettings();
			}
		}),
	);
	outputChannel.appendLine(
		`[NPC] Live runtime started server=${runtimeHost.serverId} socket=${runtimeHost.socketPath}`,
	);

	// 3. Discover and persist Ollama models on startup.
	if (PiSettings.autoSyncOllama) {
		try {
			outputChannel.appendLine("[NPC] Discovering local Ollama models on startup...");
			await syncOllamaModels({ notify: false });
			outputChannel.appendLine("[NPC] Startup Ollama discovery complete");
		} catch (err) {
			outputChannel.appendLine(
				`[NPC] Startup Ollama discovery skipped: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	// 4. Register dedicated webview sidebar chat interface
	const modelManager = ModelManager.getInstance();
	const sidebarWebviewProvider = new PiSidebarViewProvider(context.extensionUri, modelManager);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PiSidebarViewProvider.viewType, sidebarWebviewProvider),
	);
	outputChannel.appendLine("[NPC] Sidebar Webview registered");

	// 5. Register the separate durable task list / kanban surface.
	const taskBoardProvider = new PiTaskBoardViewProvider();
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PiTaskBoardViewProvider.viewType, taskBoardProvider),
	);
	outputChannel.appendLine("[NPC] Task board Webview registered");

	outputChannel.appendLine("[NPC] Activation complete");
}

export function deactivate(): void {
	// ExtensionContext disposes registered resources.
}
