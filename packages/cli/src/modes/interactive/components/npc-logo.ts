import { theme } from "../theme/theme.ts";

/**
 * Retro box-drawn terminal prompt glyph lines for the header.
 */
export function npcLogoLines(): [string, string] {
	const top = theme.fg("accent", "╔═[NPC]═");
	const bottom = theme.fg("muted", "╚═══════");
	return [top, bottom];
}

export const piLogoLines = npcLogoLines;
