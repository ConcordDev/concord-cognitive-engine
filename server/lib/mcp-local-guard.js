// server/lib/mcp-local-guard.js
//
// Tools on /mcp/call that write per-entity runtime state (rt_tick) or expose
// it (rt_drives, rt_tick_history). The general CONCORD_MCP_PUBLIC bypass gives
// every anonymous /mcp caller a synthetic identity, and /mcp/call is reachable
// through the public tunnel, so these tools must not ride that bypass. They
// are allowed for:
//   - a request whose TCP peer is loopback and that carries no proxy header
//     (the on-host entity heartbeat: launchd com.concord.entity-heartbeat), or
//   - a real resolved user (req.authMethod !== "mcp-bypass").
// Cloudflare and the Next.js proxy both reach the backend from loopback, but
// they always add CF-Connecting-IP / X-Forwarded-For, so they do not count as
// direct-local.

import { isLoopbackAddress, normalizeIp } from "./trusted-client-ip.js";

export const MCP_TOOLS_LOCAL_OR_REAL_AUTH = new Set([
  "rt_tick",
  "rt_drives",
  "rt_tick_history",
]);

const PROXY_HEADERS = ["cf-connecting-ip", "x-forwarded-for", "x-real-ip", "forwarded", "true-client-ip"];

/** True when the request came straight from this host, not via a proxy. */
export function isDirectLocalRequest(req) {
  if (!req) return false;
  const peer = normalizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress || "");
  if (!peer || !isLoopbackAddress(peer)) return false;
  const h = req.headers || {};
  for (const name of PROXY_HEADERS) {
    if (h[name] != null && String(h[name]).trim() !== "") return false;
  }
  return true;
}

/** Whether `tool` may run for this request. Tools outside the set are not judged here. */
export function mcpLocalGuardAllows(tool, req) {
  if (!MCP_TOOLS_LOCAL_OR_REAL_AUTH.has(tool)) return true;
  if (req?.user && req.authMethod !== "mcp-bypass") return true;
  return isDirectLocalRequest(req);
}
