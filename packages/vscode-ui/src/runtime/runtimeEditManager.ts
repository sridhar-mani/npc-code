import * as vscode from "vscode";
import { WorkspaceContext } from "../context/workspace";

export interface WorkspaceCheckpoint {
	readonly id: string;
	readonly createdAt: number;
	readonly files: Map<string, { exists: boolean; content?: Uint8Array }>;
}

function normalizePath(path: string): string {
	return path.startsWith("file://") ? vscode.Uri.parse(path).fsPath : WorkspaceContext.toUri(path).fsPath;
}

export class WorkspaceCheckpointManager {
	private active?: WorkspaceCheckpoint;
	private readonly checkpoints = new Map<string, WorkspaceCheckpoint>();

	begin(id: string): WorkspaceCheckpoint {
		const checkpoint: WorkspaceCheckpoint = {
			id,
			createdAt: Date.now(),
			files: new Map(),
		};
		this.active = checkpoint;
		this.checkpoints.set(id, checkpoint);
		return checkpoint;
	}

	finish(id: string): WorkspaceCheckpoint | undefined {
		if (this.active?.id === id) this.active = undefined;
		return this.checkpoints.get(id);
	}

	get(id: string): WorkspaceCheckpoint | undefined {
		return this.checkpoints.get(id);
	}

	async capturePath(path: string): Promise<void> {
		if (!this.active || !path) return;
		const fsPath = normalizePath(path);
		if (this.active.files.has(fsPath)) return;
		const uri = vscode.Uri.file(fsPath);
		try {
			const content = await vscode.workspace.fs.readFile(uri);
			this.active.files.set(fsPath, { exists: true, content: new Uint8Array(content) });
		} catch {
			this.active.files.set(fsPath, { exists: false });
		}
	}

	async captureToolInput(toolName: string, input: unknown): Promise<void> {
		if (!this.active || !input || typeof input !== "object") return;
		const value = input as Record<string, unknown>;
		const paths = new Set<string>();

		const addPath = (candidate: unknown) => {
			if (typeof candidate === "string" && candidate.trim()) paths.add(candidate);
		};

		addPath(value.path);
		addPath(value.filePath);
		addPath(value.oldPath);
		addPath(value.newPath);
		addPath(value.destination);
		addPath(value.targetPath);

		if (Array.isArray(value.edits)) {
			for (const edit of value.edits) {
				if (edit && typeof edit === "object") addPath((edit as Record<string, unknown>).path);
			}
		}

		if (toolName.includes("rename") || toolName.includes("move")) {
			addPath(value.source);
			addPath(value.destination);
		}

		for (const path of paths) await this.capturePath(path);
	}

	async restore(id: string): Promise<boolean> {
		const checkpoint = this.checkpoints.get(id);
		if (!checkpoint) return false;
		for (const [fsPath, snapshot] of checkpoint.files) {
			const uri = vscode.Uri.file(fsPath);
			if (snapshot.exists) {
				await vscode.workspace.fs.writeFile(uri, snapshot.content ? new Uint8Array(snapshot.content) : new Uint8Array());
			} else {
				try {
					await vscode.workspace.fs.delete(uri, { useTrash: false, recursive: false });
				} catch {
					// File was already absent; nothing to restore.
				}
			}
		}
		return true;
	}

	clear(id?: string): void {
		if (!id) {
			this.checkpoints.clear();
			this.active = undefined;
			return;
		}
		this.checkpoints.delete(id);
		if (this.active?.id === id) this.active = undefined;
	}
}

export function extractMutationPaths(input: unknown): string[] {
	if (!input || typeof input !== "object") return [];
	const value = input as Record<string, unknown>;
	const result = new Set<string>();
	for (const key of ["path", "filePath", "oldPath", "newPath", "destination", "targetPath", "source"]) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim()) result.add(candidate);
	}
	if (Array.isArray(value.edits)) {
		for (const edit of value.edits) {
			if (edit && typeof edit === "object") {
				const candidate = (edit as Record<string, unknown>).path;
				if (typeof candidate === "string" && candidate.trim()) result.add(candidate);
			}
		}
	}
	return [...result];
}
