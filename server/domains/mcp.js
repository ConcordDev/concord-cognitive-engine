// server/domains/mcp.js
//
// Sprint 12A — macro surface for MCP server management + tool calls.
//
// Authenticated only — MCP server config is sensitive (involves
// subprocess command lines for stdio servers).

import {
  connectMcpServer, disconnectMcpServer,
  listConnectedMcpServers, listAllMcpTools, invokeMcpTool,
} from "../lib/mcp-bridge.js";
import { listExposedTools } from "../lib/mcp-server-host.js";

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
    return connectMcpServer(serverId, { kind, command, args, url, env });
  }, { note: "Connect an external MCP server. kind='stdio' for local subprocess, 'http' for remote Streamable HTTP." });

  register("mcp", "disconnect", async (ctx, input = {}) => {
    if (!input?.serverId) return { ok: false, reason: "missing_serverId" };
    return disconnectMcpServer(input.serverId);
  }, { note: "Disconnect an external MCP server (kills the subprocess for stdio)." });

  register("mcp", "invoke", async (ctx, input = {}) => {
    const { serverId, toolName, args = {} } = input || {};
    if (!serverId || !toolName) return { ok: false, reason: "missing_inputs" };
    return invokeMcpTool(serverId, toolName, args);
  }, { note: "Invoke a tool on a connected external MCP server." });

  register("mcp", "exposed_tools", async () => {
    return { ok: true, tools: listExposedTools() };
  }, { note: "List the Concord macros exposed AS MCP tools to external MCP clients via /mcp endpoint." });
}
