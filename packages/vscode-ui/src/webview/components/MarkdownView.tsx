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
const fileExtensions = new Set([
	'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'md', 'mdx',
	'py', 'pyw', 'java', 'kt', 'kts', 'go', 'rs', 'c', 'cc', 'cpp', 'h', 'hh', 'hpp',
	'cs', 'fs', 'fsx', 'rb', 'php', 'swift', 'dart', 'lua', 'r', 'sql',
	'css', 'scss', 'less', 'html', 'htm', 'xml', 'yaml', 'yml', 'toml', 'ini',
	'env', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
]);

function isFileReference(value: string): boolean {
	const normalized = value.replaceAll('\\', '/');
	if (/^(?:https?|mailto):/i.test(normalized)) return false;
	const basename = normalized.split('/').pop() ?? normalized;
	if (basename.includes('.') && fileExtensions.has(basename.split('.').pop()!.toLowerCase())) return true;
	return /(?:^|\\/)Dockerfile$/i.test(normalized) || /(?:^|\\/)Makefile$/i.test(normalized);
}

function linkifyFileReferences(value: string): string {
	const escaped = escapeHtml(value);
	const filePattern = /((?:\b(?:\.?\.?[\\/])|\b(?:src|app|lib|test|tests|packages|apps|components|pages|scripts|docs|config|dist|build)[\\/])[A-Za-z0-9_.$@~+\-\\/]+(?:\.[A-Za-z0-9_.$@~+\-]+)?)(?::(\d+)(?::(\d+))?\b)?/g;
	return escaped.replace(filePattern, (match, pathPart: string, line?: string, character?: string) => {
		const decodedPath = pathPart.replaceAll('\\', '/');
		if (!isFileReference(decodedPath)) return match;
		const label = line ? `${decodedPath}:${line}${character ? `:${character}` : ''}` : decodedPath;
		const encodedPath = encodeURIComponent(decodedPath);
		return `<button type="button" class="file-reference" data-ziq-file-path="${encodedPath}" data-ziq-file-line="${line ?? ''}" data-ziq-file-character="${character ?? ''}" title="Open ${escapeHtml(label)}"><i class="codicon codicon-file-code"></i><span>${escapeHtml(label)}</span></button>`;
	});
}

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
	renderer.html = (token) => linkifyFileReferences(token.text);

	// Linkify workspace file paths in normal prose like the VS Code/Copilot chat surface.
	renderer.text = (token) => linkifyFileReferences(token.text);

	// Keep code blocks as HTML for Markdown's full block-level rendering, while
	// preserving the existing VS Code actions through event delegation.
	renderer.code = (token) => {
		const { text, lang } = token;
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


	// Local file links become VS Code-openable references; external links stay regular anchors.
	renderer.link = (token) => {
		const href = token.href || '';
		if (/^(?:file|vscode|vscode-remote):/i.test(href)) {
			const path = href.replace(/^(?:file|vscode|vscode-remote):\\/\\//i, '');
			const encodedPath = encodeURIComponent(path);
			return `<button type="button" class="file-reference" data-ziq-file-path="${encodedPath}" title="Open ${escapeHtml(path)}"><i class="codicon codicon-file-code"></i><span>${escapeHtml(token.text || path)}</span></button>`;
		}
		const safeHref = /^(https?:|mailto:)/i.test(href) ? href : '#';
		const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
		return `<a href="${escapeHtml(safeHref)}"${title} target="_blank" rel="noreferrer">${escapeHtml(token.text || '')}</a>`;
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
		const fileButton = target?.closest<HTMLButtonElement>('[data-ziq-file-path]');
		if (fileButton) {
			const encodedPath = fileButton.dataset.ziqFilePath;
			if (encodedPath) {
				vscode.postMessage({
					command: 'openFileReference',
					path: decodeURIComponent(encodedPath),
					line: Number(fileButton.dataset.ziqFileLine || 0) || undefined,
					character: Number(fileButton.dataset.ziqFileCharacter || 0) || undefined,
				});
			}
			return;
		}

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
