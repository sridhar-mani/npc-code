# Pi Coding Assistant (VS Code Extension)

Native Visual Studio Code extension for the Pi autonomous coding agent, supporting Ollama, custom OpenAI-compatible endpoints (BYOM), terminal agent integration, and in-editor chat with context compaction.

## Features

- **Dedicated Pi Assistant Sidebar**: Compact, modern chat interface in its own dedicated sidebar panel (`pi-assistant.dashboard`).
- **Model Provider Management**: Live selector supporting local Ollama models and Bring-Your-Own-Model (BYOM) endpoints.
- **Context Compaction**: One-click compaction trigger to summarize verbose history into a dense system memory context, conserving token windows.
- **Editor Context**: Seamlessly attach the active file or current selection into prompt queries with line numbers.
- **Code Block Actions**: Every code block features one-click `Copy` and `Insert at Cursor` actions.
- **Terminal Agent**: Launch the Pi interactive terminal agent with one click.
- **Native VS Code Chat Participant**: Access Pi directly anywhere in VS Code with `@pi`.

## Commands

- `pi.openChat`: Focus the Pi Assistant chat sidebar.
- `pi.addCustomModel`: Open wizard to register a custom OpenAI-compatible model endpoint.
- `pi.selectActiveModel`: QuickPick selector for switching active models.
- `pi.syncOllamaModels`: Synchronize and refresh local Ollama models.
- `pi.openTerminalAgent`: Launch the Pi autonomous terminal agent.
- `pi.openSettings`: Open extension configuration settings.

## Configuration

- `pi.ollama.url`: Base URL for Ollama (default: `http://127.0.0.1:11434`).
- `pi.models.default`: Default model ID.
- `pi.runtime.autoSyncOllama`: Automatically discover Ollama models on startup (default: `true`).
- `pi.runtime.timeout`: HTTP timeout in ms (default: `60000`).
- `pi.terminalCommand`: Terminal CLI launch command (default: `pi`).
