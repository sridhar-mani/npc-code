import { describe, expect, it } from "vitest";
import { SettingsManager } from "../src/index.ts";

describe("agent feature settings", () => {
	it("defaults experimental agent features to disabled and safe values", () => {
		const settings = SettingsManager.inMemory();
		expect(settings.getAgentFeaturesSettings()).toEqual({
			guardrails: { enabled: false, hooksEnabled: false, defaultTier: "config" },
			switchyard: {
				enabled: false,
				efficientModel: "",
				capableModel: "",
				evaluatorModel: "",
				picker: "efficient_first",
			},
			personalization: { enabled: false, autoLearn: false, maxTokens: 1200 },
			semble: { enabled: false, maxResults: 8 },
			worktree: { enabled: false, rootDir: "", cleanupOnDispose: false },
		});
	});

	it("persists partial agent feature updates without dropping sibling settings", async () => {
		const settings = SettingsManager.inMemory({
			agentFeatures: {
			guardrails: { enabled: true, hooksEnabled: true },
			personalization: { enabled: true, autoLearn: true, maxTokens: 900 },
		},
		});
		expect(settings.getAgentFeaturesSettings().guardrails.enabled).toBe(true);
		settings.setAgentFeaturesSettings({
			switchyard: { enabled: true, picker: "capable_first" },
		});
		await settings.flush();
		const resolved = settings.getAgentFeaturesSettings();
		expect(resolved.guardrails.enabled).toBe(true);
		expect(resolved.personalization.autoLearn).toBe(true);
		expect(resolved.switchyard.enabled).toBe(true);
		expect(resolved.switchyard.picker).toBe("capable_first");
	});
});
