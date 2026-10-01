/**
 * packages/core/src/personalization/convention-store.ts
 *
 * Persistent Convention and Preference Storage (P-PLUG) for Pi.
 *
 * Persists developer preferences, project conventions, and learned rules
 * across sessions to eliminate repetitive steering.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ConventionTier = "preference" | "custom_rule" | "semantic" | "workflow";

export interface ConventionItem {
	readonly id: string;
	readonly tier: ConventionTier;
	readonly category: string;
	readonly content: string;
	readonly confidence: number;
	readonly accessCount: number;
	readonly repoOrigin?: string;
	readonly isEnabled: boolean;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly metadata?: Record<string, unknown>;
}

export interface ConventionStoreOptions {
	readonly storagePath?: string;
	readonly workspaceDir?: string;
}

export class ConventionStore {
	private readonly storagePath: string;
	private items: Map<string, ConventionItem> = new Map();

	constructor(options?: ConventionStoreOptions) {
		if (options?.storagePath) {
			this.storagePath = options.storagePath;
		} else if (options?.workspaceDir) {
			this.storagePath = path.join(options.workspaceDir, ".pi/conventions.json");
		} else {
			this.storagePath = path.join(os.homedir(), ".config/pi/conventions.json");
		}
		this.load();
	}

	private load(): void {
		if (!fs.existsSync(this.storagePath)) {
			return;
		}
		try {
			const raw = fs.readFileSync(this.storagePath, "utf8");
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					if (
						item &&
						typeof item === "object" &&
						typeof item.id === "string" &&
						typeof item.content === "string"
					) {
						this.items.set(item.id, {
							id: item.id,
							tier: item.tier ?? "preference",
							category: item.category ?? "general",
							content: item.content,
							confidence: typeof item.confidence === "number" ? item.confidence : 1.0,
							accessCount: typeof item.accessCount === "number" ? item.accessCount : 0,
							repoOrigin: item.repoOrigin,
							isEnabled: item.isEnabled !== false,
							createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
							updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
							metadata: item.metadata,
						});
					}
				}
			}
		} catch {
			// Fallback on corrupt file
		}
	}

	public save(): void {
		try {
			const dir = path.dirname(this.storagePath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			const data = Array.from(this.items.values());
			fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), "utf8");
		} catch {
			// Non-fatal write failure
		}
	}

	public get(id: string): ConventionItem | undefined {
		return this.items.get(id);
	}

	public getAll(filter?: { tier?: ConventionTier; isEnabled?: boolean }): readonly ConventionItem[] {
		let list = Array.from(this.items.values());
		if (filter?.tier) {
			list = list.filter((i) => i.tier === filter.tier);
		}
		if (filter?.isEnabled !== undefined) {
			list = list.filter((i) => i.isEnabled === filter.isEnabled);
		}
		return list;
	}

	public set(
		item: Omit<ConventionItem, "id" | "createdAt" | "updatedAt" | "accessCount" | "confidence" | "isEnabled"> & {
			id?: string;
			confidence?: number;
			isEnabled?: boolean;
		},
	): ConventionItem {
		const existing = item.id ? this.items.get(item.id) : undefined;
		const now = Date.now();
		const id = item.id ?? `conv-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

		const fullItem: ConventionItem = {
			id,
			tier: item.tier,
			category: item.category,
			content: item.content,
			confidence: item.confidence ?? 1.0,
			accessCount: existing ? existing.accessCount + 1 : 0,
			repoOrigin: item.repoOrigin ?? existing?.repoOrigin,
			isEnabled: item.isEnabled !== false,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
			metadata: item.metadata ?? existing?.metadata,
		};

		this.items.set(id, fullItem);
		this.save();
		return fullItem;
	}

	public delete(id: string): boolean {
		const deleted = this.items.delete(id);
		if (deleted) {
			this.save();
		}
		return deleted;
	}

	public recordAccess(id: string): void {
		const item = this.items.get(id);
		if (item) {
			this.items.set(id, {
				...item,
				accessCount: item.accessCount + 1,
				updatedAt: Date.now(),
			});
			this.save();
		}
	}
}
