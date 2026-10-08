/**
 * packages/core/src/sol-pi/index.ts
 *
 * SoL-Pi: Token-efficient agent harness mechanisms based on:
 * "SoL-Pi: Recursively Scaling Auto-Research Loops for Efficient Agent Harness" (2026)
 *
 * Provides four key capabilities:
 * 1. Action Fusion: Fuses file modifications (edit/write) and follow-up verification commands.
 * 2. ObservationPack: Locally archives large tool outputs (>10 KiB) and ages them into 1 KiB excerpts.
 * 3. Evidence-Preserving Reducer: Compresses build and test outputs (>=4 KiB) with deterministic verification.
 * 4. Online Context Compact Cost-Gate: Decides when to compact based on projected savings vs prompt cache invalidation penalties.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeBashWithOperations } from "../bash-executor.ts";
import { createLocalBashOperations } from "../tools/bash.ts";
import { formatSize } from "../tools/truncate.ts";

// ============================================================================
// 1. Action Fusion
// ============================================================================

export interface FusedExecutionResult {
	readonly executed: boolean;
	readonly command: string;
	readonly exitCode: number;
	readonly output: string;
	readonly summary: string;
}

/**
 * Executes a fused follow-up command immediately after a mutation without requiring an extra LLM turn.
 */
export async function executeFusedCommand(
	cwd: string,
	thenRun: string,
	signal?: AbortSignal,
): Promise<FusedExecutionResult> {
	const trimmedCommand = thenRun.trim();
	if (!trimmedCommand) {
		return {
			executed: false,
			command: "",
			exitCode: 0,
			output: "",
			summary: "",
		};
	}

	const operations = createLocalBashOperations();
	const bashResult = await executeBashWithOperations(trimmedCommand, cwd, operations, { signal });
	const exitCode = bashResult.exitCode ?? (bashResult.cancelled ? 130 : 1);
	const statusText = exitCode === 0 ? "succeeded" : `failed with exit code ${exitCode}`;
	const summary = `\n\n[Action Fusion: '${trimmedCommand}' ${statusText}]\n${bashResult.output}`;

	return {
		executed: true,
		command: trimmedCommand,
		exitCode,
		output: bashResult.output,
		summary,
	};
}

// ============================================================================
// 2. ObservationPack (Aging and Handle Archive)
// ============================================================================

export interface ObservationRecord {
	readonly id: string;
	readonly turnCreated: number;
	readonly rawContent: string;
	readonly filePath: string;
	readonly sizeBytes: number;
}

export interface ObservationPackOptions {
	readonly thresholdBytes?: number;
	readonly archiveDir?: string;
	readonly excerptLines?: number;
}

export class ObservationPack {
	private readonly thresholdBytes: number;
	private readonly archiveDir: string;
	private readonly excerptLines: number;
	private readonly records: Map<string, ObservationRecord>;
	private currentTurn: number;

	constructor(options?: ObservationPackOptions) {
		this.thresholdBytes = options?.thresholdBytes ?? 10 * 1024; // 10 KiB
		this.archiveDir = options?.archiveDir ?? join(tmpdir(), "npc-sol-pi-observations");
		this.excerptLines = options?.excerptLines ?? 15;
		this.records = new Map();
		this.currentTurn = 1;

		if (!existsSync(this.archiveDir)) {
			mkdirSync(this.archiveDir, { recursive: true });
		}
	}

	public advanceTurn(): void {
		this.currentTurn += 1;
	}

	public getTurn(): number {
		return this.currentTurn;
	}

	/**
	 * Projects an observation according to ObservationPack aging rules:
	 * - If under threshold: returns unchanged.
	 * - For first 2 turns: returns full text unchanged while recording.
	 * - Turn 3+: replaces with handle and 1 KiB head/tail excerpt.
	 */
	public packObservation(observationId: string, text: string): { text: string; isExcerpt: boolean; handle?: string } {
		const byteLength = Buffer.byteLength(text, "utf-8");
		if (byteLength < this.thresholdBytes) {
			return { text, isExcerpt: false };
		}

		let record = this.records.get(observationId);
		if (!record) {
			const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
			const filePath = join(this.archiveDir, `obs-${hash}.log`);
			try {
				writeFileSync(filePath, text, "utf-8");
			} catch {
				return { text, isExcerpt: false };
			}
			record = {
				id: observationId,
				turnCreated: this.currentTurn,
				rawContent: text,
				filePath,
				sizeBytes: byteLength,
			};
			this.records.set(observationId, record);
		}

		const turnsElapsed = this.currentTurn - record.turnCreated;
		if (turnsElapsed < 2) {
			return { text, isExcerpt: false, handle: record.filePath };
		}

		const lines = text.split("\n");
		const head = lines.slice(0, this.excerptLines).join("\n");
		const tail = lines.slice(-this.excerptLines).join("\n");
		const excerpt = `${head}\n\n... [${lines.length - this.excerptLines * 2} intermediate lines omitted (${formatSize(byteLength)})] ...\n\n${tail}`;

		const projectedText = `[ObservationPack: Output archived to ${record.filePath} (${formatSize(byteLength)}). Excerpt below:\n${excerpt}\n(Use 'read' with path '${record.filePath}' to inspect complete log.)]`;

		return {
			text: projectedText,
			isExcerpt: true,
			handle: record.filePath,
		};
	}

	public retrieve(observationId: string): string | undefined {
		const record = this.records.get(observationId);
		if (!record) return undefined;
		if (existsSync(record.filePath)) {
			return readFileSync(record.filePath, "utf-8");
		}
		return record.rawContent;
	}
}

// ============================================================================
// 3. Evidence-Preserving Reducer
// ============================================================================

export interface EvidenceReceipt {
	readonly exitCode: number | null | undefined;
	readonly totalFailures: number;
	readonly failureExcerpts: readonly string[];
	readonly archivePath: string;
	readonly verified: boolean;
	readonly formattedReceipt: string;
}

export class EvidencePreservingReducer {
	private readonly minBytes: number;
	private readonly archiveDir: string;

	constructor(minBytes = 4 * 1024, archiveDir?: string) {
		this.minBytes = minBytes;
		this.archiveDir = archiveDir ?? join(tmpdir(), "npc-sol-pi-evidence");
		if (!existsSync(this.archiveDir)) {
			mkdirSync(this.archiveDir, { recursive: true });
		}
	}

	/**
	 * Determines whether a command matches test or build patterns.
	 */
	public isTargetCommand(command: string): boolean {
		const lower = command.toLowerCase();
		return (
			lower.includes("test") ||
			lower.includes("jest") ||
			lower.includes("vitest") ||
			lower.includes("pytest") ||
			lower.includes("cargo test") ||
			lower.includes("go test") ||
			lower.includes("npm run build") ||
			lower.includes("tsc") ||
			lower.includes("make")
		);
	}

	/**
	 * Extracts failure lines and verifies them against the raw log.
	 */
	public reduceOutput(
		command: string,
		output: string,
		exitCode: number | null | undefined,
	): { reduced: boolean; text: string; receipt?: EvidenceReceipt } {
		const bytes = Buffer.byteLength(output, "utf-8");
		if (bytes < this.minBytes || !this.isTargetCommand(command)) {
			return { reduced: false, text: output };
		}

		const lines = output.split("\n");
		const failureLines: string[] = [];
		const errorPatterns = [
			/\b(FAIL|FAILED|FAILURE|Error:|AssertionError|AssertionError:|SyntaxError|TypeError|ReferenceError)\b/i,
			/^\s*(at\s+|\d+\)\s+|✗|✕|×)/,
		];

		for (const line of lines) {
			if (errorPatterns.some((pattern) => pattern.test(line))) {
				failureLines.push(line.trim());
				if (failureLines.length >= 25) break;
			}
		}

		const verified = failureLines.every((excerpt) => output.includes(excerpt));
		if (!verified || failureLines.length === 0) {
			return { reduced: false, text: output };
		}

		const hash = createHash("sha256").update(output).digest("hex").slice(0, 16);
		const archivePath = join(this.archiveDir, `evidence-${hash}.log`);
		try {
			writeFileSync(archivePath, output, "utf-8");
		} catch {
			return { reduced: false, text: output };
		}

		const receiptFormatted = [
			`[Evidence-Preserving Reducer: Extracted ${failureLines.length} failure signal(s), Exit code: ${exitCode ?? "unknown"}]`,
			`Command: ${command}`,
			`Archive: ${archivePath} (${formatSize(bytes)})`,
			"--- Key Failure Trace ---",
			...failureLines.map((line) => `• ${line}`),
			"--- End Failure Trace ---",
		].join("\n");

		if (Buffer.byteLength(receiptFormatted, "utf-8") >= bytes) {
			return { reduced: false, text: output };
		}

		const receipt: EvidenceReceipt = {
			exitCode,
			totalFailures: failureLines.length,
			failureExcerpts: failureLines,
			archivePath,
			verified: true,
			formattedReceipt: receiptFormatted,
		};

		return {
			reduced: true,
			text: receiptFormatted,
			receipt,
		};
	}
}

// ============================================================================
// 4. Online Context Compact Cost Gate
// ============================================================================

export interface CompactionCostGateParams {
	readonly currentContextTokens: number;
	readonly contextWindow: number;
	readonly remainingPlannedSteps: number;
	readonly estimatedTokensPerStep?: number;
	readonly cacheInvalidationPenaltyRate?: number;
	readonly targetRetainedTokens?: number;
}

export interface CompactionCostGateDecision {
	readonly shouldCompact: boolean;
	readonly reason: string;
	readonly projectedSavings: number;
	readonly estimatedPenalty: number;
}

/**
 * Evaluates whether compacting context yields net token savings considering prompt-cache invalidation.
 */
export function evaluateCompactionCostGate(params: CompactionCostGateParams): CompactionCostGateDecision {
	const {
		currentContextTokens,
		contextWindow,
		remainingPlannedSteps,
		cacheInvalidationPenaltyRate = 0.5,
		targetRetainedTokens = 20000,
	} = params;

	if (currentContextTokens > contextWindow - 16384) {
		return {
			shouldCompact: true,
			reason: "Hard context boundary reached (<16K tokens remaining)",
			projectedSavings: Math.max(0, currentContextTokens - targetRetainedTokens),
			estimatedPenalty: 0,
		};
	}

	if (remainingPlannedSteps <= 1) {
		return {
			shouldCompact: false,
			reason: `Only ${remainingPlannedSteps} step(s) remaining; cache bust penalty exceeds savings`,
			projectedSavings: 0,
			estimatedPenalty: Math.round(currentContextTokens * cacheInvalidationPenaltyRate),
		};
	}

	const compressibleTokens = Math.max(0, currentContextTokens - targetRetainedTokens);
	const projectedSavings = compressibleTokens * remainingPlannedSteps;
	const estimatedPenalty = currentContextTokens * cacheInvalidationPenaltyRate;

	if (projectedSavings > estimatedPenalty * 1.5) {
		return {
			shouldCompact: true,
			reason: `Projected savings (${projectedSavings} tok) exceed cache rewrite penalty (${Math.round(estimatedPenalty)} tok)`,
			projectedSavings,
			estimatedPenalty,
		};
	}

	return {
		shouldCompact: false,
		reason: `Projected savings (${projectedSavings} tok) do not meet margin over cache rewrite penalty (${Math.round(estimatedPenalty)} tok)`,
		projectedSavings,
		estimatedPenalty,
	};
}
