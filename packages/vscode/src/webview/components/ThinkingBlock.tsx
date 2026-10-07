import React, { useEffect, useMemo, useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';

interface ThinkingBlockProps {
	thinking: string;
	isLive: boolean;
	segmentNumber?: number;
}

const LIVE_PREVIEW_LIMIT = 2600;

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ thinking, isLive, segmentNumber }) => {
	const [isOpen, setIsOpen] = useState(isLive);

	useEffect(() => {
		if (isLive) setIsOpen(true);
	}, [isLive]);

	const displayThinking = useMemo(() => {
		if (thinking.length <= LIVE_PREVIEW_LIMIT) return thinking;
		return `…${thinking.slice(-LIVE_PREVIEW_LIMIT)}`;
	}, [thinking]);

	if (!thinking.trim() && !isLive) return null;

	return (
		<Collapsible.Root open={isOpen} onOpenChange={setIsOpen} className="thinking-block">
			<Collapsible.Trigger asChild>
				<button className="thinking-trigger" type="button" aria-label="Toggle reasoning details">
					<div className="thinking-trigger-left">
						<i className={`codicon ${isLive ? 'codicon-sparkle codicon-spin' : 'codicon-sparkle'}`} />
						<span>{isLive ? 'Thinking…' : segmentNumber ? `Thinking · ${segmentNumber}` : 'Thinking'}</span>
						{thinking.length > LIVE_PREVIEW_LIMIT && <small className="thinking-size">long</small>}
					</div>
					<i className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'} thinking-chevron`} />
				</button>
			</Collapsible.Trigger>
			<Collapsible.Content className="thinking-content">
				<div className="thinking-inner">{displayThinking || (isLive ? 'Working…' : '')}</div>
			</Collapsible.Content>
		</Collapsible.Root>
	);
};
