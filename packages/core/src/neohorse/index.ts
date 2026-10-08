/**
 * packages/core/src/neohorse/index.ts
 *
 * NeoHorse-1: Routing Telemetry & Capability Feedback Curriculum based on:
 * "NeoHorse-1: Towards Recursive Self-Improvement via Agentic Post-Training with Routing Harness" (2026)
 *
 * Provides:
 * 1. Routing Telemetry Recorder:
 *    - Captures turn-by-turn capability classifier predictions, chosen model tiers,
 *      escalation triggers, and execution outcomes.
 * 2. Capability Feedback & Curriculum Analyzer:
 *    - Aggregates empirical error rates across Switchyard capability rules (SUP-1..5, UNC-1..2, LIM-1..2).
 *    - Identifies boundary misclassifications to calibrate routing thresholds and post-training data mixtures.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CapabilityBoundary, CapabilityRule, SwitchyardTier } from "../model/switchyard-router.ts";

export interface RoutingTelemetryRecord {
	readonly id: string;
	readonly timestamp: number;
	readonly turnIndex: number;
	readonly crux: string;
	readonly primaryRule: CapabilityRule;
	readonly capabilityBoundary: CapabilityBoundary;
	readonly pSolve: number;
	readonly chosenTier: SwitchyardTier;
	readonly escalated: boolean;
	readonly errorSeverity: number;
	readonly spinningScore: number;
	readonly outcome: "success" | "failure" | "escalated" | "pending";
}

export interface RulePerformanceStats {
	readonly rule: CapabilityRule;
	readonly totalCalls: number;
	readonly successCount: number;
	readonly failureCount: number;
	readonly escalationCount: number;
	readonly successRate: number;
	readonly escalationRate: number;
	readonly averageSpinningScore: number;
}

export class RoutingTelemetryRecorder {
	private readonly logFilePath?: string;
	private readonly memoryRecords: RoutingTelemetryRecord[] = [];

	constructor(logFilePath?: string) {
		this.logFilePath = logFilePath;
		if (this.logFilePath) {
			const dir = dirname(this.logFilePath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
		}
	}

	/**
	 * Records a single turn's routing decision and subsequent execution signal.
	 */
	public record(record: RoutingTelemetryRecord): void {
		this.memoryRecords.push(record);
		if (this.logFilePath) {
			try {
				appendFileSync(this.logFilePath, `${JSON.stringify(record)}\n`, "utf-8");
			} catch {
				// Non-blocking telemetry write failure
			}
		}
	}

	public getRecords(): readonly RoutingTelemetryRecord[] {
		return this.memoryRecords;
	}

	/**
	 * Loads historical telemetry records from disk if configured.
	 */
	public loadFromDisk(): RoutingTelemetryRecord[] {
		if (!this.logFilePath || !existsSync(this.logFilePath)) {
			return [...this.memoryRecords];
		}
		try {
			const lines = readFileSync(this.logFilePath, "utf-8").split("\n");
			const records: RoutingTelemetryRecord[] = [];
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed) {
					records.push(JSON.parse(trimmed) as RoutingTelemetryRecord);
				}
			}
			return records;
		} catch {
			return [...this.memoryRecords];
		}
	}

	/**
	 * Computes capability statistics per rule to identify failure boundaries.
	 */
	public computeRuleStatistics(): Record<CapabilityRule, RulePerformanceStats> {
		const all = this.loadFromDisk();
		const statsMap: Partial<
			Record<CapabilityRule, { total: number; succ: number; fail: number; esc: number; spinSum: number }>
		> = {};

		for (const rec of all) {
			const entry = statsMap[rec.primaryRule] ?? { total: 0, succ: 0, fail: 0, esc: 0, spinSum: 0 };
			entry.total += 1;
			if (rec.outcome === "success") entry.succ += 1;
			if (rec.outcome === "failure") entry.fail += 1;
			if (rec.escalated) entry.esc += 1;
			entry.spinSum += rec.spinningScore;
			statsMap[rec.primaryRule] = entry;
		}

		const result: Record<string, RulePerformanceStats> = {};
		const rules: CapabilityRule[] = [
			"SUP-1",
			"SUP-2",
			"SUP-3",
			"SUP-4",
			"SUP-5",
			"UNC-1",
			"UNC-2",
			"LIM-1",
			"LIM-2",
			"none",
		];

		for (const rule of rules) {
			const entry = statsMap[rule] ?? { total: 0, succ: 0, fail: 0, esc: 0, spinSum: 0 };
			result[rule] = {
				rule,
				totalCalls: entry.total,
				successCount: entry.succ,
				failureCount: entry.fail,
				escalationCount: entry.esc,
				successRate: entry.total > 0 ? entry.succ / entry.total : 1.0,
				escalationRate: entry.total > 0 ? entry.esc / entry.total : 0.0,
				averageSpinningScore: entry.total > 0 ? entry.spinSum / entry.total : 0.0,
			};
		}

		return result as Record<CapabilityRule, RulePerformanceStats>;
	}

	/**
	 * Generates curriculum recommendations based on empirical performance.
	 * Flags rules that should trigger earlier escalation or evaluator intervention.
	 */
	public getCurriculumRecommendations(): { rule: CapabilityRule; recommendation: string }[] {
		const stats = this.computeRuleStatistics();
		const recommendations: { rule: CapabilityRule; recommendation: string }[] = [];

		for (const [rule, data] of Object.entries(stats)) {
			if (data.totalCalls >= 3) {
				if (data.escalationRate > 0.5) {
					recommendations.push({
						rule: rule as CapabilityRule,
						recommendation: `High escalation rate (${Math.round(data.escalationRate * 100)}%). Consider routing directly to capable tier.`,
					});
				} else if (data.successRate < 0.6) {
					recommendations.push({
						rule: rule as CapabilityRule,
						recommendation: `Low success rate (${Math.round(data.successRate * 100)}%). Add evaluator validation step before tool execution.`,
					});
				}
			}
		}

		return recommendations;
	}
}
