/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DocumentId } from "../dataTypes/documentId";
import type { HistoryContext, IHistoryContextProvider } from "./historyContextProvider";

export class StaticWorkspaceTracker implements IHistoryContextProvider {
	constructor(private readonly edits: HistoryContext) {}

	getHistoryContext(_docId: DocumentId): HistoryContext | undefined {
		return this.edits;
	}
}
