import React from 'react';
import { getVsCodeApi } from '../vscode';

interface MarkdownViewProps {
	content: string;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content }) => {
	if (!content) return null;

	const vscode = getVsCodeApi();

	const handleCopy = (code: string) => {
		vscode.postMessage({ command: 'copyCode', code });
	};

	const handleRun = (code: string) => {
		vscode.postMessage({ command: 'runInTerminal', code });
	};

	// Split text by markdown code blocks: ```lang ... ```
	const parts: React.ReactNode[] = [];
	const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = codeBlockRegex.exec(content)) !== null) {
		// Normal text before code block
		if (match.index > lastIndex) {
			const textBefore = content.slice(lastIndex, match.index);
			parts.push(
				<span key={`text-${lastIndex}`}>
					{renderInlineMarkdown(textBefore)}
				</span>
			);
		}

		const lang = match[1] || 'code';
		const codeText = match[2].replace(/\n$/, '');
		const isShell = ['bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'cmd', 'bat'].includes(lang.toLowerCase());

		parts.push(
			<div key={`code-${match.index}`} className="code-block">
				<div className="code-block-header">
					<span>{lang}</span>
					<div className="code-block-actions">
						{isShell && (
							<button
								type="button"
								className="code-action-btn"
								onClick={() => handleRun(codeText)}
								title="Run in Terminal"
							>
								<i className="codicon codicon-terminal" /> Run
							</button>
						)}
						<button
							type="button"
							className="code-action-btn"
							onClick={() => handleCopy(codeText)}
							title="Copy code"
						>
							<i className="codicon codicon-copy" /> Copy
						</button>
					</div>
				</div>
				<pre>
					<code className="code-content">{codeText}</code>
				</pre>
			</div>
		);

		lastIndex = match.index + match[0].length;
	}

	// Remaining text after last code block
	if (lastIndex < content.length) {
		parts.push(
			<span key={`text-${lastIndex}`}>
				{renderInlineMarkdown(content.slice(lastIndex))}
			</span>
		);
	}

	return <div className="markdown-body">{parts}</div>;
};

function renderInlineMarkdown(text: string): React.ReactNode {
	// Simple inline parser for bold and inline code
	const lines = text.split('\n');
	return lines.map((line, lineIdx) => {
		const inlineParts: React.ReactNode[] = [];
		// Match `code` or **bold**
		const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
		let lastIdx = 0;
		let m: RegExpExecArray | null;

		while ((m = regex.exec(line)) !== null) {
			if (m.index > lastIdx) {
				inlineParts.push(line.slice(lastIdx, m.index));
			}
			const token = m[1];
			if (token.startsWith('`') && token.endsWith('`')) {
				inlineParts.push(<code key={`inline-${lineIdx}-${m.index}`}>{token.slice(1, -1)}</code>);
			} else if (token.startsWith('**') && token.endsWith('**')) {
				inlineParts.push(<strong key={`bold-${lineIdx}-${m.index}`}>{token.slice(2, -2)}</strong>);
			}
			lastIdx = m.index + token.length;
		}
		if (lastIdx < line.length) {
			inlineParts.push(line.slice(lastIdx));
		}

		return (
			<React.Fragment key={`line-${lineIdx}`}>
				{inlineParts}
				{lineIdx < lines.length - 1 && <br />}
			</React.Fragment>
		);
	});
}
