import * as vscode from 'vscode';
import { PiCliLocator } from './PiCliLocator';
import { PiLogger } from '../logging/logger';

export class PiTerminalService {
	private _terminal?: vscode.Terminal;

	constructor(
		private readonly _locator: PiCliLocator,
		private readonly _logger: PiLogger
	) {}

	public openTerminal(activeModelId?: string): void {
		const cliPath = this._locator.findPiCli();
		if (!cliPath) {
			vscode.window.showErrorMessage('Pi terminal agent CLI is not installed or could not be found.');
			return;
		}

		if (this._terminal && this._terminal.exitStatus === undefined) {
			this._terminal.show();
			this._logger.info('terminal', 'Re-focusing existing Pi terminal session');
			return;
		}

		this._logger.info('terminal', `Spawning Pi terminal with CLI: ${cliPath}`);
		this._terminal = vscode.window.createTerminal({
			name: 'Pi Coding Agent',
			iconPath: new vscode.ThemeIcon('terminal'),
		});

		const cmd = cliPath.endsWith('.js')
			? `node "${cliPath}"`
			: `"${cliPath}"`;

		const fullCmd = activeModelId ? `${cmd} --model "${activeModelId}"` : cmd;

		this._terminal.sendText(fullCmd);
		this._terminal.show();
	}
}
