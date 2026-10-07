/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import type { ServicesAccessor } from "../../../../../../../util/vs/platform/instantiation/common/instantiation";
import { ExpTreatmentVariables } from "../../experiments/expConfig";
import { TelemetryWithExp } from "../../telemetry";
import { createLibTestingContext } from "../../test/context";
import { getEngineRequestInfo } from "../config";

suite("OpenAI Config Tests", () => {
	let accessor: ServicesAccessor;

	setup(() => {
		accessor = createLibTestingContext().createTestingAccessor();
	});

	test("getEngineRequestInfo() returns the model from AvailableModelManager", () => {
		const telem = TelemetryWithExp.createEmptyConfigForTesting();
		telem.filtersAndExp.exp.variables[ExpTreatmentVariables.CustomEngine] = "model.override";

		const info = getEngineRequestInfo(accessor, telem);

		assert.strictEqual(info.modelId, "model.override");
		assert.deepStrictEqual(info.headers, {});
	});
});
