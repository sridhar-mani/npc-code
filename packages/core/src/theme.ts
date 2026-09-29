import { readFileSync } from "fs";
import { basename } from "path";
import type { SourceInfo } from "./source-info.ts";

export type ThemeColor = string;
export type ThemeBg = string;

export interface Theme {
	readonly name?: string;
	readonly sourcePath?: string;
	sourceInfo?: SourceInfo;
	fg(color: ThemeColor, text: string): string;
	bg(color: ThemeBg, text: string): string;
	style?(text: string, options?: any): string;
	bold(text: string): string;
	dim?(text: string): string;
	italic?(text: string): string;
	underline?(text: string): string;
	strikethrough?(text: string): string;
	inverse?(text: string): string;
	getFgAnsi?(color: ThemeColor): string;
	getBgAnsi?(color: ThemeBg): string;
	readonly colors?: Readonly<Record<string, any>>;
	readonly appearance?: "dark" | "light";
}

export const theme: Theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	style: (text: string) => text,
	bold: (text: string) => text,
	dim: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
	strikethrough: (text: string) => text,
	inverse: (text: string) => text,
};

let themeResolver: ((name: string) => Theme | undefined) | undefined;

export function setThemeResolver(resolver: (name: string) => Theme | undefined): void {
	themeResolver = resolver;
}

export function getThemeByName(name: string): Theme | undefined {
	return themeResolver ? themeResolver(name) : undefined;
}

export function loadThemeFromPath(themePath: string, _colorMode?: any): Theme {
	try {
		const content = readFileSync(themePath, "utf-8");
		const json = JSON.parse(content);
		return {
			...theme,
			name: json.name ?? basename(themePath, ".json"),
			sourcePath: themePath,
			colors: json.colors ?? {},
		};
	} catch {
		return {
			...theme,
			sourcePath: themePath,
		};
	}
}

const DEFAULT_THEME_COLORS: Record<string, string> = {
	accent: "#3b82f6",
	border: "#374151",
	borderAccent: "#60a5fa",
	borderMuted: "#1f2937",
	error: "#ef4444",
	muted: "#9ca3af",
	success: "#10b981",
	text: "#f3f4f6",
	toolOutput: "#9ca3af",
	toolTitle: "#60a5fa",
	userMessageBg: "#1e293b",
};

export function getResolvedThemeColors(_themeName?: string): Record<string, string> {
	return { ...DEFAULT_THEME_COLORS };
}

export function getThemeExportColors(_themeName?: string): {
	pageBg?: string;
	cardBg?: string;
	infoBg?: string;
} {
	return {};
}
