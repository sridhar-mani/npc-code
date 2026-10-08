/**
 * Procedural Graphs: Self-Evolving Execution Structures for LLM Agents.
 * Reference: Lu et al., "Procedural Graphs: Self-Evolving Execution Structures for LLM Agents" (arXiv:2609.09153).
 *
 * Implements:
 * 1. Triplet representation: (procedure, relation, procedure) with typed attributes
 *    (condition, guidance, pitfalls).
 * 2. Active node localizer matching recent agent steps/tool execution.
 * 3. k-hop Subgraph extractor & step-level Situational Guidance generator.
 * 4. Offline topological refiner proposing node/edge additions, attribute updates, and pruning.
 */

export type ProceduralRelation = "leads_to" | "requires" | "fallback" | "verifies" | "refines" | "extracts_to";

export interface EdgeAttributes {
	condition?: string;
	guidance: string;
	pitfalls?: string;
}

export interface ProceduralEdge {
	source: string;
	relation: ProceduralRelation;
	target: string;
	attributes: EdgeAttributes;
}

export interface ProceduralNode {
	id: string;
	label: string;
	category: "tool" | "reasoning" | "status" | "skill";
	description?: string;
}

export interface ProceduralGraphData {
	nodes: ProceduralNode[];
	edges: ProceduralEdge[];
}

export interface SituationalGuidance {
	activeNodeId: string;
	recommendedNextProcedures: Array<{
		procedureId: string;
		relation: ProceduralRelation;
		guidance: string;
		condition?: string;
	}>;
	pitfallsToAvoid: string[];
	formattedPromptContext: string;
}

export interface ExecutionDiagnosticTrace {
	task: string;
	success: boolean;
	executedSteps: string[];
	finalError?: string;
}

export interface GraphRefinementProposal {
	action: "add_edge" | "remove_edge" | "add_node" | "update_attributes";
	edge?: ProceduralEdge;
	node?: ProceduralNode;
	reason: string;
}

export class ProceduralGraph {
	private nodes: Map<string, ProceduralNode> = new Map();
	private edges: ProceduralEdge[] = [];

	constructor(initialData?: ProceduralGraphData) {
		if (initialData) {
			for (const node of initialData.nodes) {
				this.addNode(node);
			}
			for (const edge of initialData.edges) {
				this.addEdge(edge);
			}
		}
	}

	addNode(node: ProceduralNode): void {
		this.nodes.set(node.id, node);
	}

	getNode(id: string): ProceduralNode | undefined {
		return this.nodes.get(id);
	}

	getAllNodes(): ProceduralNode[] {
		return Array.from(this.nodes.values());
	}

	addEdge(edge: ProceduralEdge): void {
		if (!this.nodes.has(edge.source)) {
			this.addNode({ id: edge.source, label: edge.source, category: "tool" });
		}
		if (!this.nodes.has(edge.target)) {
			this.addNode({ id: edge.target, label: edge.target, category: "tool" });
		}
		// Avoid exact duplicate edges
		const exists = this.edges.some(
			(e) => e.source === edge.source && e.relation === edge.relation && e.target === edge.target,
		);
		if (!exists) {
			this.edges.push(edge);
		}
	}

	removeEdge(source: string, relation: ProceduralRelation, target: string): boolean {
		const prevLen = this.edges.length;
		this.edges = this.edges.filter((e) => !(e.source === source && e.relation === relation && e.target === target));
		return this.edges.length < prevLen;
	}

	getAllEdges(): ProceduralEdge[] {
		return [...this.edges];
	}

	/**
	 * Localizes the active node given the recent trajectory step names or tool calls.
	 * Matches against node IDs or tool names.
	 */
	localizeActiveNode(recentSteps: string[]): ProceduralNode {
		if (recentSteps.length > 0) {
			for (let i = recentSteps.length - 1; i >= 0; i--) {
				const step = recentSteps[i].toLowerCase();
				for (const [id, node] of this.nodes.entries()) {
					if (step.includes(id.toLowerCase()) || id.toLowerCase().includes(step)) {
						return node;
					}
				}
			}
		}
		// Default fallback to first node or start status node
		const startNode = this.nodes.get("start") ?? this.nodes.values().next().value;
		return (
			startNode ?? {
				id: "start",
				label: "Start",
				category: "status",
			}
		);
	}

	/**
	 * Extracts a k-hop forward subgraph from an active node.
	 */
	extractSubgraph(startNodeId: string, maxHops: number = 2): ProceduralEdge[] {
		const visitedNodes = new Set<string>([startNodeId]);
		let currentFrontier = new Set<string>([startNodeId]);
		const extractedEdges: ProceduralEdge[] = [];

		for (let hop = 0; hop < maxHops; hop++) {
			const nextFrontier = new Set<string>();
			for (const edge of this.edges) {
				if (currentFrontier.has(edge.source)) {
					extractedEdges.push(edge);
					if (!visitedNodes.has(edge.target)) {
						visitedNodes.add(edge.target);
						nextFrontier.add(edge.target);
					}
				}
			}
			currentFrontier = nextFrontier;
			if (currentFrontier.size === 0) break;
		}

		return extractedEdges;
	}

	/**
	 * Generates step-level situational guidance biasing the solver's next actions.
	 */
	generateSituationalGuidance(recentSteps: string[], maxHops: number = 2): SituationalGuidance {
		const activeNode = this.localizeActiveNode(recentSteps);
		const subEdges = this.extractSubgraph(activeNode.id, maxHops);

		const outgoing = subEdges.filter((e) => e.source === activeNode.id);
		const recommendedNextProcedures = outgoing.map((e) => ({
			procedureId: e.target,
			relation: e.relation,
			guidance: e.attributes.guidance,
			condition: e.attributes.condition,
		}));

		const pitfallsToAvoid: string[] = [];
		for (const e of subEdges) {
			if (e.attributes.pitfalls && !pitfallsToAvoid.includes(e.attributes.pitfalls)) {
				pitfallsToAvoid.push(e.attributes.pitfalls);
			}
		}

		let formattedPromptContext = `[Procedural Guidance: Current State = ${activeNode.label}]\n`;
		if (recommendedNextProcedures.length > 0) {
			formattedPromptContext += "Recommended next steps:\n";
			for (const rec of recommendedNextProcedures) {
				const condStr = rec.condition ? ` (when ${rec.condition})` : "";
				formattedPromptContext += `- -> ${rec.procedureId} [${rec.relation}]${condStr}: ${rec.guidance}\n`;
			}
		} else {
			formattedPromptContext += "- Proceed with task verification or completion.\n";
		}

		if (pitfallsToAvoid.length > 0) {
			formattedPromptContext += "Pitfalls to avoid:\n";
			for (const pitfall of pitfallsToAvoid) {
				formattedPromptContext += `- ${pitfall}\n`;
			}
		}

		return {
			activeNodeId: activeNode.id,
			recommendedNextProcedures,
			pitfallsToAvoid,
			formattedPromptContext: formattedPromptContext.trim(),
		};
	}

	/**
	 * Offline evolution refiner:
	 * Compares failed execution traces with graph transitions to propose topology edits.
	 */
	proposeRefinementsFromTrace(trace: ExecutionDiagnosticTrace): GraphRefinementProposal[] {
		const proposals: GraphRefinementProposal[] = [];
		if (trace.success) {
			return proposals;
		}

		// Check if the agent looped or repeated unproductive actions
		const stepCounts = new Map<string, number>();
		for (const step of trace.executedSteps) {
			stepCounts.set(step, (stepCounts.get(step) ?? 0) + 1);
		}

		for (const [step, count] of stepCounts.entries()) {
			if (count >= 3) {
				// High repetition detected: propose adding a fallback or verification edge
				proposals.push({
					action: "add_edge",
					edge: {
						source: step,
						relation: "fallback",
						target: "inspect_or_verify",
						attributes: {
							condition: `after repeating ${step} without progress`,
							guidance: "Switch to verifying environment state or diagnostics instead of retrying identically.",
							pitfalls: `Infinite retry loops on ${step}`,
						},
					},
					reason: `Step ${step} repeated ${count} times leading to failure.`,
				});
			}
		}

		// If there is an unhandled final error, suggest a refinement edge from the last step
		if (trace.finalError && trace.executedSteps.length > 0) {
			const lastStep = trace.executedSteps[trace.executedSteps.length - 1];
			proposals.push({
				action: "add_edge",
				edge: {
					source: lastStep,
					relation: "refines",
					target: "error_recovery",
					attributes: {
						condition: "error detected in execution output",
						guidance: `Recover from error: ${trace.finalError.slice(0, 80)}`,
						pitfalls: "Ignoring terminal error signals",
					},
				},
				reason: `Failure terminated at ${lastStep} with error "${trace.finalError.slice(0, 50)}".`,
			});
		}

		return proposals;
	}

	/**
	 * Applies an accepted refinement proposal to update graph topology or attributes.
	 */
	applyRefinement(proposal: GraphRefinementProposal): void {
		if (proposal.action === "add_node" && proposal.node) {
			this.addNode(proposal.node);
		} else if (proposal.action === "add_edge" && proposal.edge) {
			this.addEdge(proposal.edge);
		} else if (proposal.action === "remove_edge" && proposal.edge) {
			this.removeEdge(proposal.edge.source, proposal.edge.relation, proposal.edge.target);
		} else if (proposal.action === "update_attributes" && proposal.edge) {
			const existing = this.edges.find(
				(e) =>
					e.source === proposal.edge!.source &&
					e.relation === proposal.edge!.relation &&
					e.target === proposal.edge!.target,
			);
			if (existing) {
				existing.attributes = { ...existing.attributes, ...proposal.edge.attributes };
			}
		}
	}

	toJSON(): ProceduralGraphData {
		return {
			nodes: this.getAllNodes(),
			edges: this.getAllEdges(),
		};
	}
}
