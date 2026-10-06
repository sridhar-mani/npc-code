import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface ArtifactMetadata {
	summary: string;
	userFacing: boolean;
	requestFeedback: boolean;
}

export interface ArtifactRecord {
	name: string;
	path: string;
	metadata: ArtifactMetadata;
	createdAt: number;
	updatedAt: number;
}

export class ArtifactManager {
	private readonly artifactDir: string;

	constructor(cwd: string) {
		this.artifactDir = join(cwd, ".pi", "artifacts");
		if (!existsSync(this.artifactDir)) {
			mkdirSync(this.artifactDir, { recursive: true });
		}
	}

	saveArtifact(filename: string, content: string, metadata: Partial<ArtifactMetadata> = {}): ArtifactRecord {
		const safeName = basename(filename);
		const filePath = join(this.artifactDir, safeName);
		const metaPath = join(this.artifactDir, `${safeName}.meta.json`);

		const finalMetadata: ArtifactMetadata = {
			summary: metadata.summary || safeName,
			userFacing: metadata.userFacing ?? true,
			requestFeedback: metadata.requestFeedback ?? false,
		};

		const now = Date.now();
		let createdAt = now;
		if (existsSync(metaPath)) {
			try {
				const existing = JSON.parse(readFileSync(metaPath, "utf-8"));
				if (existing.createdAt) createdAt = existing.createdAt;
			} catch {}
		}

		writeFileSync(filePath, content, "utf-8");
		writeFileSync(
			metaPath,
			JSON.stringify(
				{
					name: safeName,
					metadata: finalMetadata,
					createdAt,
					updatedAt: now,
				},
				null,
				2,
			),
			"utf-8",
		);

		return {
			name: safeName,
			path: filePath,
			metadata: finalMetadata,
			createdAt,
			updatedAt: now,
		};
	}

	getArtifact(filename: string): { record: ArtifactRecord; content: string } | undefined {
		const safeName = basename(filename);
		const filePath = join(this.artifactDir, safeName);
		const metaPath = join(this.artifactDir, `${safeName}.meta.json`);

		if (!existsSync(filePath)) return undefined;

		const content = readFileSync(filePath, "utf-8");
		let metadata: ArtifactMetadata = { summary: safeName, userFacing: true, requestFeedback: false };
		let createdAt = Date.now();
		let updatedAt = Date.now();

		if (existsSync(metaPath)) {
			try {
				const parsed = JSON.parse(readFileSync(metaPath, "utf-8"));
				if (parsed.metadata) metadata = parsed.metadata;
				if (parsed.createdAt) createdAt = parsed.createdAt;
				if (parsed.updatedAt) updatedAt = parsed.updatedAt;
			} catch {}
		}

		return {
			record: {
				name: safeName,
				path: filePath,
				metadata,
				createdAt,
				updatedAt,
			},
			content,
		};
	}

	listArtifacts(): ArtifactRecord[] {
		if (!existsSync(this.artifactDir)) return [];
		const files = readdirSync(this.artifactDir);
		const records: ArtifactRecord[] = [];

		for (const file of files) {
			if (file.endsWith(".meta.json")) continue;
			const metaPath = join(this.artifactDir, `${file}.meta.json`);
			let metadata: ArtifactMetadata = { summary: file, userFacing: true, requestFeedback: false };
			let createdAt = Date.now();
			let updatedAt = Date.now();

			if (existsSync(metaPath)) {
				try {
					const parsed = JSON.parse(readFileSync(metaPath, "utf-8"));
					if (parsed.metadata) metadata = parsed.metadata;
					if (parsed.createdAt) createdAt = parsed.createdAt;
					if (parsed.updatedAt) updatedAt = parsed.updatedAt;
				} catch {}
			}

			records.push({
				name: file,
				path: join(this.artifactDir, file),
				metadata,
				createdAt,
				updatedAt,
			});
		}

		return records;
	}
}
