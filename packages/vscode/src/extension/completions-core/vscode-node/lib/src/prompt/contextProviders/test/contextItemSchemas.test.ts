/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import type { SupportedContextItem } from "../../../../../types/src";
import type { ResolvedContextItem } from "../../contextProviderRegistry";
import {
	filterContextItemsByType,
	filterSupportedContextItems,
	type SupportedContextItemWithId,
	type TraitWithId,
} from "../contextItemSchemas";

suite("contextItemSchemas", () => {
	test("can filter homogeneous context item by schema", () => {
		const badItem: ResolvedContextItem = {
			providerId: "doesntmatter",
			matchScore: 1,
			resolution: "full",
			resolutionTimeMs: 10,
			data: ["hello" as unknown as TraitWithId],
		};
		const goodItem: ResolvedContextItem = {
			providerId: "doesntmatter",
			matchScore: 1,
			resolution: "full",
			resolutionTimeMs: 10,
			data: [
				{ name: "trait1", value: "value1", id: "1", type: "Trait" },
				{ name: "trait2", value: "value2", id: "2", type: "Trait" },
			],
		};

		// Since they are homogeneous, it's either all or nothing.
		assert.deepStrictEqual(filterContextItemsByType([badItem], "Trait"), []);
		assert.deepStrictEqual(filterContextItemsByType([goodItem], "Trait"), [goodItem]);
	});

	test("can filter homogeneous context item lists by schema", () => {
		const resolvedContextItems: ResolvedContextItem[] = [
			{
				providerId: "doesntmatter",
				matchScore: 1,
				resolution: "full",
				resolutionTimeMs: 10,
				data: ["hello" as unknown as TraitWithId],
			},
			{
				providerId: "doesntmatter",
				matchScore: 1,
				resolution: "full",
				resolutionTimeMs: 10,
				data: [
					{ name: "trait1", value: "value1", id: "1", type: "Trait" },
					{ name: "trait2", value: "value2", id: "2", type: "Trait" },
				],
			},
		];

		assert.deepStrictEqual(filterContextItemsByType(resolvedContextItems, "Trait"), [resolvedContextItems[1]]);
	});

	test("can filter heterogeneous context item schema", () => {
		const data: SupportedContextItemWithId[] = [
			{ name: "trait1", value: "value1", id: "1", type: "Trait" },
			{ uri: "file:///foo", value: "filevalue1", id: "2", type: "CodeSnippet" },
		];
		const mixedContextItem: ResolvedContextItem = {
			providerId: "doesntmatter",
			matchScore: 1,
			resolution: "full",
			resolutionTimeMs: 10,
			data,
		};

		const filteredTraits = filterContextItemsByType([mixedContextItem], "Trait");
		assert.deepStrictEqual(filteredTraits.length, 1);
		assert.deepStrictEqual(filteredTraits[0].data, [data[0]]);

		const filteredFileSnippets = filterContextItemsByType([mixedContextItem], "CodeSnippet");
		assert.deepStrictEqual(filteredFileSnippets.length, 1);
		assert.deepStrictEqual(filteredFileSnippets[0].data, [data[1]]);
	});

	test("can filter heterogeneous context item list by schema", () => {
		const resolvedContextItems: ResolvedContextItem[] = [
			{
				providerId: "doesntmatter1",
				matchScore: 1,
				resolution: "full",
				resolutionTimeMs: 10,
				data: [
					{ name: "trait1", value: "value1", id: "1", type: "Trait" },
					{ uri: "file:///foo", value: "filevalue1", id: "2", type: "CodeSnippet" },
				],
			},
			{
				providerId: "doesntmatter2",
				matchScore: 1,
				resolution: "full",
				resolutionTimeMs: 10,
				data: [{ name: "trait2", value: "value2", id: "3", type: "Trait" }],
			},
		];

		const filteredTraits = filterContextItemsByType(resolvedContextItems, "Trait");
		assert.deepStrictEqual(filteredTraits.length, 2);
		assert.deepStrictEqual(filteredTraits[0].data, [{ name: "trait1", value: "value1", id: "1", type: "Trait" }]);
		assert.deepStrictEqual(filteredTraits[1].data, [{ name: "trait2", value: "value2", id: "3", type: "Trait" }]);
	});

	test("validates context items schema", () => {
		const resolvedContextItems: SupportedContextItem[] = [
			{ name: "trait1", value: "value1" },
			{ uri: "file:///foo", value: "filevalue1" },
		];

		const [validItems, invalidItems] = filterSupportedContextItems(resolvedContextItems);
		assert.deepStrictEqual(invalidItems, 0);
		assert.deepStrictEqual(validItems.length, 2);
	});

	test("items can have optional properties", () => {
		const resolvedContextItems = [
			{ uri: "file:///foo", value: "filevaluewithoptionalprop", optionalProp: "optional" },
			{ uri: "file:///foo", value: "filevaluewithoutag" },
		];

		const [validItems, invalidItems] = filterSupportedContextItems(resolvedContextItems);
		assert.deepStrictEqual(invalidItems, 0);
		assert.deepStrictEqual(validItems.length, 2);
		// Keeps all optional properties
		assert.deepStrictEqual((validItems[0] as unknown as { [key: string]: unknown }).optionalProp, "optional");
	});
});
