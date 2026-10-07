/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DocumentId } from "../dataTypes/documentId";
import { Edits, type RootedEdit } from "../dataTypes/edit";
import { LanguageId } from "../dataTypes/languageId";
import { DocumentHistory, HistoryContext, type IHistoryContextProvider } from "./historyContextProvider";

export class SingleFileStaticWorkspaceTracker implements IHistoryContextProvider {
	constructor(private readonly recentEdit: RootedEdit) {}

	getHistoryContext(docId: DocumentId): HistoryContext | undefined {
		return new HistoryContext([
			new DocumentHistory(
				docId,
				LanguageId.PlainText,
				this.recentEdit.base,
				Edits.single(this.recentEdit.edit),
				undefined,
			),
		]);
	}
}
