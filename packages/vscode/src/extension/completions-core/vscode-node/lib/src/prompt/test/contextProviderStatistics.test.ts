/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import type { ResolutionStatus } from "../../../../types/src/index";
import type { PromptMatcher } from "../contextProviderStatistics";
import type { TraitWithId } from "../contextProviders/contextItemSchemas";
import { TestContextProviderStatistics } from "./contextProviderStatistics";

suite("contextProviderStatistics", () => {
	let statistics: TestContextProviderStatistics;
	const resolutions: ResolutionStatus[] = ["partial", "full"];

	setup(() => {
		statistics = new TestContextProviderStatistics();
	});

	const trait1: TraitWithId = {
		name: "trait1",
		value: "value1",
		id: "1234",
		type: "Trait",
	};
	const trait2: TraitWithId = {
		name: "trait2",
		value: "value2",
		id: "5678",
		type: "Trait",
	};

	test("can set expectations", () => {
		statistics.addExpectations("bar", [
			[trait1, "included"],
			[trait2, "content_excluded"],
		]);
		assert.deepStrictEqual(statistics.expectations.size, 1);
		assert.deepStrictEqual(statistics.expectations.get("bar")?.length, 2);
	});

	test("can add expectations", () => {
		statistics.addExpectations("bar", [
			[trait1, "included"],
			[trait2, "content_excluded"],
		]);

		const trait3: TraitWithId = {
			name: "trait3",
			value: "value3",
			id: "9012",
			type: "Trait",
		};
		const trait4: TraitWithId = {
			name: "trait4",
			value: "value4",
			id: "3456",
			type: "Trait",
		};

		statistics.addExpectations("bar", [
			[trait3, "included"],
			[trait4, "content_excluded"],
		]);
		assert.deepStrictEqual(statistics.expectations.size, 1);
		assert.deepStrictEqual(statistics.expectations.get("bar")?.length, 4);
	});

	test("computing match unsets expectations and resolution", () => {
		statistics.addExpectations("bar", [
			[trait1, "included"],
			[trait2, "content_excluded"],
		]);
		statistics.setLastResolution("bar", "full");
		assert.deepStrictEqual(statistics.expectations.size, 1);
		assert.deepStrictEqual(statistics.lastResolution.size, 1);

		statistics.computeMatch([]);

		assert.deepStrictEqual(statistics.expectations.size, 0);
		assert.deepStrictEqual(statistics.lastResolution.size, 0);
	});

	test("does not compute match for empty expectations", () => {
		statistics.addExpectations("bar", []);

		statistics.computeMatch([]);

		assert.deepStrictEqual(statistics.statistics.size, 0);
	});

	for (const resolution of resolutions) {
		test(`can match full expectations, resolution: ${resolution}`, () => {
			statistics.addExpectations("foo", [
				[trait1, "included"],
				[trait2, "included"],
			]);
			statistics.setLastResolution("foo", resolution);

			const promptMatcher: PromptMatcher[] = [
				{
					expectedTokens: 7,
					actualTokens: 7,
					source: trait1,
				},
				{
					expectedTokens: 10,
					actualTokens: 10,
					source: trait2,
				},
			];

			statistics.computeMatch(promptMatcher);
			const stats = statistics.get("foo");
			assert.ok(stats);
			assert.deepStrictEqual(stats.resolution, resolution);
			assert.deepStrictEqual(stats.usage, "full");
			assert.deepStrictEqual(stats.usageDetails, [
				{ id: "1234", usage: "full", expectedTokens: 7, actualTokens: 7, type: "Trait" },
				{ id: "5678", usage: "full", expectedTokens: 10, actualTokens: 10, type: "Trait" },
			]);
		});

		test(`can match partial expectations, resolution: ${resolution}`, () => {
			statistics.addExpectations("foo", [
				[trait1, "included"],
				[trait2, "included"],
			]);
			statistics.setLastResolution("foo", resolution);

			const promptMatchers: PromptMatcher[] = [
				{
					expectedTokens: 7,
					actualTokens: 7,
					source: trait1,
				},
				{
					expectedTokens: 10,
					actualTokens: 5,
					source: trait2,
				},
			];

			statistics.computeMatch(promptMatchers);
			const stats = statistics.get("foo");
			assert.ok(stats);
			assert.deepStrictEqual(stats.resolution, resolution);
			assert.deepStrictEqual(stats.usage, "partial");
			assert.deepStrictEqual(stats.usageDetails, [
				{ id: "1234", usage: "full", expectedTokens: 7, actualTokens: 7, type: "Trait" },
				{ id: "5678", usage: "partial", expectedTokens: 10, actualTokens: 5, type: "Trait" },
			]);
		});

		test(`full elision is no usage, resolution: ${resolution}`, () => {
			statistics.addExpectations("foo", [
				[trait1, "included"],
				[trait2, "included"],
			]);
			statistics.setLastResolution("foo", resolution);

			const promptMatchers: PromptMatcher[] = [
				{
					expectedTokens: 7,
					actualTokens: 0,
					source: trait1,
				},
				{
					expectedTokens: 10,
					actualTokens: 0,
					source: trait2,
				},
			];

			statistics.computeMatch(promptMatchers);
			const stats = statistics.get("foo");
			assert.ok(stats);
			assert.deepStrictEqual(stats.resolution, resolution);
			assert.deepStrictEqual(stats.usage, "none");
			assert.deepStrictEqual(stats.usageDetails, [
				{ id: "1234", usage: "none", expectedTokens: 7, actualTokens: 0, type: "Trait" },
				{ id: "5678", usage: "none", expectedTokens: 10, actualTokens: 0, type: "Trait" },
			]);
		});

		test(`some content excluded items make it partial, resolution: ${resolution}`, () => {
			statistics.addExpectations("foo", [
				[trait1, "included"],
				[trait2, "content_excluded"],
			]);
			statistics.setLastResolution("foo", resolution);

			const promptMatchers: PromptMatcher[] = [
				{
					expectedTokens: 7,
					actualTokens: 7,
					source: trait1,
				},
			];

			statistics.computeMatch(promptMatchers);
			const stats = statistics.get("foo");
			assert.ok(stats);
			assert.deepStrictEqual(stats.resolution, resolution);
			assert.deepStrictEqual(stats.usage, "partial");
			assert.deepStrictEqual(stats.usageDetails, [
				{ id: "1234", usage: "full", expectedTokens: 7, actualTokens: 7, type: "Trait" },
				{ id: "5678", usage: "none_content_excluded", type: "Trait" },
			]);
		});

		test(`all content excluded items make it none, resolution: ${resolution}`, () => {
			statistics.addExpectations("foo", [
				[trait1, "content_excluded"],
				[trait2, "content_excluded"],
			]);
			statistics.setLastResolution("foo", resolution);

			statistics.computeMatch([]);
			const stats = statistics.get("foo");
			assert.ok(stats);
			assert.deepStrictEqual(stats.resolution, resolution);
			assert.deepStrictEqual(stats.usage, "none");
			assert.deepStrictEqual(stats.usageDetails, [
				{ id: "1234", usage: "none_content_excluded", type: "Trait" },
				{ id: "5678", usage: "none_content_excluded", type: "Trait" },
			]);
		});
	}

	test("none resolution is always no match", () => {
		statistics.addExpectations("foo", [
			[trait1, "included"],
			[trait1, "included"],
		]);
		statistics.setLastResolution("foo", "none");

		statistics.computeMatch([]);

		const stats = statistics.get("foo");
		assert.deepStrictEqual(stats!, { usage: "none", resolution: "none" });
	});

	test("error resolution is always no match", () => {
		statistics.addExpectations("foo", [
			[trait1, "content_excluded"],
			[trait2, "content_excluded"],
		]);
		statistics.setLastResolution("foo", "error");

		statistics.computeMatch([]);

		const stats = statistics.get("foo");
		assert.deepStrictEqual(stats!, { usage: "none", resolution: "error" });
	});
});
