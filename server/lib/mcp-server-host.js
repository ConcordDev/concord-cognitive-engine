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
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { makeActorActionCap } from "./agent-guardrails.js";

// Per-caller rate cap for MCP tool calls (the endpoint was previously unbounded).
// Keyed by authed userId, else session id, else a shared anon bucket. Override via
// CONCORD_MCP_RATE (calls/min).
const _mcpCap = makeActorActionCap({ perActorPerMin: Number(process.env.CONCORD_MCP_RATE) || 60 });

/**
 * Gate one MCP tool call: write/personal tools require an authenticated actor;
 * every call is rate-limited per caller. Pure + exported so it's unit-testable.
 * @returns {{ allow: boolean, error?: string }}
 */
export function mcpCallGuard(tool, extra, cap = _mcpCap) {
  if (tool?.requiresAuth && !extra?.authInfo?.actor) {
    return { allow: false, error: "authentication_required: connect with an authorized Concord token to use this tool" };
  }
  const callerId = extra?.authInfo?.actor?.userId || extra?.sessionId || "mcp:anon";
  if (!cap.tryConsume(callerId)) {
    return { allow: false, error: "rate_limited: too many MCP calls — slow down" };
  }
  return { allow: true };
}


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
  // B2 — the verified-compute wedge: the differentiators that make Concord worth
  // an agent reaching for it. Read-only + deterministic → safe for anonymous use.
  {
    name: "concord.verify",
    description: "Verify a claim against its cited DTUs — a deterministic citation-resolution floor (catches fabricated citations) plus a multi-brain council judge. Returns a grounded/unsupported verdict with evidence. The 'substrate that verifies'.",
    domain: "reason", macro: "verify",
    inputSchema: { claim: z.string().describe("The claim to verify"), citations: z.array(z.string()).optional().describe("DTU ids that back the claim") },
  },
  {
    name: "concord.math",
    description: "Exact symbolic computation (CAS): simplify, differentiate, or integrate an expression. Deterministic — compute, don't guess.",
    domain: "math", macro: "symbolicCompute",
    inputSchema: { expression: z.string().describe("e.g. 'x^2 + 2*x + 1'"), operation: z.string().optional().describe("simplify | differentiate | integrate"), variable: z.string().optional().describe("default 'x'") },
  },
  {
    name: "concord.dtu.create",
    description: "Mint a DTU (Discrete Thought Unit) into Concord's substrate. Requires an authenticated Concord token.",
    domain: "dtu", macro: "create",
    inputSchema: { title: z.string(), body: z.string().optional(), tags: z.array(z.string()).optional() },
    requiresAuth: true,
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
          // B1 — gate: write/personal tools need auth; every call is rate-limited.
          const guard = mcpCallGuard(t, extra);
          if (!guard.allow) {
            return { content: [{ type: "text", text: guard.error }], isError: true };
          }
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
      // Session IDs must be unguessable: a leaked or guessed id would
      // let an unauthorized client hijack another user's MCP transport.
      // Use cryptographic randomness instead of Math.random (CodeQL gate).
      const sessionId = req.headers["mcp-session-id"] || `s_${Date.now()}_${randomBytes(12).toString("hex")}`;
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

  // B3 — discovery + auth metadata (no auth required; these are public).
  // Tool catalogue for directory listings / human inspection.
  app.get("/mcp/tools", (_req, res) => res.json({ server: "concord-cognitive-engine", tools: listExposedTools() }));
  // RFC 9728 Protected Resource Metadata — tells MCP clients where to obtain a
  // token for the auth-required tools (write/personal). Anonymous read tools work
  // without it.
  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    res.json(protectedResourceMetadata(`${req.protocol}://${req.get("host")}`));
  });

  return { ok: true, exposedToolCount: EXPOSED_TOOLS.length };
}

/**
 * RFC 9728 Protected Resource Metadata document. Points MCP clients at Concord's
 * OAuth authorization server for the tools that require auth.
 */
export function protectedResourceMetadata(baseUrl) {
  const origin = String(baseUrl || process.env.CONCORD_PUBLIC_URL || "").replace(/\/$/, "");
  const authServer = process.env.CONCORD_OAUTH_ISSUER || origin;
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [authServer],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/mcp/tools`,
    scopes_supported: ["concord:read", "concord:write"],
  };
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
