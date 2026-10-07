import * as zlib from "node:zlib";

/**
 * Extracts plain text from a Word .docx buffer by parsing word/document.xml from the ZIP structure.
 * Zero external dependencies; uses Node.js built-in zlib.
 */
/**
 * Options for configuring docx text extraction.
 */
export interface DocxExtractOptions {
	readonly paragraphSeparator?: string;
	readonly decodeEntities?: (text: string) => string;
}

/**
 * Decodes XML character entities including named entities, decimal, and hexadecimal codepoints.
 */
export function decodeXmlEntities(text: string): string {
	return text.replace(/&(?:#([0-9]+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g, (match, dec, hex, named) => {
		if (dec) {
			const code = parseInt(dec, 10);
			return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
		}
		if (hex) {
			const code = parseInt(hex, 16);
			return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
		}
		switch (named) {
			case "amp":
				return "&";
			case "lt":
				return "<";
			case "gt":
				return ">";
			case "quot":
				return '"';
			case "apos":
				return "'";
			case "nbsp":
				return " ";
			default:
				return match;
		}
	});
}

/**
 * Extracts plain text from OpenXML WordprocessingML structure.
 * Accurately parses paragraphs (<w:p>), text elements (<w:t>), tabs, and line breaks.
 */
export function parseWordDocumentXml(xml: string, options?: DocxExtractOptions): string {
	const decoder = options?.decodeEntities ?? decodeXmlEntities;
	const pSep = options?.paragraphSeparator ?? "\n\n";

	const paragraphs: string[] = [];
	const pRegex = /<w:p(?:\s+[^>]*)?>([\s\S]*?)<\/w:p>/gi;
	let pMatch = pRegex.exec(xml);
	while (pMatch !== null) {
		const pContent = pMatch[1];
		let pText = "";
		const tokenRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/gi;
		let tokenMatch = tokenRegex.exec(pContent);

		while (tokenMatch !== null) {
			if (tokenMatch[1] !== undefined) {
				pText += decoder(tokenMatch[1]);
			} else if (tokenMatch[0].includes("tab")) {
				pText += "\t";
			} else {
				pText += "\n";
			}
			tokenMatch = tokenRegex.exec(pContent);
		}

		const cleaned = pText.trim();
		if (cleaned.length > 0) {
			paragraphs.push(cleaned);
		}
		pMatch = pRegex.exec(xml);
	}

	if (paragraphs.length > 0) {
		return paragraphs.join(pSep);
	}

	const fallbackRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/gi;
	const texts: string[] = [];
	let tMatch = fallbackRegex.exec(xml);
	while (tMatch !== null) {
		texts.push(decoder(tMatch[1]));
		tMatch = fallbackRegex.exec(xml);
	}
	return texts.join(" ").trim();
}

/**
 * Extracts plain text from a Word .docx buffer by parsing word/document.xml from the ZIP structure.
 * Zero external dependencies; uses Node.js built-in zlib.
 */
export function extractDocxText(buffer: Buffer, options?: DocxExtractOptions): string | null {
	let offset = 0;
	while (offset < buffer.length - 30) {
		if (buffer.readUInt32LE(offset) === 0x04034b50) {
			const compression = buffer.readUInt16LE(offset + 8);
			const compressedSize = buffer.readUInt32LE(offset + 18);
			const nameLen = buffer.readUInt16LE(offset + 26);
			const extraLen = buffer.readUInt16LE(offset + 28);
			const fileName = buffer.toString("utf8", offset + 30, offset + 30 + nameLen);
			const dataStart = offset + 30 + nameLen + extraLen;

			if (fileName === "word/document.xml") {
				let xml: string | undefined;
				if (compression === 0) {
					xml = buffer.toString("utf8", dataStart, dataStart + compressedSize);
				} else if (compression === 8) {
					const compData = buffer.subarray(dataStart, dataStart + compressedSize);
					xml = zlib.inflateRawSync(compData).toString("utf8");
				}
				if (xml) {
					return parseWordDocumentXml(xml, options);
				}
			}
			offset = dataStart + Math.max(0, compressedSize);
		} else {
			offset++;
		}
	}
	return null;
}

/**
 * Reads a buffer as text, extracting text if it is a .docx file.
 */
export function readFileAsText(filePath: string, buffer: Buffer): string {
	const lower = filePath.toLowerCase();
	if (lower.endsWith(".docx")) {
		const extracted = extractDocxText(buffer);
		if (extracted !== null) {
			return extracted;
		}
	}
	return buffer.toString("utf-8");
}
