import type * as vscode from 'vscode';
import { getWebviewStyles } from './webviewStyles';
import { getWebviewClientScript } from './webviewClientScript';

export function getWebviewHtml(codiconUri: vscode.Uri | undefined, cspSource: string): string {
	const codiconLink = codiconUri
		? `<link rel="stylesheet" href="${codiconUri.toString()}">`
		: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; script-src 'unsafe-inline';">
	<title>Ziq Assistant</title>
	${codiconLink}
	<style>${getWebviewStyles()}</style>
</head>
<body>
	<header class="assistant-header">
		<div class="brand-row">
			<div class="brand">
				<div class="brand-mark" aria-hidden="true"><i class="codicon codicon-sparkle"></i></div>
				<div class="brand-copy"><strong>Ziq</strong><span>AI coding assistant</span></div>
			</div>
			<div class="header-actions">
				<button id="addModelBtn" class="icon-button" title="Add custom model" aria-label="Add custom model"><i class="codicon codicon-add"></i></button>\n\t\t\t\t<button id="clearBtn" class="icon-button" title="New session" aria-label="New session"><i class="codicon codicon-clear-all"></i></button>
				<button id="settingsBtn" class="icon-button" title="Settings" aria-label="Settings"><i class="codicon codicon-settings-gear"></i></button>
			</div>
		</div>
		<div class="model-picker" id="modelPickerTrigger">
			<div class="model-picker-leading"><i class="codicon codicon-sparkle"></i></div>
			<select id="modelSelect" class="model-dropdown" aria-label="Active model">
				<option value="">Select or add model...</option>
			</select>
			<div class="model-picker-trailing"><i class="codicon codicon-chevron-down"></i></div>
		</div>
		<div class="status-row">
			<div id="ollamaStatus" class="status-text"><span class="status-dot dot-offline"></span><span>Checking local models…</span></div>
			<button id="syncOllamaBtn" class="quiet-button" title="Refresh local models"><i class="codicon codicon-refresh"></i></button>
		</div>
	</header>

	<main id="messagesContainer" class="messages-feed">
		<section id="welcomeBox" class="welcome">
			<div class="welcome-mark"><i class="codicon codicon-sparkle"></i></div>
			<h1>What can I help you build?</h1>
			<p>Ask about your code, debug an issue, inspect your workspace, or make a change.</p>
			<div class="welcomeGrid">
				<button class="suggestion-card" data-command="/explain"><i class="codicon codicon-symbol-structure"></i><span><strong>Explain code</strong><small>Understand architecture and logic</small></span></button>
				<button class="suggestion-card" data-command="/fix"><i class="codicon codicon-tools"></i><span><strong>Fix a problem</strong><small>Diagnose errors and propose a fix</small></span></button>
				<button class="suggestion-card" data-command="/test"><i class="codicon codicon-beaker"></i><span><strong>Write tests</strong><small>Generate focused coverage and edge cases</small></span></button>
				<button class="suggestion-card" data-command="/docs"><i class="codicon codicon-book"></i><span><strong>Document code</strong><small>Add clear production-ready docs</small></span></button>
				<button class="suggestion-card" data-action="attachContextPicker"><i class="codicon codicon-file-submodule"></i><span><strong>Attach context</strong><small>Bring files or the current selection</small></span></button>
				<button class="suggestion-card" data-action="openTerminal"><i class="codicon codicon-terminal"></i><span><strong>Open terminal agent</strong><small>Continue in the integrated terminal</small></span></button>
			</div>
		</section>
	</main>

	<footer class="composer">
		<div class="composer-shell">
			<div id="contextPillRow" class="context-pills" style="display:none;"></div>
			<textarea id="promptInput" rows="1" placeholder="Ask Ziq anything…" aria-label="Message Ziq"></textarea>
			<div class="composer-toolbar">
				<div class="composer-tools">
					<button id="attachBtn" class="toolbar-button" title="Attach context"><i class="codicon codicon-paperclip"></i></button>
					<button class="command-chip" data-command="/explain">Explain</button>
					<button class="command-chip" data-command="/fix">Fix</button>
					<button class="command-chip" data-command="/test">Test</button>
				</div>
				<div class="composer-status"><span id="turnIndicator">Ready</span><span id="turnCounter">0 turns</span><button id="sendBtn" class="send-button" title="Send message" aria-label="Send message"><i class="codicon codicon-arrow-up"></i></button></div>
			</div>
		</div>
	</footer>
	<div class="sr-only" aria-live="polite" id="liveStatus"></div>
	<script>${getWebviewClientScript()}</script>
</body>
</html>`;
}
