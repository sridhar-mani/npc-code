/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation & Pi Authors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../../util/common/services';
import { Emitter, Event } from '../../../../util/vs/base/common/event';
import { Disposable } from '../../../../util/vs/base/common/lifecycle';
import { basename } from '../../../../util/vs/base/common/resources';
import { URI } from '../../../../util/vs/base/common/uri';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { readVscodeCustomModels } from '../../../../backend-bridge';

export const COPILOT_CLI_MODEL_MEMENTO_KEY = 'github.copilot.cli.sessionModel';
export const COPILOT_CLI_DEFAULT_AGENT_ID = '___vscode_default___';

export interface CopilotCLIModelInfo {
	readonly id: string;
	readonly name: string;
	readonly multiplier?: number;
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
	readonly maxContextWindowTokens: number;
	readonly supportsVision?: boolean;
}

export interface ICopilotCLIModels {
	readonly _serviceBrand: undefined;
	resolveModel(modelId: string): Promise<string | undefined>;
	getDefaultModel(): Promise<string | undefined>;
	setDefaultModel(modelId: string | undefined): Promise<void>;
	getModels(): Promise<CopilotCLIModelInfo[]>;
	registerLanguageModelChatProvider(lm: typeof vscode['lm']): void;
}

export const ICopilotCLIModels = createServiceIdentifier<ICopilotCLIModels>('ICopilotCLIModels');

export class CopilotCLIModels extends Disposable implements ICopilotCLIModels {
	declare _serviceBrand: undefined;
	private _defaultModel: string | undefined;

	async resolveModel(modelId: string): Promise<string | undefined> {
		const models = await this.getModels();
		const normalized = modelId.trim().toLowerCase();
		return models.find(m => m.id.toLowerCase() === normalized || m.name.toLowerCase() === normalized)?.id;
	}

	async getDefaultModel(): Promise<string | undefined> {
		const models = await this.getModels();
		if (models.length === 0) return undefined;
		return this._defaultModel || models[0].id;
	}

	async setDefaultModel(modelId: string | undefined): Promise<void> {
		this._defaultModel = modelId;
	}

	async getModels(): Promise<CopilotCLIModelInfo[]> {
		const custom = readVscodeCustomModels();
		if (custom.length > 0) {
			return custom.map(m => ({
				id: m.id,
				name: m.name || m.label || m.id,
				multiplier: 1,
				maxInputTokens: m.contextWindow || 128000,
				maxOutputTokens: m.maxOutputTokens || 16384,
				maxContextWindowTokens: m.contextWindow || 128000,
				supportsVision: m.vision,
			}));
		}

		return [
			{
				id: 'default',
				name: 'Default Agent Model',
				multiplier: 1,
				maxContextWindowTokens: 128000,
				maxInputTokens: 128000,
				maxOutputTokens: 16384,
				supportsVision: true,
			},
		];
	}

	registerLanguageModelChatProvider(_lm: typeof vscode['lm']): void {
		// Registered provider
	}
}

export interface SweCustomAgent {
	name: string;
	displayName?: string;
	description?: string;
	tools?: string[] | null;
	prompt?: () => Promise<string> | string;
	disableModelInvocation?: boolean;
	model?: string;
}

export interface CLIAgentInfo {
	agent: SweCustomAgent;
	sourceUri?: URI;
}

export interface ICopilotCLIAgents {
	readonly _serviceBrand: undefined;
	readonly onDidChangeAgents: Event<void>;
	getAgents(): Promise<readonly CLIAgentInfo[]>;
	getAgent(name: string): Promise<SweCustomAgent | undefined>;
	trackSessionAgent(sessionId: string, agent: string | undefined): Promise<void>;
	getSessionAgent(sessionId: string): Promise<string | undefined>;
}

export const ICopilotCLIAgents = createServiceIdentifier<ICopilotCLIAgents>('ICopilotCLIAgents');

export class CopilotCLIAgents extends Disposable implements ICopilotCLIAgents {
	declare _serviceBrand: undefined;
	private readonly _onDidChangeAgents = this._register(new Emitter<void>());
	readonly onDidChangeAgents: Event<void> = this._onDidChangeAgents.event;

	private readonly _sessionAgents = new Map<string, string>();

	async getAgents(): Promise<readonly CLIAgentInfo[]> {
		return [];
	}

	async getAgent(_name: string): Promise<SweCustomAgent | undefined> {
		return undefined;
	}

	async trackSessionAgent(sessionId: string, agent: string | undefined): Promise<void> {
		if (agent) {
			this._sessionAgents.set(sessionId, agent);
		} else {
			this._sessionAgents.delete(sessionId);
		}
	}

	async getSessionAgent(sessionId: string): Promise<string | undefined> {
		return this._sessionAgents.get(sessionId);
	}
}

export interface ICopilotCLISDK {
	readonly _serviceBrand: undefined;
	getPackage(): Promise<any>;
	getAuthInfo(): Promise<any>;
	getRequestId(sdkRequestId: string): any;
}

export const ICopilotCLISDK = createServiceIdentifier<ICopilotCLISDK>('ICopilotCLISDK');

export class CopilotCLISDK implements ICopilotCLISDK {
	declare _serviceBrand: undefined;

	async getPackage(): Promise<any> {
		return {};
	}

	async getAuthInfo(): Promise<any> {
		return {
			type: 'token',
			token: 'pi-agent-token',
			host: 'https://github.com',
		};
	}

	getRequestId(_sdkRequestId: string): any {
		return undefined;
	}
}

export function getAgentFileNameFromFilePath(filePath: URI): string {
	const nameFromFile = basename(filePath);
	const lowerName = nameFromFile.toLowerCase();
	const indexOfAgentMd = lowerName.indexOf('.agent.md');
	if (indexOfAgentMd > 0) {
		return nameFromFile.substring(0, indexOfAgentMd);
	}
	const indexOfChatmodeMd = lowerName.indexOf('.chatmode.md');
	if (indexOfChatmodeMd > 0) {
		return nameFromFile.substring(0, indexOfChatmodeMd);
	}
	return nameFromFile;
}

export function isWelcomeView(workspaceService: IWorkspaceService): boolean {
	return workspaceService.getWorkspaceFolders().length === 0;
}
