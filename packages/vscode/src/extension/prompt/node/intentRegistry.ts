/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChatLocation } from "../../../platform/chat/common/commonTypes";
import type { SyncDescriptor } from "../../../util/vs/platform/instantiation/common/descriptors";
import type { ContributedToolName } from "../../tools/common/toolNames";
import type { IIntent } from "./intents";

export interface CommandDetails {
	commandId: string;
	intent?: IIntent;
	details: string;
	locations: ChatLocation[];
	readonly toolEquivalent?: ContributedToolName;
}

export const IntentRegistry = new (class {
	private _descriptors: SyncDescriptor<IIntent>[] = [];

	public setIntents(intentDescriptors: SyncDescriptor<IIntent>[]) {
		this._descriptors = this._descriptors.concat(intentDescriptors);
	}

	public getIntents(): readonly SyncDescriptor<IIntent>[] {
		return this._descriptors;
	}
})();
