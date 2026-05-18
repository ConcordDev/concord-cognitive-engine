# Concord Code — VS Code extension

13 commands wiring the Concord code lens into VS Code's command palette.
Every command hits a real Concord macro (no mocks); results stream to
the **Concord** output channel.

## Commands

| Command | Hits | Notes |
|---|---|---|
| `Concord: Run tests`             | `code.run_tests`       | Real spawn-sync, env-allowlisted runner |
| `Concord: AI edit selection` (⌘K) | `llm.local`            | Replaces selection / whole file |
| `Concord: Real git commit`       | `code.git_commit`      | Live `git status` first, then stage + commit |
| `Concord: Real git status`       | `code.git_status`      | |
| `Concord: Add project memory`    | `code.memory_add`      | Rule / preference / naming / pattern |
| `Concord: List project memory`   | `code.memory_list`     | |
| `Concord: Create spec`           | `code.spec_create`     | Mints kind='code_spec' DTU |
| `Concord: Generate plan from spec` | `code.spec_to_plan`  | Cites the spec via royalty cascade |
| `Concord: Run agent loop`        | `code.agent_loop`      | Edit → test → fix → retry until pass |
| `Concord: Start background agent` | `code.bg_start`       | Runs in background via heartbeat tick |
| `Concord: List background agents` | `code.bg_list`        | |
| `Concord: Semantic search patterns` | `code.semantic_search` | Real Ollama embeddings + cosine |
| `Concord: Ingest this repo into code-engine` | `code.ingest_repo` | Mints kind='code_pattern' DTUs |

## Settings

| Setting | Default |
|---|---|
| `concord.apiUrl`         | `http://localhost:5050` |
| `concord.apiToken`       | (empty — for Bearer auth when needed) |
| `concord.defaultRunner`  | `npm` |

## Building locally

```bash
cd vscode-extension
npm install
npm run compile
# Package as VSIX:
npm run package
```

Then install the resulting `.vsix` via VS Code's "Install from VSIX" command.

## Concord-native moats

Every authored memory, spec, plan, code-agent session = a citable DTU
in Concord. The royalty cascade halves per generation (21% / 2^n,
floor 0.05%) but persists 50 deep — when someone else cites your
AGENTS.md rule, your spec, or your background agent, you earn forever.
