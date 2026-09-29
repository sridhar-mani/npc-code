/**
 * Core configuration constants and path helpers for pi-core.
 *
 * Trimmed version of the full config.ts that lives in terminal-ui.
 * Exports symbols that core modules actually import.
 */
export declare const APP_NAME = "pi";
export declare const CONFIG_DIR_NAME = ".pi";
export declare const VERSION: string;
export declare const isBunBinary: boolean;
export declare const isBunRuntime: boolean;
export declare const isBundledNode: boolean;
/** Resolve the agent data directory. Respects PI_AGENT_DIR env override. */
export declare function getAgentDir(_cwd?: string): string;
export declare function getSessionsDir(agentDir?: string): string;
export declare function getBinDir(): string;
export declare function findNodePackageDir(startDir: string): string;
export declare function getPackageDir(): string;
export declare function getExportTemplateDir(): string;
export declare function getDocsPath(): string;
export declare function getExamplesPath(): string;
export declare function getReadmePath(): string;
//# sourceMappingURL=config.d.ts.map