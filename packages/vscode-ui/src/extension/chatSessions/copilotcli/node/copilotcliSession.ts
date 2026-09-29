/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation & Pi Authors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { IWorkspaceInfo } from '../../common/workspaceInfo';
import { ChatSessionStatus } from '../../../../vscodeTypes';
import { getSharedAgentBackend } from '../../../../backend-bridge';

export type CopilotCLICommand = 'compact' | 'plan' | 'fleet';
export const copilotCLICommands: readonly CopilotCLICommand[] = ['compact', 'plan', 'fleet'] as const;

export const builtinSlashSCommands = {
	commit: '/commit',
	sync: '/sync',
	merge: '/merge',
	createPr: '/create-pr',
	createDraftPr: '/create-draft-pr',
	updatePr: '/update-pr',
};

export interface ICopilotCLISession {
	readonly sessionId: string;
	readonly workspace: IWorkspaceInfo;
	readonly status: ChatSessionStatus;
	handleRequest(
		request: vscode.ChatRequest,
		input: { command?: CopilotCLICommand; prompt: string },
		attachments: any[],
		model: string | undefined,
		authInfo: any,
		token: vscode.CancellationToken,
	): Promise<void>;
	dispose(): void;
}

export class CopilotCLISession implements ICopilotCLISession {
	public status: ChatSessionStatus = ChatSessionStatus.Completed;

	constructor(
		public readonly sessionId: string,
		public readonly workspace: IWorkspaceInfo,
	) {}

	async handleRequest(
		request: vscode.ChatRequest,
		input: { command?: CopilotCLICommand; prompt: string },
		_attachments: any[],
		_model: string | undefined,
		_authInfo: any,
		_token: vscode.CancellationToken,
	): Promise<void> {
		const backend = await getSharedAgentBackend();
		this.status = ChatSessionStatus.InProgress;

		const files: string[] = [];
		if (request.references && Array.isArray(request.references)) {
			for (const ref of request.references) {
				if (typeof ref.value === 'object' && ref.value && 'fsPath' in ref.value) {
					files.push((ref.value as vscode.Uri).fsPath);
				}
			}
		}

		try {
			if (input.command === 'compact') {
				await backend.compact(this.sessionId);
			} else {
				await backend.prompt(this.sessionId, input.prompt, {
					files: files.length > 0 ? files : undefined,
				});
			}
		} finally {
			this.status = ChatSessionStatus.Completed;
		}
	}

	dispose(): void {}
}
