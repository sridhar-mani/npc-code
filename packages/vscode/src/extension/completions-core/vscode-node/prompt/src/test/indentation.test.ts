/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from "assert";
import dedent from "ts-dedent";
import {
	blankNode,
	clearLabels,
	clearLabelsIf,
	cutTreeAfterLine,
	deparseAndCutTree,
	deparseLine,
	deparseTree,
	duplicateTree,
	firstLineOf,
	foldTree,
	type IndentationTree,
	isBlank,
	isLine,
	type LineNode,
	lastLineOf,
	lineNode,
	mapLabels,
	parseRaw,
	parseTree,
	resetLineNumbers,
	topNode,
	virtualNode,
	visitTree,
	visitTreeConditionally,
} from "../indentation";
import { compareTreeWithSpec } from "./testHelpers";

function doParseTest<T>(source: string, expectedTree: IndentationTree<T>) {
	const tree = clearLabels(parseTree(source, "python"));
	compareTreeWithSpec(tree, expectedTree);
}

const SOURCE = {
	source: dedent`
f1:
    a1
f2:
    a2
    a3
`,
	name: "",
};

suite("Test compareTreeWithSpec", () => {
	const SOURCE_MISSING_CHILD = {
		source: dedent`
f1:
    a1
f2:
    a2
`,
		name: "missing child",
	};

	const SOURCE_EXTRA_CHILD = {
		source: dedent`
f1:
    a1
f2:
    a2
    a3
    a4
`,
		name: "extra_child",
	};

	const SOURCE_MISSING_SIBLING = {
		source: dedent`
f1:
    a1
`,
		name: "missing sibling",
	};

	const SOURCE_EXTRA_SIBLING = {
		source: dedent`
f1:
    a1
f2:
    a2
    a3
f3:
    a4
`,
		name: "extra_sibling",
	};

	const SOURCE_EXTRA_MIDDLE_BLANK_LINE = {
		source: dedent`
f1:
    a1

f2:
    a2
    a3
`,
		name: "extra middle blank line",
	};

	const SOURCE_EXTRA_TRAILING_BLANK_LINE = {
		source: dedent`
f1:
    a1
f2:
    a2
    a3

`,
		name: "extra trailing blank line",
	};

	const SOURCE_EXTRA_INDENTATION = {
		source: dedent`
f1:
        a1
f2:
    a2
        a3
`,
		name: "extra indentation",
	};

	const expected = topNode([
		lineNode(0, 0, "f1:", [lineNode(4, 1, "a1", [])]),
		lineNode(0, 2, "f2:", [lineNode(4, 3, "a2", []), lineNode(4, 4, "a3", [])]),
	]);

	test("Test compareTreeWithSpec with good input", () => {
		doParseTest(SOURCE.source, expected);
	});
	// Loop over all bad inputs where we expect a failure from compareTreeWithSpec
	for (const badInput of [
		SOURCE_MISSING_CHILD,
		SOURCE_EXTRA_CHILD,
		SOURCE_MISSING_SIBLING,
		SOURCE_EXTRA_SIBLING,
		SOURCE_EXTRA_INDENTATION,
		SOURCE_EXTRA_TRAILING_BLANK_LINE,
	]) {
		test(`Test compareTreeWithSpec with bad input ${badInput.name}`, () => {
			assert.throws(
				() => doParseTest(badInput.source, expected),
				assert.AssertionError,
				`Expected to fail with ${JSON.stringify(badInput)}`,
			);
		});
	}

	// Do we want extra blank lines to be children?
	test("Test compareTreeWithSpec with extra blank line input", () => {
		assert.throws(
			() => doParseTest(SOURCE_EXTRA_MIDDLE_BLANK_LINE.source, expected),
			assert.AssertionError,
			"Expected to fail with extra blank line, actually fails with extra child",
		);
	});
});

suite("Tree core functions: label manipulation", () => {
	function setOfLabels<L>(tree: IndentationTree<L>): Set<L | "undefined"> {
		const labels = new Set<L | "undefined">();
		visitTree(
			tree,
			(node) => {
				labels.add(node.label ?? "undefined");
			},
			"topDown",
		);
		return labels;
	}
	test("Remove labels from tree", () => {
		const tree = parseTree(SOURCE.source, "python");
		setOfLabels(tree);
		visitTree(
			tree,
			(node) => {
				node.label = node.type === "line" && node.lineNumber % 2 === 0 ? "foo" : "bar";
			},
			"topDown",
		);
		setOfLabels(tree);
		assert.notDeepStrictEqual([...setOfLabels(tree)], ["undefined"], "Tree never had labels");
		clearLabels(tree);
		assert.deepStrictEqual([...setOfLabels(tree)], ["undefined"], "Tree still has labels");
	});
	test("Remove certain labels from tree", () => {
		const tree = parseRaw(SOURCE.source) as IndentationTree<string>;
		visitTree(
			tree,
			(node) => {
				node.label = node.type === "line" && node.lineNumber % 2 === 0 ? "foo" : "bar";
			},
			"topDown",
		);
		assert.deepStrictEqual([...setOfLabels(tree)], ["bar", "foo"], "Did not prepare tree as expected");
		clearLabelsIf<"foo", "bar">(
			tree as IndentationTree<"foo" | "bar">,
			// type predicate of form arg is 'bar':
			(arg: "foo" | "bar"): arg is "bar" => arg === "bar",
		);
		assert.deepStrictEqual([...setOfLabels(tree)], ["undefined", "foo"], "Did not remove bar labels");
	});
	test("Test mapLabels", () => {
		const tree = parseTree(SOURCE.source + '\n\nprint("bye")', "python");
		visitTree(
			tree,
			(node) => {
				node.label = node.type === "line" && node.lineNumber % 2 === 0 ? "foo" : "bar";
			},
			"topDown",
		);
		assert.deepStrictEqual([...setOfLabels(tree)], ["bar", "foo"], "Did not prepare tree as expected");
		const labelsBefore = foldTree(tree, [] as string[], (node, acc) => [...acc, node.label ?? ""], "topDown");
		const mapfct = (label: string) => (label === "foo" ? 1 : 2);
		const treeWithNumbers = mapLabels(tree as IndentationTree<"foo" | "bar">, mapfct);
		const labelsAfter = foldTree(
			treeWithNumbers,
			[] as Array<string | number>,
			(node, acc) => [...acc, node.label ?? ""],
			"topDown",
		);
		assert.deepStrictEqual([...setOfLabels(treeWithNumbers)], [2, 1], "Did not map labels");
		assert.deepStrictEqual(labelsBefore.map(mapfct), labelsAfter, "Did not map labels right");
	});
});

suite("Tree core functions: line numbers", () => {
	const tree = parseTree(SOURCE.source, "python");
	test("First line of source tree is 0", () => {
		assert.strictEqual(firstLineOf(tree), 0);
	});
	test("First line of source tree + two newlines is 2", () => {
		const offsetTree = parseTree(`\n\n${SOURCE.source}`, "python");
		const originalTree = offsetTree.subs[2];
		assert.strictEqual(firstLineOf(originalTree), 2);
	});
	test("Last line of source tree is 4", () => {
		assert.strictEqual(lastLineOf(tree), 4);
	});
	test("firstLineOf", () => {
		const firstLine = firstLineOf(
			topNode([virtualNode(0, []), virtualNode(0, [lineNode(0, 5, "zero", [])]), lineNode(0, 6, "one", [])]),
		);
		assert.ok(firstLine !== undefined);
		assert.strictEqual(firstLine, 5);
	});
	test("firstLineOf undefined", () => {
		const firstLine = firstLineOf(topNode([virtualNode(0, []), virtualNode(0, [virtualNode(0, [])])]));
		assert.ok(firstLine === undefined);
	});
	test("firstLineOf blank", () => {
		const firstLine = firstLineOf(topNode([blankNode(1), lineNode(0, 2, "line", [])]));
		assert.ok(firstLine === 1);
	});
	test("lastLineOf", () => {
		const line = lastLineOf(
			topNode([
				virtualNode(0, []),
				virtualNode(0, [lineNode(0, 1, "first", [])]),
				lineNode(0, 2, "second", [lineNode(0, 3, "third", []), lineNode(0, 4, "fourth", [])]),
			]),
		);
		assert.ok(line !== undefined);
		assert.strictEqual(line, 4);
	});
	test("lastLineOf take by tree order, not registered line numbers", () => {
		const line = lastLineOf(
			topNode([
				lineNode(
					0,
					5,
					"parent",
					[lineNode(0, 4, "child 1", []), lineNode(0, 3, "child 2", []), lineNode(0, 2, "child 3", [])],
					5,
				),
			]),
		);
		assert.ok(line !== undefined);
		assert.strictEqual(line, 2);
	});
	test("lastLineOf undefined", () => {
		const line = lastLineOf(topNode([virtualNode(0, []), virtualNode(0, [virtualNode(0, [])])]));
		assert.ok(line === undefined);
	});

	test("lastLineOf blank", () => {
		const line = lastLineOf(topNode([lineNode(0, 1, "line", []), blankNode(2)]));
		assert.ok(line === 2);
	});
	test("Reset line numbers for tree", () => {
		const duplicatedTree = duplicateTree(tree);
		visitTree(
			duplicatedTree,
			(node) => {
				if (isLine(node)) {
					node.lineNumber = -1;
				}
			},
			"topDown",
		);
		assert.strictEqual(firstLineOf(duplicatedTree), -1);
		assert.strictEqual(lastLineOf(duplicatedTree), -1);
		resetLineNumbers(duplicatedTree);
		let counter = 0;
		visitTree(
			duplicatedTree,
			(node) => {
				if (isLine(node) || isBlank(node)) {
					assert.strictEqual(node.lineNumber, counter);
					counter++;
				}
			},
			"topDown",
		);
	});
});

suite("Test core functions: other", () => {
	const tree = parseTree(SOURCE.source, "python");
	test("deparseTree should give same output as source input", () => {
		// Assert that the tree is the same as the source, ignoring trailing newlines
		assert.strictEqual(deparseTree(tree).replace(/\n*$/, ""), SOURCE.source.replace(/\n*$/, ""));
	});
	test("deparseTree should give same output as source input with an extra blank line", () => {
		const treeLonger = parseTree(`${SOURCE.source}\n`, "python");
		// Assert that the tree is the same as the source, ignoring trailing newlines
		assert.strictEqual(deparseTree(treeLonger).replace(/\n*$/, ""), SOURCE.source.replace(/\n*$/, ""));
	});
	test("deparseAndCutTree cuts at labels", () => {
		const source = dedent`
1
    2
    3
4
    5
    6
7
    8
    9`;
		const tree = parseRaw(source) as IndentationTree<string>;
		tree.subs[0].subs[1].label = "cut";
		tree.subs[1].subs[0].label = "cut";
		const cuts = deparseAndCutTree(tree, ["cut"]);
		// since there were two cuts, it's cut in 5 bits:
		assert.strictEqual(cuts.length, 5);
		// it's cut at the lines labeled 'cut'
		assert.strictEqual(cuts[1].source, deparseLine(tree.subs[0].subs[1] as LineNode<string>));
		assert.strictEqual(cuts[3].source, deparseLine(tree.subs[1].subs[0] as LineNode<string>));
		// all together give the original source (ignoring trailing newlines -- _all_ cuts are newline ended)
		assert.strictEqual(cuts.map((x) => x.source).join(""), source + "\n");
	});
	/* test('encodeTree should give an expression coding the tree', function () {
		const source = dedent`
		1
			2
			3

		4 (
			5
			6
		)


		7
			8
			9
		)`;
		const tree = groupBlocks(parseTree(source));
		// to eval, need to make several imports explicit
		const functions = [topNode, virtualNode, lineNode, blankNode];
		assert.notStrictEqual(functions, []); // make functions used
		const treeAfterRoundTrip = <IndentationTree<string>>eval(`
			const topNode = functions[0];
			const virtualNode = functions[1];
			const lineNode = functions[2];
			const blankNode = functions[3];
			${encodeTree(tree)}`);
		compareTreeWithSpec(treeAfterRoundTrip, tree);
	}); */
	test("Cutting tree correctly", () => {
		const cutTree = parseTree(SOURCE.source, "python");
		cutTreeAfterLine(cutTree, 2);
		assert.strictEqual(lastLineOf(cutTree), 2);
	});
	test("VisitTreeConditionally", () => {
		const tree = parseRaw(dedent`
1
    2
    3
4
    5
    6
7
    8
    9`);
		const traceTopDownAll: string[] = [];
		visitTree(
			tree,
			(node) => {
				if (node.type === "line") {
					traceTopDownAll.push(node.sourceLine.trim());
				}
				return node.type === "top";
			},
			"topDown",
		);
		assert.deepStrictEqual(
			traceTopDownAll,
			["1", "2", "3", "4", "5", "6", "7", "8", "9"],
			"visit all in order: top to down",
		);

		const traceButtonUpAll: string[] = [];
		visitTree(
			tree,
			(node) => {
				if (node.type === "line") {
					traceButtonUpAll.push(node.sourceLine.trim());
				}
				return node.type === "top";
			},
			"bottomUp",
		);
		assert.deepStrictEqual(
			traceButtonUpAll,
			["2", "3", "1", "5", "6", "4", "8", "9", "7"],
			"visit all in order: first leaves, then parents",
		);

		const traceTopDown: string[] = [];
		visitTreeConditionally(
			tree,
			(node) => {
				if (node.type === "line") {
					traceTopDown.push(node.sourceLine.trim());
				}
				return traceTopDown.length < 4;
			},
			"topDown",
		);
		assert.deepStrictEqual(traceTopDown, ["1", "2", "3", "4"], "should stop after four lines");

		const traceButtomUp: string[] = [];
		visitTreeConditionally(
			tree,
			(node) => {
				if (node.type === "line") {
					traceButtomUp.push(node.sourceLine.trim());
				}
				return traceButtomUp.length < 4;
			},
			"bottomUp",
		);
		assert.deepStrictEqual(traceButtomUp, ["2", "3", "1", "5"], "should stop after four nodes");
	});
});
