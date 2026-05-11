# IDE Integration via MCP

Sprint 12 made Concord an MCP server (at `/mcp`). This means VS Code,
Cursor, Zed, JetBrains, Claude Desktop — any MCP-aware client — can
connect to Concord without a custom plugin.

This document is the "use Concord from your IDE" guide. No extension
installation needed beyond the IDE's MCP support.

## What you get

Once connected, your IDE's AI assistant (Cursor's Composer, VS Code
Copilot Chat with MCP, Continue, etc.) can call into Concord's
allowlisted macros as native tools:

- `concord.expert_mode.answer` — Perplexity-style cited answer over
  your DTU corpus + global substrate. Use for research/synthesis
  inside the editor.
- `concord.dtu.search` — search your knowledge substrate from the
  command palette.
- `concord.web_search` — DuckDuckGo / SearxNG via Concord.
- `concord.lens.list` — discover Concord's 200+ lens domains.
- `concord.event_timeline.recent` — see Concord's realtime substrate
  events without leaving the IDE.
- `concord.cross_world_effectiveness.explain` — Concordia world physics
  per skill domain.

## VS Code

VS Code's official MCP support shipped in Q1 2026. Add to
`.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "concord": {
      "type": "http",
      "url": "https://concord-os.org/mcp",
      "auth": {
        "kind": "bearer",
        "token": "${env:CONCORD_TOKEN}"
      }
    }
  }
}
```

Set `CONCORD_TOKEN` in your shell from your Concord settings page
(it's the same auth cookie value — accessible at /settings/api).

Restart VS Code. Open the Copilot Chat panel; `@concord` is now
available. Type `@concord expert_mode answer "How does the refusal
field algebra compose?"` and the answer streams back with citation
chips.

For local Concord (development), use `http://localhost:5050/mcp`.

## Cursor

Cursor's MCP support is in the Composer panel. Add to your project's
`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "concord": {
      "url": "https://concord-os.org/mcp",
      "headers": {
        "Authorization": "Bearer ${CONCORD_TOKEN}"
      }
    }
  }
}
```

Cursor's Composer will now have a "concord" tool group in the model's
available tools.

## Claude Desktop

Claude Desktop ships with MCP support. Add to
`~/Library/Application Support/Claude/claude_desktop_config.json` (Mac)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "concord": {
      "command": "npx",
      "args": ["-y", "mcp-proxy-http", "https://concord-os.org/mcp"],
      "env": {
        "AUTH_TOKEN": "your-concord-bearer-token-here"
      }
    }
  }
}
```

(The `mcp-proxy-http` wrapper bridges Claude Desktop's stdio MCP
transport to Concord's Streamable HTTP transport. Replace with your
preferred bridge if needed.)

Restart Claude Desktop. The hammer icon in the input box now lists
Concord's tools.

## Zed

Zed's Assistant panel supports MCP via `settings.json`:

```json
{
  "assistant": {
    "context_servers": {
      "concord": {
        "url": "https://concord-os.org/mcp",
        "auth_token": "${CONCORD_TOKEN}"
      }
    }
  }
}
```

## What this is NOT

- It is **not** a Concord-specific IDE extension. There's no UI panel,
  no Concord-branded toolbar. The integration surface is whatever
  your IDE's MCP support gives you.
- It is **not** a replacement for the Concord web app (`/lenses/chat`,
  `/lenses/event-timeline`, etc.). Those remain the rich-UI primary
  surface.
- It is **not** real-time bidirectional collaboration — your IDE calls
  Concord on demand, not the other way around.

## What this enables

- "Use Concord knowledge in my IDE without context switching." A code
  question that needs cited research → `@concord expert_mode answer`
  inside Cursor's composer.
- "Build code against Concord's APIs locally." Cursor pulls
  `concord.lens.list` to know what surfaces exist; suggests calls.
- "Operate Concord from terminal AI." Claude Desktop / Codex CLI can
  drive Concord macros end-to-end without opening a browser.

## Reverse direction: Concord calls IDE's MCP servers

If your IDE exposes its own MCP server (filesystem access, git,
language-server bridge — Cursor and VS Code both ship these), Concord
can consume them via the existing `mcp.connect` macro on the Concord
side. See server/lib/mcp-bridge.js for details.

## Custom Concord macros via MCP

Want to expose more than the 6 allowlisted macros to MCP clients? Edit
`server/lib/mcp-server-host.js` and add to the `EXPOSED_TOOLS` array.
Each tool needs `name`, `description`, `domain` (Concord macro
domain), `macro` (specific macro name), and a Zod `inputSchema`. The
host serializes and bridges automatically.

Keep the allowlist conservative — destructive admin macros should NOT
be exposed via MCP. The default 6 are all read-only or DTU-creating
which is safe.
