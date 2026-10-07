/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type { Event } from "../../../util/vs/base/common/event";
import type { IChatSessionService } from "../common/chatSessionService";

export class ChatSessionService implements IChatSessionService {
	declare _serviceBrand: undefined;

	get onDidDisposeChatSession(): Event<string> {
		return vscode.chat.onDidDisposeChatSession as Event<string>;
	}
}
