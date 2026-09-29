<p align="center">
  <a href="https://pi.dev">
    <img alt="pi logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@earendil-works/pi-coding-agent?style=flat-square" /></a>
</p>

> New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily. See [CONTRIBUTING.md](CONTRIBUTING.md).

# Pi Agent Harness

This is the home of the Pi agent harness project including our self extensible coding agent.

* **[@earendil-works/pi-coding-agent](packages/coding-agent)**: Interactive coding agent CLI
* **[@earendil-works/pi-agent-core](packages/agent)**: Agent runtime with tool calling and state management
* **[@earendil-works/pi-ai](packages/ai)**: Unified multi-provider LLM API (OpenAI, Anthropic, Google, …)

To learn more about Pi:

* [Visit pi.dev](https://pi.dev), the project website with demos
* [Read the documentation](https://pi.dev/docs/latest), but you can also ask the agent to explain itself

## All Packages

| Package | Description |
|---------|-------------|
| **[@earendil-works/pi-core](packages/core)** | Agent backend core: session lifecycle, model routing, tools, compaction, and provider composition |
| **[@earendil-works/pi-terminal-ui](packages/terminal-ui)** | Terminal CLI and full interactive TUI coding agent |
| **[pi-vscode-ui](packages/vscode-ui)** | VS Code extension providing chat, local Ollama discovery, and custom model (BYOM) integration |
| **[@earendil-works/chord](packages/chord)** | Standalone application-composition runtime for services, replicated state, RPC, and plugins |
| **[@earendil-works/pi-telemetry](packages/telemetry)** | Vendor-neutral telemetry contracts, reference adapter, conformance tests, and typed schemas |
| **[@earendil-works/pi-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@earendil-works/pi-durable](packages/durable)** | Durable conversation, task, and document runtime |
| **[@earendil-works/pi-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@earendil-works/pi-tui](packages/tui)** | Terminal UI library with differential rendering |

For Slack/chat automation and workflows see [earendil-works/pi-chat](https://github.com/earendil-works/pi-chat).

## VS Code Extension (`packages/vscode-ui`)

The Pi Coding Assistant brings the Pi Agent backend directly into Visual Studio Code with native support for local Ollama instances, DeepSeek, and custom OpenAI-compatible endpoints.

### 1. Prerequisite Settings

Ensure VS Code's internal AI feature master switch is **not** disabling chat. In your `settings.json` (`Ctrl+,` -> Open Settings JSON):

```json
{
  "chat.disableAIFeatures": false
}
```

> **Important**: If `"chat.disableAIFeatures"` is set to `true`, VS Code disables its internal Chat panel, hiding chat views and suppressing model selection menus.

### 2. Installation

#### Option A: Install Built VSIX Package
Run from terminal:
```bash
code --install-extension packages/vscode-ui/pi-vscode-ui-0.44.1.vsix
```

#### Option B: Build and Package from Source
```bash
cd packages/vscode-ui
npm install --ignore-scripts
npm run compile
npx @vscode/vsce package --no-dependencies
code --install-extension *.vsix
```

### 3. Model Setup & Auto-Discovery

#### Local Ollama (Automatic on Startup)
- Pi queries `http://127.0.0.1:11434/api/tags` on extension activation and every startup.
- All locally installed chat models (e.g. `qwen3.5:9b`, `gemma4:e4b`) are auto-detected, checked for reasoning/thinking and tool capabilities, and registered.
- To re-scan at any time:
  - Command Palette (`Ctrl+Shift+P`): `Pi: Sync Ollama Models`
  - Or click **Sync Ollama Models** in the Pi Assistant sidebar.
- Custom Ollama host URL can be set via `"copilot.ollamaUrl"` in `settings.json` (defaults to `http://127.0.0.1:11434`).

#### Custom Providers (BYOM: DeepSeek, OpenRouter, Groq, vLLM)
To add a remote or local custom model:
1. Open Command Palette (`Ctrl+Shift+P`) and run:
   ```text
   Pi: Add Custom Provider / Model
   ```
2. Select provider preset:
   - **DeepSeek** (`https://api.deepseek.com/v1`)
   - **OpenRouter** (`https://openrouter.ai/api/v1`)
   - **Groq** (`https://api.groq.com/openai/v1`)
   - **Local Ollama** (`http://127.0.0.1:11434/v1`)
   - **vLLM / LM Studio / Local OpenAI** (`http://localhost:8000/v1`)
   - **Custom OpenAI-Compatible Endpoint**
3. Enter API Key (optional for local endpoints).
4. Select or enter the Model ID (Pi queries `/v1/models` from the endpoint and presents a pick-list if available).
5. Specify whether the model supports reasoning tokens (e.g. DeepSeek R1).
6. Click **Set as Active Model & Open Chat**.

Alternatively, configure models directly in VS Code `settings.json`:
```json
{
  "copilot.customModels": [
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

- **Open Chat**: Click `$(sparkle) Pi` in the status bar (bottom right), run `Pi: Open Chat`, or mention `@pi` in the chat panel.
- **Switch Active Model**: Click the active model indicator in the status bar or run `Pi: Select Active Model` (`pi.selectActiveModel`).
- **Pi Assistant Sidebar**: Click the Pi icon on the Activity Bar for a dashboard showing the active model, Ollama daemon status, registered custom models, and quick actions.
- **Terminal Agent**: Run `Pi: Open Terminal Agent` or run `pi` directly in any shell.


## Permissions & Containerization

Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox Pi. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:

- **Gondolin extension**: keep `pi` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `pi` process in a local container for simple isolation.
- **OpenShell**: run the whole `pi` process in a policy-controlled sandbox.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).  Longer term plans for Pi can also be found in [RFCs](https://rfc.earendil.com/keyword/pi/).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build         # Refresh model data, then build all packages
npm run build:offline # Rebuild using existing model data without network access
npm run check         # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./pi-test.sh         # Run pi from sources (can be run from any directory)
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
