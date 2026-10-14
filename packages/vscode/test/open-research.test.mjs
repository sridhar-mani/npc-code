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
