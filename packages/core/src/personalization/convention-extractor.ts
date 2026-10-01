/**
 * packages/core/src/personalization/convention-extractor.ts
 *
 * Extracts developer preferences and rules from user messages and corrections.
 */

import type { ConventionTier } from "./convention-store.ts";

export interface CandidateConvention {
	readonly content: string;
	readonly category: string;
	readonly tier: ConventionTier;
	readonly confidence: number;
}

function inferCategory(text: string): string {
	const lower = text.toLowerCase();
	if (lower.includes("test") || lower.includes("vitest") || lower.includes("mock")) {
		return "testing";
	}
	if (lower.includes("import") || lower.includes("type") || lower.includes("style") || lower.includes("format")) {
		return "style";
	}
	if (lower.includes("git") || lower.includes("commit") || lower.includes("branch") || lower.includes("pr")) {
		return "workflow";
	}
	if (lower.includes("tool") || lower.includes("bash") || lower.includes("npm") || lower.includes("docker")) {
		return "tooling";
	}
	return "general";
}

/**
 * Analyzes user message text to discover explicit preferences or instructions.
 */
export function extractConventionsFromText(text: string): CandidateConvention[] {
	const trimmed = text.trim();
	if (!trimmed) return [];

	const candidates: CandidateConvention[] = [];
	const lines = trimmed.split("\n");

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) continue;

		// Pattern 1: Always / Never rules
		if (/^always\s+/i.test(line)) {
			candidates.push({
				content: line,
				category: inferCategory(line),
				tier: "custom_rule",
				confidence: 0.95,
			});
			continue;
		}

		if (/^(never|don'?t|do not)\s+/i.test(line)) {
			candidates.push({
				content: line,
				category: inferCategory(line),
				tier: "custom_rule",
				confidence: 0.95,
			});
			continue;
		}

		// Pattern 2: Prefer / Use conventions
		if (/^prefer\s+/i.test(line) || /^use\s+.*instead\s+of/i.test(line)) {
			candidates.push({
				content: line,
				category: inferCategory(line),
				tier: "preference",
				confidence: 0.9,
			});
			continue;
		}

		// Pattern 3: Explicit formatting/style guidelines
		if (/(in this repo|for this project|our convention is)\s+/i.test(line)) {
			candidates.push({
				content: line,
				category: inferCategory(line),
				tier: "workflow",
				confidence: 0.85,
			});
		}
	}

	return candidates;
}

export const ConventionExtractor = {
	extractFromText: extractConventionsFromText,
};
