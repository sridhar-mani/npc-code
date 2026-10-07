/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServicesAccessor } from "../../../../../../util/vs/platform/instantiation/common/instantiation";
import {
	defaultCppSimilarFilesOptions,
	type SimilarFilesOptions,
} from "../../../prompt/src/snippetInclusion/similarFiles";
import type { TelemetryWithExp } from "../telemetry";
import { useSubsetMatching } from "./similarFileOptionsProvider";

export function getCppSimilarFilesOptions(
	accessor: ServicesAccessor,
	telemetryWithExp: TelemetryWithExp,
): SimilarFilesOptions {
	return {
		...defaultCppSimilarFilesOptions,
		useSubsetMatching: useSubsetMatching(accessor, telemetryWithExp),
	};
}

export function getCppNumberOfSnippets(telemetryWithExp: TelemetryWithExp): number {
	return defaultCppSimilarFilesOptions.maxTopSnippets;
}
