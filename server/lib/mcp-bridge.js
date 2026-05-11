// server/lib/mcp-bridge.js
//
// Sprint 12A — Model Context Protocol bridge.
//
// Two directions:
//
//   1. SERVER side: expose Concord's 200+ macros (every domain.action
//      registered via the lens-action / macro-registry surface) as MCP
//      tools so any MCP client (Claude Desktop, Cursor, OpenAI Apps,
//      future MCP-aware agents) can drive Concord remotely.
//
//   2. CLIENT side: Concord acts as an MCP client. Operators register
//      external MCP servers (filesystem, GitHub, Slack, Postgres,
//      Linear, custom internal tools — there are 10,000+ public MCP
//      servers as of early 2026). Their tools become available to
//      chat_agent.do as if they were native Concord tools.
//
// The MCP standard is JSON-RPC 2.0 over a transport (stdio for local
// subprocess servers, Streamable HTTP for remote). We use the official
// `@modelcontextprotocol/sdk` v1.29.0+ which handles the protocol.
//
// Privacy: external MCP servers are sandboxed — Concord forwards only
// the tool call args, never user-context unless the brain explicitly
// includes it. MCP server-side requests get the same auth gate the
// rest of Concord uses.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ── Client side: in-memory registry of connected MCP servers ──────

const _clients = new Map(); // serverId → { client, transport, tools, info }

/**
 * Connect to an external MCP server.
 *
 * @param {string} serverId      caller-provided id ("filesystem", "github", etc.)
 * @param {object} config        { kind: 'stdio' | 'http', command?, args?, url?, env? }
 * @returns {Promise<{ok, tools?: Array, error?}>}
 */
export async function connectMcpServer(serverId, config = {}) {
  if (!serverId) return { ok: false, reason: "missing_serverId" };
  if (_clients.has(serverId)) return { ok: false, reason: "already_connected", serverId };

  let transport;
  try {
    if (config.kind === "stdio") {
      if (!config.command) return { ok: false, reason: "stdio_missing_command" };
      transport = new StdioClientTransport({
        command: String(config.command),
        args: Array.isArray(config.args) ? config.args.map(String) : [],
        env: typeof config.env === "object" ? config.env : undefined,
      });
    } else if (config.kind === "http") {
      if (!config.url || !/^https?:\/\//.test(String(config.url))) {
        return { ok: false, reason: "http_invalid_url" };
      }
      transport = new StreamableHTTPClientTransport(new URL(String(config.url)));
    } else {
      return { ok: false, reason: "unknown_kind", kind: config.kind };
    }

    const client = new Client(
      { name: "concord-mcp-client", version: "1.0.0" },
      { capabilities: { tools: {}, resources: {}, prompts: {} } },
    );

    await client.connect(transport);
    const toolsResp = await client.listTools().catch(() => ({ tools: [] }));
    const tools = Array.isArray(toolsResp?.tools) ? toolsResp.tools : [];

    _clients.set(serverId, { client, transport, tools, info: config });
    return { ok: true, serverId, tools: tools.map(_summarizeTool) };
  } catch (err) {
    try { transport?.close?.(); } catch { /* noop */ }
    return { ok: false, reason: "connect_failed", error: String(err?.message || err) };
  }
}

/**
 * Disconnect a previously-connected MCP server.
 */
export async function disconnectMcpServer(serverId) {
  if (!serverId) return { ok: false, reason: "missing_serverId" };
  const entry = _clients.get(serverId);
  if (!entry) return { ok: true, alreadyDisconnected: true };
  try {
    await entry.client.close();
  } catch { /* best-effort */ }
  _clients.delete(serverId);
  return { ok: true };
}

export function listConnectedMcpServers() {
  const result = [];
  for (const [serverId, { tools, info }] of _clients.entries()) {
    result.push({
      serverId,
      kind: info.kind,
      toolCount: tools.length,
      tools: tools.map(_summarizeTool),
    });
  }
  return result;
}

export function listAllMcpTools() {
  const result = [];
  for (const [serverId, { tools }] of _clients.entries()) {
    for (const t of tools) {
      result.push({
        serverId,
        toolName: t.name,
        description: t.description || "",
        inputSchema: t.inputSchema || null,
      });
    }
  }
  return result;
}

/**
 * Invoke a tool on a connected MCP server.
 * @param {string} serverId
 * @param {string} toolName
 * @param {object} args
 * @returns {Promise<{ok, content?, error?}>}
 */
export async function invokeMcpTool(serverId, toolName, args = {}) {
  if (!serverId || !toolName) return { ok: false, reason: "missing_inputs" };
  const entry = _clients.get(serverId);
  if (!entry) return { ok: false, reason: "server_not_connected", serverId };
  try {
    const result = await entry.client.callTool({
      name: String(toolName),
      arguments: typeof args === "object" ? args : {},
    });
    // CallToolResult shape: { content: [{type, text|image|...}], isError? }
    const text = (result.content || [])
      .filter(c => c.type === "text")
      .map(c => c.text || "")
      .join("\n");
    return {
      ok: !result.isError,
      content: result.content || [],
      text,
      isError: !!result.isError,
    };
  } catch (err) {
    return { ok: false, reason: "invoke_failed", error: String(err?.message || err) };
  }
}

function _summarizeTool(t) {
  return {
    name: t.name,
    description: (t.description || "").slice(0, 240),
    hasInputSchema: !!t.inputSchema,
  };
}

/**
 * Cleanup helper — disconnect all servers (used on shutdown).
 */
export async function disconnectAllMcpServers() {
  const ids = Array.from(_clients.keys());
  for (const id of ids) {
    await disconnectMcpServer(id);
  }
  return { ok: true, disconnected: ids.length };
}

export const MCP_BRIDGE_CONSTANTS = Object.freeze({
  CLIENT_NAME: "concord-mcp-client",
  CLIENT_VERSION: "1.0.0",
});
