import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoutingTelemetryRecorder } from "../../core/src/index.ts";

describe("NeoHorse-1 Routing Telemetry & Capability Feedback (Unit Tests)", () => {
	let logFilePath: string;

	beforeEach(() => {
		logFilePath = join(tmpdir(), `neohorse-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jsonl`);
	});

	afterEach(() => {
		if (existsSync(logFilePath)) {
			rmSync(logFilePath, { force: true });
		}
	});

	it("records and loads routing decisions to/from disk", () => {
		const recorder = new RoutingTelemetryRecorder(logFilePath);

		recorder.record({
			id: "rec-disk-1",
			timestamp: 1000,
			turnIndex: 1,
			crux: "Local unit test validator available",
			primaryRule: "SUP-1",
			capabilityBoundary: "supported",
			pSolve: 0.95,
			chosenTier: "efficient",
			escalated: false,
			errorSeverity: 0,
			spinningScore: 0,
			outcome: "success",
		});

		expect(existsSync(logFilePath)).toBe(true);

		// New recorder loading from disk
		const reader = new RoutingTelemetryRecorder(logFilePath);
		const records = reader.loadFromDisk();
		expect(records.length).toBe(1);
		expect(records[0]?.id).toBe("rec-disk-1");
		expect(records[0]?.primaryRule).toBe("SUP-1");
		expect(records[0]?.chosenTier).toBe("efficient");
	});

	it("computes capability rule statistics across multi-tier turns", () => {
		const recorder = new RoutingTelemetryRecorder();

		// Record 2 successful SUP-1 turns
		for (let i = 0; i < 2; i++) {
			recorder.record({
				id: `sup1-${i}`,
				timestamp: Date.now(),
				turnIndex: 1,
				crux: "Verified parser",
				primaryRule: "SUP-1",
				capabilityBoundary: "supported",
				pSolve: 0.9,
				chosenTier: "efficient",
				escalated: false,
				errorSeverity: 0,
				spinningScore: 0,
				outcome: "success",
			});
		}

		// Record 3 failing and escalated UNC-1 turns
		for (let i = 0; i < 3; i++) {
			recorder.record({
				id: `unc1-${i}`,
				timestamp: Date.now(),
				turnIndex: 2,
				crux: "Ambiguous spec",
				primaryRule: "UNC-1",
				capabilityBoundary: "uncertain",
				pSolve: 0.4,
				chosenTier: "capable",
				escalated: true,
				errorSeverity: 2,
				spinningScore: 1,
				outcome: "failure",
			});
		}

		const stats = recorder.computeRuleStatistics();
		expect(stats["SUP-1"].totalCalls).toBe(2);
		expect(stats["SUP-1"].successRate).toBe(1.0);
		expect(stats["SUP-1"].escalationRate).toBe(0.0);

		expect(stats["UNC-1"].totalCalls).toBe(3);
		expect(stats["UNC-1"].successRate).toBe(0.0);
		expect(stats["UNC-1"].escalationRate).toBe(1.0);
	});

	it("generates curriculum calibration recommendations for degraded rules", () => {
		const recorder = new RoutingTelemetryRecorder();

		// Populate 4 failing turns for SUP-4 (exceeding min call count threshold)
		for (let i = 0; i < 4; i++) {
			recorder.record({
				id: `sup4-fail-${i}`,
				timestamp: Date.now(),
				turnIndex: 2,
				crux: "Search space unbounded error",
				primaryRule: "SUP-4",
				capabilityBoundary: "supported",
				pSolve: 0.5,
				chosenTier: "capable",
				escalated: true,
				errorSeverity: 3,
				spinningScore: 2,
				outcome: "failure",
			});
		}

		const recommendations = recorder.getCurriculumRecommendations();
		expect(recommendations.length).toBeGreaterThan(0);
		const sup4Rec = recommendations.find((r) => r.rule === "SUP-4");
		expect(sup4Rec).toBeDefined();
		expect(sup4Rec?.recommendation).toContain("High escalation rate");
	});
});
