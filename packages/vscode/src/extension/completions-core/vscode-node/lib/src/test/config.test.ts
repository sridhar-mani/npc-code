/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import {
	ConfigKey,
	DefaultsOnlyConfigProvider,
	getConfigDefaultForKey,
	getConfigKeyRecursively,
	InMemoryConfigProvider,
} from "../config";

suite("getConfig", () => {
	for (const key of Object.values(ConfigKey)) {
		test(`has default for ${key}`, () => {
			// No news is good news
			getConfigDefaultForKey(key);
		});
	}
});

suite("getConfigKeyRecursively", () => {
	test("handles arbitrary dots", () => {
		const config = {
			"a.b.c": { "d.e": "value" },
		};
		assert.strictEqual(getConfigKeyRecursively(config, "a.b.c.d.e"), "value");
	});
});

suite("InMemoryConfigProvider", () => {
	test("allows setting and getting config values", () => {
		const configProvider = new InMemoryConfigProvider(new DefaultsOnlyConfigProvider());
		configProvider.setConfig(ConfigKey.DebugOverrideEngine, "test");
		assert.strictEqual(configProvider.getConfig(ConfigKey.DebugOverrideEngine), "test");
	});
});
