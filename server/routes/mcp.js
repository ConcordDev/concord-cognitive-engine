/**
 * MCP (Model Context Protocol) Routes — Express Router
 *
 * Endpoints:
 *   POST   /api/mcp                     — JSON-RPC 2.0 endpoint (initialize, tools/list, tools/call)
 *   POST   /api/mcp/tools/list          — REST: list all MCP tools
 *   POST   /api/mcp/tools/call          — REST: call a specific tool
 *   GET    /api/mcp/servers             — list configured external MCP servers
 *   POST   /api/mcp/servers             — add an external MCP server
 *   DELETE /api/mcp/servers/:id         — remove an external MCP server
 *   GET    /api/mcp/sse                 — SSE streaming endpoint for MCP responses
 *
 * The JSON-RPC endpoint (/api/mcp) implements the full MCP protocol;
 * the REST endpoints are convenience wrappers for clients that prefer
 * a traditional REST interface.
 *
 * @module routes/mcp
 */

import crypto from "crypto";
import { asyncHandler } from "../lib/async-handler.js";
import { createMCPServer } from "../lib/mcp-server.js";
import { MCPClient } from "../lib/mcp-client.js";
import { validateSafeFetchUrl } from "../lib/ssrf-guard.js";
import logger from "../logger.js";

// ── External Server Registry (in-memory, persists for lifetime of process) ──

const externalServers = new Map(); // id → { id, name, url, headers, addedAt, client }

// ── Tool authorization ─────────────────────────────────────────────────────
// SECURITY: a regular user calling `POST /api/mcp/tools/call` could
// previously invoke ANY registered lens action — including admin or
// internal-only tools — because the dispatcher only checked that the tool
// existed. We now apply a coarse role gate:
//   • Any tool in a domain namespace listed below requires admin role.
//   • Any tool name matching a dangerous verb requires admin role.
//   • Everything else requires an authenticated user (no anonymous).
// This is a coarse defense; the macro handlers themselves still perform
// their own ownership checks. The goal here is "tool-call from a JSON-RPC
// client shouldn't be cheaper than tool-call from the web UI".

const ADMIN_ONLY_TOOL_NAMESPACES = new Set([
  "admin", "system", "federation", "governance", "backup", "repair",
  "migration", "shadow", "plugin",
]);
const ADMIN_ONLY_TOOL_VERBS = new Set([
  "shutdown", "restart", "purge", "reset", "wipe", "delete_all",
  "promote", "demote", "impersonate", "revoke", "approve",
]);

function isAdminRole(actor) {
  const r = actor?.role || "guest";
  return r === "owner" || r === "admin" || r === "founder";
}

function authorizeToolCall(req, toolName) {
  // AUTH_MODE=public is the local-first single-user mode — tools are
  // available to anyone on the box. The gate only applies to
  // multi-user deployments.
  if (process.env.AUTH_MODE === "public") return { allowed: true };

  const actor = req.user || req.actor || null;
  if (!actor || !actor.id) {
    return { allowed: false, status: 401, reason: "Authentication required" };
  }
  if (!toolName || typeof toolName !== "string") {
    return { allowed: false, status: 400, reason: "tool name required" };
  }
  const normalized = toolName.toLowerCase();
  const [domain, ...rest] = normalized.split(".");
  const verb = rest.join(".");
  // Admin required only if:
  //   • namespace is explicitly admin-only, OR
  //   • verb is an EXACT match for a dangerous verb (was previously
  //     `.includes()` which false-positived on e.g. "reset_filters").
  const adminRequired =
    ADMIN_ONLY_TOOL_NAMESPACES.has(domain) ||
    ADMIN_ONLY_TOOL_VERBS.has(verb);
  if (adminRequired && !isAdminRole(actor)) {
    return { allowed: false, status: 403, reason: `Tool ${toolName} requires admin role` };
  }
  return { allowed: true };
}

// ── Router Factory ──────────────────────────────────────────────────────────

/**
 * @param {Object} deps
 * @param {Map}      deps.LENS_ACTIONS       — lens action registry
 * @param {Object}   deps.DOMAIN_ACTION_MANIFEST — manifest for descriptions
 * @param {Function} deps.makeCtx            — context factory
 * @param {Object}   deps.STATE              — global state (for lensArtifacts)
 */
export default function createMCPRouter({
  LENS_ACTIONS,
  MACROS,                  // Code Sprint C #12: also expose register()-style macros
  runMacro,                // Dispatcher for the above
  DOMAIN_ACTION_MANIFEST = {},
  makeCtx,
  STATE,
} = {}) {
  // We cannot import express.Router at module level (ESM compat), so
  // accept the express reference or use dynamic import.  The simplest
  // approach: build a plain function that registers on `app`.
  //
  // This follows the same pattern as registerShieldRoutes, registerSystemRoutes, etc.

  const mcpServer = createMCPServer({
    lensActions: LENS_ACTIONS,
    macros: MACROS,
    runMacro,
    actionManifest: DOMAIN_ACTION_MANIFEST,
    makeCtx,
    lensArtifacts: STATE?.lensArtifacts,
  });

  // SSE client tracking for streaming
  const sseClients = new Set();

  /**
   * Register all MCP routes on the given Express app.
   */
  function register(app) {

    // ── JSON-RPC 2.0 Endpoint (full MCP protocol) ──────────────────────

    app.post("/api/mcp", asyncHandler(async (req, res) => {
      try {
        // SECURITY: if the JSON-RPC body is a tools/call, apply the same
        // role gate used by the REST wrapper. Otherwise we'd have a
        // second door around the role check.
        if (req.body?.method === "tools/call") {
          const toolName = req.body?.params?.name;
          const auth = authorizeToolCall(req, toolName);
          if (!auth.allowed) {
            return res.status(auth.status).json({
              jsonrpc: "2.0",
              id: req.body?.id ?? null,
              error: { code: -32001, message: auth.reason },
            });
          }
        }
        const response = await mcpServer.handleMCPRequest(req.body, req);

        if (response === undefined) {
          // Notification — no response body
          return res.status(204).end();
        }

        return res.json(response);
      } catch (err) {
        logger.log("error", "mcp", "JSON-RPC dispatch error", { error: err?.message });
        return res.status(500).json({
          jsonrpc: "2.0",
          id: req.body?.id ?? null,
          error: {
            code: -32603,
            message: err?.message || "Internal error",
          },
        });
      }
    }));

    // ── REST: List Tools ────────────────────────────────────────────────

    app.post("/api/mcp/tools/list", asyncHandler(async (req, res) => {
      try {
        // Build a tools/list JSON-RPC call internally
        const rpcRequest = {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "rest-api", version: "1.0.0" },
          },
        };

        // Initialize + list in one go
        await mcpServer.handleRequest(rpcRequest, req);

        const listRequest = {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: req.body || {},
        };

        const response = await mcpServer.handleRequest(listRequest, req);

        // Also include tools from external servers
        const externalTools = [];
        for (const [, server] of externalServers) {
          if (server.client?.connected) {
            try {
              const remote = await server.client.listTools();
              for (const tool of remote) {
                externalTools.push({
                  ...tool,
                  _server: { id: server.id, name: server.name, url: server.url },
                });
              }
            } catch (err) {
              logger.log("warn", "mcp", `Failed listing tools from ${server.name}`, {
                error: err?.message,
              });
            }
          }
        }

        return res.json({
          ok: true,
          tools: response?.result?.tools || [],
          nextCursor: response?.result?.nextCursor,
          externalTools,
          totalLocal: LENS_ACTIONS.size,
          totalExternal: externalTools.length,
        });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err?.message || "Failed to list tools" });
      }
    }));

    // ── REST: Call Tool ──────────────────────────────────────────────────

    app.post("/api/mcp/tools/call", asyncHandler(async (req, res) => {
      try {
        const { name, arguments: args, params } = req.body || {};

        if (!name) {
          return res.status(400).json({ ok: false, error: "name is required" });
        }

        // SECURITY: per-tool role gate (see authorizeToolCall above).
        const auth = authorizeToolCall(req, name);
        if (!auth.allowed) {
          return res.status(auth.status).json({ ok: false, error: auth.reason });
        }

        const toolArgs = args || params || {};

        // Check if this is an external tool (prefixed with server id)
        const externalMatch = name.match(/^ext:([^:]+):(.+)$/);
        if (externalMatch) {
          const [, serverId, toolName] = externalMatch;
          const server = externalServers.get(serverId);
          if (!server?.client?.connected) {
            return res.status(404).json({ ok: false, error: `External server "${serverId}" not found or not connected` });
          }

          const result = await server.client.callTool(toolName, toolArgs);
          return res.json({ ok: true, result, source: "external", server: { id: server.id, name: server.name } });
        }

        // Local tool — route through MCP server
        // Initialize a fresh session for this REST call
        const initReq = {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "rest-api", version: "1.0.0" },
          },
        };
        await mcpServer.handleRequest(initReq, req);

        const callReq = {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name, arguments: toolArgs },
        };
        const response = await mcpServer.handleRequest(callReq, req);

        if (response?.error) {
          return res.status(400).json({ ok: false, error: response.error.message, rpcError: response.error });
        }

        // Broadcast to SSE clients
        broadcastSSE({
          type: "tool_result",
          tool: name,
          result: response?.result,
          timestamp: new Date().toISOString(),
        });

        return res.json({ ok: true, result: response?.result, source: "local" });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err?.message || "Failed to call tool" });
      }
    }));

    // ── External Server Management ──────────────────────────────────────

    app.get("/api/mcp/servers", (_req, res) => {
      const servers = [];
      for (const [, server] of externalServers) {
        servers.push({
          id: server.id,
          name: server.name,
          url: server.url,
          connected: server.client?.connected || false,
          serverInfo: server.client?.serverInfo || null,
          addedAt: server.addedAt,
        });
      }
      return res.json({ ok: true, servers, count: servers.length });
    });

    app.post("/api/mcp/servers", asyncHandler(async (req, res) => {
      try {
        // SECURITY: only admins can register external MCP servers. A
        // non-admin user could otherwise point the Concord node at an
        // attacker-controlled endpoint that then exfiltrates whatever
        // data the bridge forwards.
        if (!isAdminRole(req.user || req.actor)) {
          return res.status(403).json({ ok: false, error: "admin role required to register MCP servers" });
        }

        const { name, url, headers } = req.body || {};

        if (!url) {
          return res.status(400).json({ ok: false, error: "url is required" });
        }

        // SSRF: reject URLs that resolve to private ranges, localhost,
        // cloud metadata, etc. — even an admin shouldn't be able to
        // accidentally aim the bridge at internal infrastructure.
        const ssrfCheck = await validateSafeFetchUrl(url);
        if (!ssrfCheck.ok) {
          return res.status(400).json({ ok: false, error: `url rejected by SSRF guard: ${ssrfCheck.error}` });
        }

        // Check for duplicate URL
        for (const [, existing] of externalServers) {
          if (existing.url === url) {
            return res.status(409).json({
              ok: false,
              error: "Server with this URL already registered",
              existingId: existing.id,
            });
          }
        }

        const id = `mcp_${crypto.randomBytes(8).toString("hex")}`;
        const client = new MCPClient({
          clientName: "concord-mcp-bridge",
          clientVersion: "1.0.0",
          headers: headers || {},
        });

        // Attempt connection
        let connectionInfo;
        try {
          connectionInfo = await client.connect(url);
        } catch (err) {
          return res.status(502).json({
            ok: false,
            error: `Failed to connect to MCP server: ${err.message}`,
            url,
          });
        }

        const serverEntry = {
          id,
          name: name || connectionInfo.serverInfo?.name || url,
          url,
          headers: headers || {},
          addedAt: new Date().toISOString(),
          client,
        };

        externalServers.set(id, serverEntry);

        logger.log("info", "mcp", "External MCP server added", {
          id,
          name: serverEntry.name,
          url,
          toolCapabilities: connectionInfo.capabilities?.tools,
        });

        // Broadcast to SSE
        broadcastSSE({
          type: "server_added",
          server: { id, name: serverEntry.name, url },
          timestamp: new Date().toISOString(),
        });

        return res.status(201).json({
          ok: true,
          server: {
            id,
            name: serverEntry.name,
            url,
            connected: client.connected,
            serverInfo: connectionInfo.serverInfo,
            capabilities: connectionInfo.capabilities,
          },
        });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err?.message || "Failed to add server" });
      }
    }));

    app.delete("/api/mcp/servers/:id", (req, res) => {
      const { id } = req.params;
      const server = externalServers.get(id);

      if (!server) {
        return res.status(404).json({ ok: false, error: `Server "${id}" not found` });
      }

      // Disconnect the client
      try {
        server.client?.disconnect();
      } catch {
        // Ignore disconnect errors
      }

      externalServers.delete(id);

      logger.log("info", "mcp", "External MCP server removed", {
        id,
        name: server.name,
        url: server.url,
      });

      broadcastSSE({
        type: "server_removed",
        serverId: id,
        timestamp: new Date().toISOString(),
      });

      return res.json({ ok: true, removed: { id, name: server.name, url: server.url } });
    });

    // ── SSE Streaming Endpoint ──────────────────────────────────────────

    app.get("/api/mcp/sse", (req, res) => {
      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering
      });

      // Send initial connection event
      res.write(`data: ${JSON.stringify({
        type: "connected",
        serverName: "concord-mcp",
        toolCount: LENS_ACTIONS.size,
        externalServerCount: externalServers.size,
        timestamp: new Date().toISOString(),
      })}\n\n`);

      // Track this client
      const client = { id: crypto.randomBytes(8).toString("hex"), res, connectedAt: Date.now() };
      sseClients.add(client);

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          res.write(`: heartbeat\n\n`);
        } catch {
          clearInterval(heartbeat);
          sseClients.delete(client);
        }
      }, 30_000);

      // Cleanup on close
      req.on("close", () => {
        clearInterval(heartbeat);
        sseClients.delete(client);
      });
    });

    // ── Introspection Endpoint ──────────────────────────────────────────

    app.get("/api/mcp/status", (_req, res) => {
      return res.json({
        ok: true,
        protocol: "MCP",
        protocolVersion: "2024-11-05",
        server: "concord-cognitive-engine",
        localToolCount: LENS_ACTIONS.size,
        externalServers: externalServers.size,
        sseClients: sseClients.size,
        endpoints: {
          jsonrpc: "POST /api/mcp",
          listTools: "POST /api/mcp/tools/list",
          callTool: "POST /api/mcp/tools/call",
          servers: "GET|POST /api/mcp/servers",
          removeServer: "DELETE /api/mcp/servers/:id",
          sse: "GET /api/mcp/sse",
          status: "GET /api/mcp/status",
        },
      });
    });
  }

  // ── SSE Broadcast Helper ────────────────────────────────────────────────

  function broadcastSSE(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.res.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  return { register, mcpServer, externalServers, broadcastSSE };
}
