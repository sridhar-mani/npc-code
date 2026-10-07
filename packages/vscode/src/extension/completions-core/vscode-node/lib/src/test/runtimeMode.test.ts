/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import { RuntimeMode } from "../util/runtimeMode";

suite("RuntimeMode", () => {
	suite("environment variable precedence", () => {
		test("looks for a GH_COPILOT_ variable", () => {
			const runtime = RuntimeMode.fromEnvironment(false, [], { GH_COPILOT_DEBUG: "1" });
			assert.strictEqual(runtime.flags.debug, true);
		});

		test("looks for a GITHUB_COPILOT_ variable", () => {
			const runtime = RuntimeMode.fromEnvironment(false, [], { GITHUB_COPILOT_DEBUG: "1" });
			assert.strictEqual(runtime.flags.debug, true);
		});

		test("gives precedence to GH_COPILOT_ variable if both are set", () => {
			const runtime = RuntimeMode.fromEnvironment(false, [], {
				GH_COPILOT_DEBUG: "0",
				GITHUB_COPILOT_DEBUG: "1",
			});

			assert.strictEqual(runtime.flags.debug, false);
		});
	});

	[true, false].forEach((inTest) => {
		test(`isRunningInTest is set to ${inTest}`, () => {
			assert.strictEqual(RuntimeMode.fromEnvironment(inTest).isRunningInTest(), inTest);
		});
	});

	test("shouldFailForDebugPurposes is enabled by isRunningInTest", () => {
		assert.strictEqual(RuntimeMode.fromEnvironment(true).shouldFailForDebugPurposes(), true);
	});

	suite("isVerboseLoggingEnabled", () => {
		[
			"GH_COPILOT_DEBUG",
			"GITHUB_COPILOT_DEBUG",
			"GH_COPILOT_VERBOSE",
			"GITHUB_COPILOT_VERBOSE",
			"COPILOT_AGENT_VERBOSE",
		].forEach((key) => {
			["1", "true", "TRUE"].forEach((value) => {
				test(`is enabled by ${key}=${value}`, () => {
					assert.strictEqual(
						RuntimeMode.fromEnvironment(false, [], { [key]: value }).isVerboseLoggingEnabled(),
						true,
					);
				});
			});
		});

		test("is enabled by --debug flag", () => {
			assert.strictEqual(RuntimeMode.fromEnvironment(false, ["--debug"], {}).isVerboseLoggingEnabled(), true);
		});

		test("is disabled by default", () => {
			assert.strictEqual(RuntimeMode.fromEnvironment(false, [], {}).isVerboseLoggingEnabled(), false);
		});
	});

	suite("isDebugEnabled", () => {
		["GH_COPILOT_DEBUG", "GITHUB_COPILOT_DEBUG"].forEach((key) => {
			["1", "true", "TRUE"].forEach((value) => {
				test(`is enabled by ${key}=${value}`, () => {
					assert.strictEqual(RuntimeMode.fromEnvironment(false, [], { [key]: value }).isDebugEnabled(), true);
				});
			});
		});

		test("is enabled by --debug flag", () => {
			assert.strictEqual(RuntimeMode.fromEnvironment(false, ["--debug"], {}).isDebugEnabled(), true);
		});

		test("is disabled by default", () => {
			assert.strictEqual(RuntimeMode.fromEnvironment(false, [], {}).isDebugEnabled(), false);
		});
	});
});
