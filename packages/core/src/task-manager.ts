import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const TASKS_FILE_NAME = "tasks.json";
export const TASKS_DIR_NAME = ".pi";

export type TaskStatus = "backlog" | "todo" | "in_progress" | "review" | "done" | "blocked";
export type TaskPriority = "low" | "medium" | "high";

export const TASK_STATUSES: TaskStatus[] = ["backlog", "todo", "in_progress", "review", "done", "blocked"];

export interface TaskRecord {
	id: string;
	title: string;
	description?: string;
	status: TaskStatus;
	priority: TaskPriority;
	assignee?: string;
	parentTaskId?: string;
	dependsOn?: string[];
	createdAt: number;
	updatedAt: number;
	metadata?: Record<string, unknown>;
}

export interface TaskFile {
	version: 1;
	tasks: TaskRecord[];
}

export interface CreateTaskInput {
	title: string;
	description?: string;
	status?: TaskStatus;
	priority?: TaskPriority;
	assignee?: string;
	parentTaskId?: string;
	dependsOn?: string[];
	metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
	title?: string;
	description?: string;
	status?: TaskStatus;
	priority?: TaskPriority;
	assignee?: string | null;
	parentTaskId?: string | null;
	dependsOn?: string[];
	metadata?: Record<string, unknown>;
}

function normalizeTaskTitle(title: string): string {
	const normalized = title.trim().replace(/\s+/g, " ");
	if (!normalized) throw new Error("Task title is required.");
	if (normalized.length > 240) return normalized.slice(0, 237) + "...";
	return normalized;
}

function normalizeTaskFile(value: unknown): TaskFile {
	if (!value || typeof value !== "object") return { version: 1, tasks: [] };
	const input = value as Partial<TaskFile>;
	if (!Array.isArray(input.tasks)) return { version: 1, tasks: [] };

	const tasks = input.tasks
		.filter((task): task is TaskRecord => Boolean(task && typeof task === "object"))
		.map((task) => ({
			...task,
			id: typeof task.id === "string" && task.id ? task.id : randomUUID(),
			title: normalizeTaskTitle(typeof task.title === "string" ? task.title : "Untitled task"),
			status: TASK_STATUSES.includes(task.status) ? task.status : "todo",
			priority: task.priority === "low" || task.priority === "high" ? task.priority : "medium",
			createdAt: typeof task.createdAt === "number" ? task.createdAt : Date.now(),
			updatedAt: typeof task.updatedAt === "number" ? task.updatedAt : Date.now(),
			...(Array.isArray(task.dependsOn) ? { dependsOn: task.dependsOn.filter((id) => typeof id === "string") } : {}),
		}));
	return { version: 1, tasks };
}

/**
 * Small file-backed task store shared by the Ziq UI and agent tools.
 *
 * Tasks intentionally live outside conversation transcripts. This keeps planning
 * state useful across sessions, compactions, and multiple child agents.
 */
export class TaskManager {
	readonly filePath: string;

	private constructor(readonly cwd: string) {
		this.filePath = join(cwd, TASKS_DIR_NAME, TASKS_FILE_NAME);
	}

	static forCwd(cwd: string): TaskManager {
		return new TaskManager(cwd);
	}

	list(): TaskRecord[] {
		return this.read().tasks
			.slice()
			.sort((a, b) => a.createdAt - b.createdAt);
	}

	get(id: string): TaskRecord | undefined {
		return this.read().tasks.find((task) => task.id === id);
	}

	create(input: CreateTaskInput): TaskRecord {
		const now = Date.now();
		const task: TaskRecord = {
			id: randomUUID(),
			title: normalizeTaskTitle(input.title),
			description: input.description?.trim() || undefined,
			status: input.status ?? "todo",
			priority: input.priority ?? "medium",
			assignee: input.assignee?.trim() || undefined,
			parentTaskId: input.parentTaskId,
			dependsOn: input.dependsOn?.filter(Boolean),
			createdAt: now,
			updatedAt: now,
			metadata: input.metadata,
		};
		const file = this.read();
		file.tasks.push(task);
		this.write(file);
		return task;
	}

	update(id: string, input: UpdateTaskInput): TaskRecord {
		const file = this.read();
		const task = file.tasks.find((item) => item.id === id);
		if (!task) throw new Error(`Task not found: ${id}`);

		if (input.title !== undefined) task.title = normalizeTaskTitle(input.title);
		if (input.description !== undefined) task.description = input.description.trim() || undefined;
		if (input.status !== undefined) task.status = input.status;
		if (input.priority !== undefined) task.priority = input.priority;
		if (input.assignee !== undefined) task.assignee = input.assignee?.trim() || undefined;
		if (input.parentTaskId !== undefined) task.parentTaskId = input.parentTaskId || undefined;
		if (input.dependsOn !== undefined) task.dependsOn = input.dependsOn.filter(Boolean);
		if (input.metadata !== undefined) task.metadata = input.metadata;
		task.updatedAt = Date.now();
		this.write(file);
		return task;
	}

	remove(id: string): boolean {
		const file = this.read();
		const original = file.tasks.length;
		file.tasks = file.tasks.filter((task) => task.id !== id);
		if (file.tasks.length === original) return false;

		for (const task of file.tasks) {
			if (task.parentTaskId === id) task.parentTaskId = undefined;
			if (task.dependsOn?.includes(id)) {
				task.dependsOn = task.dependsOn.filter((dependency) => dependency !== id);
			}
		}
		this.write(file);
		return true;
	}

	private read(): TaskFile {
		if (!existsSync(this.filePath)) return { version: 1, tasks: [] };
		try {
			return normalizeTaskFile(JSON.parse(readFileSync(this.filePath, "utf8")));
		} catch {
			return { version: 1, tasks: [] };
		}
	}

	private write(file: TaskFile): void {
		mkdirSync(join(this.cwd, TASKS_DIR_NAME), { recursive: true });
		const tmpPath = this.filePath + ".tmp";
		writeFileSync(tmpPath, JSON.stringify({ version: 1, tasks: file.tasks }, null, 2) + "\n", "utf8");
		renameSync(tmpPath, this.filePath);
	}
}
