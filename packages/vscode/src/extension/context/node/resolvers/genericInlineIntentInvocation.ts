/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { BasePromptElementProps } from '@vscode/prompt-tsx';
import type { CancellationToken, ChatResponseProgressPart, ChatResponseReferencePart, ChatResponseStream, Progress } from 'vscode';
import type { IResponsePart } from '../../../../platform/chat/common/chatMLFetcher';
import type { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import type { IChatEndpoint } from '../../../../platform/networking/common/networking';
import { Schemas } from '../../../../util/vs/base/common/network';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import type { IBuildPromptContext } from '../../../prompt/common/intents';
import type { IDocumentContext } from '../../../prompt/node/documentContext';
import { EditStrategy } from '../../../prompt/node/editGeneration';
import { type IBuildPromptResult, type IIntent, type IIntentInvocation, type IResponseProcessorContext, NoopReplyInterpreter, type ReplyInterpreter, ReplyInterpreterMetaData } from '../../../prompt/node/intents';
import type { PromptElementCtor } from '../../../prompts/node/base/promptElement';
import { PromptRenderer } from '../../../prompts/node/base/promptRenderer';
import { InlineChatEditCodePrompt } from '../../../prompts/node/inline/inlineChatEditCodePrompt';
import { InlineChatEditMarkdownPrompt } from '../../../prompts/node/inline/inlineChatEditMarkdownPrompt';
import { InlineChatGenerateCodePrompt } from '../../../prompts/node/inline/inlineChatGenerateCodePrompt';
import { InlineChatGenerateMarkdownPrompt } from '../../../prompts/node/inline/inlineChatGenerateMarkdownPrompt';
import { InlineChatNotebookEditPrompt } from '../../../prompts/node/inline/inlineChatNotebookEditPrompt';
import { InlineChatNotebookGeneratePrompt } from '../../../prompts/node/inline/inlineChatNotebookGeneratePrompt';

export interface GenericInlinePromptProps extends BasePromptElementProps {
	documentContext: IDocumentContext;
	promptContext: IBuildPromptContext;
}

export class GenericInlineIntentInvocation implements IIntentInvocation {

	private replyInterpreter: ReplyInterpreter | null = null;

	constructor(
		readonly intent: IIntent,
		readonly location: ChatLocation,
		readonly endpoint: IChatEndpoint,
		private readonly documentContext: IDocumentContext,
		private readonly editStrategy: EditStrategy,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	async buildPrompt(
		promptContext: IBuildPromptContext,
		progress: Progress<ChatResponseReferencePart | ChatResponseProgressPart>,
		token: CancellationToken
	): Promise<IBuildPromptResult> {
		let prompt: PromptElementCtor<GenericInlinePromptProps, any>;
		if (this.documentContext.document.uri.scheme === Schemas.vscodeNotebookCell) {
			prompt = (this.editStrategy === EditStrategy.ForceInsertion ? InlineChatNotebookGeneratePrompt : InlineChatNotebookEditPrompt);
		} else if (this.documentContext.document.languageId === 'markdown') {
			prompt = (this.editStrategy === EditStrategy.ForceInsertion ? InlineChatGenerateMarkdownPrompt : InlineChatEditMarkdownPrompt);
		} else {
			prompt = (this.editStrategy === EditStrategy.ForceInsertion ? InlineChatGenerateCodePrompt : InlineChatEditCodePrompt);
		}
		const renderer = PromptRenderer.create(this.instantiationService, this.endpoint, prompt, {
			documentContext: this.documentContext,
			promptContext
		});
		const result = await renderer.render(progress, token);

		this.replyInterpreter = result.metadata.get(ReplyInterpreterMetaData)?.replyInterpreter ?? null;

		if (!this.replyInterpreter && result.hasIgnoredFiles) {
			this.replyInterpreter = new NoopReplyInterpreter();
		}


		return result;
	}

	public processResponse(context: IResponseProcessorContext, inputStream: AsyncIterable<IResponsePart>, outputStream: ChatResponseStream, token: CancellationToken): Promise<void> {
		if (!this.replyInterpreter) {
			throw new Error(`Could not process response without a reply interpreter!`);
		}
		return this.replyInterpreter.processResponse(context, inputStream, outputStream, token);
	}
}
