<p align="center">
  <a href="https://pi.dev">
    <img alt="Pi logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@earendil-works/pi-coding-agent?style=flat-square&logo=npm&logoColor=white" /></a>
</p>

> New issues and PRs from new contributors are closed automatically. Maintainers review closed submissions daily. See [CONTRIBUTING.md](https://github.com/earendil-works/pi/blob/main/CONTRIBUTING.md).

# NPC Code CLI (`npc`)

NPC is a minimal, extensible autonomous AI agent for the terminal. Adapt NPC to your workflow, not the other way around.

Ask NPC to create prompt templates, skills, extensions, and themes, or install plugins. Use NPC directly in terminal interactive mode, automate it in print, JSON, or RPC mode, or build applications with the TypeScript SDK.

## Getting started

Start NPC in the directory where you want it to work:

```bash
cd /path/to/project
npc
```

For a built-in AI provider, run `/login` inside NPC to connect a subscription or API key. Then give NPC a task.

See the [documentation](docs/index.md) for full setup and usage instructions.

## Development

Run NPC from source:

```bash
npm install --ignore-scripts
./test.sh
```

Before submitting changes, run:

```bash
npm run check
./test.sh
```

Read [CONTRIBUTING.md](https://github.com/earendil-works/pi/blob/main/CONTRIBUTING.md) before opening an issue or pull request. It defines the contribution gate, issue quality bar, and required checks. Read [AGENTS.md](https://github.com/earendil-works/pi/blob/main/AGENTS.md) for repository-specific implementation, testing, dependency, and release rules.

## License

MIT
