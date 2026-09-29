import * as vscode from 'vscode';
import { PiSettings } from '../config/settings';

export class TerminalAgentService {
	static launchTerminalAgent(): void {
		const terminalName = 'Pi Agent';
		let terminal = vscode.window.terminals.find(t => t.name === terminalName);
		if (!terminal) {
			terminal = vscode.window.createTerminal({
				name: terminalName,
				iconPath: new vscode.ThemeIcon('terminal'),
			});
		}

		terminal.show();

		const cmd = PiSettings.terminalCommand;
		const activeModel = PiSettings.activeModel;
		if (activeModel) {
			terminal.sendText(`${cmd} --model ${activeModel}`);
		} else {
			terminal.sendText(cmd);
		}
	}
}
