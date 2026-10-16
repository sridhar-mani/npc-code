/**
 * Tool & Command Dangerous Risk Classifier.
 *
 * Implements Claude Code & Codex-style pre-execution danger level prediction
 * and risk hazard explanations for tools and shell commands.
 */

export type DangerLevel = "safe" | "warning" | "danger";

export interface ToolRiskAssessment {
	readonly dangerLevel: DangerLevel;
	readonly riskReason?: string;
}

const HIGH_DANGER_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{
		pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?|\brm\s+--recursive/i,
		reason: "Destructive recursive file deletion (rm -rf)",
	},
	{
		pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-zA-Z]*f|push\s+(?:--force|-f))/i,
		reason: "Destructive Git command: uncommitted changes or remote history may be permanently overwritten",
	},
	{
		pattern: /\b(?:mkfs|fdisk|parted)\b|\bdd\s+if=.*of=\/dev\//i,
		reason: "Direct disk formatting or raw block write operation",
	},
	{
		pattern: /\bchmod\s+(?:-R\s+)?(?:777|a\+rwx|000)\b/i,
		reason: "Insecure or destructive filesystem permission modification",
	},
	{
		pattern: /\b(?:sudo|su\s+-)\b/i,
		reason: "Privilege escalation to root/superuser",
	},
	{
		pattern: /\b(?:curl|wget|fetch)\b[^\n|]*\|\s*(?:ba)?sh\b/i,
		reason: "Piping remote unverified network content directly into a shell interpreter",
	},
	{
		pattern: /:(){ :|:& };:|fork\s*bomb/i,
		reason: "Fork bomb detected: attempts system denial-of-service",
	},
	{
		pattern: /\b(?:killall|kill\s+-9\s+-1|pkill\s+-9)\b/i,
		reason: "System-wide process termination signal",
	},
	{
		pattern: /\b(?:reboot|shutdown|init\s+0|halt)\b/i,
		reason: "System power state / shutdown command",
	},
];

const MODERATE_RISK_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{
		pattern: /\b(?:npm\s+i|npm\s+install|pnpm\s+add|yarn\s+add|pip\s+install)\b/i,
		reason: "External dependency installation modifying local environment",
	},
	{
		pattern: /\bgit\s+push\b/i,
		reason: "Publishing commits to a remote repository",
	},
	{
		pattern: /\b(?:kill|pkill)\b/i,
		reason: "Process termination signal",
	},
	{
		pattern: /\b(?:rm|unlink|mv)\b/i,
		reason: "File removal or path alteration",
	},
	{
		pattern: /\b(?:curl|wget)\b/i,
		reason: "Outbound network request",
	},
];

const SENSITIVE_RESOURCE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{
		pattern: /(?:\.env(?:\..*)?|id_rsa.*|id_ed25519.*|\.pem|\.key|credentials\.json)$/i,
		reason: "Targeting sensitive credentials, secret keys, or environment files",
	},
	{
		pattern: /^\/(?:etc|root|var\/run|sys|proc)\b/i,
		reason: "Targeting protected root operating system paths",
	},
	{
		pattern: /(?:^|[\\/])\.git[\\/]config$/i,
		reason: "Targeting repository Git configuration directly",
	},
];

export function classifyCommandRisk(toolName: string, args?: Record<string, unknown> | string): ToolRiskAssessment {
	const name = toolName.toLowerCase();
	let commandStr = "";
	let targetPath = "";

	if (typeof args === "string") {
		commandStr = args;
	} else if (args && typeof args === "object") {
		if (typeof args.command === "string") commandStr = args.command;
		else if (typeof args.cmd === "string") commandStr = args.cmd;
		else if (typeof args.CommandLine === "string") commandStr = args.CommandLine;

		if (typeof args.path === "string") targetPath = args.path;
		else if (typeof args.filePath === "string") targetPath = args.filePath;
		else if (typeof args.TargetFile === "string") targetPath = args.TargetFile;
		else if (typeof args.AbsolutePath === "string") targetPath = args.AbsolutePath;
	}

	// 1. Check sensitive file paths for mutating tools
	if (
		targetPath &&
		(name === "write" ||
			name === "edit" ||
			name === "replace_file_content" ||
			name === "write_to_file" ||
			name === "delete" ||
			name.includes("write") ||
			name.includes("edit"))
	) {
		for (const { pattern, reason } of SENSITIVE_RESOURCE_PATTERNS) {
			if (pattern.test(targetPath)) {
				return { dangerLevel: "danger", riskReason: reason };
			}
		}
	}

	// 2. Check high danger command patterns
	if (commandStr) {
		for (const { pattern, reason } of HIGH_DANGER_COMMAND_PATTERNS) {
			if (pattern.test(commandStr)) {
				return { dangerLevel: "danger", riskReason: reason };
			}
		}
	}

	// 3. Check moderate risk command patterns
	if (commandStr) {
		for (const { pattern, reason } of MODERATE_RISK_COMMAND_PATTERNS) {
			if (pattern.test(commandStr)) {
				return { dangerLevel: "warning", riskReason: reason };
			}
		}
	}

	// 4. Mutation tools default to moderate risk
	if (
		name === "bash" ||
		name === "run_command" ||
		name === "write" ||
		name === "edit" ||
		name === "replace_file_content" ||
		name === "write_to_file"
	) {
		return {
			dangerLevel: "warning",
			riskReason: "Modifies workspace files or executes shell environment commands",
		};
	}

	return { dangerLevel: "safe" };
}
