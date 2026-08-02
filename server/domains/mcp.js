// server/domains/mcp.js
//
// Sprint 12A — macro surface for MCP server management + tool calls.
// Extended 2026-08-02 to give ConKay/Concord chat's agent loop real MCP
// reach ("any and all" external MCP servers, not just Concord's own
// native tools) — see server/lib/chat-agent.js's `mcp_connect` tool.
//
// ADMIN GATE (2026-08-02 fix): `connect` with kind='stdio' spawns an
// arbitrary local subprocess (`config.command`/`config.args`, no
// allowlist) — that is unrestricted local code execution. The macro was
// previously gated only by "authenticated" (any logged-in user), which is
// a real RCE-as-any-user bug, same class as the SEC-1 finding in
// domains/invariant.js this same session. Fixed the same way
// domains/admin.js gates its operator console: an IN-HANDLER check off
// `ctx.actor.role`. kind='http' stays open to any authenticated caller —
// it's SSRF-guarded at the mcp-bridge.js chokepoint (same risk class as
// the already-open `browse_url` agent tool, not a new exposure) — which is
// what lets the agent's `mcp_connect` tool (http-only, enforced again at
// that call site) reach genuinely any public HTTP MCP server without
// needing an admin in the loop for every connection.
import {
  connectMcpServer, disconnectMcpServer,
  listConnectedMcpServers, listAllMcpTools, invokeMcpTool,
} from "../lib/mcp-bridge.js";
import { listExposedTools } from "../lib/mcp-server-host.js";

function requireAdminRole(ctx) {
  const role = ctx?.actor?.role || "";
  if (["owner", "admin", "founder"].includes(role)) return null;
  return { ok: false, error: "Insufficient permissions: admin role required for a local-subprocess (stdio) MCP server" };
}

export default function registerMcpMacros(register) {
  register("mcp", "list_servers", async () => {
    return { ok: true, servers: listConnectedMcpServers() };
  }, { note: "List connected external MCP servers + their tool catalog." });

  register("mcp", "list_tools", async () => {
    return { ok: true, tools: listAllMcpTools() };
  }, { note: "Flat list of every tool from every connected MCP server. Used by chat_agent so the brain knows what's callable." });

  register("mcp", "connect", async (ctx, input = {}) => {
    const { serverId, kind, command, args, url, env } = input || {};
    if (!serverId || !kind) return { ok: false, reason: "missing_inputs" };
    if (kind === "stdio") {
      const denied = requireAdminRole(ctx);
      if (denied) return denied;
    }
    const r = await connectMcpServer(serverId, { kind, command, args, url, env });
    // Normalize: mcp-bridge.js's failure shapes carry `reason` (a stable
    // code) and only sometimes `error` (human text) — surface `reason` as
    // `error` too when it's the only thing present, so a frontend that only
    // reads `.error` (the lensRun client's convention) doesn't show a bare
    // "lens error" for something as legible as "already_connected".
    if (r && r.ok === false && !r.error && r.reason) return { ...r, error: r.reason };
    return r;
  }, { note: "Connect an external MCP server. kind='stdio' (local subprocess) requires an admin/owner/founder role; kind='http' (remote Streamable HTTP) is SSRF-guarded and open to any authenticated caller." });

  register("mcp", "disconnect", async (ctx, input = {}) => {
    if (!input?.serverId) return { ok: false, reason: "missing_serverId" };
    // Disconnect is admin-gated too: the registry is shared/global (not
    // per-user — see mcp-bridge.js), so any authenticated user disconnecting
    // a server would be an availability hit against every other user's
    // in-flight or future mcp_call/mcp_list use of it.
    const denied = requireAdminRole(ctx);
    if (denied) return denied;
    return disconnectMcpServer(input.serverId);
  }, { note: "Disconnect an external MCP server (kills the subprocess for stdio). Admin/owner/founder only — the connection is shared across all users." });

  register("mcp", "invoke", async (ctx, input = {}) => {
    const { serverId, toolName, args = {} } = input || {};
    if (!serverId || !toolName) return { ok: false, reason: "missing_inputs" };
    return invokeMcpTool(serverId, toolName, args);
  }, { note: "Invoke a tool on a connected external MCP server." });

  register("mcp", "exposed_tools", async () => {
    return { ok: true, tools: listExposedTools() };
  }, { note: "List the Concord macros exposed AS MCP tools to external MCP clients via /mcp endpoint." });
}
