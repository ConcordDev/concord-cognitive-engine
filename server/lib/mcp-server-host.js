// server/lib/mcp-server-host.js
//
// Sprint 12A — Concord-as-MCP-server.
//
// Exposes a subset of Concord's macros as MCP tools so external MCP
// clients (Claude Desktop, Cursor, OpenAI Apps, future MCP-aware
// agents) can drive Concord remotely via the standard JSON-RPC 2.0
// + SSE protocol.
//
// We mount over Streamable HTTP at /mcp on the existing Express
// server. Auth: requires the standard Concord auth cookie/JWT (the
// `_auth` middleware applied at the route level — caller wires it).
//
// Tool list: by default we expose the most useful read-only +
// commonly-requested macros. The list is allowlisted (not every
// macro is exposed — destructive admin macros stay internal).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// Allowlist of Concord macros to expose as MCP tools. Each entry
// names the (domain, macro) and a human-readable wrapping. We
// deliberately keep this conservative — destructive write paths and
// admin-only macros are NOT exposed.
const EXPOSED_TOOLS = [
  {
    name: "concord.dtu.search",
    description: "Search Concord's DTU corpus for matches to a query string.",
    domain: "discovery", macro: "search",
    inputSchema: { query: z.string().describe("Search query"), limit: z.number().int().optional() },
  },
  {
    name: "concord.expert_mode.answer",
    description: "Get a Perplexity-style cited answer over Concord's substrate. Returns answer + numbered sources + provenance.",
    domain: "expert_mode", macro: "answer",
    inputSchema: { query: z.string().describe("Question to answer") },
  },
  {
    name: "concord.web_search",
    description: "Search the web (DuckDuckGo or SearxNG) for current information.",
    domain: "tools", macro: "web_search",
    inputSchema: { query: z.string() },
  },
  {
    name: "concord.lens.list",
    description: "List Concord's 200+ lenses with their domains.",
    domain: "lens", macro: "list",
    inputSchema: {},
  },
  {
    name: "concord.event_timeline.recent",
    description: "Recent substrate events (the unified event timeline).",
    domain: "event_timeline", macro: "recent",
    inputSchema: { limit: z.number().int().optional() },
  },
  {
    name: "concord.cross_world_effectiveness.explain",
    description: "Explain how a skill performs in a given Concordia world (cross-world potency).",
    domain: "cross_world_effectiveness", macro: "explain",
    inputSchema: { domain: z.string(), worldId: z.string(), level: z.number().optional() },
  },
];

let _activeMcpServer = null;
let _activeTransports = new Map(); // sessionId → transport

/**
 * Build the MCP server instance and wire each exposed tool to the
 * Concord runMacro path.
 */
export function buildMcpServer({ runMacro, ctxFor }) {
  const server = new McpServer(
    { name: "concord-cognitive-engine", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  for (const t of EXPOSED_TOOLS) {
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.inputSchema,
      },
      async (args, extra) => {
        try {
          const ctx = typeof ctxFor === "function" ? ctxFor(extra) : { db: null, actor: null };
          const result = await runMacro(t.domain, t.macro, args || {}, ctx);
          const text = JSON.stringify(result, null, 2).slice(0, 16_000);
          return {
            content: [{ type: "text", text }],
            isError: !result?.ok,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Concord macro error: ${err?.message || err}` }],
            isError: true,
          };
        }
      },
    );
  }

  _activeMcpServer = server;
  return server;
}

/**
 * Mount the MCP server onto an existing Express app at /mcp.
 * Caller is responsible for applying auth middleware before this.
 *
 * @param {object} args
 * @param {object} args.app          Express app
 * @param {Function} args.runMacro   the standard runMacro
 * @param {Function} args.ctxFor     (req) => ctx (with db + actor)
 * @param {Function} [args.authMW]   auth middleware to apply
 */
export function mountMcpServer({ app, runMacro, ctxFor, authMW }) {
  const server = buildMcpServer({ runMacro, ctxFor });

  const handler = async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] || `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      let transport = _activeTransports.get(sessionId);
      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
        });
        _activeTransports.set(sessionId, transport);
        transport.onclose = () => _activeTransports.delete(sessionId);
        await server.connect(transport);
      }
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: "mcp_handler_failed", message: String(err?.message || err) });
      }
    }
  };

  // Streamable HTTP supports POST + GET (long-poll for SSE) + DELETE (cleanup).
  if (authMW) {
    app.post("/mcp", authMW, handler);
    app.get("/mcp", authMW, handler);
    app.delete("/mcp", authMW, handler);
  } else {
    app.post("/mcp", handler);
    app.get("/mcp", handler);
    app.delete("/mcp", handler);
  }

  return { ok: true, exposedToolCount: EXPOSED_TOOLS.length };
}

export function listExposedTools() {
  return EXPOSED_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    domain: t.domain,
    macro: t.macro,
  }));
}

export const MCP_HOST_CONSTANTS = Object.freeze({
  EXPOSED_TOOL_COUNT: EXPOSED_TOOLS.length,
});
