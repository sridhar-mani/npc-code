/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextDocument, WebviewPanel } from 'vscode';
import { IVSCodeExtensionContext } from '../../../../../../platform/extContext/common/extensionContext';
import { IInstantiationService } from '../../../../../../util/vs/platform/instantiation/common/instantiation';
import type { IPosition, ITextDocument } from '../../../lib/src/textDocument';
import { solutionCountTarget } from '../lib/copilotPanel/common';
import { BaseSuggestionsPanelManager, type ListDocumentInterface } from '../panelShared/baseSuggestionsPanelManager';
import type { PanelCompletion } from './common';
import { CopilotListDocument } from './copilotListDocument';
import { CopilotSuggestionsPanel } from './copilotSuggestionsPanel';
import { copilotPanelConfig } from './panelConfig';

export class CopilotSuggestionsPanelManager extends BaseSuggestionsPanelManager<PanelCompletion> {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IVSCodeExtensionContext extensionContext: IVSCodeExtensionContext,
	) {
		super(copilotPanelConfig, instantiationService, extensionContext);
	}

	protected createListDocument(
		wrapped: ITextDocument,
		position: IPosition,
		panel: CopilotSuggestionsPanel
	): ListDocumentInterface {
		return this._instantiationService.createInstance(CopilotListDocument, wrapped, position, panel, solutionCountTarget);
	}

	protected createSuggestionsPanel(
		panel: WebviewPanel,
		document: TextDocument,
		manager: this
	): CopilotSuggestionsPanel {
		return this._instantiationService.createInstance(CopilotSuggestionsPanel, panel, document, manager);
	}
}
