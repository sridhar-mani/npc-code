import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createEditTool,
	createSwitchyardVirtualModel,
	createWriteTool,
	EvidencePreservingReducer,
	ExecCriticScaffold,
	evaluateCompactionCostGate,
	ObservationPack,
	RoutingTelemetryRecorder,
	SwitchyardModelRouter,
} from "../../core/src/index.ts";

describe("Agent Papers End-to-End Integration Tests", () => {
	let repoDir: string;

	beforeEach(() => {
		repoDir = join(tmpdir(), `agent-papers-integ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
		mkdirSync(repoDir, { recursive: true });

		// Initialize a valid git repository for ExecCritic integration
		execSync("git init", { cwd: repoDir, stdio: "ignore" });
		execSync('git config user.email "test@npc.ai"', { cwd: repoDir, stdio: "ignore" });
		execSync('git config user.name "NPC Agent"', { cwd: repoDir, stdio: "ignore" });
	});

	afterEach(() => {
		if (existsSync(repoDir)) {
			rmSync(repoDir, { recursive: true, force: true });
		}
	});

	describe("ExecCritic End-to-End Workflow (Paper 2 Replication)", () => {
		it("replicates full Test-Verify-Revise flow: fail-closed rejection, freezing, test protection, and verified repair", async () => {
			// 1. Create buggy codebase in the repository
			const srcDir = join(repoDir, "src");
			mkdirSync(srcDir, { recursive: true });
			const mathFile = join(srcDir, "calculator.js");

			// Bug: divider function forgets to handle denominator === 0 and returns NaN instead of throwing
			const buggyCode = `
export function divide(a, b) {
  return a / b;
}
`;
			writeFileSync(mathFile, buggyCode, "utf-8");
			execSync("git add . && git commit -m 'initial buggy commit'", { cwd: repoDir, stdio: "ignore" });

			const scaffold = new ExecCriticScaffold({ repoPath: repoDir });

			// 2. Candidate Test 1: Trivial test agreeing with buggy behavior (does not assert exception)
			const trivialTestFile = join(repoDir, "test_trivial.js");
			writeFileSync(
				trivialTestFile,
				`
import { divide } from "./src/calculator.js";
const res = divide(10, 0);
if (!Number.isFinite(res)) {
  process.exit(0); // passes even though bug exists!
}
`,
				"utf-8",
			);

			// Fail-closed verification MUST reject Candidate Test 1
			const qual1 = await scaffold.qualifyReproductionTest(["test_trivial.js"], "node test_trivial.js", repoDir);
			expect(qual1.qualified).toBe(false);
			expect(qual1.reason).toContain("Fail-closed test rejection");
			expect(scaffold.getActiveManifest()).toBeUndefined();

			// 3. Candidate Test 2: Rigorous reproduction test asserting correct behavior (expects error on zero division)
			const reproTestFile = join(repoDir, "test_reproduce.js");
			writeFileSync(
				reproTestFile,
				`
import { divide } from "./src/calculator.js";
try {
  divide(10, 0);
  process.exit(1); // Bug: failed to throw!
} catch (e) {
  process.exit(0); // Expected behavior
}
`,
				"utf-8",
			);

			// Fail-closed verification MUST qualify Candidate Test 2 because it fails on base buggy code!
			const qual2 = await scaffold.qualifyReproductionTest(["test_reproduce.js"], "node test_reproduce.js", repoDir);
			expect(qual2.qualified).toBe(true);
			expect(qual2.manifest).toBeDefined();
			expect(qual2.manifest?.testPaths).toContain("test_reproduce.js");
			expect(scaffold.getActiveManifest()).toBeDefined();

			// 4. Test protection verification: Repair agent cannot edit the frozen test
			expect(scaffold.isProtectedTestFile("test_reproduce.js")).toBe(true);
			expect(scaffold.isProtectedTestFile("src/calculator.js")).toBe(false);

			// 5. Repair Phase: Repair agent applies source fix to src/calculator.js
			const fixedCode = `
export function divide(a, b) {
  if (b === 0) throw new Error("Division by zero");
  return a / b;
}
`;
			writeFileSync(mathFile, fixedCode, "utf-8");

			// 6. Execute frozen test against the repaired code
			const operations = await scaffold.qualifyReproductionTest(
				["test_reproduce.js"],
				"node test_reproduce.js",
				repoDir,
			);
			// Now that the code is fixed, executing the test succeeds (exit code 0)!
			expect(operations.qualified).toBe(false); // Because on fixed code, reproduction test now passes!
		});
	});

	describe("SoL-Pi End-to-End Tool & Pipeline Flow", () => {
		it("fuses edit with test command, ages observation, and passes cost-gate checks", async () => {
			const editTool = createEditTool(repoDir);
			const writeTool = createWriteTool(repoDir);
			const observationPack = new ObservationPack({ thresholdBytes: 150, excerptLines: 2 });
			const reducer = new EvidencePreservingReducer(100);

			// Step 1: Write file and immediately verify with Action Fusion
			const targetSource = join(repoDir, "index.js");
			const writeResult = await writeTool.execute("write-1", {
				path: targetSource,
				content: "export const version = 1;\n",
				then_run: "node -e 'console.log(\"file exists\")'",
			});
			const firstWrite = writeResult.content[0];
			const writeText = firstWrite && firstWrite.type === "text" ? firstWrite.text : "";
			expect(writeText).toContain("[Action Fusion: 'node -e 'console.log(\"file exists\")'' succeeded]");

			// Step 2: Edit file and run test with Action Fusion
			const editResult = await editTool.execute("edit-1", {
				path: targetSource,
				edits: [{ oldText: "version = 1;", newText: "version = 2;" }],
				then_run: 'node -e \'console.log("version verified: " + require("./index.js").version)\'',
			});
			const firstEdit = editResult.content[0];
			const editText = firstEdit && firstEdit.type === "text" ? firstEdit.text : "";
			expect(editText).toContain("Successfully replaced 1 block(s)");
			expect(editText).toContain("Action Fusion");

			// Step 3: Handle large test failure with Reducer & ObservationPack
			const largeTestLog = [
				"Running vitest suite in workspace...",
				"FAIL test/integration.test.ts",
				"  AssertionError: expected version 3 but received 2",
				...Array.from({ length: 25 }, (_, i) => `[TRACE-STACK-${i}] Stack trace line ${i}`),
			].join("\n");

			const reduction = reducer.reduceOutput("npm test", largeTestLog, 1);
			expect(reduction.reduced).toBe(true);
			expect(reduction.text).toContain("AssertionError: expected version 3 but received 2");

			// ObservationPack aging across turns
			const packedTurn1 = observationPack.packObservation("test-run-1", reduction.text);
			expect(packedTurn1.isExcerpt).toBe(false);

			observationPack.advanceTurn();
			observationPack.advanceTurn();
			const packedTurn3 = observationPack.packObservation("test-run-1", reduction.text);
			expect(packedTurn3.isExcerpt).toBe(true);
			expect(packedTurn3.handle).toBeDefined();

			// Step 4: Evaluate compaction cost-gate at subtask boundary
			const costGate = evaluateCompactionCostGate({
				currentContextTokens: 45000,
				contextWindow: 128000,
				remainingPlannedSteps: 5,
			});
			expect(costGate.shouldCompact).toBe(true);
			expect(costGate.projectedSavings).toBeGreaterThan(costGate.estimatedPenalty);
		});
	});

	describe("NeoHorse-1 + Switchyard Virtual Model Integration Flow", () => {
		it("records user and continuation routing events through Switchyard virtual model", async () => {
			const telemetryLog = join(repoDir, "routing-events.jsonl");
			const recorder = new RoutingTelemetryRecorder(telemetryLog);

			const router = new SwitchyardModelRouter({
				efficientModel: "provider/efficient-model",
				capableModel: "provider/capable-model",
				baseThreshold: 0.5,
				confidenceThreshold: 0.5,
			});

			const dummyModel = {
				id: "dummy",
				name: "Dummy",
				provider: "test",
				contextWindow: 128000,
				maxTokens: 4096,
				api: "openai",
			} as any;

			const virtualModel = createSwitchyardVirtualModel({
				provider: "switchyard",
				id: "switchyard-virtual",
				name: "Switchyard Virtual Model",
				router,
				efficientModel: dummyModel,
				capableModel: dummyModel,
				telemetryRecorder: recorder,
			});

			// User turn routing
			const userRoute = await virtualModel.route({
				model: dummyModel,
				thinkingLevel: "off",
				reason: "user",
				messages: [
					{
						role: "user",
						content: "Fix deterministic syntax error with unit test present",
						timestamp: Date.now(),
					},
				],
			});

			expect(userRoute.model).toBeDefined();
			expect(userRoute.state).toBeDefined();

			// Continuation turn routing with tool signals
			const continuationRoute = await virtualModel.route({
				model: dummyModel,
				thinkingLevel: "off",
				reason: "continuation",
				state: userRoute.state,
				messages: [
					{ role: "user", content: "Fix syntax", timestamp: Date.now() },
					{
						role: "assistant",
						content: [{ type: "toolCall", id: "tc-1", name: "edit", arguments: {} }],
						timestamp: Date.now(),
						api: "openai" as any,
						provider: "openai",
						model: "dummy",
						stopReason: "stop",
						usage: {
							input: 10,
							output: 10,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 20,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
					},
					{
						role: "toolResult",
						toolCallId: "tc-1",
						toolName: "edit",
						content: [{ type: "text", text: "SyntaxError: Unexpected token" }],
						isError: true,
						timestamp: Date.now(),
					},
				],
			});

			expect(continuationRoute.model).toBeDefined();

			// Verify records were logged to disk
			const diskRecords = recorder.loadFromDisk();
			expect(diskRecords.length).toBeGreaterThanOrEqual(2);

			const userRecord = diskRecords.find((r) => r.turnIndex === 1);
			expect(userRecord).toBeDefined();
			expect(userRecord?.chosenTier).toBeDefined();

			// Verify curriculum statistics computation
			const stats = recorder.computeRuleStatistics();
			expect(stats).toBeDefined();
		});
	});
});
