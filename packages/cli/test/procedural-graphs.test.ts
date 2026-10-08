import { describe, expect, it } from "vitest";
import { type ExecutionDiagnosticTrace, type ProceduralEdge, ProceduralGraph } from "../../core/src/index.ts";

describe("Procedural Graphs: Self-Evolving Execution Structures", () => {
	it("constructs graph, localizes active node, and generates situational guidance", () => {
		const pg = new ProceduralGraph();

		pg.addNode({ id: "read_code", label: "Read Code", category: "tool" });
		pg.addNode({ id: "edit_code", label: "Edit Code", category: "tool" });
		pg.addNode({ id: "run_test", label: "Run Test", category: "tool" });

		const e1: ProceduralEdge = {
			source: "read_code",
			relation: "leads_to",
			target: "edit_code",
			attributes: {
				guidance: "Formulate concrete diffs after verifying file contents.",
				condition: "target file inspected in full",
				pitfalls: "Making blind assumptions without viewing code first.",
			},
		};

		const e2: ProceduralEdge = {
			source: "edit_code",
			relation: "verifies",
			target: "run_test",
			attributes: {
				guidance: "Execute targeted unit tests to verify modifications.",
				pitfalls: "Declaring completion before checking test results.",
			},
		};

		pg.addEdge(e1);
		pg.addEdge(e2);

		expect(pg.getAllNodes().length).toBe(3);
		expect(pg.getAllEdges().length).toBe(2);

		// Active node localization from recent steps
		const active = pg.localizeActiveNode(["ls", "read_code"]);
		expect(active.id).toBe("read_code");

		// Situational guidance extraction
		const guidance = pg.generateSituationalGuidance(["read_code"], 2);
		expect(guidance.activeNodeId).toBe("read_code");
		expect(guidance.recommendedNextProcedures.length).toBe(1);
		expect(guidance.recommendedNextProcedures[0].procedureId).toBe("edit_code");
		expect(guidance.pitfallsToAvoid).toContain("Making blind assumptions without viewing code first.");
		expect(guidance.pitfallsToAvoid).toContain("Declaring completion before checking test results.");
		expect(guidance.formattedPromptContext).toContain("Recommended next steps:");
		expect(guidance.formattedPromptContext).toContain("-> edit_code [leads_to]");
	});

	it("extracts multi-hop subgraphs correctly", () => {
		const pg = new ProceduralGraph({
			nodes: [
				{ id: "A", label: "Node A", category: "tool" },
				{ id: "B", label: "Node B", category: "tool" },
				{ id: "C", label: "Node C", category: "tool" },
				{ id: "D", label: "Node D", category: "tool" },
			],
			edges: [
				{ source: "A", relation: "leads_to", target: "B", attributes: { guidance: "step B" } },
				{ source: "B", relation: "leads_to", target: "C", attributes: { guidance: "step C" } },
				{ source: "C", relation: "leads_to", target: "D", attributes: { guidance: "step D" } },
			],
		});

		const sub1 = pg.extractSubgraph("A", 1);
		expect(sub1.length).toBe(1);
		expect(sub1[0].target).toBe("B");

		const sub2 = pg.extractSubgraph("A", 2);
		expect(sub2.length).toBe(2);
		expect(sub2.map((e) => e.target)).toEqual(["B", "C"]);
	});

	it("proposes topological refinements from failure traces and applies them", () => {
		const pg = new ProceduralGraph();
		pg.addNode({ id: "bash", label: "Run Bash Command", category: "tool" });

		// Simulate diagnostic trace where agent loops unproductive bash calls
		const trace: ExecutionDiagnosticTrace = {
			task: "build package",
			success: false,
			executedSteps: ["bash", "bash", "bash"],
			finalError: "Syntax error in build configuration file",
		};

		const proposals = pg.proposeRefinementsFromTrace(trace);
		expect(proposals.length).toBeGreaterThanOrEqual(1);

		// Repetition check should propose fallback edge
		const loopProposal = proposals.find((p) => p.edge?.relation === "fallback");
		expect(loopProposal).toBeDefined();
		expect(loopProposal?.edge?.target).toBe("inspect_or_verify");

		// Error check should propose error recovery refinement
		const errProposal = proposals.find((p) => p.edge?.relation === "refines");
		expect(errProposal).toBeDefined();
		expect(errProposal?.edge?.target).toBe("error_recovery");

		// Apply proposal to graph
		if (loopProposal) {
			pg.applyRefinement(loopProposal);
		}
		const updatedEdges = pg.getAllEdges();
		expect(updatedEdges.some((e) => e.relation === "fallback" && e.target === "inspect_or_verify")).toBe(true);
	});
});
