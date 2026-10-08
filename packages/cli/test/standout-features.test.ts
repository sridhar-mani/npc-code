import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	AirgapGuard,
	ArchitectureVisualizer,
	ContinuousAstDependencyGraph,
	DualAgentAdversary,
	PrAutoPilot,
	ShadowRewindManager,
	SpeculativeDraftingRouter,
	StablePrefixCacheLedger,
} from "../../core/src/index.ts";

describe("Standout Agent Architecture Features", () => {
	// Feature 1: ShadowRewindManager
	describe("Feature 1: ShadowRewindManager (Time-Traveling Rollback)", () => {
		it("creates shadow checkpoints and lists them without corrupting HEAD", () => {
			const tempDir = join(tmpdir(), `shadow-test-${Date.now()}`);
			mkdirSync(tempDir, { recursive: true });
			execSync("git init", { cwd: tempDir });
			execSync("git config user.name 'Test'", { cwd: tempDir });
			execSync("git config user.email 'test@test.com'", { cwd: tempDir });
			writeFileSync(join(tempDir, "file1.txt"), "Initial content");
			execSync("git add file1.txt && git commit -m 'initial'", { cwd: tempDir });

			const manager = new ShadowRewindManager(tempDir, true);
			const checkpoint = manager.createCheckpoint(1, "Pre-refactor state");

			expect(checkpoint).not.toBeNull();
			expect(checkpoint?.turnIndex).toBe(1);
			expect(checkpoint?.description).toBe("Pre-refactor state");

			const list = manager.listCheckpoints();
			expect(list.length).toBeGreaterThanOrEqual(1);

			// Test rollback to current checkpoint
			const rollbackResult = manager.rollbackToCheckpoint(checkpoint?.checkpointId);
			expect(rollbackResult.success).toBe(true);

			manager.cleanup();
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("gracefully reports missing checkpoints", () => {
			const tempDir = join(tmpdir(), `shadow-test-missing-${Date.now()}`);
			mkdirSync(tempDir, { recursive: true });
			execSync("git init", { cwd: tempDir });
			execSync("git config user.name 'Test'", { cwd: tempDir });
			execSync("git config user.email 'test@test.com'", { cwd: tempDir });
			writeFileSync(join(tempDir, "file1.txt"), "Initial content");
			execSync("git add file1.txt && git commit -m 'initial'", { cwd: tempDir });

			const manager = new ShadowRewindManager(tempDir, true);
			const emptyResult = manager.rollbackToCheckpoint("non-existent-id");
			expect(emptyResult.success).toBe(false);
			expect(emptyResult.message).toContain("No checkpoints available");

			manager.createCheckpoint(1, "test");
			const notFoundResult = manager.rollbackToCheckpoint("non-existent-id");
			expect(notFoundResult.success).toBe(false);
			expect(notFoundResult.message).toContain("not found");
			manager.cleanup();
			rmSync(tempDir, { recursive: true, force: true });
		});
	});

	// Feature 2: ContinuousAstDependencyGraph
	describe("Feature 2: ContinuousAstDependencyGraph (Targeted AST Impact)", () => {
		it("indexes symbols, callers, and calculates blast radius", () => {
			const graph = new ContinuousAstDependencyGraph();

			const authServiceCode = `
import { dbConnect } from "db";
export function authenticateUser(token: string) {
  return dbConnect(token);
}
export class SessionManager {
  validate() {
    return true;
  }
}
`;

			const apiRoutesCode = `
import { authenticateUser } from "./auth";
export function handleLoginRequest(req: any) {
  return authenticateUser(req.token);
}
`;

			graph.indexFile("/src/auth.ts", authServiceCode);
			graph.indexFile("/src/routes.ts", apiRoutesCode);

			const symbols = graph.getSymbols("/src/auth.ts");
			expect(symbols.length).toBeGreaterThanOrEqual(2);
			expect(symbols.some((s) => s.name === "authenticateUser")).toBe(true);

			const callers = graph.getCallers("authenticateUser");
			expect(callers.length).toBe(1);
			expect(callers[0].fromFile).toBe("/src/routes.ts");

			const impact = graph.getImpactRadius("/src/auth.ts", "authenticateUser");
			expect(impact.affectedFiles).toContain("/src/routes.ts");
			expect(impact.blastRadiusScore).toBeGreaterThan(0);

			const promptContext = graph.buildTargetedPromptContext("/src/auth.ts", "authenticateUser", 500);
			expect(promptContext).toContain("AST Impact Radius");
			expect(promptContext).toContain("/src/routes.ts");
		});
	});

	// Feature 3: DualAgentAdversary
	describe("Feature 3: DualAgentAdversary (Builder vs Breaker)", () => {
		it("synthesizes edge-case breaker scenarios and evaluates builder code resilience", () => {
			const adversary = new DualAgentAdversary();
			const weakCode = `
function processItems(items: string[]) {
  const first = items[0].trim();
  return items.map(x => x.split(","));
}
`;

			const scenarios = adversary.generateBreakerScenarios(weakCode, "processItems");
			expect(scenarios.length).toBeGreaterThanOrEqual(3);
			expect(scenarios.some((s) => s.category === "null_empty")).toBe(true);

			const evalResult = adversary.evaluateResilience(weakCode, scenarios);
			expect(evalResult.passed).toBe(false);
			expect(evalResult.vulnerabilitiesFound).toBeGreaterThan(0);

			const repairPrompt = adversary.generateBuilderRepairPrompt(evalResult);
			expect(repairPrompt).toContain("Breaker Adversarial Red-Team Findings");
			expect(repairPrompt).toContain("Resilience Score");
		});

		it("passes defensive code with full guard rails", () => {
			const adversary = new DualAgentAdversary();
			const guardedCode = `
function processItems(items?: string[]) {
  if (!items || items.length === 0) return [];
  const first = items?.[0]?.trim() ?? "";
  if (items.length <= 0) return [];
  return items.map(x => x.split(","));
}
`;
			const scenarios = adversary.generateBreakerScenarios(guardedCode, "processItems");
			const evalResult = adversary.evaluateResilience(guardedCode, scenarios);
			expect(evalResult.resilienceScore).toBeGreaterThanOrEqual(0.8);
		});
	});

	// Feature 4: SpeculativeDraftingRouter
	describe("Feature 4: SpeculativeDraftingRouter (Tiny Draft + Heavy Verifier)", () => {
		it("accepts valid drafts and avoids heavy model fallback", async () => {
			const router = new SpeculativeDraftingRouter();

			const draft = {
				id: "draft-1",
				source: "heuristic_template" as const,
				proposedAction: "formatCode",
				payload: "function hello() { return 42; }",
				estimatedLatencyMs: 30,
			};

			let heavyCalled = false;
			const outcome = await router.routeDraft(
				draft,
				(d) => SpeculativeDraftingRouter.verifyCodeSyntax(d.payload),
				async () => {
					heavyCalled = true;
					return "fallback";
				},
			);

			expect(outcome.wasDraftAccepted).toBe(true);
			expect(outcome.executionPath).toBe("draft");
			expect(outcome.result).toBe("function hello() { return 42; }");
			expect(heavyCalled).toBe(false);

			const metrics = router.getMetrics();
			expect(metrics.acceptedDrafts).toBe(1);
			expect(metrics.acceptanceRate).toBe(1.0);
			expect(metrics.estimatedSavedTokens).toBe(1200);
		});

		it("rejects malformed drafts and routes to heavy verifier with diagnostics", async () => {
			const router = new SpeculativeDraftingRouter();

			const malformedDraft = {
				id: "draft-2",
				source: "tiny_model" as const,
				proposedAction: "scaffoldClass",
				payload: "class Broken { missingBrace() {",
				estimatedLatencyMs: 25,
			};

			let heavyDiagnostics: string[] = [];
			const outcome = await router.routeDraft(
				malformedDraft,
				(d) => SpeculativeDraftingRouter.verifyCodeSyntax(d.payload),
				async (diagnostics) => {
					heavyDiagnostics = diagnostics;
					return "class Fixed { missingBrace() {} }";
				},
			);

			expect(outcome.wasDraftAccepted).toBe(false);
			expect(outcome.executionPath).toBe("heavy_fallback");
			expect(outcome.result).toContain("class Fixed");
			expect(heavyDiagnostics.length).toBeGreaterThan(0);

			const metrics = router.getMetrics();
			expect(metrics.rejectedDrafts).toBe(1);
		});
	});

	// Feature 5: StablePrefixCacheLedger
	describe("Feature 5: StablePrefixCacheLedger (KV-Cache Optimization)", () => {
		it("aligns prompt partitions to maximize stable prefix hits and detects cache busters", () => {
			const ledger = new StablePrefixCacheLedger();

			ledger.addBlock("sys-1", "system_base", "STATIC", "You are npc-code, an autonomous coding agent.");
			ledger.addBlock("tools-1", "tool_schemas", "STATIC", "Available tools: read_file, edit_file, bash.");
			ledger.addBlock("hist-1", "history", "SEMI_STATIC", "Turn 1: User asked for refactor.");
			ledger.addBlock("dyn-1", "active_turn", "DYNAMIC", "Turn 2: Run the test suite now.");

			const report = ledger.analyzeCacheEfficiency();
			expect(report.cacheEfficiencyRatio).toBeGreaterThan(0.5);
			expect(report.prefixFingerprint).toBeDefined();
			expect(report.cacheBustersDetected.length).toBe(0);

			const aligned = ledger.getAlignedBlocks();
			expect(aligned[0].volatility).toBe("STATIC");
			expect(aligned[aligned.length - 1].volatility).toBe("DYNAMIC");
		});

		it("identifies cache busters in static blocks", () => {
			const ledger = new StablePrefixCacheLedger();
			ledger.addBlock(
				"bad-sys",
				"system_base",
				"STATIC",
				"Current timestamp is 2026-10-08T18:00:00Z and session PID: 49201",
			);

			const report = ledger.analyzeCacheEfficiency();
			expect(report.cacheBustersDetected.length).toBeGreaterThan(0);
		});
	});

	// Feature 6: ArchitectureVisualizer
	describe("Feature 6: ArchitectureVisualizer (Automated Mermaid Diagrams)", () => {
		it("generates component flowcharts and sequence diagrams", () => {
			const visualizer = new ArchitectureVisualizer("TD");

			const flowchart = visualizer.generateComponentFlowchart(
				[
					{ id: "agent", label: "npc-code CLI", isModified: true },
					{ id: "core", label: "Core Engine" },
				],
				[{ from: "agent", to: "core", label: "orchestrates" }],
			);

			expect(flowchart).toContain("```mermaid");
			expect(flowchart).toContain("flowchart TD");
			expect(flowchart).toContain('agent["npc-code CLI"]');
			expect(flowchart).toContain("style agent fill:#d4edda");

			const sequence = visualizer.generateExecutionSequence([
				{ turnIndex: 1, toolName: "read_file", summary: "read config.json", status: "success" },
				{ turnIndex: 2, toolName: "bash", summary: "run build", status: "error" },
			]);

			expect(sequence).toContain("sequenceDiagram");
			expect(sequence).toContain("read_file()");
			expect(sequence).toContain("Error (run build)");
		});
	});

	// Feature 7: PrAutoPilot
	describe("Feature 7: PrAutoPilot (Automated GitHub PR Generator)", () => {
		it("renders structured PR markdown with receipts and rollback steps", () => {
			const autopilot = new PrAutoPilot("main");

			const prMarkdown = autopilot.renderPullRequestMarkdown({
				title: "feat(core): implement high-performance AST impact analysis",
				branchName: "feat/ast-impact",
				targetBranch: "main",
				summary: "Introduces ContinuousAstDependencyGraph for targeted blast-radius prompt injection.",
				modifiedFiles: ["packages/core/src/ast-impact/index.ts", "packages/core/src/index.ts"],
				testReceipts: [
					{
						command: "npm run check",
						exitCode: 0,
						passedCount: 1701,
						failedCount: 0,
						durationMs: 3200,
					},
					{
						command: "vitest run test/standout-features.test.ts",
						exitCode: 0,
						passedCount: 12,
						failedCount: 0,
						durationMs: 450,
					},
				],
			});

			expect(prMarkdown).toContain("## feat(core): implement high-performance AST impact analysis");
			expect(prMarkdown).toContain("Test Verification Receipts");
			expect(prMarkdown).toContain("`npm run check`");
			expect(prMarkdown).toContain("PASSED");
			expect(prMarkdown).toContain("Rollback & Safety Plan");
		});
	});

	// Feature 8: AirgapGuard
	describe("Feature 8: AirgapGuard (Zero-Configuration Offline Flight Mode)", () => {
		it("permits local loopback requests and blocks outbound remote targets", () => {
			const guard = new AirgapGuard(true);

			const localCheck = guard.evaluateUrl("http://localhost:11434/api/generate");
			expect(localCheck.allowed).toBe(true);

			const loopbackCheck = guard.evaluateUrl("http://127.0.0.1:8080/v1/chat/completions");
			expect(loopbackCheck.allowed).toBe(true);

			const remoteCheck = guard.evaluateUrl("https://api.openai.com/v1/chat/completions");
			expect(remoteCheck.allowed).toBe(false);
			expect(remoteCheck.reason).toContain("Egress blocked");
		});

		it("intercepts commands matching egress network utilities", () => {
			const guard = new AirgapGuard(true);

			const safeCommand = guard.evaluateCommand("npm run test -- --run");
			expect(safeCommand.allowed).toBe(true);

			const blockedCurl = guard.evaluateCommand("curl -X POST https://analytics.external.io/log");
			expect(blockedCurl.allowed).toBe(false);

			const blockedPush = guard.evaluateCommand("git push origin main");
			expect(blockedPush.allowed).toBe(false);

			const audit = guard.getAuditLog();
			expect(audit.length).toBe(3);
		});
	});
});
