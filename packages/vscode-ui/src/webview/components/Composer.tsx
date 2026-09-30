import React, { useRef, useEffect } from 'react';
import type { AttachedContext } from '../types';

interface ComposerProps {
	prompt: string;
	onPromptChange: (val: string) => void;
	onSend: () => void;
	onStop: () => void;
	isGenerating: boolean;
	turnIndicator: string;
	turnCount: number;
	attachedContexts: AttachedContext[];
	onRemoveContext: (id: string) => void;
	onAttachContext: () => void;
	onQuickCommand: (cmd: string) => void;
}

export const Composer: React.FC<ComposerProps> = ({
	prompt,
	onPromptChange,
	onSend,
	onStop,
	isGenerating,
	turnIndicator,
	turnCount,
	attachedContexts,
	onRemoveContext,
	onAttachContext,
	onQuickCommand,
}) => {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = 'auto';
			textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
		}
	}, [prompt]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			if (isGenerating) {
				onStop();
			} else {
				onSend();
			}
		}
	};

	return (
		<footer className="composer">
			<div className="composer-shell">
				{attachedContexts.length > 0 && (
					<div className="context-pills">
						{attachedContexts.map((ctx) => (
							<div key={ctx.id} className="context-pill">
								<i className={`codicon ${ctx.icon || 'codicon-file-code'}`} />
								<span>{ctx.name}</span>
								<span
									className="context-pill-remove"
									onClick={() => onRemoveContext(ctx.id)}
									aria-label="Remove context"
								>
									×
								</span>
							</div>
						))}
					</div>
				)}

				<textarea
					ref={textareaRef}
					rows={1}
					placeholder="Ask Ziq anything…"
					value={prompt}
					onChange={(e) => onPromptChange(e.target.value)}
					onKeyDown={handleKeyDown}
					aria-label="Message Ziq"
				/>

				<div className="composer-toolbar">
					<div className="composer-tools">
						<button
							type="button"
							className="toolbar-button"
							onClick={onAttachContext}
							title="Attach context"
							aria-label="Attach context"
						>
							<i className="codicon codicon-paperclip" />
						</button>
						<button
							type="button"
							className="command-chip"
							onClick={() => onQuickCommand('/explain')}
						>
							Explain
						</button>
						<button
							type="button"
							className="command-chip"
							onClick={() => onQuickCommand('/fix')}
						>
							Fix
						</button>
						<button
							type="button"
							className="command-chip"
							onClick={() => onQuickCommand('/test')}
						>
							Test
						</button>
						<button
							type="button"
							className="command-chip"
							onClick={() => onQuickCommand('/compact')}
						>
							Compact
						</button>
					</div>

					<div className="composer-status">
						<span className="turn-indicator">{turnIndicator}</span>
						<span className="turn-counter">{turnCount} turns</span>
						<button
							type="button"
							className={`send-button ${isGenerating ? 'generating' : ''}`}
							onClick={isGenerating ? onStop : onSend}
							title={isGenerating ? 'Stop generation' : 'Send message'}
							aria-label={isGenerating ? 'Stop generation' : 'Send message'}
							disabled={!isGenerating && !prompt.trim() && attachedContexts.length === 0}
						>
							<i className={`codicon ${isGenerating ? 'codicon-primitive-square' : 'codicon-arrow-up'}`} />
						</button>
					</div>
				</div>
			</div>
		</footer>
	);
};
