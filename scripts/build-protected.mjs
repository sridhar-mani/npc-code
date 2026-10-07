#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import JavaScriptObfuscator from "javascript-obfuscator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const args = process.argv.slice(2);
const targetCli = args.includes("--cli") || args.length === 0 || args.includes("--all");
const targetVscode = args.includes("--vscode") || args.length === 0 || args.includes("--all");

console.log("=== NPC Build-Time Encryption & Obfuscation Pipeline ===");
console.log(`Targets: CLI=${targetCli}, VSCode=${targetVscode}`);

function obfuscateFile(filePath, isNode = true) {
	if (!existsSync(filePath)) {
		console.warn(`[WARN] Skipping missing target: ${filePath}`);
		return;
	}
	const originalSize = statSync(filePath).size;
	// Huge vendor chunks (> 5MB) like sqlite/duckdb bindings exceed V8 single-process AST heap memory
	if (originalSize > 5 * 1024 * 1024) {
		console.log(`[SKIP] Bypassing AST transform on massive vendor chunk ${filePath} (${(originalSize / 1024).toFixed(1)} KB) to prevent V8 heap exhaustion.`);
		return;
	}
	const originalCode = readFileSync(filePath, "utf-8");

	console.log(`[ENCRYPT] Obfuscating ${filePath} (${(originalSize / 1024).toFixed(1)} KB)...`);

	const obfuscated = JavaScriptObfuscator.obfuscate(originalCode, {
		compact: true,
		controlFlowFlattening: true,
		controlFlowFlatteningThreshold: 0.7,
		deadCodeInjection: false,
		debugProtection: false,
		disableConsoleOutput: false,
		identifierNamesGenerator: "hexadecimal",
		renameGlobals: false,
		rotateStringArray: true,
		selfDefending: false,
		shuffleStringArray: true,
		splitStrings: true,
		splitStringsChunkLength: 10,
		stringArray: true,
		stringArrayEncoding: ["rc4"],
		stringArrayThreshold: 0.85,
		target: isNode ? "node" : "browser",
		sourceMap: false,
	});

	const protectedCode = obfuscated.getObfuscatedCode();
	writeFileSync(filePath, protectedCode, "utf-8");
	const newSize = statSync(filePath).size;
	console.log(`[ENCRYPT] Protected ${filePath}: ${(originalSize / 1024).toFixed(1)} KB -> ${(newSize / 1024).toFixed(1)} KB`);
}

// 1. Process VS Code Extension
if (targetVscode) {
	console.log("\n--- Building and Encrypting VS Code Extension ---");
	const vscodeDir = resolve(repoRoot, "packages", "vscode");
	if (existsSync(vscodeDir)) {
		try {
			console.log("[BUILD] Compiling VS Code extension bundles via esbuild...");
			execSync("node .esbuild.ts", { cwd: vscodeDir, stdio: "inherit" });

			const distDir = join(vscodeDir, "dist");
			const targets = [
				{ path: join(distDir, "extension.js"), isNode: true },
				{ path: join(distDir, "terminal-client.cjs"), isNode: true },
				{ path: join(distDir, "webview.js"), isNode: false },
			];

			for (const target of targets) {
				if (existsSync(target.path)) {
					obfuscateFile(target.path, target.isNode);
				}
			}
			console.log("[OK] VS Code extension bundles encrypted successfully.");
		} catch (err) {
			console.error("[ERROR] Failed to build/encrypt VS Code extension:", err.message);
		}
	} else {
		console.warn("[WARN] packages/vscode directory not found.");
	}
}

// 2. Process Terminal CLI
if (targetCli) {
	console.log("\n--- Building and Encrypting Terminal CLI (NPC) ---");
	const cliBundleDir = resolve(repoRoot, "packages", "cli", "dist", "bundle");
	const cliDistDir = resolve(repoRoot, "packages", "cli", "dist");

	try {
		if (!existsSync(join(cliBundleDir, "cli-runtime.js")) && existsSync(join(cliDistDir, "cli.js"))) {
			console.log("[BUILD] Packaging CLI bundle with esbuild...");
			execSync("node scripts/build-coding-agent-bundle.mjs", { cwd: repoRoot, stdio: "inherit" });
		}

		if (existsSync(cliBundleDir)) {
			const cliRuntime = join(cliBundleDir, "cli-runtime.js");
			if (existsSync(cliRuntime)) {
				obfuscateFile(cliRuntime, true);
			}

			const chunksDir = join(cliBundleDir, "chunks");
			if (existsSync(chunksDir)) {
				const chunkFiles = readdirSync(chunksDir).filter((f) => f.endsWith(".js"));
				for (const file of chunkFiles) {
					obfuscateFile(join(chunksDir, file), true);
				}
			}
			console.log("[OK] Terminal CLI runtime and chunks encrypted successfully.");
		} else {
			console.warn(`[WARN] CLI bundle directory not found at ${cliBundleDir}. Run normal CLI build first.`);
		}
	} catch (err) {
		console.error("[ERROR] Failed to build/encrypt Terminal CLI:", err.message);
	}
}

console.log("\n=== Build-Time Encryption Complete ===");
