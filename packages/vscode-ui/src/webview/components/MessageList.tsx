import React, { useEffect, useRef } from 'react';
import type { ChatActivity, ChatMessage, SubagentRecord, ToolCallRecord } from '../types';
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

const THINKING_CHUNK_SIZE = 700;

function splitThinkingText(text: string, maxChars = THINKING_CHUNK_SIZE): string[] {
	const normalized = text.trim();
	if (!normalized) return [];
	const chunks: string[] = [];
	let remaining = normalized;
	while (remaining.length > maxChars) {
		const window = remaining.slice(0, maxChars);
		let cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
		if (cut < Math.floor(maxChars * 0.55)) cut = window.lastIndexOf(" ");
		if (cut < Math.floor(maxChars * 0.45)) cut = maxChars;
		chunks.push(remaining.slice(0, cut).trim());
		remaining = remaining.slice(cut).trim();
	}
	if (remaining) chunks.push(remaining);
	return chunks;
}

const ActivityItem: React.FC<{ item: ChatActivity; isLive?: boolean }> = ({ item, isLive = false }) => {
	if (item.kind === 'thinking') {
		const chunks = splitThinkingText(item.thinking.text);
		return (
			<>
				{chunks.map((chunk, index) => (
					<ThinkingBlock
						key={`${item.thinking.id}-${index}`}
						thinking={chunk}
						isLive={isLive && item.thinking.status === 'streaming' && index === chunks.length - 1}
						segmentNumber={index + 1}
					/>
				))}
			</>
		);
	}
	if (item.kind === 'tool') {
		return <ToolCallCard tool={item.tool} />;
	}
	return <SubagentCard agent={item.agent} />;
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
			{agent.prompt && (
				<div className="subagent-card-prompt" title={agent.prompt}>{agent.prompt}</div>
			)}
			{agent.actions && agent.actions.length > 0 ? (
				<div className="subagent-actions">
					{agent.actions.slice(-8).map((action) => {
						const hasDetails = Boolean(action.args || action.result);
						const label = action.toolName || action.text || 'Working…';
						return hasDetails ? (
							<details key={action.id} className="subagent-action-details">
								<summary className="subagent-action-row">
									<i className={`codicon ${action.kind === 'tool' ? (action.status === 'running' ? 'codicon-loading codicon-modifier-spin' : action.status === 'error' ? 'codicon-error' : 'codicon-check') : 'codicon-chevron-right'}`} />
									<span className="subagent-action-name">{label}</span>
									{action.status === 'running' && <span className="subagent-action-state">running</span>}
								</summary>
								<div className="subagent-action-details-body">
									{action.args && <pre>{typeof action.args === 'string' ? action.args : JSON.stringify(action.args, null, 2)}</pre>}
									{action.result && <pre>{action.result}</pre>}
								</div>
							</details>
						) : (
							<div key={action.id} className="subagent-action-row">
								<i className={`codicon ${action.kind === 'tool' ? (action.status === 'running' ? 'codicon-loading codicon-modifier-spin' : action.status === 'error' ? 'codicon-error' : 'codicon-check') : 'codicon-chevron-right'}`} />
								<span className="subagent-action-name">{label}</span>
								{action.status === 'running' && <span className="subagent-action-state">running</span>}
							</div>
						);
					})}
				</div>
			) : (agent.toolName || agent.text) ? (
				<div className="subagent-card-activity">{agent.toolName ? `Running ${agent.toolName}` : agent.text}</div>
			) : null}
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
	streamingActivity: ChatActivity[];
	onSuggestionClick: (cmd: string) => void;
	onAttachClick: () => void;
	onOpenTerminal: () => void;
}

export const MessageList: React.FC<MessageListProps> = ({
	messages,
	onEditMessage,
	streamingThinkingSegments,
	streamingContent,
	streamingActivity,
	isGenerating,
	liveToolCalls,
	liveSubagents,
	onSuggestionClick,
	onAttachClick,
	onOpenTerminal,
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
					{m.role === 'assistant' && m.activity && m.activity.length > 0 ? (
						<div className="assistant-activity">
							{m.activity.map((item) => <ActivityItem key={item.id} item={item} />)}
						</div>
					) : m.role === 'assistant' && (m.thinkingSegments?.length || m.thinking) ? (
						<div className="thinking-segments">
							{m.thinkingSegments?.map((segment, index) => (
								<ThinkingBlock key={segment.id} thinking={segment.text} isLive={false} segmentNumber={index + 1} />
							))}
							{!m.thinkingSegments?.length && m.thinking && <ThinkingBlock thinking={m.thinking} isLive={false} />}
						</div>
					) : null}
					{m.role === 'assistant' && (!m.activity || m.activity.length === 0) && m.toolCalls && m.toolCalls.length > 0 && (
						<div className="tool-calls-group">
							{m.toolCalls.map((tc) => <ToolCallCard key={tc.id} tool={tc} />)}
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
					{streamingActivity.length > 0 ? (
						<div className="assistant-activity">
							{streamingActivity.map((item) => <ActivityItem key={item.id} item={item} isLive={isGenerating} />)}
						</div>
					) : null}
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
