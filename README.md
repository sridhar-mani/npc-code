<p align="center">
  <img alt="NPC Code logo" src="assets/logo.png" width="144">
</p>

# NPC Code (`npc-code`)

Autonomous coding agent monorepo designed for terminal CLI, VS Code extension, and protected builds.

- **[@npc/cli](packages/cli)**: Standalone terminal coding agent CLI (`npc`)
- **[npc-vscode](packages/vscode)**: Streamlined VS Code extension
- **[@npc/core](packages/core)**: Core agent runtime with tool execution, session management, and model routing
- **[@earendil-works/pi-agent-core](packages/agent)**: Agent runtime with tool calling and state management
- **[@earendil-works/pi-ai](packages/ai)**: Unified multi-provider LLM API (OpenAI, Anthropic, Google, DeepSeek)

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

- **Native Document Rendering**: Parse, inspect, and preview `.docx` and rich text documentation directly in the agent conversation flow.

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

---

## All Packages

| Package                                                | Description                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **[@earendil-works/pi-core](packages/core)**           | Agent backend core: session lifecycle, model routing, tools, compaction, and provider composition |
| **[@npc/cli](packages/cli)**                           | Terminal CLI and full interactive coding agent (`npc`)                                            |
| **[npc-vscode](packages/vscode)**                      | VS Code extension providing chat, local Ollama discovery, and custom model (BYOM) integration     |
| **[@npc/core](packages/core)**                         | Agent backend core: session lifecycle, model routing, tools, compaction, and provider composition |
| **[@earendil-works/chord](packages/chord)**            | Standalone application-composition runtime for services, replicated state, RPC, and plugins       |
| **[@earendil-works/pi-telemetry](packages/telemetry)** | Vendor-neutral telemetry contracts, reference adapter, conformance tests, and typed schemas       |
| **[@earendil-works/pi-ai](packages/ai)**               | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.)                                  |
| **[@earendil-works/pi-durable](packages/durable)**     | Durable conversation, task, and document runtime                                                  |
| **[@earendil-works/pi-agent-core](packages/agent)**    | Agent runtime with tool calling and state management                                              |
| **[@earendil-works/pi-tui](packages/tui)**             | Terminal UI library with differential rendering                                                   |

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
- **Switch Active Model**: Click the active model indicator in the status bar or run `NPC: Select Active Model` (`pi.selectActiveModel`).
- **NPC Assistant Sidebar**: Click the NPC icon on the Activity Bar for a dashboard showing the active model, Ollama daemon status, registered custom models, and quick actions.
- **Terminal Agent**: Run `NPC: Open Terminal Agent` or run `npc` directly in any shell.

## Permissions & Containerization

NPC does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox Pi. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:

- **Gondolin extension**: keep `pi` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `pi` process in a local container for simple isolation.
- **OpenShell**: run the whole `pi` process in a policy-controlled sandbox.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents). Longer term plans for Pi can also be found in [RFCs](https://rfc.earendil.com/keyword/pi/).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build         # Refresh model data, then build all packages
npm run build:offline # Rebuild using existing model data without network access
npm run check         # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
npm run build:cli    # Build standalone NPC CLI
```

## Building standalone binaries from release source

GitHub releases include a versioned source archive covered by the release's `SHA256SUMS` file. Extract it and run the same build script used for the official standalone binaries:

```bash
VERSION="<release-version>"
tar -xzf "pi-${VERSION}-source.tar.gz"
cd "pi-${VERSION}"
./scripts/build-binaries.sh --offline-model-data --platform linux-x64 --out "$PWD/out"
```

The archive includes release model data and native prebuilds. `--offline-model-data` uses that model data without refreshing provider catalogs. The script installs dependencies and builds the executable with its runtime assets; pass `--skip-install` if dependencies are already provided.

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `PI_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent shrinkwrap.
- The published CLI package includes `packages/coding-agent/npm-shrinkwrap.json`, generated from the root lockfile, to pin transitive deps for npm users.
- Release smoke tests use `npm run release:local` to build, pack, and create isolated npm and Bun installs outside the repo before tagging a release.
- Local release installs, documented npm installs, and `pi update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Shrinkwrap generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## Share your OSS coding agent sessions

If you use Pi or other coding agents for open source work, please share your sessions.

Public OSS session data helps improve coding agents with real-world tasks, tool use, failures, and fixes instead of toy benchmarks.

For the full explanation, see [this post on X](https://x.com/badlogicgames/status/2037811643774652911).

To publish sessions, use [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf). Read its README.md for setup instructions. All you need is a Hugging Face account, the Hugging Face CLI, and `pi-share-hf`.

You can also watch [this video](https://x.com/badlogicgames/status/2041151967695634619), where I show how I publish my `pi-mono` sessions.

I regularly publish my own `pi-mono` work sessions here:

- [badlogicgames/pi-mono on Hugging Face](https://huggingface.co/datasets/badlogicgames/pi-mono)

## License

MIT

<p align="center">
  <a href="https://pi.dev">pi.dev</a> domain graciously donated by
  <br /><br />
  <a href="https://exe.dev"><img src="packages/coding-agent/docs/images/exy.png" alt="Exy mascot" width="48" /><br />exe.dev</a>
</p>
