# Pi Coding Assistant

> Enterprise AI coding assistant powered by **Pi Core** with seamless BYOM (Bring Your Own Model) support for DeepSeek, OpenAI, Anthropic, Ollama, and private enterprise endpoints. Developed by **Zenteiq**.

---

## Key Features

| Feature | Description |
|---|---|
| **Pi Core Engine** | Powered by `@earendil-works/pi-core` for unified reasoning, tool execution, and session management |
| **Bring Your Own Model (BYOM)** | Native support for DeepSeek, OpenAI, Ollama, OpenRouter, and any OpenAI-compatible endpoint |
| **Terminal & IDE Unified** | Share models, sessions, and configuration seamlessly between VS Code and the `pi` CLI |
| **Full Tool Calling** | Workspace code search, file read/edit/write, symbol lookup, and terminal execution |
| **DeepSeek Reasoning** | Native `reasoning_content` multi-turn streaming and configurable thinking effort |
| **Context Compaction** | Intelligent automated conversation compaction to maximize available context |
| **Private & Telemetry-Free** | Telemetry attribution headers are opt-in and disabled by default |

---

## Quick Start

### 1. Add a Custom Model

Open the VS Code Command Palette (`Ctrl+Shift+P` / `F1`) and execute:

```text
Copilot: Add Custom Model
```

Follow the prompts to enter:
- **Model ID**: (e.g. `deepseek-chat`, `gpt-4o`, `llama3.3:70b`)
- **Base URL**: (e.g. `https://api.deepseek.com/v1` or `http://localhost:11434/v1`)
- **API Key**: (optional for local models)

Alternatively, configure directly in your VS Code `settings.json`:

```json
{
  "pi.customModels": [
    {
      "id": "deepseek-chat",
      "name": "DeepSeek V3",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "your-api-key"
    },
    {
      "id": "llama3.3:70b",
      "name": "Local Ollama Llama 3.3",
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": ""
    }
  ]
}
```

### 2. Using the Assistant in VS Code

1. Open the **Chat** panel in the primary sidebar.
2. Select your desired model from the model picker at the bottom of the chat panel.
3. Start typing your prompts or use `@workspace` to query project files.

---

## Terminal Coding Agent (`pi`)

To use the standalone terminal agent alongside VS Code:

```bash
# Launch interactive terminal session
pi

# Run a one-off non-interactive prompt
pi -p "Explain the architecture of this project"

# Select models interactively
# Press Ctrl+P within the terminal agent
```

---

## License

Internal Enterprise Tool — Copyright (c) Zenteiq.
