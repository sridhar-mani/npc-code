import { SessionManager } from "./session-manager.ts";

/**
 * Open the canonical persistent session for a project.
 *
 * Every Pi presentation surface can call this helper so cross-interface
 * continuation is a core runtime policy rather than a UI-specific handoff.
 * An explicit session directory is preserved for hosts such as the terminal.
 */
export function createSharedSessionManager(cwd: string, sessionDir?: string): SessionManager {
	return SessionManager.continueRecent(cwd, sessionDir);
}
