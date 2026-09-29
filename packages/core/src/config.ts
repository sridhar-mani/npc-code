/**
 * Core configuration constants and path helpers for pi-core.
 *
 * Trimmed version of the full config.ts that lives in terminal-ui.
 * Exports symbols that core modules actually import.
 */

import { existsSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { normalizePath } from "./utils/paths.ts";

const __filename = (() => {
	try {
		if (typeof import.meta !== "undefined" && typeof import.meta.url === "string" && import.meta.url.length > 0) {
			return fileURLToPath(import.meta.url);
		}
	} catch {
		// In VS Code extension host (CJS bundle), import.meta.url is undefined — safe to ignore.
	}
	return "";
})();
const __dirname = __filename ? dirname(__filename) : process.cwd();

// =============================================================================
// App Metadata
// =============================================================================

export const APP_NAME = "pi";
export const CONFIG_DIR_NAME = ".pi";

/** VERSION injected at build time; falls back to dev sentinel for source runs. */
declare const PI_VERSION: string;
export const VERSION: string = typeof PI_VERSION !== "undefined" ? PI_VERSION : "0.0.0-dev";

export const isBunBinary =
	typeof import.meta !== "undefined" && typeof import.meta.url === "string"
		? import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN")
		: false;

export const isBunRuntime = !!process.versions.bun;

declare const PI_BUNDLED_NODE: boolean;
export const isBundledNode = typeof PI_BUNDLED_NODE !== "undefined" && PI_BUNDLED_NODE;

// =============================================================================
// Path Helpers
// =============================================================================

/** Resolve the agent data directory. Respects PI_AGENT_DIR env override. */
export function getAgentDir(_cwd?: string): string {
	if (process.env.PI_AGENT_DIR) {
		return normalizePath(resolve(process.env.PI_AGENT_DIR));
	}
	return normalizePath(join(homedir(), CONFIG_DIR_NAME));
}

export function getSessionsDir(agentDir?: string): string {
	return join(agentDir ?? getAgentDir(), "sessions");
}

export function getBinDir(): string {
	return join(getAgentDir(), "bin");
}

export function findNodePackageDir(startDir: string): string {
	let dir = startDir;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			const parent = dirname(dir);
			if (basename(dir) === "dist" && existsSync(join(parent, "package.json"))) {
				return parent;
			}
			return dir;
		}
		dir = dirname(dir);
	}
	return startDir;
}

export function getPackageDir(): string {
	const envDir = process.env.PI_PACKAGE_DIR;
	if (envDir) {
		return normalizePath(envDir);
	}

	if (isBunBinary) {
		return dirname(process.execPath);
	}
	return findNodePackageDir(__dirname);
}

export function getExportTemplateDir(): string {
	if (isBunBinary) {
		return join(getPackageDir(), "export-html");
	}
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "core", "export-html");
}

export function getDocsPath(): string {
	return join(__dirname, "..", "docs");
}

export function getExamplesPath(): string {
	return join(__dirname, "..", "examples");
}

export function getReadmePath(): string {
	return join(__dirname, "..", "README.md");
}
