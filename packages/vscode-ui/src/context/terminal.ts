import * as vscode from 'vscode';

export class TerminalContext {
	static executeInTerminal(command: string, name: string = 'Pi Terminal'): void {
		let term = vscode.window.terminals.find(t => t.name === name);
		if (!term) {
			term = vscode.window.createTerminal({ name });
		}
		term.show();
		term.sendText(command);
	}
}
