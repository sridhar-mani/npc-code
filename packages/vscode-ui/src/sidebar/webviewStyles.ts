export function getWebviewStyles(): string {
	return `
		:root {
			color-scheme: light dark;
			--ui-border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.25)));
			--ui-hover: var(--vscode-list-hoverBackground, rgba(128,128,128,.10));
			--ui-active: var(--vscode-list-activeSelectionBackground, rgba(128,128,128,.16));
			--ui-muted: var(--vscode-descriptionForeground);
			--ui-accent: var(--vscode-textLink-foreground, var(--vscode-focusBorder));
		}
		* { box-sizing: border-box; }
		html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; }
		body {
			overflow: hidden;
			background: var(--vscode-sideBar-background);
			color: var(--vscode-foreground);
			font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
			font-size: var(--vscode-font-size, 13px);
		}
		#root {
			display: flex;
			flex-direction: column;
			min-height: 0;
			overflow: hidden;
		}
		.assistant-shell {
			width: 100%;
			height: 100%;
			min-height: 0;
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}
		button, textarea, select { font: inherit; }
		button { color: inherit; }
		button:focus-visible, select:focus-visible, textarea:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
		.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }

		.assistant-header {
			padding: 10px 10px 8px;
			border-bottom: 1px solid var(--ui-border);
			background: var(--vscode-sideBar-background);
			flex: 0 0 auto;
		}
		.brand-row, .status-row, .composer-toolbar, .composer-status, .composer-tools, .header-actions {
			display:flex; align-items:center;
		}
		.brand-row { justify-content:space-between; gap:8px; }
		.brand { display:flex; align-items:center; gap:8px; min-width:0; }
		.brand-mark, .welcome-mark {
			display:flex; align-items:center; justify-content:center;
			background: var(--vscode-button-secondaryBackground, var(--ui-active));
			border:1px solid var(--ui-border);
			color:var(--ui-accent);
		}
		.brand-mark { width:26px; height:26px; border-radius:7px; }
		.brand-copy { display:flex; flex-direction:column; min-width:0; }
		.brand-copy strong { font-size:13px; line-height:16px; font-weight:600; }
		.brand-copy span { color:var(--ui-muted); font-size:10px; line-height:13px; }
		.header-actions { gap:2px; }
		.icon-button, .quiet-button, .toolbar-button {
			border:1px solid transparent; background:transparent; cursor:pointer;
			display:inline-flex; align-items:center; justify-content:center;
			color:var(--ui-muted); border-radius:5px;
		}
		.icon-button { width:26px; height:26px; }
		.icon-button:hover, .quiet-button:hover, .toolbar-button:hover { color:var(--vscode-foreground); background:var(--ui-hover); }
		.model-picker {
			position:relative; display:flex; align-items:center; gap:6px; height:32px;
			margin-top:8px; padding:0 8px;
			border:1px solid var(--ui-border); border-radius:6px;
			background:var(--vscode-input-background);
		}
		.model-picker:focus-within { border-color:var(--vscode-focusBorder); }
		.model-picker-leading { color:var(--ui-accent); display:flex; }
		.model-picker-trailing { color:var(--ui-muted); display:flex; pointer-events:none; }
		.model-dropdown {
			min-width:0; flex:1; appearance:none; border:0; outline:0;
			background:transparent; color:var(--vscode-input-foreground);
			font-size:12px; cursor:pointer; text-overflow:ellipsis;
		}
		.status-row { justify-content:space-between; min-height:20px; padding:5px 1px 0; }
		.status-text { min-width:0; display:flex; align-items:center; gap:6px; color:var(--ui-muted); font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
		.status-dot { width:6px; height:6px; border-radius:50%; flex:0 0 auto; }
		.dot-online { background:var(--vscode-testing-iconPassed, #73c991); }
		.dot-offline { background:var(--vscode-testing-iconFailed, #f14c4c); }
		.quiet-button { width:22px; height:22px; font-size:11px; }

		.messages-feed { flex:1 1 auto; min-height:0; overflow-y:auto; padding:18px 12px 12px; scroll-behavior:smooth; }
		.welcome { max-width:560px; margin:5vh auto 0; text-align:center; }
		.welcome-mark { width:42px; height:42px; margin:0 auto 12px; border-radius:12px; font-size:20px; }
		.welcome h1 { margin:0; font-size:16px; line-height:22px; font-weight:600; letter-spacing:-.01em; }
		.welcome > p { max-width:360px; margin:6px auto 18px; color:var(--ui-muted); font-size:11px; line-height:17px; }
		.welcomeGrid { display:grid; grid-template-columns:1fr 1fr; gap:7px; text-align:left; }
		.suggestion-card {
			min-width:0; display:flex; align-items:flex-start; gap:9px; padding:10px;
			border:1px solid var(--ui-border); border-radius:7px;
			background:var(--vscode-editor-background); cursor:pointer; text-align:left;
			transition:background .12s ease, border-color .12s ease, transform .12s ease;
		}
		.suggestion-card:hover { background:var(--ui-hover); border-color:var(--vscode-focusBorder); transform:translateY(-1px); }
		.suggestion-card > i { flex:0 0 auto; margin-top:1px; color:var(--ui-accent); font-size:14px; }
		.suggestion-card span { min-width:0; display:flex; flex-direction:column; gap:2px; }
		.suggestion-card strong { font-size:11px; font-weight:600; }
		.suggestion-card small { color:var(--ui-muted); font-size:10px; line-height:14px; }

		.message-card { display:flex; flex-direction:column; gap:5px; margin:0 auto 14px; max-width:720px; }
		.message-card-header { display:flex; align-items:center; gap:5px; color:var(--ui-muted); font-size:10px; font-weight:600; }
		.author-icon { color:var(--ui-accent); }
		.bubble { border-radius:7px; padding:9px 10px; font-size:12px; line-height:1.55; word-break:break-word; }
		.bubble-user { background:var(--vscode-chat-requestBackground, var(--vscode-button-secondaryBackground)); border:1px solid var(--ui-border); }
		.bubble-assistant { background:var(--vscode-editor-background); border:1px solid var(--ui-border); }
		.thinking-block {
			border:1px solid var(--ui-border);
			background:var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
			border-radius:7px;
			overflow:hidden;
			font-size:11px;
			margin:3px 0 6px;
		}
		.thinking-trigger {
			width:100%;
			display:flex;
			align-items:center;
			justify-content:space-between;
			padding:6px 9px;
			background:transparent;
			border:0;
			color:var(--ui-muted);
			font-weight:600;
			cursor:pointer;
			font-size:11px;
		}
		.thinking-trigger:hover {
			color:var(--vscode-foreground);
			background:var(--ui-hover);
		}
		.thinking-trigger-left {
			display:flex;
			align-items:center;
			gap:6px;
		}
		.thinking-chevron {
			font-size:11px;
			opacity:0.75;
		}
		.thinking-content {
			padding:7px 10px 9px 12px;
			border-top:1px solid var(--ui-border);
			color:var(--ui-muted);
			font-size:11px;
			line-height:1.55;
			background:rgba(0,0,0,0.06);
		}
		.thinking-inner {
			white-space:pre-wrap;
			word-break:break-word;
		}
		.context-pills { display:flex; flex-wrap:wrap; gap:4px; padding-bottom:5px; }
		.context-pill { display:flex; align-items:center; gap:5px; max-width:100%; padding:3px 6px; border:1px solid var(--ui-border); border-radius:5px; background:var(--ui-hover); font-size:10px; }
		.context-pill span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
		.context-pill-remove { cursor:pointer; color:var(--ui-muted); }
		.context-pill-remove:hover { color:var(--vscode-errorForeground); }

		.code-block { margin:8px 0; overflow:hidden; border:1px solid var(--ui-border); border-radius:6px; background:var(--vscode-textCodeBlock-background); }
		.code-block-header { display:flex; align-items:center; justify-content:space-between; padding:4px 7px; border-bottom:1px solid var(--ui-border); color:var(--ui-muted); font-size:10px; }
		.code-block-actions { display:flex; gap:2px; }
		.code-action-btn { border:0; border-radius:4px; padding:3px 5px; background:transparent; color:var(--ui-muted); cursor:pointer; font-size:10px; }
		.code-action-btn:hover { background:var(--ui-hover); color:var(--vscode-foreground); }
		pre { margin:0; padding:9px; overflow:auto; font-family:var(--vscode-editor-font-family, monospace); font-size:11px; line-height:1.5; }
		code { font-family:var(--vscode-editor-font-family, monospace); }

		.composer { flex:0 0 auto; margin-top:auto; padding:8px 10px 10px; background:var(--vscode-sideBar-background); border-top:1px solid var(--ui-border); }
		.composer-shell { border:1px solid var(--ui-border); border-radius:8px; background:var(--vscode-input-background); padding:6px 7px; transition:border-color .12s ease, box-shadow .12s ease; }
		.composer-shell:focus-within { border-color:var(--vscode-focusBorder); box-shadow:0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 35%, transparent); }
		textarea#promptInput { width:100%; min-height:38px; max-height:150px; resize:none; border:0; outline:0; padding:3px 2px; background:transparent; color:var(--vscode-input-foreground); font-size:12px; line-height:17px; }
		textarea#promptInput::placeholder { color:var(--vscode-input-placeholderForeground, var(--ui-muted)); }
		.composer-toolbar { justify-content:space-between; gap:8px; padding-top:3px; }
		.composer-tools { min-width:0; gap:3px; overflow:hidden; }
		.toolbar-button { width:25px; height:25px; flex:0 0 auto; }
		.command-chip { border:1px solid transparent; border-radius:4px; background:transparent; color:var(--ui-muted); padding:3px 5px; cursor:pointer; font-size:10px; }
		.command-chip:hover { background:var(--ui-hover); color:var(--vscode-foreground); }
		.composer-status { gap:6px; color:var(--ui-muted); font-size:10px; white-space:nowrap; }
		#turnCounter { opacity:.7; }
		.send-button { width:26px; height:26px; border:0; border-radius:6px; background:var(--vscode-button-background); color:var(--vscode-button-foreground); cursor:pointer; display:flex; align-items:center; justify-content:center; }
		.send-button:hover { background:var(--vscode-button-hoverBackground); }
		.send-button.btn-stop { background:var(--vscode-testing-iconFailed, #f14c4c); }

		@media (max-width: 300px) {
			.welcomeGrid { grid-template-columns:1fr; }
			.command-chip { display:none; }
		}
		@media (prefers-reduced-motion: reduce) {
			*, *::before, *::after { scroll-behavior:auto !important; transition:none !important; animation:none !important; }
		}
	`;
}
