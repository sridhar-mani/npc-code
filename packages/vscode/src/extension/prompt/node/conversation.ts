/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IIntentInvocation } from "./intents";

export class IntentInvocationMetadata {
	constructor(readonly value: IIntentInvocation) {}
}
