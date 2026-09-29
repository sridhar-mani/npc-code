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
export declare const theme: Theme;
export declare function setThemeResolver(resolver: (name: string) => Theme | undefined): void;
export declare function getThemeByName(name: string): Theme | undefined;
export declare function loadThemeFromPath(themePath: string, _colorMode?: any): Theme;
export declare function getResolvedThemeColors(_themeName?: string): Record<string, string>;
export declare function getThemeExportColors(_themeName?: string): {
	pageBg?: string;
	cardBg?: string;
	infoBg?: string;
};
//# sourceMappingURL=theme.d.ts.map
