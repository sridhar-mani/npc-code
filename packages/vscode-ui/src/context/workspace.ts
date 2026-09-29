import * as vscode from 'vscode';

export class WorkspaceContext {
	static getFolders(): vscode.WorkspaceFolder[] {
		return vscode.workspace.workspaceFolders ? [...vscode.workspace.workspaceFolders] : [];
	}

	static getPrimaryWorkspaceFolder(): string | undefined {
		const folders = this.getFolders();
		return folders.length > 0 ? folders[0].uri.fsPath : undefined;
	}

	static async findFiles(query: string = '**/*', maxResults: number = 50): Promise<string[]> {
		const uris = await vscode.workspace.findFiles(query, '**/node_modules/**,**/.git/**,**/dist/**,**/build/**', maxResults);
		return uris.map(u => vscode.workspace.asRelativePath(u));
	}

	static async readFile(filePathOrUri: string): Promise<string> {
		const uri = filePathOrUri.startsWith('file://')
			? vscode.Uri.parse(filePathOrUri)
			: vscode.Uri.file(filePathOrUri);
		const bytes = await vscode.workspace.fs.readFile(uri);
		return Buffer.from(bytes).toString('utf8');
	}

	static async writeFile(filePathOrUri: string, content: string): Promise<void> {
		const uri = filePathOrUri.startsWith('file://')
			? vscode.Uri.parse(filePathOrUri)
			: vscode.Uri.file(filePathOrUri);
		await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
	}
}
