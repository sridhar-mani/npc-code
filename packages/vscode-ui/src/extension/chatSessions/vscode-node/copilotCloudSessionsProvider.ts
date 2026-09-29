/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation & Pi Authors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../../../util/vs/base/common/lifecycle';

export class CopilotCloudSessionsProvider extends Disposable implements vscode.ChatSessionItemProvider, vscode.ChatSessionContentProvider {
	static readonly TYPE = 'copilotcloud';

	readonly chatParticipant: vscode.ChatParticipant;

	constructor() {
		super();
		this.chatParticipant = vscode.chat.createChatParticipant('copilotcloud', (_req, _ctx, stream) => {
			stream.markdown('Cloud sessions are disabled in local BYOM mode.');
		});
	}

	async provideChatSessionItems(_token: vscode.CancellationToken): Promise<vscode.ChatSessionItem[]> {
		return [];
	}

	async provideChatSessionContent(_resource: vscode.Uri, _token: vscode.CancellationToken): Promise<vscode.ChatResponseTurn[]> {
		return [];
	}

	resetWorkspaceContext(): void {}

	openSessionInBrowser(_item: vscode.ChatSessionItem): void {}

	refresh(): void {}
}

export function normalizeInitialSessionOptions(options: any): any {
	return options;
}

export function parseSessionLogChunksSafely(text: string): any[] {
	return [];
}
