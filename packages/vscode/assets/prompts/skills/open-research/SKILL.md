---
name: open-research
description: Conduct autonomous multi-source academic, technical, and open-web research using ArXiv, Wikipedia, and web endpoints. Use for architecture investigations, algorithm discovery, literature review, and synthesizing citations into structured research dossiers.
argument-hint: What topic, paper, library, or algorithm do you want to research?
user-invocable: true
disable-model-invocation: false
---

# Open Research

## Purpose

Autonomous multi-source research workflow that discovers academic papers, technical documentation, and encyclopedic references, extracting primary citations and synthesizing actionable research dossiers.

Use this skill when:
- Investigating algorithms, academic papers, or protocol specifications
- Evaluating competing technical libraries, architectural patterns, or frameworks
- Researching API specs, RFCs, or formal models
- Compiling structured technical dossiers with validated primary sources

## Research Tool Integration

When conducting open research, call the available research tools:
1. `vscode_open_research`: Executes a federated multi-source search query across ArXiv, Wikipedia, and open web endpoints with automatic deduplication, scoring, and synthesized key findings.
   - `query`: Focused keywords (e.g., `"MCTS tree search context pruning"`, `"raft consensus invariants"`).
   - `sources`: Optional subset `["arxiv", "wikipedia", "web"]`.
   - `maxResults`: Total entries per source (1 to 10).
2. Direct URL and web inspection tools (`read_url_content`, `search_web`, `fetch`): Retrieve complete whitepapers, documentation pages, and GitHub markdown specifications.

## Autonomous Research Procedure

Follow this 4-stage loop:

### Stage 1: Problem Decomposition & Query Generation
1. Extract core technical concepts from the user's objective.
2. Formulate 2 to 4 orthogonal queries:
   - Theoretical / Academic: `"formal specification <concept> arxiv"`
   - Implementation / Technical: `"<technology> architecture benchmark github"`
   - Contextual / Encyclopedic: `"<term> overview wikipedia"`

### Stage 2: Federated Information Gathering
1. Invoke `vscode_open_research` with the decomposed queries.
2. Collect the resulting sources, URLs, and snippets.
3. If specific papers or documentation pages contain high-signal content, inspect the target URLs directly to extract exact formulas, benchmark figures, or architecture patterns.

### Stage 3: Synthesis & Verification
1. Cross-reference claims across multiple independent sources.
2. Filter out promotional claims; focus on verified constraints, benchmark numbers, complexity bounds, and interface definitions.
3. Identify actionable implementation decisions directly applicable to the codebase.

### Stage 4: Dossier Compilation
Format the final findings as a structured research dossier:

```markdown
# Research Dossier: <Topic>

## Executive Summary
Concise synthesis of the state-of-the-art and direct relevance to the project.

## Key Technical Findings
- Finding 1 with verified rationale
- Finding 2 with concrete operational trade-offs

## Primary Sources & Citations
- [<Paper/Spec Title>](<URL>) - Key contribution and relevant section.

## Architecture & Implementation Recommendations
Actionable steps to apply in the codebase.
```

## Token Optimization Rules
- Do not dump entire fetched HTML pages into context.
- Extract only pertinent sections, function signatures, or mathematical formulas.
- Compact intermediate findings before generating final code or PRs.
