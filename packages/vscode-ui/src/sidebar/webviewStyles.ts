export function getWebviewStyles(): string {
	return `
		* { box-sizing: border-box; }
		body {
			font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
			color: var(--vscode-foreground);
			background: var(--vscode-sideBar-background);
			margin: 0;
			padding: 0;
			height: 100vh;
			display: flex;
			flex-direction: column;
			font-size: var(--vscode-font-size, 13px);
			overflow: hidden;
		}

		/* Header & Toolbar */
		.copilot-header {
			padding: 8px 10px;
			background: var(--vscode-sideBar-background);
			border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.18));
			display: flex;
			flex-direction: column;
			gap: 6px;
			flex-shrink: 0;
		}
		.header-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 6px;
		}
		.model-pill-container {
			flex: 1;
			display: flex;
			align-items: center;
			min-width: 0;
			background: var(--vscode-dropdown-background);
			border: 1px solid var(--vscode-dropdown-border, rgba(128, 128, 128, 0.25));
			border-radius: 6px;
			padding: 0 6px;
			height: 28px;
		}
		.model-pill-container i {
			color: var(--vscode-textLink-foreground, #3794ff);
			font-size: 13px;
			margin-right: 5px;
			flex-shrink: 0;
		}
		select.model-dropdown {
			flex: 1;
			background: transparent;
			color: var(--vscode-dropdown-foreground);
			border: none;
			font-size: 11px;
			outline: none;
			cursor: pointer;
			text-overflow: ellipsis;
			white-space: nowrap;
			overflow: hidden;
			padding: 0;
			font-family: inherit;
		}
		.toolbar-icons {
			display: flex;
			align-items: center;
			gap: 2px;
		}
		.icon-action-btn {
			background: none;
			border: 1px solid transparent;
			color: var(--vscode-foreground);
			opacity: 0.85;
			cursor: pointer;
			padding: 4px;
			border-radius: 4px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 26px;
			height: 26px;
			font-size: 14px;
			transition: background 0.12s, opacity 0.12s;
		}
		.icon-action-btn:hover {
			opacity: 1;
			background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
			border-color: var(--vscode-panel-border, rgba(128, 128, 128, 0.2));
		}
		.status-subrow {
			display: flex;
			align-items: center;
			justify-content: space-between;
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			padding: 0 2px;
		}
		.status-chip {
			display: flex;
			align-items: center;
			gap: 5px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.status-dot {
			width: 7px;
			height: 7px;
			border-radius: 50%;
			display: inline-block;
			flex-shrink: 0;
		}
		.dot-online { background: #3fb950; }
		.dot-offline { background: #d73a49; }
		.turns-badge {
			font-size: 10px;
			font-weight: 500;
			padding: 1px 6px;
			border-radius: 10px;
			background: var(--vscode-badge-background, rgba(128, 128, 128, 0.2));
			color: var(--vscode-badge-foreground);
		}

		/* Messages Feed */
		.messages-feed {
			flex: 1;
			overflow-y: auto;
			padding: 12px;
			display: flex;
			flex-direction: column;
			gap: 14px;
		}
		.welcome-container {
			display: flex;
			flex-direction: column;
			align-items: center;
			text-align: center;
			padding: 24px 8px;
			color: var(--vscode-descriptionForeground);
		}
		.welcome-icon-wrapper {
			width: 44px;
			height: 44px;
			border-radius: 10px;
			background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.06));
			display: flex;
			align-items: center;
			justify-content: center;
			margin-bottom: 12px;
		}
		.welcome-icon-wrapper i {
			font-size: 24px;
			color: var(--vscode-textLink-foreground, #3794ff);
		}
		.welcome-title {
			margin: 0 0 4px 0;
			color: var(--vscode-foreground);
			font-size: 15px;
			font-weight: 600;
		}
		.welcome-desc {
			font-size: 12px;
			margin: 0 0 16px 0;
			opacity: 0.85;
		}
		.cards-grid {
			width: 100%;
			display: flex;
			flex-direction: column;
			gap: 8px;
		}
		.feature-card {
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.18));
			border-radius: 6px;
			padding: 8px 12px;
			text-align: left;
			cursor: pointer;
			display: flex;
			align-items: center;
			gap: 10px;
			transition: background 0.15s, border-color 0.15s, transform 0.1s;
		}
		.feature-card:hover {
			background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05));
			border-color: var(--vscode-focusBorder);
			transform: translateY(-1px);
		}
		.card-icon {
			font-size: 18px;
			color: var(--vscode-textLink-foreground, #3794ff);
			flex-shrink: 0;
		}
		.card-texts {
			display: flex;
			flex-direction: column;
			min-width: 0;
		}
		.card-texts strong {
			font-size: 12px;
			color: var(--vscode-foreground);
		}
		.card-texts span {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		/* Message Cards */
		.message-card {
			display: flex;
			flex-direction: column;
			gap: 6px;
		}
		.message-card-header {
			display: flex;
			align-items: center;
			gap: 6px;
			font-size: 11px;
			font-weight: 600;
			color: var(--vscode-foreground);
		}
		.author-icon {
			font-size: 13px;
			color: var(--vscode-textLink-foreground, #3794ff);
		}
		.bubble {
			padding: 8px 12px;
			border-radius: 6px;
			font-size: 12px;
			line-height: 1.5;
			word-break: break-word;
		}
		.bubble-user {
			background: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.08));
			color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
			border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.15));
			align-self: flex-start;
			width: 100%;
		}
		.bubble-assistant {
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
			color: var(--vscode-foreground);
			width: 100%;
		}

		/* Context Attachment Pill */
		.context-pill-container {
			display: flex;
			flex-wrap: wrap;
			gap: 4px;
			padding: 4px 0;
		}
		.context-pill {
			display: inline-flex;
			align-items: center;
			gap: 5px;
			background: var(--vscode-badge-background, rgba(128, 128, 128, 0.2));
			color: var(--vscode-badge-foreground, var(--vscode-foreground));
			border-radius: 4px;
			padding: 2px 7px;
			font-size: 11px;
		}
		.context-pill-remove {
			cursor: pointer;
			font-weight: bold;
			opacity: 0.7;
			margin-left: 2px;
		}
		.context-pill-remove:hover {
			opacity: 1;
		}

		/* Code block formatting */
		.code-block {
			margin: 8px 0;
			border-radius: 6px;
			background: var(--vscode-textCodeBlock-background, #1e1e1e);
			border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.22));
			overflow: hidden;
		}
		.code-block-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			background: rgba(255, 255, 255, 0.04);
			padding: 4px 8px;
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			border-bottom: 1px solid rgba(128, 128, 128, 0.15);
		}
		.code-block-actions {
			display: flex;
			gap: 4px;
		}
		.code-action-btn {
			background: none;
			border: none;
			color: var(--vscode-foreground);
			cursor: pointer;
			font-size: 11px;
			opacity: 0.8;
			padding: 2px 5px;
			border-radius: 3px;
			display: inline-flex;
			align-items: center;
			gap: 3px;
		}
		.code-action-btn:hover {
			opacity: 1;
			background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
		}
		pre {
			margin: 0;
			padding: 10px;
			overflow-x: auto;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 11px;
			line-height: 1.45;
		}
		code {
			font-family: var(--vscode-editor-font-family, monospace);
		}
		p {
			margin: 4px 0;
		}
		p:first-child { margin-top: 0; }
		p:last-child { margin-bottom: 0; }

		/* Copilot Unified Input Box */
		.copilot-input-wrapper {
			padding: 10px 12px;
			background: var(--vscode-sideBar-background);
			border-top: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.18));
			flex-shrink: 0;
		}
		.copilot-input-container {
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.3));
			border-radius: 8px;
			padding: 6px 8px;
			display: flex;
			flex-direction: column;
			gap: 4px;
			transition: border-color 0.15s, box-shadow 0.15s;
		}
		.copilot-input-container:focus-within {
			border-color: var(--vscode-focusBorder);
			box-shadow: 0 0 0 1px var(--vscode-focusBorder);
		}
		textarea#promptInput {
			width: 100%;
			background: transparent;
			color: var(--vscode-input-foreground);
			border: none;
			font-family: inherit;
			font-size: 12px;
			resize: none;
			min-height: 36px;
			max-height: 130px;
			outline: none;
			line-height: 1.4;
			padding: 2px 2px;
		}
		.input-footer {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding-top: 2px;
		}
		.footer-actions-left {
			display: flex;
			align-items: center;
			gap: 4px;
		}
		.action-chip {
			background: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.06));
			border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.15));
			color: var(--vscode-descriptionForeground);
			border-radius: 4px;
			padding: 2px 6px;
			font-size: 11px;
			cursor: pointer;
			display: inline-flex;
			align-items: center;
			gap: 3px;
			transition: background 0.12s, color 0.12s;
		}
		.action-chip:hover {
			color: var(--vscode-foreground);
			background: var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.12));
		}
		.footer-actions-right {
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.send-round-btn {
			width: 26px;
			height: 26px;
			border-radius: 50%;
			border: none;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			cursor: pointer;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			font-size: 12px;
			transition: background 0.15s, transform 0.1s;
		}
		.send-round-btn:hover {
			background: var(--vscode-button-hoverBackground);
			transform: scale(1.05);
		}
		.send-round-btn.btn-stop {
			background: #d73a49;
		}
	`;
}
