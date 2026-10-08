/**
 * ArchitectureVisualizer: Automated Mermaid Flowchart & Dependency Diff Generator.
 *
 * Generates Mermaid markdown diagrams directly from code symbols, tool traces,
 * and workspace changes:
 * 1. Component dependency graphs (flowchart TD/LR)
 * 2. Agent tool call sequences (sequenceDiagram)
 * 3. Class/Interface structure (classDiagram)
 * 4. Architectural diff highlighting added/modified modules
 */

export interface ComponentNode {
	id: string;
	label: string;
	type?: "module" | "class" | "database" | "service";
	isModified?: boolean;
}

export interface ComponentEdge {
	from: string;
	to: string;
	label?: string;
	style?: "normal" | "dotted";
}

export interface ToolCallTrace {
	turnIndex: number;
	toolName: string;
	summary: string;
	status: "success" | "error";
}

export class ArchitectureVisualizer {
	defaultDirection: "TD" | "LR";

	constructor(defaultDirection: "TD" | "LR" = "TD") {
		this.defaultDirection = defaultDirection;
	}

	/**
	 * Generates a Mermaid flowchart representing component architecture and relationships.
	 */
	generateComponentFlowchart(nodes: ComponentNode[], edges: ComponentEdge[], direction?: "TD" | "LR"): string {
		const dir = direction ?? this.defaultDirection;
		const lines: string[] = [];
		lines.push("```mermaid");
		lines.push(`flowchart ${dir}`);

		for (const node of nodes) {
			const sanitizedLabel = node.label.replace(/"/g, "'");
			if (node.type === "database") {
				lines.push(`  ${node.id}[("${sanitizedLabel}")]`);
			} else {
				lines.push(`  ${node.id}["${sanitizedLabel}"]`);
			}
		}

		for (const edge of edges) {
			const arrow = edge.style === "dotted" ? "-.->" : "-->";
			if (edge.label) {
				lines.push(`  ${edge.from} ${arrow}|${edge.label}| ${edge.to}`);
			} else {
				lines.push(`  ${edge.from} ${arrow} ${edge.to}`);
			}
		}

		// Highlight modified components
		const modifiedNodes = nodes.filter((n) => n.isModified);
		if (modifiedNodes.length > 0) {
			lines.push("");
			for (const mod of modifiedNodes) {
				lines.push(`  style ${mod.id} fill:#d4edda,stroke:#28a745,stroke-width:2px`);
			}
		}

		lines.push("```");
		return lines.join("\n");
	}

	/**
	 * Generates a Mermaid sequence diagram representing agent interactions and tool invocations.
	 */
	generateExecutionSequence(traces: ToolCallTrace[]): string {
		const lines: string[] = [];
		lines.push("```mermaid");
		lines.push("sequenceDiagram");
		lines.push("  autonumber");
		lines.push("  actor User");
		lines.push("  participant Agent as npc-code Engine");
		lines.push("  participant Tools as Tool Runtime");

		lines.push("  User->>Agent: Execute Task");

		for (const trace of traces) {
			const note = trace.summary.replace(/"/g, "'");
			lines.push(`  Agent->>Tools: ${trace.toolName}()`);
			if (trace.status === "success") {
				lines.push(`  Tools-->>Agent: Result OK (${note})`);
			} else {
				lines.push(`  Tools-->>Agent: Error (${note})`);
			}
		}

		lines.push("  Agent-->>User: Complete Response");
		lines.push("```");
		return lines.join("\n");
	}

	/**
	 * Generates a Mermaid class diagram representing extracted classes and methods.
	 */
	generateClassDiagram(classes: Array<{ name: string; methods: string[]; fields: string[] }>): string {
		const lines: string[] = [];
		lines.push("```mermaid");
		lines.push("classDiagram");

		for (const cls of classes) {
			lines.push(`  class ${cls.name} {`);
			for (const f of cls.fields) {
				lines.push(`    +${f}`);
			}
			for (const m of cls.methods) {
				lines.push(`    +${m}()`);
			}
			lines.push("  }");
		}

		lines.push("```");
		return lines.join("\n");
	}
}
