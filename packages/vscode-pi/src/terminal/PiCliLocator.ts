import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { PiLogger } from '../logging/logger';

export class PiCliLocator {
	constructor(
		private readonly _extensionContext: vscode.ExtensionContext,
		private readonly _logger: PiLogger
	) {}

	public findPiCli(): string | undefined {
		// 1. Check extension bundled CLI
		const bundledCli = path.join(this._extensionContext.extensionPath, 'dist', 'cli.js');
		if (fs.existsSync(bundledCli)) {
			this._logger.info('terminal', `Resolved bundled CLI: ${bundledCli}`);
			return bundledCli;
		}

		// 2. Check repository development CLI in packages/terminal-ui
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders) {
			for (const wf of workspaceFolders) {
				const devCliPaths = [
					path.join(wf.uri.fsPath, 'packages', 'terminal-ui', 'dist', 'bundle', 'cli.js'),
					path.join(wf.uri.fsPath, '..', 'terminal-ui', 'dist', 'bundle', 'cli.js'),
					path.join(wf.uri.fsPath, 'dist', 'bundle', 'cli.js'),
				];
				for (const p of devCliPaths) {
					if (fs.existsSync(p)) {
						this._logger.info('terminal', `Resolved repository development CLI: ${p}`);
						return p;
					}
				}
			}
		}

		// Also check relative to extension path in repo
		const repoDevCli = path.resolve(this._extensionContext.extensionPath, '..', 'terminal-ui', 'dist', 'bundle', 'cli.js');
		if (fs.existsSync(repoDevCli)) {
			this._logger.info('terminal', `Resolved repository CLI: ${repoDevCli}`);
			return repoDevCli;
		}

		// 3. Check system PATH 'pi'
		try {
			const whichCmd = process.platform === 'win32' ? 'where pi' : 'which pi';
			const out = execSync(whichCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
			if (out) {
				const firstMatch = out.split('\n')[0].trim();
				if (firstMatch && fs.existsSync(firstMatch)) {
					this._logger.info('terminal', `Resolved system PATH CLI: ${firstMatch}`);
					return firstMatch;
				}
			}
		} catch {
			// Not on PATH
		}

		this._logger.warn('terminal', 'Pi CLI could not be located in bundled, repository, or system PATH');
		return undefined;
	}
}
