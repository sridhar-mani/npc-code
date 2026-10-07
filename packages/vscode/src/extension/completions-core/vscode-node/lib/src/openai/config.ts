/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServicesAccessor } from "../../../../../../util/vs/platform/instantiation/common/instantiation";
import type { TokenizerName } from "../../../prompt/src/tokenization";
import type { TelemetryWithExp } from "../telemetry";
import type { CompletionHeaders } from "./fetch";
import { ICompletionsModelManagerService, type ModelChoiceSourceTelemetryValue } from "./model";

// Config methods

export type EngineRequestInfo = {
	headers: CompletionHeaders;
	modelId: string;
	engineChoiceSource: ModelChoiceSourceTelemetryValue;
	tokenizer: TokenizerName;
};

export function getEngineRequestInfo(
	accessor: ServicesAccessor,
	telemetryData: TelemetryWithExp | undefined = undefined,
): EngineRequestInfo {
	const modelsManager = accessor.get(ICompletionsModelManagerService);
	const modelRequestInfo = modelsManager.getCurrentModelRequestInfo(telemetryData);
	const tokenizer = modelsManager.getTokenizerForModel(modelRequestInfo.modelId);

	return {
		headers: modelRequestInfo.headers,
		modelId: modelRequestInfo.modelId,
		engineChoiceSource: modelRequestInfo.modelChoiceSource,
		tokenizer,
	};
}
