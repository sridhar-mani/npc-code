/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ExtensionContext } from "vscode";
import { resolve } from "../../../util/vs/base/common/path";
import { baseActivate } from "../vscode/extension";
import { vscodeNodeContributions } from "./contributions";
import { registerServices } from "./services";

// ###############################################################################################
// ###                                                                                         ###
// ###                 Node extension that runs ONLY in node.js extension host.                ###
// ###                                                                                         ###
// ### !!! Prefer to add code in ../vscode/extension.ts to support all extension runtimes !!!  ###
// ###                                                                                         ###
// ###############################################################################################

//#region TODO@bpasero this needs cleanup
import "../../intents/node/allIntents";

function configureDevPackages() {
	try {
		const sourceMapSupport = require("source-map-support");
		sourceMapSupport.install();
		const dotenv = require("dotenv");
		dotenv.config({ path: [resolve(__dirname, "../.env")] });
	} catch (err) {
		console.error(err);
	}
}

//#endregion

import * as vscode from "vscode";
import { registerBackendBridge } from "../../../backend-bridge";

const piLog = vscode.window.createOutputChannel("Pi Agent");

export async function activate(context: ExtensionContext, forceActivation?: boolean) {
	context.subscriptions.push(piLog);
	piLog.appendLine("[Pi] activate() called");

	piLog.appendLine("[Pi] calling registerBackendBridge...");
	try {
		registerBackendBridge(context);
		piLog.appendLine("[Pi] registerBackendBridge completed successfully");
	} catch (err) {
		const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
		piLog.appendLine("[Pi] registerBackendBridge FAILED: " + msg);
		console.error("[Pi] Failed to register backend bridge:", err);
		throw err;
	}

	piLog.appendLine("[Pi] calling baseActivate...");
	try {
		return await baseActivate({
			context,
			registerServices,
			contributions: vscodeNodeContributions,
			configureDevPackages,
			forceActivation,
		});
	} catch (err) {
		// Pi is a standalone bridge inside this fork. Copilot-specific contributions
		// must not be allowed to tear down the extension after Pi commands are ready.
		const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
		piLog.appendLine("[Pi] baseActivate FAILED; keeping Pi bridge active: " + msg);
		console.error("[Pi] baseActivate failed; continuing with Pi bridge:", err);
		return context;
	}
}
