import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getShellConfig, getShellEnv, killProcessTree } from "./utils/shell.ts";

export type BackgroundTaskStatus = "running" | "completed" | "failed" | "killed";

export interface BackgroundTaskRecord {
	id: string;
	command: string;
	startedAt: number;
	endedAt?: number;
	status: BackgroundTaskStatus;
	exitCode?: number | null;
	logPath: string;
	pid?: number;
}

export class BackgroundTaskManager {
	private static instance: BackgroundTaskManager | null = null;
	private readonly tasks = new Map<string, { record: BackgroundTaskRecord; process?: ChildProcess }>();
	private readonly logDir: string;

	constructor(baseDir = "/tmp/pi-tasks") {
		this.logDir = baseDir;
		if (!existsSync(this.logDir)) {
			mkdirSync(this.logDir, { recursive: true });
		}
	}

	static getInstance(): BackgroundTaskManager {
		if (!BackgroundTaskManager.instance) {
			BackgroundTaskManager.instance = new BackgroundTaskManager();
		}
		return BackgroundTaskManager.instance;
	}

	spawn(command: string, cwd: string, options?: { env?: NodeJS.ProcessEnv }): BackgroundTaskRecord {
		const id = `task-${randomUUID().slice(0, 8)}`;
		const logPath = join(this.logDir, `${id}.log`);
		const shell = getShellConfig();
		const env = { ...getShellEnv(), ...(options?.env ?? {}) };

		const fd = openSync(logPath, "a");
		appendFileSync(logPath, `=== Task ${id} started at ${new Date().toISOString()} ===\n$ ${command}\n\n`);

		const child = spawn(shell.shell, [...shell.args, command], {
			cwd,
			env,
			detached: true,
			stdio: ["pipe", fd, fd],
		});

		const record: BackgroundTaskRecord = {
			id,
			command,
			startedAt: Date.now(),
			status: "running",
			logPath,
			pid: child.pid,
		};

		child.on("close", (code) => {
			closeSync(fd);
			record.endedAt = Date.now();
			record.exitCode = code;
			record.status = code === 0 ? "completed" : "failed";
		});

		child.on("error", (err) => {
			closeSync(fd);
			record.endedAt = Date.now();
			record.status = "failed";
			appendFileSync(logPath, `\n=== Process error: ${err.message} ===\n`);
		});

		this.tasks.set(id, { record, process: child });
		return record;
	}

	list(): BackgroundTaskRecord[] {
		return Array.from(this.tasks.values()).map((t) => ({ ...t.record }));
	}

	get(id: string): { record: BackgroundTaskRecord; recentOutput: string } | undefined {
		const entry = this.tasks.get(id);
		if (!entry) return undefined;

		let recentOutput = "";
		if (existsSync(entry.record.logPath)) {
			try {
				const full = readFileSync(entry.record.logPath, "utf-8");
				const lines = full.split("\n");
				recentOutput = lines.slice(-40).join("\n");
			} catch {}
		}

		return { record: { ...entry.record }, recentOutput };
	}

	async kill(id: string): Promise<boolean> {
		const entry = this.tasks.get(id);
		if (!entry || !entry.process || entry.record.status !== "running") {
			return false;
		}

		if (entry.record.pid) {
			await killProcessTree(entry.record.pid);
		} else {
			entry.process.kill("SIGTERM");
		}

		entry.record.status = "killed";
		entry.record.endedAt = Date.now();
		appendFileSync(entry.record.logPath, `\n=== Task killed by user/agent ===\n`);
		return true;
	}

	sendInput(id: string, input: string): boolean {
		const entry = this.tasks.get(id);
		if (!entry || !entry.process || !entry.process.stdin || entry.record.status !== "running") {
			return false;
		}
		entry.process.stdin.write(input.endsWith("\n") ? input : `${input}\n`);
		return true;
	}
}
