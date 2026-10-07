/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import {
	IInstantiationService,
	type ServicesAccessor,
} from "../../../../../../util/vs/platform/instantiation/common/instantiation";
import { FileReader } from "../fileReader";
import { ICompletionsFileSystemService } from "../fileSystem";
import { ICompletionsTextDocumentManagerService } from "../textDocumentManager";
import { createLibTestingContext } from "./context";
import { FakeFileSystem } from "./filesystem";
import type { TestTextDocumentManager } from "./textDocument";

suite("File Reader", () => {
	let sandbox: sinon.SinonSandbox;
	let accessor: ServicesAccessor;

	setup(() => {
		sandbox = sinon.createSandbox();
		const serviceCollection = createLibTestingContext();
		serviceCollection.define(
			ICompletionsFileSystemService,
			new FakeFileSystem({
				"/test.ts": FakeFileSystem.file("const foo", { ctime: 0, mtime: 0, size: 0.1 * 1024 * 1024 }), // .1MB
				"/empty.ts": "",
				"/large.ts": FakeFileSystem.file("very large file", { ctime: 0, mtime: 0, size: 1.1 * 1024 * 1024 }), // 1.1MB
			}),
		);
		accessor = serviceCollection.createTestingAccessor();
	});

	teardown(() => {
		sandbox.restore();
	});

	test("reads file from text document manager", async () => {
		const tdm = accessor.get(ICompletionsTextDocumentManagerService) as TestTextDocumentManager;
		tdm.setTextDocument("file:///test.js", "javascript", "const abc =");
		const reader = accessor.get(IInstantiationService).createInstance(FileReader);

		const docResult = await reader.getOrReadTextDocument({ uri: "file:///test.js" });

		assert.deepStrictEqual(docResult.status, "valid");
		assert.deepStrictEqual(docResult.document?.getText(), "const abc =");
		assert.deepStrictEqual(docResult.document?.detectedLanguageId, "javascript");
	});

	test("reads file from file system", async () => {
		const reader = accessor.get(IInstantiationService).createInstance(FileReader);

		const docResult = await reader.getOrReadTextDocument({ uri: "file:///test.ts" });

		assert.deepStrictEqual(docResult.status, "valid");
		assert.deepStrictEqual(docResult.document?.getText(), "const foo");
		assert.deepStrictEqual(docResult.document?.detectedLanguageId, "typescript");
	});

	test("reads notfound from non existing file", async () => {
		const reader = accessor.get(IInstantiationService).createInstance(FileReader);

		const docResult = await reader.getOrReadTextDocument({ uri: "file:///UNKNOWN.ts" });

		assert.deepStrictEqual(docResult.status, "notfound");
		assert.deepStrictEqual(docResult.message, "File not found");
	});

	test("reads notfound for file too large", async () => {
		const reader = accessor.get(IInstantiationService).createInstance(FileReader);

		const docResult = await reader.getOrReadTextDocument({ uri: "file:///large.ts" });

		assert.deepStrictEqual(docResult.status, "notfound");
		assert.deepStrictEqual(docResult.message, "File too large");
	});

	test("reads empty files", async () => {
		const reader = accessor.get(IInstantiationService).createInstance(FileReader);
		const docResult = await reader.getOrReadTextDocument({ uri: "file:///empty.ts" });

		assert.deepStrictEqual(docResult.status, "valid");
		assert.deepStrictEqual(docResult.document.getText(), "");
	});
});
