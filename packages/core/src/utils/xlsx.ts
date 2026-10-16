import * as zlib from "node:zlib";

export interface XlsxExtractOptions {
	readonly maxRowsPerSheet?: number;
	readonly maxChars?: number;
	readonly format?: "markdown" | "csv";
}

function decodeXmlEntities(str: string): string {
	return str
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function parseSharedStrings(xml: string): string[] {
	const strings: string[] = [];
	// Look for <si>...</si> entries
	const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
	let match: RegExpExecArray | null = siRegex.exec(xml);
	while (match) {
		const siContent = match[1];
		const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
		let tMatch: RegExpExecArray | null = tRegex.exec(siContent);
		const parts: string[] = [];
		while (tMatch) {
			parts.push(tMatch[1]);
			tMatch = tRegex.exec(siContent);
		}
		strings.push(decodeXmlEntities(parts.join("")));
		match = siRegex.exec(xml);
	}
	return strings;
}

function parseWorksheetRows(xml: string, sharedStrings: string[], maxRows: number): string[][] {
	const rows: string[][] = [];
	const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
	let rowMatch: RegExpExecArray | null = rowRegex.exec(xml);

	while (rowMatch && rows.length < maxRows) {
		const rowContent = rowMatch[1];
		const cells: string[] = [];
		const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
		let cellMatch: RegExpExecArray | null = cellRegex.exec(rowContent);

		while (cellMatch) {
			const attrs = cellMatch[1];
			const inner = cellMatch[2];
			const isString = /t="s"/i.test(attrs);
			const isInline = /t="inlineStr"/i.test(attrs);

			let val = "";
			if (isInline) {
				const tMatch = /<t\b[^>]*>([\s\S]*?)<\/t>/i.exec(inner);
				if (tMatch) val = decodeXmlEntities(tMatch[1]);
			} else if (isString) {
				const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(inner);
				if (vMatch) {
					const idx = parseInt(vMatch[1], 10);
					val = Number.isFinite(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx] : "";
				}
			} else {
				const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(inner);
				if (vMatch) {
					val = decodeXmlEntities(vMatch[1]);
				}
			}
			cells.push(val.trim());
			cellMatch = cellRegex.exec(rowContent);
		}

		if (cells.some((c) => c.length > 0)) {
			rows.push(cells);
		}
		rowMatch = rowRegex.exec(xml);
	}

	return rows;
}

function formatSheetAsMarkdown(sheetName: string, rows: string[][]): string {
	if (rows.length === 0) return `### Sheet: ${sheetName}\n*(empty)*\n`;
	const lines: string[] = [`### Sheet: ${sheetName}`, ""];
	const maxCols = Math.max(...rows.map((r) => r.length));
	const pad = (r: string[]) => {
		const padded = [...r];
		while (padded.length < maxCols) padded.push("");
		return padded;
	};

	const header = pad(rows[0]);
	lines.push(`| ${header.map((h) => h || "-").join(" | ")} |`);
	lines.push(`| ${header.map(() => "---").join(" | ")} |`);

	for (let i = 1; i < rows.length; i++) {
		const row = pad(rows[i]);
		lines.push(`| ${row.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`);
	}
	lines.push("");
	return lines.join("\n");
}

/**
 * Extracts structured plain text from an Excel .xlsx buffer by parsing ZIP contents.
 * Zero external dependencies; uses Node.js built-in zlib.
 */
export function extractXlsxText(buffer: Buffer, options?: XlsxExtractOptions): string | null {
	const maxRows = options?.maxRowsPerSheet ?? 500;
	const maxChars = options?.maxChars ?? 100000;

	const zipFiles: Map<string, Buffer> = new Map();
	let offset = 0;

	while (offset < buffer.length - 30) {
		if (buffer.readUInt32LE(offset) === 0x04034b50) {
			const compression = buffer.readUInt16LE(offset + 8);
			const compressedSize = buffer.readUInt32LE(offset + 18);
			const nameLen = buffer.readUInt16LE(offset + 26);
			const extraLen = buffer.readUInt16LE(offset + 28);
			const fileName = buffer.toString("utf8", offset + 30, offset + 30 + nameLen);
			const dataStart = offset + 30 + nameLen + extraLen;

			if (
				fileName === "xl/sharedStrings.xml" ||
				(fileName.startsWith("xl/worksheets/sheet") && fileName.endsWith(".xml"))
			) {
				try {
					let decompressed: Buffer | undefined;
					if (compression === 0) {
						decompressed = buffer.subarray(dataStart, dataStart + compressedSize);
					} else if (compression === 8) {
						decompressed = zlib.inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize));
					}
					if (decompressed) {
						zipFiles.set(fileName, decompressed);
					}
				} catch {
					// Ignore corrupted chunk
				}
			}
			offset = dataStart + Math.max(0, compressedSize);
		} else {
			offset++;
		}
	}

	if (zipFiles.size === 0) return null;

	const sharedStringsXml = zipFiles.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
	const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];

	const sheetEntries = Array.from(zipFiles.keys())
		.filter((name) => name.startsWith("xl/worksheets/sheet") && name.endsWith(".xml"))
		.sort();

	const outputParts: string[] = [];
	for (let i = 0; i < sheetEntries.length; i++) {
		const sheetPath = sheetEntries[i];
		const sheetXml = zipFiles.get(sheetPath)!.toString("utf8");
		const sheetNum = sheetPath.replace(/[^\d]/g, "") || String(i + 1);
		const rows = parseWorksheetRows(sheetXml, sharedStrings, maxRows);
		outputParts.push(formatSheetAsMarkdown(`Sheet${sheetNum}`, rows));
	}

	const result = outputParts.join("\n\n").trim();
	if (result.length > maxChars) {
		return `${result.slice(0, maxChars)}\n\n...(truncated ${result.length - maxChars} characters)`;
	}
	return result || null;
}
