import * as vscode from "vscode";

export interface DocumentContext {
	uri: string;
	fileName: string;
	languageId: string;
	lineCount: number;
	fullText?: string;
	selectedText?: string;
	startLine?: number;
	endLine?: number;
}

export class EditorContext {
	static getActiveDocument(includeText: boolean = false): DocumentContext | undefined {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return undefined;

		const doc = editor.document;
		const sel = editor.selection;
		const selectedText = !sel.isEmpty ? doc.getText(sel) : undefined;
		const relPath = vscode.workspace.asRelativePath(doc.uri);

		return {
			uri: doc.uri.toString(),
			fileName: relPath,
			languageId: doc.languageId,
			lineCount: doc.lineCount,
			fullText: includeText ? doc.getText() : undefined,
			selectedText,
			startLine: !sel.isEmpty ? sel.start.line + 1 : undefined,
			endLine: !sel.isEmpty ? sel.end.line + 1 : undefined,
		};
	}

	static getOpenDocuments(): Array<{ fileName: string; languageId: string }> {
		return vscode.workspace.textDocuments
			.filter((doc) => !doc.isClosed && doc.uri.scheme === "file")
			.map((doc) => ({
				fileName: vscode.workspace.asRelativePath(doc.uri),
				languageId: doc.languageId,
			}));
	}
}
