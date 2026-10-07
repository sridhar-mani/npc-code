/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Raw } from "@vscode/prompt-tsx";
import type { OptionalChatRequestParams } from "../../networking/common/fetch";
import type { Source } from "./chatMLFetcher";
import type { ChatLocation } from "./commonTypes";

export interface IRichChatRequestOptions {
	/** Name of the request for debugging purposes */
	debugName: string;
	messages: Raw.ChatMessage[];
	location: ChatLocation;
	source?: Source;
	requestOptions?: Omit<OptionalChatRequestParams, "n">;
	/** Whether the request was user-initiated (applicable to CAPI requests) */
	userInitiatedRequest?: boolean;
}
