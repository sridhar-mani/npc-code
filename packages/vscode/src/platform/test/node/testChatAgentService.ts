/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, type IDisposable } from "../../../util/vs/base/common/lifecycle";
import type { IChatAgentService } from "../../chat/common/chatAgents";
import type { IConversationOptions } from "../../chat/common/conversationOptions";

export class TestChatAgentService implements IChatAgentService {
	declare readonly _serviceBrand: undefined;
	register(options: IConversationOptions): IDisposable {
		return new DisposableStore();
	}
}
