import { readFileSync } from "fs";
import { basename } from "path";
export const theme = {
    fg: (_color, text) => text,
    bg: (_color, text) => text,
    style: (text) => text,
    bold: (text) => text,
    dim: (text) => text,
    italic: (text) => text,
    underline: (text) => text,
    strikethrough: (text) => text,
    inverse: (text) => text,
};
let themeResolver;
export function setThemeResolver(resolver) {
    themeResolver = resolver;
}
export function getThemeByName(name) {
    return themeResolver ? themeResolver(name) : undefined;
}
export function loadThemeFromPath(themePath, _colorMode) {
    try {
        const content = readFileSync(themePath, "utf-8");
        const json = JSON.parse(content);
        return {
            ...theme,
            name: json.name ?? basename(themePath, ".json"),
            sourcePath: themePath,
            colors: json.colors ?? {},
        };
    }
    catch {
        return {
            ...theme,
            sourcePath: themePath,
        };
    }
}
const DEFAULT_THEME_COLORS = {
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
export function getResolvedThemeColors(_themeName) {
    return { ...DEFAULT_THEME_COLORS };
}
export function getThemeExportColors(_themeName) {
    return {};
}
//# sourceMappingURL=theme.js.map