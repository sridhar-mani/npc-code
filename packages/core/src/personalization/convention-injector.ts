/**
 * packages/core/src/personalization/convention-injector.ts
 *
 * Injects persistent conventions into the model's system prompt context.
 */

import type { ConventionItem } from "./convention-store.ts";

export interface InjectionOptions {
	readonly maxTokens?: number;
	readonly headerTitle?: string;
}

/**
 * Formats a list of active conventions into a prompt section with budget budgeting.
 */
export function formatPromptSection(conventions: readonly ConventionItem[], options?: InjectionOptions): string {
	const enabled = conventions.filter((c) => c.isEnabled);
	if (enabled.length === 0) {
		return "";
	}

	const title = options?.headerTitle ?? "# User & Repository Conventions";
	const maxChars = options?.maxTokens ? options.maxTokens * 4 : 4000;

	const grouped = new Map<string, string[]>();
	for (const item of enabled) {
		const cat = item.category || "general";
		const list = grouped.get(cat) ?? [];
		list.push(`- ${item.content}`);
		grouped.set(cat, list);
	}

	const sections: string[] = [title];
	let totalChars = title.length + 2;

	for (const [category, items] of grouped.entries()) {
		const catHeader = `\n## ${category.toUpperCase()}`;
		const block = `${catHeader}\n${items.join("\n")}`;

		if (totalChars + block.length > maxChars) {
			break;
		}
		sections.push(block);
		totalChars += block.length + 1;
	}

	return sections.join("\n");
}

export const ConventionInjector = {
	formatPromptSection,
};
