import React, { useRef, useEffect } from 'react';
import type { AttachedContext } from '../types';

interface ComposerProps {
	prompt: string;
	onPromptChange: (val: string) => void;
	onSend: () => void;
	onStop: () => void;
	isGenerating: boolean;
	turnIndicator: string;
	sendMode: 'send' | 'queue' | 'steer';
	onSendModeChange: (mode: 'send' | 'queue' | 'steer') => void;
	onCreateSkill: () => void;
	turnCount: number;
	attachedContexts: AttachedContext[];
	onRemoveContext: (id: string) => void;
	onAttachContext: () => void;
	onDropFiles: (files: FileList | File[]) => void;
	onQuickCommand: (cmd: string) => void;
}

export const Composer: React.FC<ComposerProps> = ({
	prompt,
	onPromptChange,
	onSend,
	onStop,
	isGenerating,
	turnIndicator,
	sendMode,
	onSendModeChange,
	onCreateSkill,
	turnCount,
	attachedContexts,
	onRemoveContext,
	onAttachContext,
	onDropFiles,
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
			if (isGenerating && sendMode === 'send') {
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
					id="promptInput"
					className="composer-textarea"
					onDragOver={(e) => e.preventDefault()}
					onDrop={(e) => { e.preventDefault(); onDropFiles(Array.from(e.dataTransfer.files)); }}
					onPaste={(e) => {
						const files = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith('image/'));
						if (files.length > 0) { e.preventDefault(); onDropFiles(files); }
					}}
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
							className="command-chip"
							onClick={onCreateSkill}
							title="Create a reusable Agent Skill"
						>
							<i className="codicon codicon-sparkle" /> Skill
						</button>
						<button
							type="button"
							className="command-chip toolbar-attach"
							onClick={onAttachContext}
							title="Attach files, images, or editor context"
							aria-label="Attach files, images, or editor context"
						>
							<i className="codicon codicon-paperclip" /> Attach
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
						<select
							value={sendMode}
							onChange={(e) => onSendModeChange(e.target.value as 'send' | 'queue' | 'steer')}
							title="Send behavior"
							aria-label="Send behavior"
							className="send-mode-select"
						>
							<option value="send">Send</option>
							<option value="queue">Queue</option>
							<option value="steer">Steer</option>
						</select>
						<button
							type="button"
							className={`send-button ${isGenerating ? 'generating' : ''}`}
							onClick={isGenerating && sendMode === 'send' ? onStop : onSend}
							title={isGenerating && sendMode === 'send' ? 'Stop generation' : sendMode === 'queue' ? 'Queue message' : sendMode === 'steer' ? 'Steer running agent' : 'Send message'}
							aria-label={isGenerating && sendMode === 'send' ? 'Stop generation' : sendMode === 'queue' ? 'Queue message' : sendMode === 'steer' ? 'Steer running agent' : 'Send message'}
							disabled={!isGenerating && !prompt.trim() && attachedContexts.length === 0}
						>
							<i className={`codicon ${isGenerating && sendMode === 'send' ? 'codicon-primitive-square' : sendMode === 'queue' ? 'codicon-arrow-down' : sendMode === 'steer' ? 'codicon-debug-stop' : 'codicon-arrow-up'}`} />
						</button>
					</div>
				</div>
			</div>
		</footer>
	);
};
