import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractXlsxText } from "../src/utils/xlsx.ts";

function createZipBuffer(files: Array<{ name: string; content: string }>): Buffer {
	const parts: Buffer[] = [];
	for (const file of files) {
		const nameBuf = Buffer.from(file.name, "utf8");
		const dataBuf = zlib.deflateRawSync(Buffer.from(file.content, "utf8"));

		const header = Buffer.alloc(30);
		header.writeUInt32LE(0x04034b50, 0); // signature
		header.writeUInt16LE(20, 4); // min version
		header.writeUInt16LE(0, 6); // flags
		header.writeUInt16LE(8, 8); // compression method (deflate)
		header.writeUInt16LE(0, 10); // mod time
		header.writeUInt16LE(0, 12); // mod date
		header.writeUInt32LE(0, 14); // crc32
		header.writeUInt32LE(dataBuf.length, 18); // compressed size
		header.writeUInt32LE(Buffer.byteLength(file.content), 22); // uncompressed size
		header.writeUInt16LE(nameBuf.length, 26); // file name length
		header.writeUInt16LE(0, 28); // extra field length

		parts.push(header, nameBuf, dataBuf);
	}
	return Buffer.concat(parts);
}

describe("extractXlsxText", () => {
	it("returns null for non-zip buffer", () => {
		const result = extractXlsxText(Buffer.from("not a zip file"));
		expect(result).toBeNull();
	});

	it("extracts rows and shared strings into markdown table", () => {
		const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
	<si><t>Header 1</t></si>
	<si><t>Header 2</t></si>
	<si><t>Hello World</t></si>
</sst>`;

		const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
	<sheetData>
		<row r="1">
			<c r="A1" t="s"><v>0</v></c>
			<c r="B1" t="s"><v>1</v></c>
		</row>
		<row r="2">
			<c r="A2" t="s"><v>2</v></c>
			<c r="B2"><v>42</v></c>
		</row>
	</sheetData>
</worksheet>`;

		const zipBuf = createZipBuffer([
			{ name: "xl/sharedStrings.xml", content: sharedStringsXml },
			{ name: "xl/worksheets/sheet1.xml", content: sheetXml },
		]);

		const extracted = extractXlsxText(zipBuf);
		expect(extracted).not.toBeNull();
		expect(extracted).toContain("Sheet1");
		expect(extracted).toContain("Header 1");
		expect(extracted).toContain("Header 2");
		expect(extracted).toContain("Hello World");
		expect(extracted).toContain("42");
	});
});
