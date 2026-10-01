import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyBudgetLimits,
	parseSembleJson,
	type SembleChunk,
	SembleSearchService,
} from "../../core/src/semble/semble-search.ts";
import { createSembleToolDefinition } from "../../core/src/tools/semble.ts";

describe("Semble AST Search", () => {
	it("parses Semble JSON chunk output accurately", () => {
		const rawJson = JSON.stringify([
			{
				file_path: "src/engine.ts",
				start_line: 10,
				end_line: 45,
				score: 0.92,
				content: "export class Engine {\n  run() {}\n}",
				type: "class",
			},
		]);

		const chunks = parseSembleJson(rawJson, "/workspace");
		expect(chunks).toHaveLength(1);
		expect(chunks[0].file).toBe("src/engine.ts");
		expect(chunks[0].startLine).toBe(10);
		expect(chunks[0].endLine).toBe(45);
		expect(chunks[0].score).toBe(0.92);
		expect(chunks[0].type).toBe("class");
	});

	it("applies budget limits on chunks", () => {
		const chunks: SembleChunk[] = [
			{ file: "a.ts", startLine: 1, endLine: 5, score: 0.9, content: "function a() {}" },
			{ file: "b.ts", startLine: 1, endLine: 5, score: 0.8, content: "function b() {}" },
			{ file: "c.ts", startLine: 1, endLine: 5, score: 0.7, content: "function c() {}" },
		];

		const limited = applyBudgetLimits(chunks, { limit: 2 });
		expect(limited).toHaveLength(2);
		expect(limited[0].file).toBe("a.ts");
		expect(limited[1].file).toBe("b.ts");
	});

	it("falls back to ripgrep when local files are searched", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-semble-test-"));
		try {
			fs.writeFileSync(
				path.join(tempDir, "sample.ts"),
				"export function computeUniqueMatrixValue() {\n  return 42;\n}\n",
			);

			const results = await SembleSearchService.search({
				cwd: tempDir,
				query: "computeUniqueMatrixValue",
			});

			expect(results.length).toBeGreaterThan(0);
			expect(results[0].content).toContain("computeUniqueMatrixValue");

			// Test tool definition execution
			const tool = createSembleToolDefinition(tempDir);
			const toolResult = await tool.execute("call-1", { query: "computeUniqueMatrixValue" }, undefined, undefined, {
				cwd: tempDir,
			} as never);
			const firstItem = toolResult.content[0];
			expect(firstItem.type).toBe("text");
			if (firstItem.type === "text") {
				expect(firstItem.text).toContain("sample.ts");
			}
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
