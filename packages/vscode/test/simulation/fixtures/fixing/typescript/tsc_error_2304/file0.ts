// here's a copyright

import * as assert from "assert";
import { parse } from "./file1";

declare function test(name: string, callback: () => void): void;

// here are some comments that should be preserved

test("parse", () => {
	const testObj = parse(readFileSync("myFile.txt", "utf-8"));
	assert.equal(testObj.a, 1);
});
