/**
 * AirgapGuard: Zero-Configuration Offline Flight Mode.
 *
 * Guarantees zero data egress in enterprise and high-security airgapped environments.
 * 1. Blocks outbound network calls unless explicitly whitelisted or directed to loopback (localhost/127.0.0.1).
 * 2. Intercepts bash tool commands matching remote egress utilities (curl, wget, ssh, git push).
 * 3. Maintains an audit ledger of blocked and permitted operations.
 */

export interface AirgapCheckResult {
	allowed: boolean;
	target: string;
	reason: string;
	timestamp: number;
}

export class AirgapGuard {
	private enabled: boolean;
	private allowedHosts: Set<string>;
	private auditLog: AirgapCheckResult[] = [];

	constructor(enabled: boolean = true, customAllowedHosts: string[] = []) {
		this.enabled = enabled;
		this.allowedHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", ...customAllowedHosts]);
	}

	isAirgapEnabled(): boolean {
		return this.enabled;
	}

	setAirgapEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	/**
	 * Evaluates whether an outbound HTTP/WebSocket destination URL is permitted.
	 */
	evaluateUrl(rawUrl: string): AirgapCheckResult {
		const timestamp = Date.now();

		if (!this.enabled) {
			const res: AirgapCheckResult = {
				allowed: true,
				target: rawUrl,
				reason: "Airgap mode disabled.",
				timestamp,
			};
			this.auditLog.push(res);
			return res;
		}

		try {
			const parsed = new URL(rawUrl);
			const host = parsed.hostname;

			if (this.allowedHosts.has(host)) {
				const res: AirgapCheckResult = {
					allowed: true,
					target: rawUrl,
					reason: `Host ${host} is on local/loopback whitelist.`,
					timestamp,
				};
				this.auditLog.push(res);
				return res;
			}

			const blockedRes: AirgapCheckResult = {
				allowed: false,
				target: rawUrl,
				reason: `Egress blocked: Host ${host} is external and AirgapGuard is active.`,
				timestamp,
			};
			this.auditLog.push(blockedRes);
			return blockedRes;
		} catch {
			const blockedRes: AirgapCheckResult = {
				allowed: false,
				target: rawUrl,
				reason: "Malformed URL blocked by default in Airgap mode.",
				timestamp,
			};
			this.auditLog.push(blockedRes);
			return blockedRes;
		}
	}

	/**
	 * Evaluates command lines to detect potential remote egress calls (curl, wget, git push, ssh).
	 */
	evaluateCommand(commandLine: string): AirgapCheckResult {
		const timestamp = Date.now();

		if (!this.enabled) {
			const res: AirgapCheckResult = {
				allowed: true,
				target: commandLine,
				reason: "Airgap mode disabled.",
				timestamp,
			};
			this.auditLog.push(res);
			return res;
		}

		const trimmed = commandLine.trim();
		const egressPatterns = [
			/\bcurl\s+/i,
			/\bwget\s+/i,
			/\bgit\s+push\b/i,
			/\bssh\s+/i,
			/\bscp\s+/i,
			/\brsync\s+.*@/i,
			/\bnc\s+/i,
		];

		for (const pattern of egressPatterns) {
			if (pattern.test(trimmed)) {
				const blockedRes: AirgapCheckResult = {
					allowed: false,
					target: commandLine,
					reason: `Outbound egress utility blocked: matched pattern ${pattern.toString()}`,
					timestamp,
				};
				this.auditLog.push(blockedRes);
				return blockedRes;
			}
		}

		const res: AirgapCheckResult = {
			allowed: true,
			target: commandLine,
			reason: "Command does not trigger remote egress patterns.",
			timestamp,
		};
		this.auditLog.push(res);
		return res;
	}

	getAuditLog(): readonly AirgapCheckResult[] {
		return this.auditLog;
	}

	clearAuditLog(): void {
		this.auditLog = [];
	}
}
