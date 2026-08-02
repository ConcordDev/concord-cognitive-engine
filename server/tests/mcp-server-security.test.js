// server/tests/mcp-server-security.test.js
//
// Pins the 2026-08-02 MCP security fix (found while wiring ConKay/Concord
// chat's agent loop up to external MCP servers, per CLAUDE.md's "any real
// gap surfaces as a fingerprint, not an excuse" discipline):
//
//   1. mcp-bridge.js#connectMcpServer's kind='http' branch previously only
//      checked `^https?://` — no SSRF guard — so an authenticated caller
//      could point it at a loopback brain, an internal service, or a
//      cloud-metadata endpoint. Now routed through the same
//      `validateSafeFetchUrl` chokepoint every other user-supplied-URL
//      fetch in this codebase uses.
//   2. domains/mcp.js's `connect` macro previously gated kind='stdio'
//      (arbitrary local subprocess spawn — real RCE) behind nothing more
//      than "authenticated" — any logged-in user could run any local
//      command as the server process. Now admin/owner/founder-gated,
//      in-handler off ctx.actor.role, the same idiom domains/admin.js uses.
//
// These are exercised at the REAL module boundary (mcp-bridge.js's actual
// connectMcpServer + the actual domains/mcp.js macro handlers) — no
// mocking of the guard itself, so a regression in either the SSRF check or
// the role gate fails this file for real.

import test from "node:test";
import assert from "node:assert/strict";
import { connectMcpServer, disconnectAllMcpServers } from "../lib/mcp-bridge.js";
import registerMcpMacros from "../domains/mcp.js";

function collectMacros() {
  const registry = new Map();
  registerMcpMacros((domain, name, handler) => registry.set(`${domain}.${name}`, handler));
  return registry;
}

test.afterEach(async () => {
  await disconnectAllMcpServers();
});

test("connectMcpServer (http) blocks a loopback URL via the SSRF guard", async () => {
  const r = await connectMcpServer("t-loopback", { kind: "http", url: "http://127.0.0.1:5050/mcp" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "http_url_blocked");
  assert.match(r.error, /private|reserved|loopback/i);
});

test("connectMcpServer (http) blocks the AWS/cloud metadata endpoint", async () => {
  const r = await connectMcpServer("t-metadata", { kind: "http", url: "http://169.254.169.254/latest/meta-data/" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "http_url_blocked");
});

test("connectMcpServer (http) blocks a non-http(s) scheme before the SSRF check even runs", async () => {
  const r = await connectMcpServer("t-scheme", { kind: "http", url: "ftp://example.com/mcp" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "http_invalid_url");
});

test("mcp.connect macro denies kind='stdio' for a caller with no admin role", async () => {
  const macros = collectMacros();
  const connect = macros.get("mcp.connect");
  const ctx = { actor: { userId: "u1", role: "member" } };
  const r = await connect(ctx, { serverId: "t-stdio-denied", kind: "stdio", command: "/bin/true" });
  assert.equal(r.ok, false);
  assert.match(r.error, /admin role required/i);
});

test("mcp.connect macro denies kind='stdio' for a caller with NO role at all (the chat-agent ctx shape — fails closed)", async () => {
  const macros = collectMacros();
  const connect = macros.get("mcp.connect");
  const ctx = { actor: { userId: "u1" } }; // exactly what chat-agent.js's executeToolCall ctx looks like
  const r = await connect(ctx, { serverId: "t-stdio-no-role", kind: "stdio", command: "/bin/true" });
  assert.equal(r.ok, false);
  assert.match(r.error, /admin role required/i);
});

test("mcp.connect macro passes an admin caller through to the real connect attempt for kind='stdio'", async () => {
  const macros = collectMacros();
  const connect = macros.get("mcp.connect");
  const ctx = { actor: { userId: "admin1", role: "admin" } };
  // /bin/true exits immediately with no MCP handshake response, so the
  // real connect attempt fails downstream (connect_failed) — proving we got
  // PAST the role gate (a denial would short-circuit before ever spawning),
  // without needing a real MCP server subprocess in this test.
  const r = await connect(ctx, { serverId: "t-stdio-admin", kind: "stdio", command: "/bin/true", args: [] });
  assert.equal(r.ok, false); // /bin/true gives no real MCP handshake response
  assert.ok(!/admin role required/i.test(r.error || ""), `expected a downstream connect failure, not a role denial; got: ${r.error}`);
});

test("mcp.connect macro allows kind='http' for a plain authenticated (non-admin) caller, still SSRF-guarded", async () => {
  const macros = collectMacros();
  const connect = macros.get("mcp.connect");
  const ctx = { actor: { userId: "u1", role: "member" } };
  const r = await connect(ctx, { serverId: "t-http-member", kind: "http", url: "http://127.0.0.1:1/mcp" });
  // Reaches the SSRF guard (not an admin denial) — the failure reason proves
  // the role gate never fired for the http branch.
  assert.equal(r.ok, false);
  assert.equal(r.reason, "http_url_blocked");
});

test("mcp.disconnect macro is admin-gated even though the server is a shared/global resource", async () => {
  await connectMcpServer("t-disc-fixture", { kind: "stdio", command: "/bin/true" }).catch(() => {});
  const macros = collectMacros();
  const disconnect = macros.get("mcp.disconnect");
  const ctx = { actor: { userId: "u1", role: "member" } };
  const r = await disconnect(ctx, { serverId: "t-disc-fixture" });
  assert.equal(r.ok, false);
  assert.match(r.error, /admin role required/i);
});

test("mcp.connect normalizes a bare `reason` failure into `.error` for frontend consumption", async () => {
  const macros = collectMacros();
  const connect = macros.get("mcp.connect");
  const ctx = { actor: { userId: "u1", role: "member" } };
  const r = await connect(ctx, { serverId: "t-missing-url", kind: "http" }); // no url -> http_invalid_url, reason-only from mcp-bridge.js
  assert.equal(r.ok, false);
  assert.equal(r.error, "http_invalid_url");
});
