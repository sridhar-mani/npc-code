import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const metaUrl = typeof import.meta !== "undefined" && typeof import.meta.url === "string" ? import.meta.url : undefined;
const moduleRequire = createRequire(metaUrl ?? (typeof __filename !== "undefined" ? __filename : process.cwd() + "/index.js"));
const TUI_PACKAGE_NAME = "@earendil-works/pi-tui";

export interface NativeModuleCandidateOptions {
	moduleUrl?: string;
	execPath?: string;
	resolvePackage?: (specifier: string) => string;
}

export function getNativeModuleCandidates(nativePath: string, options: NativeModuleCandidateOptions = {}): string[] {
	const effectiveUrl = options.moduleUrl ?? metaUrl;
	const moduleDir = effectiveUrl
		? dirname(fileURLToPath(effectiveUrl))
		: (typeof __filename !== "undefined" ? dirname(__filename) : process.cwd());
	const candidates: string[] = [];

	try {
		const packageEntry = (options.resolvePackage ?? moduleRequire.resolve)(TUI_PACKAGE_NAME);
		candidates.push(join(dirname(packageEntry), "..", nativePath));
	} catch {
		// Standalone binaries do not have an installed TUI package.
	}

	candidates.push(
		join(moduleDir, "..", nativePath),
		join(moduleDir, nativePath),
		join(dirname(options.execPath ?? process.execPath), nativePath),
	);
	return Array.from(new Set(candidates));
}
