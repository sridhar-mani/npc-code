import type * as vscode from 'vscode';
import { getWebviewStyles } from './webviewStyles';

export function getWebviewHtml(
	codiconUri: vscode.Uri | undefined,
	scriptUri: vscode.Uri | undefined,
	cspSource: string
): string {
	const codiconLink = codiconUri
		? `<link rel="stylesheet" href="${codiconUri.toString()}">`
		: '';
	const scriptTag = scriptUri
		? `<script src="${scriptUri.toString()}"></script>`
		: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; script-src ${cspSource} 'unsafe-inline';">
	<title>Ziq Assistant</title>
	${codiconLink}
	<style>${getWebviewStyles()}</style>
</head>
<body>
	<div id="root"></div>
	${scriptTag}
</body>
</html>`;
}
