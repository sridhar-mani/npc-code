import * as vscode from 'vscode';

function toWorkspaceUri(filePathOrUri: string): vscode.Uri {
	if (filePathOrUri.startsWith('file://')) return vscode.Uri.parse(filePathOrUri);
	if (filePathOrUri.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePathOrUri)) {
		return vscode.Uri.file(filePathOrUri);
	}
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root) throw new Error('No VS Code workspace is open');
	return vscode.Uri.joinPath(root, filePathOrUri);
}

export class WorkspaceContext {
	private static runtimeRootOverride?: string;

	static setRuntimeRoot(root?: string): void {
		this.runtimeRootOverride = root;
	}

	static getRuntimeRoot(): string | undefined {
		return this.runtimeRootOverride;
	}

	static getFolders(): vscode.WorkspaceFolder[] {
		return vscode.workspace.workspaceFolders ? [...vscode.workspace.workspaceFolders] : [];
	}

	static getPrimaryWorkspaceFolder(): string | undefined {
		return this.getFolders()[0]?.uri.fsPath;
	}

	static toUri(filePathOrUri: string): vscode.Uri {
		return toWorkspaceUri(filePathOrUri);
	}

	static async findFiles(query = '**/*', maxResults = 100): Promise<string[]> {
		const uris = await vscode.workspace.findFiles(
			query,
			'**/node_modules/**,**/.git/**,**/dist/**,**/build/**',
			maxResults,
		);
		return uris.map((uri) => vscode.workspace.asRelativePath(uri));
	}

	static async readFile(filePathOrUri: string): Promise<string> {
		const bytes = await vscode.workspace.fs.readFile(toWorkspaceUri(filePathOrUri));
		return Buffer.from(bytes).toString('utf8');
	}
}
