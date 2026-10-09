<p align="center">
  <img alt="NPC Code logo" src="assets/logo.png" width="144">
</p>

# NPC Code (`npc-code`)

Autonomous coding agent monorepo designed for terminal CLI, VS Code extension, and protected builds.

- **[@npc/cli](packages/cli)**: Standalone terminal coding agent CLI (`npc`)
- **[npc-vscode](packages/vscode)**: Streamlined VS Code extension
- **[@npc/core](packages/core)**: Core agent runtime with tool execution, session management, and model routing

---

## Key Capabilities & Advanced Features

### 1. Isolated Git Worktrees (`WorktreeManager`)

- **Zero-Conflict Session Isolation**: Concurrent prompts and subagent tasks run in isolated, ephemeral git worktrees without mutating the developer's active working tree.
- **Automated Merging**: Safe merge-back into the active workspace branch once changes are verified, complete with automatic cleanup.

### 2. Switchyard Multi-Model Architecture

- **Dynamic Task Routing**: Automatically routes tasks based on computational complexity.
  - **Full Mode**: Automatic continuous routing between efficient and capable models.
  - **Lite Mode**: Operates on a single macro task model with manual or rule-based delegation.
- **KV-Cache Optimization**: Prompt prefixes remain stable across routing decisions to maximize prompt caching efficiency and minimize time-to-first-token.

### 3. Model Safety Guardrails & Policy Tiers

- **Granular Execution Policies**: Configure tool and terminal safety across 5 distinct tiers:
  - `config`: Respects configuration-declared limits.
  - `allow`: Unrestricted execution.
  - `ask`: Interactively prompts on potentially destructive operations.
  - `ask_every_time`: Prompts on every tool invocation.
  - `deny`: Enforces read-only mode.
- **Pre-Execution Hooks & Evaluator**: Optional evaluator model validates shell commands and AST modifications before execution.

### 4. Tail Personalization

- **Tail-Anchored Context**: Developer preferences, workspace conventions, and instruction guidelines are appended at the _tail_ of the context window rather than injected at the head, preserving 100% of KV-cache prefix hits for system prompts.

### 5. Durable Task Board & Kanban Surface

- **Durable Task Management**: Dedicated interactive Kanban board in VS Code tracking pending, active, and completed subtasks across sessions.
- **State Preservation**: Task states persist across IDE reloads with automatic checkpointing and rollback support.

### 6. Subagent Swarms & Background Workers

- **Parallel Delegation**: Spawn subagents for isolated research, refactoring, or testing tasks.
- **Scoped Skillsets**: Each subagent receives a filtered, minimal tool and skill configuration.

### 7. AST-Aware Code Search (`Semble`)

- **Syntax-Aware Chunking**: Extracts and searches discrete structural code elements (functions, classes, interfaces) with token and character budgeting.
- **Resilient Fallback**: Gracefully degrades to ripgrep regex matching when AST parsers are unavailable.

### 8. Background Process Manager & Task Automation

- **Detached Execution**: Launch asynchronous background tasks, daemons, or test watchers without blocking chat turns.
- **Process Lifecycle Control**: Real-time log capture, stdin stream interaction, and clean process-tree termination.

### 9. Interactive Artifact Management

- **First-Class Document Artifacts**: Generate, inspect, diff, and manage structured markdown artifacts persisted in `.npc/artifacts`.

### 10. Docx & Document Viewing

- **Native Document Viewing**: Parse, inspect, and preview `.docx` and rich text documentation directly in dedicated VS Code editor tabs without polluting chat turns.

### 11. Action Fusion & Context Compaction Cost Gate (SoL-Pi Architecture)

- **Atomic Tool Fusion (`then_run`)**: Executes code edits and subsequent validation commands in a single round-trip cycle, halving inference turns.
- **Evidence-Preserving Reducer & ObservationPack**: Reduces verbose test/build failure logs by over 70% while deterministically capturing failure exit codes, diff receipts, and error traces.
- **Prompt-Cache Cost Gating**: Evaluates compounding step savings against prefix KV-cache reload penalties, deferring compaction when remaining step savings are smaller than the cache rewrite cost.

### 12. Decoupled Test & Repair Scaffold (ExecCritic Architecture)

- **Fail-Closed Qualification**: Candidate reproduction tests must execute against the unmodified buggy codebase and fail first before qualification.
- **Frozen Test Manifest & Tamper Protection**: Hash-locks qualified reproduction tests, preventing repair agents from modifying test assertions to fabricate passing runs.

### 13. Turn-Level Routing Telemetry & Feedback Curriculum (NeoHorse-1 Architecture)

- **Routing Telemetry Recorder**: Logs per-turn prompt contexts, chosen model tiers, tool signals, and error metrics to disk.
- **Curriculum Performance Statistics**: Continuously scores routing rules to identify rules that over-route to high-cost models when lightweight models suffice.

### 14. Regularized Recursive Self-Improvement (RRSI Architecture)

- **Annealed Proposal Budget**: Restricts candidate edit cardinalities using a cosine decay schedule ($b_t \to b_{\min}$) to favor sparse, attributable updates.
- **Pre-Evaluation Leakage Screening**: Discards candidates containing benchmark-specific logic or test answer leaks before running evaluations.
- **Ridge/$L_2$ Complexity Gating & Lasso/$L_1$ Structural Pruning**: Enforces token growth boundaries ($\Delta C \le \beta_0 + \beta_1 \Delta S$) to eliminate prompt bloat, pruning components that yield no positive gain over a sliding window.

### 15. Self-Evolving Execution Structures (Procedural Graphs)

- **Attributed Triplet Representation**: Directed graph $G = (V, R, E, \Phi)$ storing `(procedure, relation, procedure)` triplets with condition, guidance, and pitfall attributes.
- **Active Node Localization & Situational Guidance**: Dynamically guides solver action selection based on recent trajectory history without rigid constraints.
- **Offline Failure Refinement**: Analyzes failed diagnostic traces to detect action loops and automatically injects fallback/recovery edges into the execution topology.

### 16. Harness Distillation via Agent-as-Harness (Harness-Zero Architecture)

- **Response Boundary Teacher Interception**: Validates candidate student actions against reference harness rules and applies minimal coherent corrections in the student's native action space.
- **Clean SFT Distillation Dataset Export**: Strips internal teacher scratchpads and notes, exporting clean prompt-action demonstration pairs ready for fine-tuning.

### 17. Time-Traveling Execution Rollback (`ShadowRewindManager`)

- **Zero-Pollution Shadow Git Trees**: Automatically records pre-action checkpoints (`refs/npc/checkpoints/<turn_id>`) without creating spurious branch commits or polluting git history.
- **Instant Rollback**: Restores workspace files to the exact state before a failed turn or hallucinated refactor with zero manual git stashing.

### 18. Targeted AST Caller/Callee Impact Injection (`ContinuousAstDependencyGraph`)

- **Transitive Symbol Blast-Radius**: Indexes symbol declarations, imports, and calls across source files to compute transitive blast radii.
- **Token-Bounded Injection**: Injects targeted callers and signatures directly into model prompt context, avoiding massive whole-file context dumps while providing full semantic call awareness.

### 19. Builder vs. Breaker Red-Teaming Pair (`DualAgentAdversary`)

- **Cooperative Adversarial Testing**: Synthesizes a specialized "Breaker" agent that actively generates edge-case inputs (nulls, boundary values, async race conditions, resource exhaustion) against the "Builder" agent's code.
- **Defensive Repair Loop**: Automatically feeds counter-examples into repair prompts before declaring turn completion.

### 20. Dual-Path Speculative Drafting & Verification (`SpeculativeDraftingRouter`)

- **Tiny Draft + Heavy Verifier Engine**: Generates speculative edits using local/fast lightweight heuristics or templates, verified via static AST/syntax checks.
- **Bypasses Heavy Frontier LLM**: Accepted drafts bypass expensive frontier LLM calls, delivering substantial latency and token reductions on routine refactors and scaffolds.

### 21. Offline KV-Cache Fingerprinting & Prefix Alignment (`StablePrefixCacheLedger`)

- **Immutable Segment Partitioning**: Partitions prompt context into strictly ordered static, semi-static, and dynamic blocks to maximize modern LLM prompt caching (Anthropic, Gemini, OpenAI, DeepSeek).
- **Cache-Buster Detection**: Flags timestamps, random UUIDs, or dynamic process metadata injected in static segments and isolates dynamic parameters to the prompt tail.

### 22. Automated Architecture & Execution Visualizer (`ArchitectureVisualizer`)

- **Mermaid Markdown Synthesis**: Generates component dependency flowcharts (`flowchart TD/LR`), tool invocation sequence diagrams (`sequenceDiagram`), and class diagrams (`classDiagram`) on the fly.
- **Visual Architectural Diffs**: Highlights modified components directly inside pull requests and session summaries.

### 23. Pull Request AutoPilot with Verification Receipts (`PrAutoPilot`)

- **Cryptographic Test Verification Receipts**: Records exact test commands, exit codes, passed/failed assertion counts, and run durations in a standardized Markdown receipt table.
- **Turnkey PR Generation**: Combines executive rationale, architectural Mermaid flowcharts, impacted component summaries, and rollback instructions ready for GitHub review.

### 24. Zero-Configuration Offline Flight Mode (`AirgapGuard`)

- **Guaranteed Zero Data Egress**: Blocks all outbound remote network calls, telemetry, and external URLs while whitelisting local loopback endpoints (`localhost`, `127.0.0.1`, Ollama, vLLM).
- **Tool Command Interception**: Intercepts shell commands matching remote egress utilities (`curl`, `wget`, `ssh`, `git push`), maintaining a full audit security ledger.

---

## Monorepo Architecture

| Component | Description |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **[@npc/cli](packages/cli)**                           | Terminal CLI and full interactive coding agent (`npc`)                                            |
| **[npc-vscode](packages/vscode)**                      | VS Code extension providing chat, local Ollama discovery, and custom model (BYOM) integration     |
| **[@npc/core](packages/core)**                         | Agent backend core: session lifecycle, model routing, tools, compaction, and provider composition |
| **Multi-Provider AI Subsystem**                        | Unified LLM adapter interface supporting local Ollama, DeepSeek, Anthropic, and OpenAI endpoints |
| **Durable Task Store**                                 | Durable conversation, task, and document state persistence                                        |
| **Terminal UI Runtime**                                | Terminal UI runtime with differential rendering                                                   |

## VS Code Extension (`packages/vscode`)

The NPC Code Assistant brings the NPC Agent backend directly into Visual Studio Code with native support for local Ollama instances, DeepSeek, and custom OpenAI-compatible endpoints.

### 1. Prerequisite Settings

Ensure VS Code's internal AI feature master switch is **not** disabling chat. In your `settings.json` (`Ctrl+,` -> Open Settings JSON):

```json
{
  "chat.disableAIFeatures": false
}
```

> **Important**: If `"chat.disableAIFeatures"` is set to `true`, VS Code disables its internal Chat panel, hiding chat views and suppressing model selection menus.

### 2. Installation

#### Option A: Quick Reinstall Script

Run from repository root:

```bash
./scripts/reinstall-vscode-extension.sh
```

#### Option B: Build and Package from Source

```bash
cd packages/vscode
npm install --ignore-scripts
npm run build
npx --no-install @vscode/vsce package --allow-missing-repository --allow-star-activation
code --install-extension *.vsix
```

### 3. Model Setup & Auto-Discovery

#### Local Ollama (Automatic on Startup)

- NPC queries `http://127.0.0.1:11434/api/tags` on extension activation and every startup.
- All locally installed chat models (e.g. `qwen3.5:9b`, `gemma4:e4b`) are auto-detected, checked for reasoning/thinking and tool capabilities, and registered.
- To re-scan at any time:
  - Command Palette (`Ctrl+Shift+P`): `NPC: Sync Ollama Models`
  - Or click **Sync Ollama Models** in the NPC Assistant sidebar.
- Custom Ollama host URL can be set via `"npc.ollamaUrl"` or `"pi.ollamaUrl"` in `settings.json` (defaults to `http://127.0.0.1:11434`).

#### Custom Providers (BYOM: DeepSeek, OpenRouter, Groq, vLLM)

To add a remote or local custom model:

1. Open Command Palette (`Ctrl+Shift+P`) and run:
   ```text
   NPC: Add Custom Provider / Model
   ```
2. Select provider preset:
   - **DeepSeek** (`https://api.deepseek.com/v1`)
   - **OpenRouter** (`https://openrouter.ai/api/v1`)
   - **Groq** (`https://api.groq.com/openai/v1`)
   - **Local Ollama** (`http://127.0.0.1:11434/v1`)
   - **vLLM / LM Studio / Local OpenAI** (`http://localhost:8000/v1`)
   - **Custom OpenAI-Compatible Endpoint**
3. Enter API Key (optional for local endpoints).
4. Select or enter the Model ID (NPC queries `/v1/models` from the endpoint and presents a pick-list if available).
5. Specify whether the model supports reasoning tokens (e.g. DeepSeek R1).
6. Click **Set as Active Model & Open Chat**.

Alternatively, configure models directly in VS Code `settings.json`:

```json
{
  "pi.customModels": [
    {
      "id": "deepseek-chat",
      "name": "DeepSeek V3",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "sk-...",
      "contextWindow": 128000,
      "maxOutputTokens": 16384
    },
    {
      "id": "deepseek-reasoner",
      "name": "DeepSeek R1",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "sk-...",
      "thinking": true,
      "reasoning": true
    }
  ]
}
```

### 4. Usage

- **Open Chat**: Click `$(sparkle) NPC` in the status bar (bottom right), run `NPC: Open Chat`, or mention `@npc` in the chat panel.
- **NPC Assistant Sidebar**: Click the NPC icon on the Activity Bar for a dashboard showing the active model, Ollama daemon status, registered custom models, and quick actions.
- **Terminal Agent**: Run `NPC: Open Terminal Agent` or run `npc` directly in any shell.

## Permissions & Containerization

NPC does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build         # Refresh model data, then build all packages
npm run build:offline # Rebuild using existing model data without network access
npm run check         # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
npm run build:cli    # Build standalone NPC CLI
```



## License

MIT
