import * as vscode from 'vscode';
import { PiRuntimeService } from '../runtime/PiRuntimeService';

export function registerStatusBar(
	context: vscode.ExtensionContext,
	runtime: PiRuntimeService
): void {
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'pi.selectActiveModel';
	statusBarItem.tooltip = 'Click to switch active Pi model';

	function update(): void {
		const state = runtime.getState();
		const modelName = state.activeModel ? state.activeModel.name : 'No Model';
		statusBarItem.text = `$(sparkle) Pi: ${modelName}`;
		statusBarItem.show();
	}

	update();

	context.subscriptions.push(
		statusBarItem,
		runtime.onDidChangeState(() => update())
	);
}
