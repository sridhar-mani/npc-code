import React, { useEffect, useRef } from 'react';
import type { ChatMessage } from '../types';
import { ThinkingBlock } from './ThinkingBlock';
import { MarkdownView } from './MarkdownView';

interface MessageListProps {
	messages: ChatMessage[];
	streamingThinking: string;
	streamingContent: string;
	isGenerating: boolean;
	onSuggestionClick: (cmd: string) => void;
	onAttachClick: () => void;
	onOpenTerminal: () => void;
}

export const MessageList: React.FC<MessageListProps> = ({
	messages,
	streamingThinking,
	streamingContent,
	isGenerating,
	onSuggestionClick,
	onAttachClick,
	onOpenTerminal,
}) => {
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages, streamingThinking, streamingContent]);

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
					</div>
					{m.role === 'assistant' && m.thinking && (
						<ThinkingBlock thinking={m.thinking} isLive={false} />
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
