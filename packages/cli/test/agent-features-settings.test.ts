import { describe, expect, it } from "vitest";
import { SettingsManager } from "../src/index.ts";

describe("agent feature settings", () => {
	it("defaults experimental agent features to disabled and safe values", () => {
		const settings = SettingsManager.inMemory();
		expect(settings.getAgentFeaturesSettings()).toEqual({
			guardrails: { enabled: false, hooksEnabled: false, defaultTier: "config" },
			switchyard: {
				enabled: false,
				mode: "lite",
				efficientModel: "",
				capableModel: "",
				evaluatorModel: "",
				picker: "efficient_first",
			},
			personalization: { enabled: false, autoLearn: false, maxTokens: 1200 },
			semble: { enabled: false, maxResults: 8 },
			worktree: { enabled: false, rootDir: "", cleanupOnDispose: false },
			openResearch: { enabled: true, maxResults: 4 },
			proceduralGuidance: { enabled: true },
			astImpact: { enabled: true },
			actionFusion: { enabled: true },
			execCritic: { enabled: true },
			airgap: { enabled: false },
			prAutopilot: { enabled: true },
			reduceOutput: { enabled: true, maxChars: 1024 },
		});
	});

	it("persists partial agent feature updates without dropping sibling settings", async () => {
		const settings = SettingsManager.inMemory({
			agentFeatures: {
				guardrails: { enabled: true, hooksEnabled: true },
				personalization: { enabled: true, autoLearn: true, maxTokens: 900 },
				openResearch: { enabled: false, maxResults: 2 },
				actionFusion: { enabled: false },
			},
		});
		expect(settings.getAgentFeaturesSettings().guardrails.enabled).toBe(true);
		expect(settings.getAgentFeaturesSettings().openResearch.enabled).toBe(false);
		expect(settings.getAgentFeaturesSettings().actionFusion.enabled).toBe(false);
		settings.setAgentFeaturesSettings({
			switchyard: { enabled: true, picker: "capable_first" },
			airgap: { enabled: true },
		});
		await settings.flush();
		const resolved = settings.getAgentFeaturesSettings();
		expect(resolved.guardrails.enabled).toBe(true);
		expect(resolved.personalization.autoLearn).toBe(true);
		expect(resolved.switchyard.enabled).toBe(true);
		expect(resolved.switchyard.picker).toBe("capable_first");
		expect(resolved.openResearch.enabled).toBe(false);
		expect(resolved.actionFusion.enabled).toBe(false);
		expect(resolved.airgap.enabled).toBe(true);
	});
});
