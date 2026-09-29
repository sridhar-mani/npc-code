import { theme } from "../theme/theme.ts";

/**
 * Clean terminal prompt glyph lines for the header.
 */
export function piLogoLines(): [string, string] {
	const top = theme.fg("accent", "◆ ");
	const bottom = theme.fg("muted", "│ ");
	return [top, bottom];
}
