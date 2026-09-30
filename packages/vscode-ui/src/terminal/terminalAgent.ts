import * as vscode from 'vscode';
import { getZiqRuntimeHost } from '../runtime/runtimeHost';

function shellQuote(value: string): string {
	if (process.platform === 'win32') {
		return '"' + value.replace(/"/g, '\\\"') + '"';
	}
	return "'" + value.replace(/'/g, "'\\''") + "'";
}

export class TerminalAgentService {
	static async launchTerminalAgent(): Promise<void> {
		const host = await getZiqRuntimeHost();
		const attachment = await host.attachLocal();
		const terminalName = 'Ziq Agent';
		let terminal = vscode.window.terminals.find(t => t.name === terminalName);
		if (!terminal) {
			terminal = vscode.window.createTerminal({
				name: terminalName,
				iconPath: new vscode.ThemeIcon('terminal'),
			});
		}

		terminal.show();

		const extensionClientPath = vscode.extensions.getExtension('zenteiq.ziq-vscode-ui')?.extensionUri.fsPath;
		if (!extensionClientPath) throw new Error('Ziq extension URI is unavailable');
		const scriptPath = vscode.Uri.joinPath(vscode.Uri.file(extensionClientPath), 'dist', 'terminal-client.cjs').fsPath;
		const nodeExecutable = process.execPath;
		const args = [
			nodeExecutable,
			'--ms-enable-electron-run-as-node',
			scriptPath,
			'--server-id',
			host.serverId,
			'--socket',
			host.socketPath,
			'--session-id',
			attachment.sessionId,
		];

		terminal.sendText(args.map(shellQuote).join(' '));
	}
}
