import * as vscode from "vscode";

export interface DiagnosticItem {
	file: string;
	severity: "error" | "warning" | "info";
	line: number;
	character: number;
	message: string;
}

export class DiagnosticsContext {
	static getDiagnostics(limit: number = 50): DiagnosticItem[] {
		const all = vscode.languages.getDiagnostics();
		const results: DiagnosticItem[] = [];

		for (const [uri, diags] of all) {
			if (diags.length === 0) continue;
			const file = vscode.workspace.asRelativePath(uri);
			for (const d of diags) {
				let severity: "error" | "warning" | "info" = "info";
				if (d.severity === vscode.DiagnosticSeverity.Error) severity = "error";
				else if (d.severity === vscode.DiagnosticSeverity.Warning) severity = "warning";

				results.push({
					file,
					severity,
					line: d.range.start.line + 1,
					character: d.range.start.character + 1,
					message: d.message,
				});

				if (results.length >= limit) return results;
			}
		}

		return results;
	}

	static formatDiagnosticsForPrompt(limit: number = 30): string {
		const diags = DiagnosticsContext.getDiagnostics(limit);
		if (diags.length === 0) return "No active errors or warnings detected in workspace.";

		return diags
			.map((d) => `[${d.severity.toUpperCase()}] ${d.file}:${d.line}:${d.character} - ${d.message}`)
			.join("\n");
	}
}
