import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenResearchEngine, createOpenResearchTool } from '../../core/src/index.ts';

test('OpenResearchEngine formats structured research dossiers correctly', () => {
	const engine = new OpenResearchEngine();
	const mockResult = {
		query: 'Procedural Graphs in LLM Agents',
		sources: [
			{
				title: 'Procedural Graphs: Self-Evolving Execution Structures',
				url: 'https://arxiv.org/abs/2601.12345',
				snippet: 'Attributed execution graphs guide LLM reasoning and edge recovery.',
				source: 'arxiv',
			},
			{
				title: 'Graph Execution Topology',
				url: 'https://en.wikipedia.org/wiki/Directed_graph',
				snippet: 'A directed graph is a set of vertices connected by directed edges.',
				source: 'wikipedia',
			},
		],
		summary: 'Found 2 relevant reference(s) across arxiv, wikipedia.',
		keyFindings: [
			'[ARXIV] Procedural Graphs: Attributed execution graphs guide LLM reasoning...',
			'[WIKIPEDIA] Graph Execution Topology: A directed graph is a set of vertices...',
		],
		suggestedNextSteps: [
			'Inspect primary citations from returned URLs',
			'Use vscode_fetch_url to download full text of high-relevance papers/articles',
			'Apply validated architectural findings directly into project source files',
		],
	};

	const md = engine.formatMarkdown(mockResult);
	assert.ok(md.includes('# Research Dossier: Procedural Graphs in LLM Agents'));
	assert.ok(md.includes('Procedural Graphs: Self-Evolving Execution Structures'));
	assert.ok(md.includes('https://arxiv.org/abs/2601.12345'));
	assert.ok(md.includes('## Key Insights & Snippets'));
	assert.ok(md.includes('## Recommended Actions'));
});

test('createOpenResearchTool produces a valid agent ToolDefinition', async () => {
	const engine = new OpenResearchEngine();
	const tool = createOpenResearchTool(engine);

	assert.equal(tool.name, 'open_research');
	assert.equal(tool.label, 'Open Research');
	assert.ok(tool.description.includes('autonomous research'));
	assert.ok(typeof tool.execute === 'function');
});

test('open-research skill manifests exist and parse cleanly', async () => {
	const { readFileSync, existsSync } = await import('node:fs');
	const { resolve } = await import('node:path');

	const locations = [
		resolve('packages/vscode/assets/prompts/skills/open-research/SKILL.md'),
		resolve('.npc/skills/open-research/SKILL.md'),
		resolve('.agents/skills/open-research/SKILL.md'),
	];

	for (const loc of locations) {
		assert.ok(existsSync(loc), `Skill file must exist at ${loc}`);
		const content = readFileSync(loc, 'utf-8');
		assert.ok(content.startsWith('---'), `Skill file at ${loc} must start with YAML frontmatter`);
		assert.ok(content.includes('name: open-research'), `Skill name must be open-research in ${loc}`);
		assert.ok(content.includes('description:'), `Skill description must be present in ${loc}`);
		assert.ok(content.includes('# Open Research'), `Skill heading must be present in ${loc}`);
		assert.ok(content.includes('vscode_open_research'), `Skill must document vscode_open_research tool in ${loc}`);
	}
});

test('createVsCodeTools contract exposes frontier research tools', async () => {
	const { readFileSync } = await import('node:fs');
	const { resolve } = await import('node:path');
	const { ProceduralGraph, ContinuousAstDependencyGraph } = await import('../../core/src/index.ts');

	// Verify ProceduralGraph situational guidance
	const graph = new ProceduralGraph();
	graph.addNode({ id: 'localize', label: 'Localize Defect', category: 'reasoning' });
	graph.addNode({ id: 'patch', label: 'Apply Patch', category: 'tool' });
	graph.addEdge({
		source: 'localize',
		relation: 'leads_to',
		target: 'patch',
		attributes: { guidance: 'Apply minimal focused edits.' },
	});
	const guidance = graph.generateSituationalGuidance(['localize'], 2);
	assert.ok(guidance.formattedPromptContext.includes('Procedural Guidance'));
	assert.equal(guidance.recommendedNextProcedures[0].procedureId, 'patch');

	// Verify ContinuousAstDependencyGraph caller extraction
	const astGraph = new ContinuousAstDependencyGraph();
	astGraph.indexFile('test.ts', 'export function helper() {}\nexport function caller() { helper(); }');
	const radius = astGraph.getImpactRadius('test.ts', 'helper');
	assert.equal(radius.targetFile, 'test.ts');
	assert.ok(radius.directCallers.length > 0);

	// Verify tools registration contract in vscode-tools.ts
	const toolsSource = readFileSync(resolve('packages/vscode/src/tools/vscode-tools.ts'), 'utf-8');
	assert.ok(toolsSource.includes('name: "vscode_open_research"'));
	assert.ok(toolsSource.includes('name: "vscode_procedural_guidance"'));
	assert.ok(toolsSource.includes('name: "vscode_ast_impact_radius"'));
	assert.ok(toolsSource.includes('name: "vscode_action_fusion"'));
});

