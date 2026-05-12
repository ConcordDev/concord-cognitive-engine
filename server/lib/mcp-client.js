/**
 * MCP (Model Context Protocol) Client — Connects to External MCP Servers
 *
 * Used by the brain tool-calling system when the target tool lives on
 * a remote MCP server rather than in the local lens action registry.
 *
 * Implements the client side of the MCP JSON-RPC 2.0 protocol:
 *   - connect(url)       — handshake with a remote MCP server
 *   - listTools()        — enumerate available tools
 *   - callTool(name, args) — invoke a remote tool and return the result
 *   - disconnect()       — clean up resources
 *
 * Supports both HTTP+JSON-RPC transport and SSE streaming transport.
 *
 * @module mcp-client
 * @exports MCPClient
 */

import logger from "../logger.js";
import { validateSafeFetchUrl, fetchWithPinnedIp } from "./ssrf-guard.js";

// ── Protocol Constants ──────────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION = "2024-11-05";
const JSONRPC_VERSION = "2.0";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;

// ── MCPClient Class ─────────────────────────────────────────────────────────

export class MCPClient {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.clientName]    — name sent during initialize
   * @param {string} [opts.clientVersion] — version sent during initialize
   * @param {number} [opts.timeoutMs]     — per-request timeout (default 30s)
   * @param {number} [opts.retryCount]    — automatic retries on transient errors
   * @param {number} [opts.retryDelayMs]  — delay between retries
   * @param {Object} [opts.headers]       — extra HTTP headers for every request
   */
  constructor(opts = {}) {
    this.clientName = opts.clientName || "concord-mcp-client";
    this.clientVersion = opts.clientVersion || "1.0.0";
    this.timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.retryCount = opts.retryCount ?? DEFAULT_RETRY_COUNT;
    this.retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.extraHeaders = opts.headers || {};

    // Connection state
    this._url = null;
    this._serverInfo = null;
    this._serverCapabilities = null;
    this._connected = false;
    this._requestId = 0;
    this._cachedTools = null;
    this._cachedToolsAt = 0;
    this._toolCacheTTLMs = 60_000; // cache tool list for 1 minute
  }

  // ── Connection Lifecycle ────────────────────────────────────────────────

  /**
   * Connect to a remote MCP server and perform the initialize handshake.
   *
   * @param {string} url — Base URL of the MCP server (e.g. "http://localhost:8080/mcp")
   * @returns {Object} Server info from the initialize response
   * @throws {Error} If the handshake fails
   */
  async connect(url) {
    if (!url || typeof url !== "string") {
      throw new Error("MCPClient.connect: url is required");
    }
    if (url.length > 2048) {
      throw new Error("MCPClient.connect: url exceeds 2048 chars");
    }

    // Strip trailing slashes without a regex (defangs polynomial-time match on
    // adversarial input like a 2KB string of '/' characters).
    let trimmed = url;
    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "/") {
      trimmed = trimmed.slice(0, -1);
    }

    // SSRF gate: validate the URL points to a public host before we make any
    // network request. Throws on metadata endpoints, private ranges, etc.
    const safety = await validateSafeFetchUrl(trimmed);
    if (!safety.ok) {
      throw new Error(`MCPClient.connect: URL rejected — ${safety.error}`);
    }
    this._url = safety.url;
    this._urlSafety = safety;
    this._connected = false;
    this._cachedTools = null;

    const result = await this._sendRequest("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: this.clientName,
        version: this.clientVersion,
      },
    });

    this._serverInfo = result.serverInfo || null;
    this._serverCapabilities = result.capabilities || {};
    this._connected = true;

    // Send initialized notification (fire-and-forget)
    this._sendNotification("notifications/initialized").catch(() => {
      // Notification failures are non-fatal
    });

    logger.log("info", "mcp-client", `Connected to ${url}`, {
      serverName: this._serverInfo?.name,
      serverVersion: this._serverInfo?.version,
      protocolVersion: result.protocolVersion,
    });

    return {
      serverInfo: this._serverInfo,
      capabilities: this._serverCapabilities,
      protocolVersion: result.protocolVersion,
    };
  }

  /**
   * Disconnect and clean up.
   */
  disconnect() {
    this._connected = false;
    this._cachedTools = null;
    this._serverInfo = null;
    this._serverCapabilities = null;
    this._url = null;
    this._urlSafety = null;

    logger.log("debug", "mcp-client", "Disconnected");
  }

  // ── Tool Operations ─────────────────────────────────────────────────────

  /**
   * List all tools available on the remote server.
   * Results are cached for `_toolCacheTTLMs` milliseconds.
   *
   * Automatically handles cursor-based pagination to fetch the complete list.
   *
   * @param {Object} [opts]
   * @param {boolean} [opts.forceRefresh] — bypass cache
   * @returns {Array<{name, description, inputSchema}>}
   */
  async listTools(opts = {}) {
    this._ensureConnected();

    // Return cached if fresh
    if (
      !opts.forceRefresh &&
      this._cachedTools &&
      Date.now() - this._cachedToolsAt < this._toolCacheTTLMs
    ) {
      return this._cachedTools;
    }

    const allTools = [];
    let cursor = undefined;

    // Paginate through all tools
    do {
      const params = cursor ? { cursor } : {};
      const result = await this._sendRequest("tools/list", params);

      if (Array.isArray(result.tools)) {
        allTools.push(...result.tools);
      }

      cursor = result.nextCursor || undefined;
    } while (cursor);

    this._cachedTools = allTools;
    this._cachedToolsAt = Date.now();

    logger.log("debug", "mcp-client", `Listed ${allTools.length} tools from ${this._url}`);

    return allTools;
  }

  /**
   * Call a tool on the remote server.
   *
   * @param {string} name      — tool name (e.g. "domain.action")
   * @param {Object} [args={}] — tool arguments (passed as `arguments` in JSON-RPC)
   * @returns {Object} Tool result with content array
   * @throws {Error} If the call fails or the tool returns isError: true
   */
  async callTool(name, args = {}) {
    this._ensureConnected();

    if (!name || typeof name !== "string") {
      throw new Error("MCPClient.callTool: name is required");
    }

    const startMs = Date.now();

    const result = await this._sendRequest("tools/call", {
      name,
      arguments: args,
    });

    const durationMs = Date.now() - startMs;

    logger.log("info", "mcp-client", `tools/call ${name}`, {
      durationMs,
      isError: result?.isError || false,
      contentCount: result?.content?.length || 0,
      server: this._url,
    });

    // If the tool reported an error, attach it to a thrown error so callers
    // can distinguish tool errors from transport errors.
    if (result?.isError) {
      const errorText = this._extractText(result.content);
      const err = new Error(`Tool "${name}" returned error: ${errorText}`);
      err.toolResult = result;
      throw err;
    }

    return result;
  }

  // ── Convenience Accessors ───────────────────────────────────────────────

  /** Whether the client has an active connection */
  get connected() {
    return this._connected;
  }

  /** Server info from the last successful handshake */
  get serverInfo() {
    return this._serverInfo;
  }

  /** Server capabilities from the last successful handshake */
  get serverCapabilities() {
    return this._serverCapabilities;
  }

  /** The URL this client is connected to */
  get url() {
    return this._url;
  }

  // ── Transport (HTTP + JSON-RPC) ─────────────────────────────────────────

  /**
   * Send a JSON-RPC request and wait for the response.
   * Retries on transient errors (network, 5xx).
   *
   * @private
   */
  async _sendRequest(method, params) {
    const id = ++this._requestId;

    const body = {
      jsonrpc: JSONRPC_VERSION,
      id,
      method,
      params: params || {},
    };

    let lastError;

    for (let attempt = 0; attempt <= this.retryCount; attempt++) {
      try {
        const response = await this._httpPost(body);

        // Validate JSON-RPC response
        if (response.error) {
          const errMsg = response.error.message || "Unknown RPC error";
          const err = new Error(`MCP RPC error (${response.error.code}): ${errMsg}`);
          err.rpcError = response.error;
          // Don't retry client errors (4xx equivalent)
          if (response.error.code >= -32600 && response.error.code <= -32603) {
            throw err;
          }
          lastError = err;
        } else {
          return response.result;
        }
      } catch (err) {
        lastError = err;

        // Don't retry if it's a definite client error
        if (err.rpcError && err.rpcError.code >= -32600 && err.rpcError.code <= -32603) {
          throw err;
        }

        // Log and retry
        if (attempt < this.retryCount) {
          logger.log("warn", "mcp-client", `Request ${method} attempt ${attempt + 1} failed, retrying`, {
            error: err.message,
            server: this._url,
          });
          await this._sleep(this.retryDelayMs * (attempt + 1));
        }
      }
    }

    throw lastError || new Error(`MCP request ${method} failed after ${this.retryCount + 1} attempts`);
  }

  /**
   * Send a JSON-RPC notification (no id, no response expected).
   *
   * @private
   */
  async _sendNotification(method, params) {
    const body = {
      jsonrpc: JSONRPC_VERSION,
      method,
      ...(params ? { params } : {}),
    };

    try {
      await this._httpPost(body);
    } catch {
      // Notifications are fire-and-forget; suppress errors
    }
  }

  /**
   * HTTP POST to the MCP server endpoint.
   *
   * @private
   */
  async _httpPost(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      // SSRF posture:
      //   - HAPPY PATH (this._urlSafety present from connect()): use
      //     fetchWithPinnedIp which pins the validated IP from handshake.
      //     No per-request DNS lookup, so transient DNS outage doesn't
      //     break in-flight RPCs. Per code-review feedback on PR #333:
      //     the previous per-request validateSafeFetchUrl call made
      //     EVERY RPC fail during DNS hiccups, even with a still-valid
      //     pinned IP.
      //   - FALLBACK PATH (no _urlSafety — e.g. connect() was bypassed):
      //     re-validate inline immediately before fetch so the sanitizer
      //     dataflow is visible to CodeQL's taint tracker.
      const init = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...this.extraHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      };
      let response;
      if (this._urlSafety) {
        // Pinned-IP fetch: connect to the IP we validated at connect() time,
        // eliminating DNS-rebinding between validation and request.
        // No per-call DNS lookup — connected MCP servers stay reachable
        // through transient resolver outages.
        response = await fetchWithPinnedIp(this._urlSafety, init);
      } else {
        const reChecked = await validateSafeFetchUrl(this._url);
        if (!reChecked.ok) {
          throw new Error(`SSRF re-validation failed: ${reChecked.error}`);
        }
        response = await fetch(reChecked.url, init);
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
      }

      const json = await response.json();
      return json;
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error(`MCP request timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  _ensureConnected() {
    if (!this._connected) {
      throw new Error("MCPClient is not connected. Call connect(url) first.");
    }
  }

  /**
   * Extract text content from an MCP content array.
   * @private
   */
  _extractText(content) {
    if (!Array.isArray(content)) return String(content || "");
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }

  _sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  /**
   * Return a serializable summary of this client's state.
   */
  toJSON() {
    return {
      url: this._url,
      connected: this._connected,
      serverInfo: this._serverInfo,
      capabilities: this._serverCapabilities,
      cachedToolCount: this._cachedTools?.length || 0,
    };
  }
}

export default MCPClient;
