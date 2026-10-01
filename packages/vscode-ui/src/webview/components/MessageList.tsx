import React, { useEffect, useRef } from 'react';
import type { ChatMessage, ToolCallRecord } from '../types';
import { ThinkingBlock } from './ThinkingBlock';
import { MarkdownView } from './MarkdownView';

interface ToolCallCardProps {
	tool: ToolCallRecord;
}

const ToolCallCard: React.FC<ToolCallCardProps> = ({ tool }) => {
	const [expanded, setExpanded] = React.useState(false);
	const isRunning = tool.status === 'running';
	const isError = tool.status === 'error';
	const hasDetails = Boolean(tool.result || tool.args);

	return (
		<div className={`tool-call-card tool-call-${tool.status} ${expanded ? 'tool-call-expanded' : ''}`}>
			<div
				className="tool-call-header"
				onClick={() => hasDetails && setExpanded(!expanded)}
				style={{ cursor: hasDetails ? 'pointer' : 'default' }}
				title={hasDetails ? (expanded ? 'Click to collapse' : 'Click to expand full output') : undefined}
			>
				<i className={`codicon ${isRunning ? 'codicon-loading codicon-modifier-spin' : isError ? 'codicon-error' : 'codicon-check'} tool-call-icon`} />
				<span className="tool-call-name">{tool.name}</span>
				<span className="tool-call-status">{isRunning ? 'Running…' : isError ? 'Failed' : 'Done'}</span>
				{hasDetails && (
					<i className={`codicon ${expanded ? 'codicon-chevron-up' : 'codicon-chevron-down'} tool-call-expand-icon`} />
				)}
			</div>
			{expanded && !isRunning && (
				<div className="tool-call-body">
					{tool.args && (
						<div className="tool-call-section">
							<div className="tool-call-section-title">Arguments</div>
							<pre className="tool-call-code">{typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2)}</pre>
						</div>
					)}
					{tool.result && (
						<div className="tool-call-section">
							<div className="tool-call-section-title">Output</div>
							<pre className="tool-call-result-full">{tool.result}</pre>
						</div>
					)}
				</div>
			)}
			{!expanded && tool.result && !isRunning && (
				<div
					className="tool-call-result"
					onClick={() => setExpanded(true)}
					title="Click to view full output"
				>
					{tool.result.length > 200 ? tool.result.slice(0, 200) + '… (click to expand)' : tool.result}
				</div>
			)}
		</div>
	);
};

interface MessageListProps {
	messages: ChatMessage[];
	onEditMessage: (message: ChatMessage) => void;
	streamingThinking: string;
	streamingContent: string;
	isGenerating: boolean;
	liveToolCalls?: ToolCallRecord[];
	onSuggestionClick: (cmd: string) => void;
	onAttachClick: () => void;
	onOpenTerminal: () => void;
}

export const MessageList: React.FC<MessageListProps> = ({
	messages,
	streamingThinking,
	streamingContent,
	isGenerating,
	liveToolCalls,
	onSuggestionClick,
	onAttachClick,
	onOpenTerminal,
	onEditMessage,
}) => {
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages, streamingThinking, streamingContent, liveToolCalls]);

	const showWelcome = messages.length === 0 && !isGenerating;

	return (
		<main className="messages-feed">
			{showWelcome && (
				<section className="welcome">
					<div className="welcome-mark">
						<i className="codicon codicon-sparkle" />
					</div>
					<h1>What can I help you build?</h1>
					<p>Ask about your code, debug an issue, inspect your workspace, or make a change.</p>
					<div className="welcomeGrid">
						<button
							type="button"
							className="suggestion-card"
							onClick={() => onSuggestionClick('/explain')}
						>
							<i className="codicon codicon-symbol-structure" />
							<span>
								<strong>Explain code</strong>
								<small>Understand architecture and logic</small>
							</span>
						</button>
						<button
							type="button"
							className="suggestion-card"
							onClick={() => onSuggestionClick('/fix')}
						>
							<i className="codicon codicon-tools" />
							<span>
								<strong>Fix a problem</strong>
								<small>Diagnose errors and propose a fix</small>
							</span>
						</button>
						<button
							type="button"
							className="suggestion-card"
							onClick={() => onSuggestionClick('/test')}
						>
							<i className="codicon codicon-beaker" />
							<span>
								<strong>Write tests</strong>
								<small>Generate focused coverage and edge cases</small>
							</span>
						</button>
						<button
							type="button"
							className="suggestion-card"
							onClick={() => onSuggestionClick('/docs')}
						>
							<i className="codicon codicon-book" />
							<span>
								<strong>Document code</strong>
								<small>Add clear production-ready docs</small>
							</span>
						</button>
						<button
							type="button"
							className="suggestion-card"
							onClick={onAttachClick}
						>
							<i className="codicon codicon-file-submodule" />
							<span>
								<strong>Attach context</strong>
								<small>Bring files or the current selection</small>
							</span>
						</button>
						<button
							type="button"
							className="suggestion-card"
							onClick={onOpenTerminal}
						>
							<i className="codicon codicon-terminal" />
							<span>
								<strong>Open terminal agent</strong>
								<small>Continue in the integrated terminal</small>
							</span>
						</button>
					</div>
				</section>
			)}

			{messages.map((m) => (
				<div key={m.id} className="message-card">
					<div className="message-card-header">
						<i
							className={`codicon ${
								m.role === 'user' ? 'codicon-account' : 'codicon-sparkle'
							} author-icon`}
						/>
						<span>{m.role === 'user' ? 'You' : 'Ziq'}</span>
					{m.role === 'user' && m.entryId && (
						<button
							type="button"
								className="message-edit-button"
								onClick={() => onEditMessage(m)}
								title="Edit and resend this request"
								aria-label="Edit and resend this request"
							>
								<i className="codicon codicon-edit" />
							</button>
					)}
					</div>
					{m.role === 'assistant' && m.thinking && (
						<ThinkingBlock thinking={m.thinking} isLive={false} />
					)}
					{m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0 && (
						<div className="tool-calls-group">
							{m.toolCalls.map((tc) => (
								<ToolCallCard key={tc.id} tool={tc} />
							))}
						</div>
					)}
					<div className={`bubble bubble-${m.role}`}>
						<MarkdownView content={m.content} />
					</div>
				</div>
			))}

			{isGenerating && (
				<div className="message-card">
					<div className="message-card-header">
						<i className="codicon codicon-sparkle author-icon" />
						<span>Ziq</span>
					</div>
					<ThinkingBlock thinking={streamingThinking} isLive={!streamingContent} />
					{liveToolCalls && liveToolCalls.length > 0 && (
						<div className="tool-calls-group">
							{liveToolCalls.map((tc) => (
								<ToolCallCard key={tc.id} tool={tc} />
							))}
						</div>
					)}
					{streamingContent ? (
						<div className="bubble bubble-assistant">
							<MarkdownView content={streamingContent} />
						</div>
					) : null}
				</div>
			)}

			<div ref={bottomRef} />
		</main>
	);
};
