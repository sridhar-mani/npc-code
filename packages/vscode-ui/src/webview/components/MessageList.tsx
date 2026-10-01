import React, { useEffect, useRef } from 'react';
import type { ChatMessage, SubagentRecord, ToolCallRecord } from '../types';
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
	const label = tool.name === 'run_subagent' ? 'Subagent' : tool.name;

	return (
		<div className={`tool-call-card tool-call-${tool.status} ${expanded ? 'tool-call-expanded' : ''}`}>
			<div
				className="tool-call-header"
				onClick={() => hasDetails && setExpanded(!expanded)}
				style={{ cursor: hasDetails ? 'pointer' : 'default' }}
				title={hasDetails ? (expanded ? 'Collapse details' : 'Expand details') : undefined}
			>
				<i className={`codicon ${isRunning ? 'codicon-loading codicon-modifier-spin' : isError ? 'codicon-error' : 'codicon-check'} tool-call-icon`} />
				<span className="tool-call-name">{label}</span>
				<span className="tool-call-status">{isRunning ? 'Running…' : isError ? 'Failed' : 'Done'}</span>
				{hasDetails && <i className={`codicon codicon-chevron-${expanded ? 'up' : 'down'} tool-call-expand-icon`} />}
			</div>
			{!expanded && tool.result && !isRunning && (
				<div className="tool-call-result" title="Expand details">
					{tool.result.length > 160 ? `${tool.result.slice(0, 160)}…` : tool.result}
				</div>
			)}
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
		</div>
	);
};

const SubagentCard: React.FC<{ agent: SubagentRecord }> = ({ agent }) => {
	const [expanded, setExpanded] = React.useState(false);
	const [now, setNow] = React.useState(Date.now());
	const running = agent.status === 'running';

	React.useEffect(() => {
		if (!running) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [running]);
	const failed = agent.status === 'failed';
	const elapsed = Math.max(0, (agent.endedAt ?? now) - agent.startedAt);
	const seconds = (elapsed / 1000).toFixed(1);

	return (
		<div className={`subagent-card subagent-${agent.status}`}>
			<button className="subagent-card-header" type="button" onClick={() => agent.result && setExpanded(!expanded)}>
				<i className={`codicon ${running ? 'codicon-loading codicon-modifier-spin' : failed ? 'codicon-error' : 'codicon-check'}`} />
				<span className="subagent-card-title">Subagent</span>
				<span className="subagent-card-meta">{running ? `${seconds}s` : failed ? 'Failed' : `Done · ${seconds}s`}</span>
				{agent.result && <i className={`codicon codicon-chevron-${expanded ? 'up' : 'down'}`} />}
			</button>
			{(agent.toolName || agent.text) && (
				<div className="subagent-card-activity">
					{agent.toolName ? `Running ${agent.toolName}` : agent.text}
				</div>
			)}
			{expanded && agent.result && <pre className="subagent-card-result">{agent.result}</pre>}
		</div>
	);
};
interface MessageListProps {
	messages: ChatMessage[];
	onEditMessage: (message: ChatMessage) => void;
	streamingThinkingSegments: Array<{ id: string; text: string; status: 'streaming' | 'complete' }>;
	streamingContent: string;
	isGenerating: boolean;
	liveToolCalls?: ToolCallRecord[];
	liveSubagents?: SubagentRecord[];
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
		bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
	}, [messages, streamingThinkingSegments, streamingContent, liveToolCalls, liveSubagents]);

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
					{m.role === 'assistant' && (m.thinkingSegments?.length || m.thinking) && (
						<div className="thinking-segments">
							{m.thinkingSegments?.map((segment, index) => (
								<ThinkingBlock key={segment.id} thinking={segment.text} isLive={false} segmentNumber={index + 1} />
							))}
							{!m.thinkingSegments?.length && m.thinking && <ThinkingBlock thinking={m.thinking} isLive={false} />}
						</div>
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
							{liveToolCalls.map((tc) => <ToolCallCard key={tc.id} tool={tc} />)}
						</div>
					)}
					{liveSubagents && liveSubagents.length > 0 && (
						<div className="subagents-group">
							{liveSubagents.map((agent) => <SubagentCard key={agent.id} agent={agent} />)}
						</div>
					)}
					{streamingThinkingSegments.map((segment, index) => (
						<ThinkingBlock key={segment.id} thinking={segment.text} isLive={isGenerating && index === streamingThinkingSegments.length - 1 && segment.status === 'streaming'} segmentNumber={index + 1} />
					))}
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
