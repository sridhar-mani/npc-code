import * as vscode from 'vscode';

export class PiLogger implements vscode.Disposable {
	private readonly _channel: vscode.OutputChannel;

	constructor() {
		this._channel = vscode.window.createOutputChannel('Pi Agent');
	}

	public info(category: string, message: string, ...args: any[]): void {
		this.log('INFO', category, message, args);
	}

	public warn(category: string, message: string, ...args: any[]): void {
		this.log('WARN', category, message, args);
	}

	public error(category: string, message: string, ...args: any[]): void {
		this.log('ERROR', category, message, args);
	}

	public debug(category: string, message: string, ...args: any[]): void {
		this.log('DEBUG', category, message, args);
	}

	public show(): void {
		this._channel.show(true);
	}

	public dispose(): void {
		this._channel.dispose();
	}

	private log(level: string, category: string, message: string, args: any[]): void {
		const timestamp = new Date().toISOString().split('T')[1].replace('Z', '');
		const extra = args.length > 0 ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : '';
		const line = `[${timestamp}] [Pi] [${category}] [${level}] ${message}${extra}`;
		this._channel.appendLine(line);
	}
}
