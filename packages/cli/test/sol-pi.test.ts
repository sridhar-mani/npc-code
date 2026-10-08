import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createEditTool,
	createWriteTool,
	EvidencePreservingReducer,
	evaluateCompactionCostGate,
	executeFusedCommand,
	ObservationPack,
} from "../../core/src/index.ts";

describe("SoL-Pi Efficiency Mechanisms (Unit Tests)", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `sol-pi-unit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	describe("Action Fusion", () => {
		it("executes a fused command and formats summary on success", async () => {
			const result = await executeFusedCommand(testDir, "echo 'fused-success'");
			expect(result.executed).toBe(true);
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("fused-success");
			expect(result.summary).toContain("[Action Fusion: 'echo 'fused-success'' succeeded]");
		});

		it("reports non-zero exit code when fused command fails", async () => {
			const result = await executeFusedCommand(testDir, "false");
			expect(result.executed).toBe(true);
			expect(result.exitCode).not.toBe(0);
			expect(result.summary).toContain("failed with exit code");
		});

		it("returns empty result when command is empty or whitespace", async () => {
			const result = await executeFusedCommand(testDir, "   ");
			expect(result.executed).toBe(false);
			expect(result.command).toBe("");
			expect(result.summary).toBe("");
		});

		it("integrates Action Fusion into write tool", async () => {
			const writeTool = createWriteTool(testDir);
			const targetFile = join(testDir, "fused-write.txt");

			const result = await writeTool.execute("call-1", {
				path: targetFile,
				content: "Hello World",
				then_run: "echo 'verified write'",
			});

			expect(existsSync(targetFile)).toBe(true);
			expect(readFileSync(targetFile, "utf-8")).toBe("Hello World");
			const firstContent = result.content[0];
			const text = firstContent && firstContent.type === "text" ? firstContent.text : "";
			expect(text).toContain("Successfully wrote to");
			expect(text).toContain("[Action Fusion: 'echo 'verified write'' succeeded]");
		});

		it("integrates Action Fusion into edit tool", async () => {
			const editTool = createEditTool(testDir);
			const targetFile = join(testDir, "fused-edit.txt");
			writeFileSync(targetFile, "const value = 1;\n", "utf-8");

			const result = await editTool.execute("call-2", {
				path: targetFile,
				edits: [{ oldText: "const value = 1;", newText: "const value = 42;" }],
				then_run: "echo 'verified edit'",
			});

			expect(readFileSync(targetFile, "utf-8")).toBe("const value = 42;\n");
			const firstContent = result.content[0];
			const text = firstContent && firstContent.type === "text" ? firstContent.text : "";
			expect(text).toContain("Successfully replaced 1 block(s)");
			expect(text).toContain("[Action Fusion: 'echo 'verified edit'' succeeded]");
		});
	});

	describe("ObservationPack", () => {
		it("leaves output uncompressed when below byte threshold", () => {
			const pack = new ObservationPack({ thresholdBytes: 1024 });
			const output = "small log message";
			const packed = pack.packObservation("call-small", output);
			expect(packed.isExcerpt).toBe(false);
			expect(packed.text).toBe(output);
		});

		it("delivers full output on turns 1 and 2, but excerpts and archives on turn 3", () => {
			const pack = new ObservationPack({ thresholdBytes: 100, excerptLines: 3 });
			const lines = Array.from({ length: 40 }, (_, idx) => `Step log line ${idx + 1}: detailed debug traces`);
			const longLog = lines.join("\n");

			// Turn 1: full output
			const turn1 = pack.packObservation("call-log-1", longLog);
			expect(turn1.isExcerpt).toBe(false);
			expect(turn1.text).toBe(longLog);

			// Turn 2: still full output
			pack.advanceTurn();
			const turn2 = pack.packObservation("call-log-1", longLog);
			expect(turn2.isExcerpt).toBe(false);
			expect(turn2.text).toBe(longLog);

			// Turn 3: aged into excerpt
			pack.advanceTurn();
			const turn3 = pack.packObservation("call-log-1", longLog);
			expect(turn3.isExcerpt).toBe(true);
			expect(turn3.text).toContain("[ObservationPack: Output archived to");
			expect(turn3.text).toContain("Step log line 1:");
			expect(turn3.text).toContain("Step log line 40:");
			expect(turn3.handle).toBeDefined();

			// Full log remains retrievable
			const retrieved = pack.retrieve("call-log-1");
			expect(retrieved).toBe(longLog);
		});
	});

	describe("Evidence-Preserving Reducer", () => {
		it("reduces verbose test failure logs with deterministic verification", () => {
			const reducer = new EvidencePreservingReducer(200);
			const testOutput = [
				"Running test suite: unit tests",
				"PASS test/unit/alpha.test.ts",
				"FAIL test/unit/beta.test.ts",
				"  ● CheckoutService › should charge correct credit",
				"    AssertionError: expected 100 but received 200",
				"      at Object.<anonymous> (test/unit/beta.test.ts:35:12)",
				"Tests: 1 failed, 1 passed, 2 total",
				...Array.from({ length: 50 }, (_, i) => `[DEBUG-TRACE-VERBOSE-${i}] Memory alloc dump byte block ${i}`),
			].join("\n");

			const result = reducer.reduceOutput("npm test -- --run", testOutput, 1);
			expect(result.reduced).toBe(true);
			expect(result.text).toContain("[Evidence-Preserving Reducer:");
			expect(result.text).toContain("AssertionError: expected 100 but received 200");
			expect(result.receipt).toBeDefined();
			expect(result.receipt?.verified).toBe(true);
			expect(result.receipt?.totalFailures).toBeGreaterThan(0);
		});

		it("bypasses non-target commands like ls or cat", () => {
			const reducer = new EvidencePreservingReducer(50);
			const result = reducer.reduceOutput("ls -la", "total 10\nfile1\nfile2", 0);
			expect(result.reduced).toBe(false);
		});
	});

	describe("Online Context Compact Cost Gate", () => {
		it("rejects compaction when horizon is short and prompt cache invalidation costs exceed savings", () => {
			const gate = evaluateCompactionCostGate({
				currentContextTokens: 35000,
				contextWindow: 128000,
				remainingPlannedSteps: 1,
			});
			expect(gate.shouldCompact).toBe(false);
			expect(gate.reason).toContain("cache bust penalty exceeds savings");
		});

		it("approves compaction when remaining steps provide compounding net savings", () => {
			const gate = evaluateCompactionCostGate({
				currentContextTokens: 65000,
				contextWindow: 128000,
				remainingPlannedSteps: 6,
			});
			expect(gate.shouldCompact).toBe(true);
			expect(gate.projectedSavings).toBeGreaterThan(gate.estimatedPenalty);
		});

		it("enforces compaction when reaching hard reserve boundary", () => {
			const gate = evaluateCompactionCostGate({
				currentContextTokens: 118000,
				contextWindow: 128000,
				remainingPlannedSteps: 0,
			});
			expect(gate.shouldCompact).toBe(true);
			expect(gate.reason).toContain("Hard context boundary reached");
		});
	});
});
