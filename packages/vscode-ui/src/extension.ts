import * as vscode from 'vscode';
import { registerBackendBridge } from './backend-bridge';

export function activate(context: vscode.ExtensionContext): void {
	const outputChannel = vscode.window.createOutputChannel('Pi Agent');
	context.subscriptions.push(outputChannel);
	outputChannel.appendLine('[Pi] Activating VS Code bridge...');

	// Pi owns inference, providers, agent orchestration, sessions, skills and MCP.
	// This extension owns the IDE boundary: context, editor APIs, tools and UI wiring.
	registerBackendBridge(context);

	outputChannel.appendLine('[Pi] VS Code bridge activation complete');
}

export function deactivate(): void {
	// ExtensionContext disposes registered resources.
}
