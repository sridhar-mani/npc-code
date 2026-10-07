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
import { normalizePath } from "./utils/paths.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// =============================================================================
// App Metadata
// =============================================================================
export const APP_NAME = "npc";
export const CONFIG_DIR_NAME = ".npc";
export const VERSION = typeof PI_VERSION !== "undefined" ? PI_VERSION : "0.0.0-dev";
export const isBunBinary = import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");
export const isBunRuntime = !!process.versions.bun;
export const isBundledNode = typeof PI_BUNDLED_NODE !== "undefined" && PI_BUNDLED_NODE;
// =============================================================================
// Path Helpers
// =============================================================================
/** Resolve the agent data directory. Respects PI_AGENT_DIR env override. */
export function getAgentDir(_cwd) {
    if (process.env.PI_AGENT_DIR) {
        return normalizePath(resolve(process.env.PI_AGENT_DIR));
    }
    return normalizePath(join(homedir(), CONFIG_DIR_NAME));
}
export function getSessionsDir(agentDir) {
    return join(agentDir ?? getAgentDir(), "sessions");
}
export function getBinDir() {
    return join(getAgentDir(), "bin");
}
export function findNodePackageDir(startDir) {
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
export function getPackageDir() {
    const envDir = process.env.PI_PACKAGE_DIR;
    if (envDir) {
        return normalizePath(envDir);
    }
    if (isBunBinary) {
        return dirname(process.execPath);
    }
    return findNodePackageDir(__dirname);
}
export function getExportTemplateDir() {
    if (isBunBinary) {
        return join(getPackageDir(), "export-html");
    }
    const packageDir = getPackageDir();
    const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
    return join(packageDir, srcOrDist, "core", "export-html");
}
export function getDocsPath() {
    return join(__dirname, "..", "docs");
}
export function getExamplesPath() {
    return join(__dirname, "..", "examples");
}
export function getReadmePath() {
    return join(__dirname, "..", "README.md");
}
//# sourceMappingURL=config.js.map