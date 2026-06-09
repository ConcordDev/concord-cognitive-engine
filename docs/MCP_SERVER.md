# Concord as an MCP server

Concord exposes a curated, **verified-compute** tool surface over the Model
Context Protocol so any MCP client (Claude Code, Claude Desktop, Cursor, Windsurf)
can reach for it. The wedge: *the substrate that verifies its own answers.*

## Endpoint
- **Transport:** Streamable HTTP (JSON-RPC 2.0) at `POST/GET/DELETE /mcp`.
- **Discovery:** `GET /mcp/tools` (tool catalogue), `GET /.well-known/oauth-protected-resource` (RFC 9728 PRM).
- **Auth:** anonymous read tools work without a token; write/personal tools require
  a Bearer token (OAuth 2.1 / RFC 9728 — the PRM doc names the authorization server).
- **Rate limit:** per caller, `CONCORD_MCP_RATE` calls/min (default 60).

## Tools
| Tool | What it does | Auth |
|---|---|---|
| `concord.verify` | Verify a claim against its cited DTUs — deterministic citation floor + multi-brain council judge | no |
| `concord.math` | Exact symbolic computation (CAS): simplify / differentiate / integrate | no |
| `concord.dtu.search` | Semantic search over the DTU corpus | no |
| `concord.expert_mode.answer` | Perplexity-style cited answer over the substrate | no |
| `concord.web_search` | Web search (DuckDuckGo / SearxNG) | no |
| `concord.lens.list` | List Concord's 200+ lenses | no |
| `concord.event_timeline.recent` | Recent substrate events | no |
| `concord.cross_world_effectiveness.explain` | Skill potency in a Concordia world | no |
| `concord.dtu.create` | Mint a DTU into the substrate | **yes** |

## Connect (Claude Desktop / Cursor)
```json
{
  "mcpServers": {
    "concord": { "url": "https://concord-os.org/mcp" }
  }
}
```

## Publish to the official MCP Registry
The registry hosts metadata for remote servers (URL config, no npm package).
`server/mcp-server.json` is the publishable manifest. Once a public URL is live and
the `org.concord-os` namespace is verified (DNS or GitHub):

```bash
# https://registry.modelcontextprotocol.io — preview
mcp-publisher login
mcp-publisher publish server/mcp-server.json
```

Also list in community registries (cursor.directory, mcpindex, smithery).

> **Live-only steps (need a deployed public URL):** the registry publish, a real
> MCP-client handshake, and the full OAuth flow. The server code (confined + rate-
> limited tools, the verified-compute surface, the PRM/discovery routes) is in
> place and unit-tested; bringing it online is a deploy step.
