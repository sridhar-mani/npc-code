/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation & Pi Authors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from "vscode";
import { getSharedAgentBackend } from "../../../../backend-bridge";
import { createServiceIdentifier } from "../../../../util/common/services";
import { Emitter, type Event } from "../../../../util/vs/base/common/event";
import { Disposable, type IReference } from "../../../../util/vs/base/common/lifecycle";
import type { IWorkspaceInfo } from "../../common/workspaceInfo";
import { CopilotCLISession, type ICopilotCLISession } from "./copilotcliSession";

export interface ICopilotCLISessionItem {
	readonly id: string;
	readonly label: string;
}

export const ICopilotCLISessionService =
	createServiceIdentifier<ICopilotCLISessionService>("ICopilotCLISessionService");

export interface ICopilotCLISessionService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeSessions: Event<void>;
	isNewSessionId(sessionId: string): boolean;
	createSession(workspace: IWorkspaceInfo, sessionId?: string): Promise<IReference<ICopilotCLISession>>;
	getSession(sessionId: string): Promise<IReference<ICopilotCLISession> | undefined>;
	getAllSessions(token?: vscode.CancellationToken): Promise<ICopilotCLISessionItem[]>;
}

export class CopilotCLISessionService extends Disposable implements ICopilotCLISessionService {
	declare readonly _serviceBrand: undefined;
	private readonly _onDidChangeSessions = this._register(new Emitter<void>());
	readonly onDidChangeSessions: Event<void> = this._onDidChangeSessions.event;

	private readonly _sessions = new Map<string, CopilotCLISession>();

	isNewSessionId(sessionId: string): boolean {
		return !this._sessions.has(sessionId);
	}

	async createSession(workspace: IWorkspaceInfo, sessionId?: string): Promise<IReference<ICopilotCLISession>> {
		const backend = await getSharedAgentBackend();
		const sessionResult = await backend.createSession({ enableAttributionHeaders: true });
		const id = sessionId || sessionResult.session.sessionId;
		const session = new CopilotCLISession(id, workspace);
		this._sessions.set(id, session);
		this._onDidChangeSessions.fire();
		return {
			object: session,
			dispose: () => {},
		};
	}

	async getSession(sessionId: string): Promise<IReference<ICopilotCLISession> | undefined> {
		let session = this._sessions.get(sessionId);
		if (!session) {
			const backend = await getSharedAgentBackend();
			const existing = backend.getSession(sessionId);
			if (existing) {
				session = new CopilotCLISession(sessionId, { workspaceFolder: undefined, repository: undefined });
				this._sessions.set(sessionId, session);
			}
		}
		if (!session) return undefined;
		return {
			object: session,
			dispose: () => {},
		};
	}

	async getAllSessions(_token?: vscode.CancellationToken): Promise<ICopilotCLISessionItem[]> {
		const backend = await getSharedAgentBackend();
		const summaries = backend.listSessions();
		return summaries.map((s) => ({
			id: s.id,
			label: s.name || s.id,
		}));
	}
}
