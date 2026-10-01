import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConventionExtractor, ConventionInjector, ConventionStore } from "../../core/src/personalization/index.ts";

describe("ConventionStore", () => {
	it("saves and retrieves persistent conventions", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-conv-test-"));
		const storePath = path.join(tempDir, "conventions.json");

		try {
			const store = new ConventionStore({ storagePath: storePath });
			const item = store.set({
				category: "style",
				content: "Always use erasable syntax in TypeScript",
				tier: "custom_rule",
			});

			expect(item.id).toBeDefined();
			expect(item.content).toBe("Always use erasable syntax in TypeScript");

			// Reload from disk in a fresh store instance
			const reloaded = new ConventionStore({ storagePath: storePath });
			const fetched = reloaded.get(item.id);
			expect(fetched).toBeDefined();
			expect(fetched?.category).toBe("style");
			expect(fetched?.content).toBe("Always use erasable syntax in TypeScript");
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("extracts conventions from developer statements", () => {
		const text = `
Always prefer explicit constructor assignments over parameter properties.
Never hardcode API keys or secret tokens.
In this repo our convention is to write unit tests for every new module.
`;

		const extracted = ConventionExtractor.extractFromText(text);
		expect(extracted).toHaveLength(3);
		expect(extracted[0].tier).toBe("custom_rule");
		expect(extracted[1].tier).toBe("custom_rule");
		expect(extracted[2].tier).toBe("workflow");
	});

	it("formats conventions into structured system prompt sections", () => {
		const conventions = [
			{
				id: "c1",
				category: "testing",
				content: "Run test.sh before pushing commits",
				tier: "workflow" as const,
				confidence: 1.0,
				accessCount: 1,
				isEnabled: true,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			},
			{
				id: "c2",
				category: "style",
				content: "Keep answers concise and direct",
				tier: "preference" as const,
				confidence: 0.9,
				accessCount: 1,
				isEnabled: true,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			},
		];

		const formatted = ConventionInjector.formatPromptSection(conventions);
		expect(formatted).toContain("# User & Repository Conventions");
		expect(formatted).toContain("## TESTING");
		expect(formatted).toContain("- Run test.sh before pushing commits");
		expect(formatted).toContain("## STYLE");
		expect(formatted).toContain("- Keep answers concise and direct");
	});
});
