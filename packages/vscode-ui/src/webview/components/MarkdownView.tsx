import React, { useMemo } from 'react';
import { Marked, Renderer } from 'marked';
import { getVsCodeApi } from '../vscode';

interface MarkdownViewProps {
	content: string;
}

const markdownParser = new Marked({
	gfm: true,
	breaks: true,
});

const shellLanguages = new Set(['bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'cmd', 'bat']);

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function createRenderer(): Renderer {
	const renderer = new Renderer();

	// Model output is untrusted. Render raw HTML as text rather than executing it.
	renderer.html = ({ text }: { text: string }) => escapeHtml(text);

	// Keep code blocks as HTML for Markdown's full block-level rendering, while
	// preserving the existing VS Code actions through event delegation.
	renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
		const language = lang?.trim() || 'code';
		const encodedCode = encodeURIComponent(text);
		const languageClass = escapeHtml(language);
		const shell = shellLanguages.has(language.toLowerCase());

		return [
			'<div class="code-block">',
				'<div class="code-block-header">',
					`<span>${languageClass}</span>`,
					'<div class="code-block-actions">',
						shell
						? `<button type="button" class="code-action-btn" data-ziq-code-action="run" data-ziq-code="${encodedCode}" title="Run in Terminal"><i class="codicon codicon-terminal"></i> Run</button>`
						: '',
					`<button type="button" class="code-action-btn" data-ziq-code-action="insert" data-ziq-code="${encodedCode}" title="Insert into active editor"><i class="codicon codicon-insert"></i> Insert</button>`,
					`<button type="button" class="code-action-btn" data-ziq-code-action="copy" data-ziq-code="${encodedCode}" title="Copy code"><i class="codicon codicon-copy"></i> Copy</button>`,
					'</div>',
				'</div>',
				`<pre><code class="code-content">${escapeHtml(text)}</code></pre>`,
			'</div>',
		].join('');
	};

	return renderer;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content }) => {
	const vscode = getVsCodeApi();

	const html = useMemo(() => {
		if (!content) return '';
		try {
			return markdownParser.parse(content, { renderer: createRenderer() }) as string;
		} catch (error) {
			console.error('[Ziq] Markdown render failed:', error);
			return `<p>${escapeHtml(content)}</p>`;
		}
	}, [content]);

	if (!content) return null;

	const handleCodeAction = (event: React.MouseEvent<HTMLDivElement>) => {
		const target = event.target as HTMLElement | null;
		const button = target?.closest<HTMLButtonElement>('[data-ziq-code-action]');
		if (!button) return;

		const encodedCode = button.dataset.ziqCode;
		const code = encodedCode ? decodeURIComponent(encodedCode) : '';
		if (!code) return;

		switch (button.dataset.ziqCodeAction) {
			case 'copy':
				vscode.postMessage({ command: 'copyCode', code });
				break;
			case 'run':
				vscode.postMessage({ command: 'runInTerminal', code });
				break;
			case 'insert':
				vscode.postMessage({ command: 'insertCode', code });
				break;
		}
	};

	return (
		<div
			className="markdown-body"
			onClick={handleCodeAction}
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
};
