/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from 'vscode';
import type { Copilot } from '../../../platform/inlineCompletions/common/api';
import { ILanguageContextProviderService, ProviderTarget } from '../../../platform/languageContextProvider/common/languageContextProviderService';


export class VSCodeContextProviderApiV1 implements Copilot.ContextProviderApiV1 {

	constructor(
		@ILanguageContextProviderService private contextProviderService: ILanguageContextProviderService,
	) {
	}

	registerContextProvider<T extends Copilot.SupportedContextItem>(provider: Copilot.ContextProvider<T>): Disposable {
		return this.contextProviderService.registerContextProvider(provider, [ProviderTarget.Completions]);
	}
}
