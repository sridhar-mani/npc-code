/**
 * StablePrefixCacheLedger: Offline KV-Cache Fingerprinting & Prefix Alignment.
 *
 * Maximizes modern LLM prompt caching (Anthropic, Gemini, OpenAI, DeepSeek) by ensuring
 * that prompts are partitioned into immutable prefixes and variable suffixes.
 * Detects cache-busting tokens (such as timestamps or dynamic IDs) in system prompts
 * and rearranges prompt blocks to preserve byte-level prefix stability.
 */

import { createHash } from "node:crypto";

export type CacheBlockVolatility = "STATIC" | "SEMI_STATIC" | "DYNAMIC";

export interface PromptBlock {
	id: string;
	category: "system_base" | "tool_schemas" | "rules" | "skills" | "history" | "active_turn";
	volatility: CacheBlockVolatility;
	content: string;
	tokenEstimate: number;
}

export interface CacheAnalysisReport {
	totalEstimatedTokens: number;
	cacheablePrefixTokens: number;
	cacheEfficiencyRatio: number;
	prefixFingerprint: string;
	cacheBustersDetected: string[];
}

export class StablePrefixCacheLedger {
	private blocks: PromptBlock[] = [];

	addBlock(id: string, category: PromptBlock["category"], volatility: CacheBlockVolatility, content: string): void {
		// 1 token approx 4 chars
		const tokenEstimate = Math.ceil(content.length / 4);
		this.blocks.push({ id, category, volatility, content, tokenEstimate });
	}

	clearBlocks(): void {
		this.blocks = [];
	}

	/**
	 * Detects cache-busting dynamic patterns injected in supposedly static blocks.
	 */
	detectCacheBusters(content: string): string[] {
		const issues: string[] = [];

		// ISO timestamp or dates
		if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(content)) {
			issues.push("ISO timestamp detected (busts cache on each second/minute change)");
		}
		// Random UUIDs
		if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(content)) {
			issues.push("Random UUID detected in static block");
		}
		// Dynamic process PID or microsecond timestamp
		if (/PID:\s*\d+/i.test(content) || /timestamp:\s*\d{10,13}/i.test(content)) {
			issues.push("PID or unix timestamp detected");
		}

		return issues;
	}

	/**
	 * Reorganizes blocks so that all STATIC blocks form an uninterrupted prefix,
	 * followed by SEMI_STATIC blocks, followed by DYNAMIC tail blocks.
	 */
	getAlignedBlocks(): PromptBlock[] {
		const staticBlocks = this.blocks.filter((b) => b.volatility === "STATIC");
		const semiStaticBlocks = this.blocks.filter((b) => b.volatility === "SEMI_STATIC");
		const dynamicBlocks = this.blocks.filter((b) => b.volatility === "DYNAMIC");

		return [...staticBlocks, ...semiStaticBlocks, ...dynamicBlocks];
	}

	/**
	 * Computes SHA-256 fingerprint of the cacheable prefix and provides cache metrics.
	 */
	analyzeCacheEfficiency(): CacheAnalysisReport {
		const aligned = this.getAlignedBlocks();
		const cacheBusters: string[] = [];

		let cacheablePrefixContent = "";
		let cacheablePrefixTokens = 0;
		let totalTokens = 0;

		let inStaticZone = true;

		for (const block of aligned) {
			totalTokens += block.tokenEstimate;

			if (block.volatility === "STATIC" && inStaticZone) {
				// Inspect for accidental cache busters
				const found = this.detectCacheBusters(block.content);
				if (found.length > 0) {
					cacheBusters.push(...found.map((f) => `[Block ${block.id}]: ${f}`));
				}
				cacheablePrefixContent += block.content;
				cacheablePrefixTokens += block.tokenEstimate;
			} else {
				inStaticZone = false;
			}
		}

		const fingerprint = createHash("sha256").update(cacheablePrefixContent).digest("hex").slice(0, 16);
		const efficiency = totalTokens === 0 ? 0 : cacheablePrefixTokens / totalTokens;

		return {
			totalEstimatedTokens: totalTokens,
			cacheablePrefixTokens,
			cacheEfficiencyRatio: Number(efficiency.toFixed(2)),
			prefixFingerprint: fingerprint,
			cacheBustersDetected: cacheBusters,
		};
	}

	/**
	 * Assembles the final aligned prompt string for API consumption.
	 */
	renderOptimizedPrompt(): string {
		const aligned = this.getAlignedBlocks();
		return aligned.map((b) => b.content).join("\n\n");
	}
}
