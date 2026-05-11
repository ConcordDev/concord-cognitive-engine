/**
 * MCP (Model Context Protocol) Server — JSON-RPC 2.0 Implementation
 *
 * Exposes all registered lens actions as MCP-compatible tools.
 * Implements the MCP protocol methods: initialize, tools/list, tools/call.
 *
 * Each tool is named as "domain.action" (e.g. "retail.reorderCheck"),
 * has a description derived from the DOMAIN_ACTION_MANIFEST or a default,
 * and accepts an input schema with domain-level parameters.
 *
 * @module mcp-server
 * @exports createMCPServer
 * @exports handleMCPRequest
 */

import logger from "../logger.js";

// ── MCP Protocol Constants ──────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION = "2024-11-05";
const MCP_SERVER_NAME = "concord-cognitive-engine";
const MCP_SERVER_VERSION = "1.0.0";

const JSONRPC_VERSION = "2.0";

// JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// ── Tool Schema Builders ────────────────────────────────────────────────────

/**
 * Build a JSON Schema input definition for a lens action.
 * If the manifest entry provides parameter hints we use them;
 * otherwise we expose a generic params object so callers can pass
 * arbitrary key/value pairs to the underlying handler.
 */
function buildInputSchema(domain, action, manifestEntry) {
  // Base schema — every tool accepts at minimum a free-form params object
  const schema = {
    type: "object",
    properties: {
      params: {
        type: "object",
        description: `Parameters for ${domain}.${action}. Pass action-specific key/value pairs.`,
        additionalProperties: true,
      },
    },
    required: [],
    additionalProperties: true,
  };

  // When the action operates on an artifact the caller can optionally
  // supply artifact data inline so domain-level (no-artifact) calls work too.
  schema.properties.artifactId = {
    type: "string",
    description: "Optional lens artifact ID. If omitted a virtual artifact is created.",
  };
  schema.properties.data = {
    type: "object",
    description: "Inline data payload — used when no artifact ID is given.",
    additionalProperties: true,
  };

  return schema;
}

/**
 * Derive a human-readable description for a tool.
 * Prefers the manifest desc; falls back to a generated string.
 */
function buildDescription(domain, action, manifestEntry) {
  if (manifestEntry?.desc) {
    return `[${domain}] ${manifestEntry.desc}`;
  }
  return `Execute the "${action}" action in the "${domain}" domain.`;
}

// ── MCP Server Factory ──────────────────────────────────────────────────────

/**
 * Create an MCP server instance bound to the engine's lens action registry.
 *
 * @param {Object} opts
 * @param {Map} opts.lensActions        — The LENS_ACTIONS map (key → handler)
 * @param {Object} opts.actionManifest  — DOMAIN_ACTION_MANIFEST { domain: [{action, desc, brain}] }
 * @param {Function} opts.makeCtx       — Context factory: (req?) => ctx
 * @param {Map} opts.lensArtifacts      — STATE.lensArtifacts map
 * @returns {{ handleRequest: Function, getToolCount: Function }}
 */
export function createMCPServer({
  lensActions,
  actionManifest = {},
  makeCtx,
  lensArtifacts,
} = {}) {
  if (!lensActions) throw new Error("mcp-server: lensActions map is required");
  if (!makeCtx) throw new Error("mcp-server: makeCtx function is required");

  // Pre-index manifest entries for fast lookup: "domain.action" → entry
  const manifestIndex = new Map();
  for (const [domain, actions] of Object.entries(actionManifest)) {
    for (const entry of actions) {
      manifestIndex.set(`${domain}.${entry.action}`, entry);
    }
  }

  // ── Session state (per-connection, lightweight) ─────────────────────────
  let initialized = false;
  let clientInfo = null;

  // ── Method handlers ─────────────────────────────────────────────────────

  /**
   * initialize — MCP handshake
   */
  function handleInitialize(params) {
    clientInfo = params?.clientInfo || null;
    initialized = true;

    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
      },
    };
  }

  /**
   * notifications/initialized — client acknowledgment (no-op, no response)
   */
  function handleInitialized() {
    return undefined; // notifications have no response
  }

  /**
   * tools/list — enumerate all registered lens actions as MCP tools
   *
   * Supports optional cursor-based pagination.  When the caller passes
   * { cursor: "<offset>" } we resume from that position.
   */
  function handleToolsList(params) {
    const PAGE_SIZE = 200;
    const offset = params?.cursor ? parseInt(params.cursor, 10) || 0 : 0;

    const keys = Array.from(lensActions.keys());
    const total = keys.length;
    const page = keys.slice(offset, offset + PAGE_SIZE);

    const tools = page.map((key) => {
      const [domain, ...rest] = key.split(".");
      const action = rest.join(".");
      const manifestEntry = manifestIndex.get(key);

      return {
        name: key,
        description: buildDescription(domain, action, manifestEntry),
        inputSchema: buildInputSchema(domain, action, manifestEntry),
      };
    });

    const nextOffset = offset + PAGE_SIZE;
    const nextCursor = nextOffset < total ? String(nextOffset) : undefined;

    return { tools, nextCursor };
  }

  /**
   * tools/call — execute a lens action by name
   *
   * MCP tools/call shape:
   *   { name: "domain.action", arguments: { ... } }
   *
   * Routes to the LENS_ACTIONS handler with a context, artifact, and params.
   */
  async function handleToolsCall(params, req) {
    const { name, arguments: args = {} } = params || {};

    if (!name) {
      throw makeRPCError(INVALID_PARAMS, "Missing required parameter: name");
    }

    const handler = lensActions.get(name);
    if (!handler) {
      throw makeRPCError(INVALID_PARAMS, `Unknown tool: ${name}`);
    }

    const [domain, ...rest] = name.split(".");
    const action = rest.join(".");

    // Build execution context
    const ctx = makeCtx(req || null);

    // Resolve or build artifact
    let artifact;
    if (args.artifactId && lensArtifacts) {
      artifact = lensArtifacts.get(args.artifactId);
      if (!artifact) {
        throw makeRPCError(INVALID_PARAMS, `Artifact not found: ${args.artifactId}`);
      }
    } else {
      // Virtual artifact for domain-level calls
      const data = (args.data && typeof args.data === "object") ? { ...args.data } : {};
      // Merge top-level args (excluding reserved + prototype keys) into data
      const reserved = new Set(["artifactId", "data", "params", "__proto__", "constructor", "prototype"]);
      for (const [k, v] of Object.entries(args)) {
        if (!reserved.has(k) && Object.prototype.hasOwnProperty.call(args, k)) data[k] = v;
      }
      artifact = {
        id: null,
        domain,
        type: "mcp_tool_call",
        data,
        meta: { source: "mcp", calledAt: new Date().toISOString() },
      };
    }

    // Merge params from args.params and top-level args
    const toolParams = { ...(args.params || {}) };
    const reserved = new Set(["artifactId", "data", "params", "__proto__", "constructor", "prototype"]);
    for (const [k, v] of Object.entries(args)) {
      if (!reserved.has(k) && !(k in toolParams) && Object.prototype.hasOwnProperty.call(args, k)) {
        toolParams[k] = v;
      }
    }

    try {
      const startMs = Date.now();
      const result = await handler(ctx, artifact, toolParams);
      const durationMs = Date.now() - startMs;

      logger.log("info", "mcp", `tools/call ${name}`, {
        domain,
        action,
        durationMs,
        ok: result?.ok !== false,
      });

      // MCP tools/call response must have content array
      const content = [];

      if (result !== null && result !== undefined) {
        if (typeof result === "string") {
          content.push({ type: "text", text: result });
        } else {
          content.push({
            type: "text",
            text: JSON.stringify(result, null, 2),
          });
        }
      } else {
        content.push({ type: "text", text: '{"ok": true}' });
      }

      return { content, isError: false };
    } catch (err) {
      logger.log("error", "mcp", `tools/call ${name} failed`, {
        error: err?.message || String(err),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: err?.message || String(err),
            }),
          },
        ],
        isError: true,
      };
    }
  }

  // ── JSON-RPC Dispatch ───────────────────────────────────────────────────

  /**
   * Handle a single JSON-RPC 2.0 request envelope.
   *
   * @param {Object} message — parsed JSON-RPC request
   * @param {Object} [req]   — optional Express req for context building
   * @returns {Object|undefined} JSON-RPC response (undefined for notifications)
   */
  async function handleRequest(message, req) {
    // Validate basic JSON-RPC structure
    if (!message || typeof message !== "object") {
      return errorResponse(null, PARSE_ERROR, "Parse error");
    }

    const { jsonrpc, method, params, id } = message;
    const isNotification = id === undefined || id === null;

    if (jsonrpc !== JSONRPC_VERSION) {
      return isNotification
        ? undefined
        : errorResponse(id, INVALID_REQUEST, "Invalid JSON-RPC version");
    }

    if (typeof method !== "string") {
      return isNotification
        ? undefined
        : errorResponse(id, INVALID_REQUEST, "Method must be a string");
    }

    try {
      let result;

      switch (method) {
        case "initialize":
          result = handleInitialize(params);
          break;

        case "notifications/initialized":
          handleInitialized();
          return undefined; // no response for notifications

        case "tools/list":
          if (!initialized) {
            throw makeRPCError(INVALID_REQUEST, "Server not initialized. Call 'initialize' first.");
          }
          result = handleToolsList(params);
          break;

        case "tools/call":
          if (!initialized) {
            throw makeRPCError(INVALID_REQUEST, "Server not initialized. Call 'initialize' first.");
          }
          result = await handleToolsCall(params, req);
          break;

        case "ping":
          result = {};
          break;

        default:
          throw makeRPCError(METHOD_NOT_FOUND, `Unknown method: ${method}`);
      }

      if (isNotification) return undefined;

      return {
        jsonrpc: JSONRPC_VERSION,
        id,
        result,
      };
    } catch (err) {
      if (isNotification) return undefined;

      if (err._rpcCode) {
        return errorResponse(id, err._rpcCode, err.message);
      }
      return errorResponse(id, INTERNAL_ERROR, err?.message || "Internal error");
    }
  }

  /**
   * Handle a raw JSON string or pre-parsed object.
   * Supports JSON-RPC batch requests (array of requests).
   *
   * @param {string|Object|Array} input — raw JSON string or parsed body
   * @param {Object} [req] — optional Express request
   * @returns {Object|Array|undefined} JSON-RPC response(s)
   */
  async function handleMCPRequest(input, req) {
    let parsed;

    if (typeof input === "string") {
      try {
        parsed = JSON.parse(input);
      } catch {
        return errorResponse(null, PARSE_ERROR, "Invalid JSON");
      }
    } else {
      parsed = input;
    }

    // Batch request
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return errorResponse(null, INVALID_REQUEST, "Empty batch");
      }
      const responses = [];
      for (const msg of parsed) {
        const resp = await handleRequest(msg, req);
        if (resp !== undefined) responses.push(resp);
      }
      return responses.length > 0 ? responses : undefined;
    }

    // Single request
    return handleRequest(parsed, req);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  return {
    handleRequest,
    handleMCPRequest,
    getToolCount: () => lensActions.size,
    getClientInfo: () => clientInfo,
    isInitialized: () => initialized,
  };
}

// ── Convenience: module-level handleMCPRequest ──────────────────────────────
// Allows creating a server and immediately exporting the handler.
// Usage:
//   const { handleMCPRequest } = createMCPServer({ ... });

export { createMCPServer as default };

// ── Helpers ─────────────────────────────────────────────────────────────────

function errorResponse(id, code, message, data) {
  return {
    jsonrpc: JSONRPC_VERSION,
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

function makeRPCError(code, message) {
  const err = new Error(message);
  err._rpcCode = code;
  return err;
}
