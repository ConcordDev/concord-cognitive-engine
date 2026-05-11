# ADR 006: Adopt @modelcontextprotocol/sdk for MCP Bridge

## Status
Accepted

## Context
Sprint 12 needed to close two related agent-capability gaps:
1. Concord's 200+ macros are invisible to external AI clients (Claude
   Desktop, Cursor, OpenAI Apps, future MCP-aware agents).
2. Concord's chat agent has no way to consume the rapidly growing
   ecosystem of external MCP servers (filesystem, GitHub, Slack,
   Postgres, Linear, custom internal tools — 10,000+ public servers
   as of early 2026 per the [MCP 2026 guide][mcp-guide]).

The Model Context Protocol is a JSON-RPC 2.0 + SSE standard published
by Anthropic in late 2024 that has become the de-facto "USB-C for AI
tools" of 2026. 97M monthly SDK downloads. 28% Fortune 500 adoption.
76% of software providers building MCP integrations.

We could have:
- **Rolled our own protocol** — wasted effort. Every MCP-aware agent
  would need a Concord-specific adapter. We'd never close the
  ecosystem gap.
- **Skipped the integration entirely** — leaves Concord siloed.
- **Used a third-party MCP wrapper** — the official SDK is well-
  maintained by Anthropic with semver-stable releases since v1.0.

## Decision
Adopt the **official `@modelcontextprotocol/sdk` v1.29.0** as a
top-level server dependency. Use it in two places:

1. `server/lib/mcp-bridge.js` — Concord as MCP **client**. Connect
   to external MCP servers via `Client` + `StdioClientTransport` /
   `StreamableHTTPClientTransport`. Their tools become callable from
   `chat_agent.do` via the `mcp_call` tool.

2. `server/lib/mcp-server-host.js` — Concord as MCP **server**. Mount
   `McpServer` over `StreamableHTTPServerTransport` at `/mcp`.
   Expose 6 allowlisted Concord macros (expert_mode, dtu.search,
   web_search, lens.list, event_timeline, cross_world_effectiveness)
   so any MCP client can drive Concord.

Allowlist is conservative — destructive admin macros stay internal.

## Consequences

- **Pro**: Concord becomes immediately addressable from every
  MCP-aware client without per-client adapter work. Strategic
  ecosystem play.
- **Pro**: Concord can consume the entire MCP server ecosystem
  (10,000+ public, 28% Fortune 500 building) — instantly broadens
  the agent's tool surface beyond what we could build ourselves.
- **Pro**: Official Anthropic SDK = semver-stable, well-tested,
  spec-compliant. No reverse-engineering risk.
- **Con**: New top-level dep (+ 42 transitive). Auditable but real.
- **Con**: Standard is still evolving (MCP added Streamable HTTP +
  deprecated HTTP+SSE in March 2025). We may need version bumps.
- **Mitigation**: SDK is pinned at 1.29.x. Bump intentionally per
  release notes. The protocol-version handshake is built into the
  spec, so older servers/clients degrade gracefully.

## Alternatives Considered
- **Rolling our own JSON-RPC server**: rejected — would not be MCP
  compatible, defeating the entire ecosystem-play rationale.
- **OpenAI Apps SDK**: closed-source, OpenAI-only. Rejected.
- **A2A (Agent-to-Agent protocol)**: complementary, not competitive.
  Could add later for agent-to-agent rather than tool-to-agent flows.

[mcp-guide]: https://www.essamamdani.com/blog/complete-guide-model-context-protocol-mcp-2026
