/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as vscode from "vscode";
import type { ILogger } from "../../../../../platform/log/common/logService";
import { makeTextResult } from "./utils";

export function registerGetVscodeInfoTool(server: McpServer, logger: ILogger): void {
	server.registerTool(
		"get_vscode_info",
		{ description: "Get information about the current VS Code instance" },
		async () => {
			logger.debug("Getting VS Code info");
			logger.trace(`VS Code version: ${vscode.version}, app: ${vscode.env.appName}`);
			return makeTextResult({
				version: vscode.version,
				appName: vscode.env.appName,
				appRoot: vscode.env.appRoot,
				language: vscode.env.language,
				machineId: vscode.env.machineId,
				sessionId: vscode.env.sessionId,
				uriScheme: vscode.env.uriScheme,
				shell: vscode.env.shell,
			});
		},
	);
}
