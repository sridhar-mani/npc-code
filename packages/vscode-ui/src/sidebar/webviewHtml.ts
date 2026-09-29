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
	<style>
${getWebviewStyles()}
	</style>
</head>
<body>
	<!-- Copilot Style Header -->
	<div class="copilot-header">
		<div class="header-row">
			<div class="model-pill-container" title="Select or change active model">
				<i class="codicon codicon-sparkle"></i>
				<select id="modelSelect" class="model-dropdown">
					<option value="">Select or add model...</option>
				</select>
			</div>
			<div class="toolbar-icons">
				<button id="addModelBtn" class="icon-action-btn" title="Add Custom Provider / Model (BYOM)">
					<i class="codicon codicon-add"></i>
				</button>
				<button id="syncOllamaBtn" class="icon-action-btn" title="Sync Models from Ollama">
					<i class="codicon codicon-sync"></i>
				</button>
				<button id="clearBtn" class="icon-action-btn" title="New Session (/clear)">
					<i class="codicon codicon-clear-all"></i>
				</button>
				<button id="terminalBtn" class="icon-action-btn" title="Open Terminal">
					<i class="codicon codicon-terminal"></i>
				</button>
				<button id="settingsBtn" class="icon-action-btn" title="Extension Settings">
					<i class="codicon codicon-settings-gear"></i>
				</button>
			</div>
		</div>
		<div class="status-subrow">
			<div id="ollamaStatus" class="status-chip">
				<span class="status-dot dot-offline"></span>
				<span>Checking status...</span>
			</div>
			<span id="turnCounter" class="turns-badge">0 turns</span>
		</div>
	</div>

	<!-- Messages Thread -->
	<div id="messagesContainer" class="messages-feed">
		<div id="welcomeBox" class="welcome-container">
			<div class="welcome-icon-wrapper">
				<i class="codicon codicon-copilot"></i>
			</div>
			<h3 class="welcome-title">Ziq Assistant</h3>
			<p class="welcome-desc">Enterprise AI coding companion powered by Zenteiq</p>

			<div class="cards-grid">
				<div class="feature-card" data-command="/explain">
					<i class="codicon codicon-symbol-structure card-icon"></i>
					<div class="card-texts">
						<strong>Explain Architecture</strong>
						<span>Analyze workspace structure and code logic</span>
					</div>
				</div>
				<div class="feature-card" data-command="/fix">
					<i class="codicon codicon-tools card-icon"></i>
					<div class="card-texts">
						<strong>Fix & Diagnostics</strong>
						<span>Propose fixes for active errors and warnings</span>
					</div>
				</div>
				<div class="feature-card" data-command="/test">
					<i class="codicon codicon-beaker card-icon"></i>
					<div class="card-texts">
						<strong>Generate Tests</strong>
						<span>Write unit tests with edge cases & mocks</span>
					</div>
				</div>
				<div class="feature-card" data-command="/docs">
					<i class="codicon codicon-book card-icon"></i>
					<div class="card-texts">
						<strong>Documentation & JSDoc</strong>
						<span>Generate docstrings, types, and guides</span>
					</div>
				</div>
				<div class="feature-card" data-action="attachContextPicker">
					<i class="codicon codicon-file-submodule card-icon"></i>
					<div class="card-texts">
						<strong>Attach Files / Context</strong>
						<span>Attach workspace files, problems, or diff</span>
					</div>
				</div>
				<div class="feature-card" data-action="openTerminal">
					<i class="codicon codicon-terminal card-icon"></i>
					<div class="card-texts">
						<strong>Terminal Agent</strong>
						<span>Launch autonomous interactive coding agent</span>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Copilot Style Bottom Input Box -->
	<div class="copilot-input-wrapper">
		<div class="copilot-input-container">
			<div id="contextPillRow" class="context-pill-container" style="display:none;"></div>
			<textarea
				id="promptInput"
				rows="1"
				placeholder="Ask Ziq or type / for commands... (Enter to send)"
			></textarea>
			<div class="input-footer">
				<div class="footer-actions-left">
					<button id="attachBtn" class="action-chip" title="Attach files, workspace code, or diagnostics">
						<i class="codicon codicon-attach"></i>
						<span>Attach</span>
					</button>
					<button class="action-chip" data-command="/explain">/explain</button>
					<button class="action-chip" data-command="/fix">/fix</button>
					<button class="action-chip" data-command="/test">/test</button>
					<button class="action-chip" data-command="/docs">/docs</button>
				</div>
				<div class="footer-actions-right">
					<span id="turnIndicator" style="font-size: 11px; color: var(--vscode-descriptionForeground);">Ready</span>
					<button id="sendBtn" class="send-round-btn" title="Send message (Enter)">
						<i class="codicon codicon-arrow-up"></i>
					</button>
				</div>
			</div>
		</div>
	</div>

	<script>
${getWebviewClientScript()}
	</script>
</body>
</html>`;
}
