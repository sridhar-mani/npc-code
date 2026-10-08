/**
 * ContinuousAstDependencyGraph: Targeted AST Caller/Callee Impact Injection.
 *
 * Continuously indexes source code symbols, caller/callee relationships, and import-export
 * bindings. When a symbol is edited, calculates the transitive blast radius and generates
 * token-bounded prompt context containing only the affected callers and signatures.
 */

export interface AstSymbol {
	name: string;
	kind: "function" | "class" | "interface" | "type" | "variable" | "method";
	filePath: string;
	line: number;
	signature?: string;
	exported: boolean;
}

export interface AstImport {
	filePath: string;
	sourceModule: string;
	importedSymbols: string[];
}

export interface AstReference {
	fromFile: string;
	fromSymbol?: string;
	toSymbol: string;
	line: number;
}

export interface ImpactRadiusResult {
	targetFile: string;
	targetSymbol?: string;
	directCallers: AstReference[];
	transitiveCallers: AstReference[];
	affectedFiles: string[];
	blastRadiusScore: number;
}

export class ContinuousAstDependencyGraph {
	private symbolsByFile: Map<string, AstSymbol[]> = new Map();
	private importsByFile: Map<string, AstImport[]> = new Map();
	private referencesByFile: Map<string, AstReference[]> = new Map();

	/**
	 * Parses and indexes symbols, imports, and references from a source file.
	 */
	indexFile(filePath: string, content: string): void {
		const symbols: AstSymbol[] = [];
		const imports: AstImport[] = [];
		const references: AstReference[] = [];

		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineNum = i + 1;

			// Match import statements: import { a, b } from "module"; or import defaultExport from "module";
			const importMatch = line.match(/import\s+(?:\{([^}]+)\}|([a-zA-Z0-9_$]+))\s+from\s+["']([^"']+)["']/);
			if (importMatch) {
				const specifiers = importMatch[1]
					? importMatch[1]
							.split(",")
							.map((s) =>
								s
									.trim()
									.split(/\s+as\s+/)[0]
									.trim(),
							)
							.filter(Boolean)
					: importMatch[2]
						? [importMatch[2].trim()]
						: [];
				const sourceModule = importMatch[3];
				imports.push({ filePath, sourceModule, importedSymbols: specifiers });
			}

			// Match exported functions / classes / interfaces / types / const
			const exportFuncMatch = line.match(/^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/);
			if (exportFuncMatch) {
				const isExported = line.trim().startsWith("export");
				symbols.push({
					name: exportFuncMatch[1],
					kind: "function",
					filePath,
					line: lineNum,
					signature: `${exportFuncMatch[1]}(${exportFuncMatch[2].trim()})`,
					exported: isExported,
				});
			}

			const classMatch = line.match(/^(?:export\s+)?class\s+([a-zA-Z0-9_$]+)/);
			if (classMatch) {
				symbols.push({
					name: classMatch[1],
					kind: "class",
					filePath,
					line: lineNum,
					signature: `class ${classMatch[1]}`,
					exported: line.trim().startsWith("export"),
				});
			}

			const interfaceMatch = line.match(/^(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)/);
			if (interfaceMatch) {
				symbols.push({
					name: interfaceMatch[1],
					kind: "interface",
					filePath,
					line: lineNum,
					signature: `interface ${interfaceMatch[1]}`,
					exported: line.trim().startsWith("export"),
				});
			}

			const typeMatch = line.match(/^(?:export\s+)?type\s+([a-zA-Z0-9_$]+)\s*=/);
			if (typeMatch) {
				symbols.push({
					name: typeMatch[1],
					kind: "type",
					filePath,
					line: lineNum,
					signature: `type ${typeMatch[1]}`,
					exported: line.trim().startsWith("export"),
				});
			}

			// Match method signatures inside classes: methodName(...)
			const methodMatch = line.match(
				/^\s+(?:public|private|protected|async|\s)*([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*[:{]/,
			);
			if (methodMatch && !["if", "for", "while", "switch", "catch"].includes(methodMatch[1])) {
				symbols.push({
					name: methodMatch[1],
					kind: "method",
					filePath,
					line: lineNum,
					signature: `${methodMatch[1]}(${methodMatch[2].trim()})`,
					exported: false,
				});
			}

			// Match symbol calls/references: identifier(...) or new Identifier(...)
			const declaredName = exportFuncMatch?.[1] ?? methodMatch?.[1];
			const callMatches = line.matchAll(/(?:new\s+)?([a-zA-Z0-9_$]+)\s*\(/g);
			for (const call of callMatches) {
				const name = call[1];
				if (name === declaredName) {
					continue;
				}
				if (
					!["if", "for", "while", "switch", "catch", "function", "return", "throw", "import", "require"].includes(
						name,
					)
				) {
					references.push({
						fromFile: filePath,
						toSymbol: name,
						line: lineNum,
					});
				}
			}
		}

		this.symbolsByFile.set(filePath, symbols);
		this.importsByFile.set(filePath, imports);
		this.referencesByFile.set(filePath, references);
	}

	/**
	 * Removes a file from index.
	 */
	removeFile(filePath: string): void {
		this.symbolsByFile.delete(filePath);
		this.importsByFile.delete(filePath);
		this.referencesByFile.delete(filePath);
	}

	/**
	 * Returns all indexed symbols in a file.
	 */
	getSymbols(filePath: string): readonly AstSymbol[] {
		return this.symbolsByFile.get(filePath) ?? [];
	}

	/**
	 * Finds all caller references across the indexed codebase for a specific symbol.
	 */
	getCallers(symbolName: string, targetFile?: string): AstReference[] {
		const callers: AstReference[] = [];

		for (const [file, refs] of this.referencesByFile.entries()) {
			if (targetFile && file === targetFile) {
				// Skip self if looking for external callers
			}
			for (const ref of refs) {
				if (ref.toSymbol === symbolName) {
					callers.push(ref);
				}
			}
		}

		return callers;
	}

	/**
	 * Calculates the full transitive impact radius of altering a file and/or specific symbol.
	 */
	getImpactRadius(targetFile: string, targetSymbol?: string): ImpactRadiusResult {
		const symbols = targetSymbol
			? [{ name: targetSymbol, filePath: targetFile, kind: "function" as const, line: 1, exported: true }]
			: (this.symbolsByFile.get(targetFile) ?? []);

		const directCallers: AstReference[] = [];
		const affectedFilesSet = new Set<string>();
		affectedFilesSet.add(targetFile);

		for (const sym of symbols) {
			const callers = this.getCallers(sym.name);
			for (const caller of callers) {
				directCallers.push(caller);
				affectedFilesSet.add(caller.fromFile);
			}
		}

		// Transitive expansion (1 layer deeper)
		const transitiveCallers: AstReference[] = [];
		for (const direct of directCallers) {
			const callerFileSymbols = this.symbolsByFile.get(direct.fromFile) ?? [];
			for (const sym of callerFileSymbols) {
				const trans = this.getCallers(sym.name);
				for (const t of trans) {
					if (!affectedFilesSet.has(t.fromFile)) {
						transitiveCallers.push(t);
						affectedFilesSet.add(t.fromFile);
					}
				}
			}
		}

		const blastRadiusScore = directCallers.length * 1.5 + transitiveCallers.length * 0.7;

		return {
			targetFile,
			targetSymbol,
			directCallers,
			transitiveCallers,
			affectedFiles: Array.from(affectedFilesSet),
			blastRadiusScore,
		};
	}

	/**
	 * Generates a token-bounded context string containing caller call sites and signatures
	 * to inject into model prompts without loading entire foreign files.
	 */
	buildTargetedPromptContext(targetFile: string, targetSymbol?: string, maxTokens: number = 800): string {
		const impact = this.getImpactRadius(targetFile, targetSymbol);
		const lines: string[] = [];

		lines.push(`### AST Impact Radius for ${targetFile}${targetSymbol ? ` [${targetSymbol}]` : ""}`);
		lines.push(`- Blast Radius Score: ${impact.blastRadiusScore.toFixed(1)}`);
		lines.push(`- Directly Dependent Files (${impact.directCallers.length} calls):`);

		for (const caller of impact.directCallers.slice(0, 10)) {
			lines.push(`  * ${caller.fromFile}:${caller.line} -> calls ${caller.toSymbol}()`);
		}

		if (impact.transitiveCallers.length > 0) {
			lines.push(`- Transitive Dependent Files (${impact.transitiveCallers.length} calls):`);
			for (const trans of impact.transitiveCallers.slice(0, 5)) {
				lines.push(`  * ${trans.fromFile}:${trans.line} -> calls ${trans.toSymbol}()`);
			}
		}

		const output = lines.join("\n");
		// Rough token heuristic: 4 chars per token
		if (output.length > maxTokens * 4) {
			return `${output.slice(0, maxTokens * 4)}\n...[AST context truncated to budget]`;
		}
		return output;
	}
}
