/**
 * B1/B2/B3 contract tests — MCP server hardening + the verified-compute wedge.
 *
 * Pins: write/personal tools require an authenticated actor; every call is
 * rate-limited per caller; the verified-compute tools (concord.verify / concord.math)
 * are exposed and anonymous-safe while concord.dtu.create requires auth; and the
 * RFC 9728 Protected Resource Metadata is spec-shaped.
 *
 * Run: node --test server/tests/mcp-host.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mcpCallGuard, listExposedTools, protectedResourceMetadata } from "../lib/mcp-server-host.js";
import { makeActorActionCap } from "../lib/agent-guardrails.js";

describe("mcpCallGuard — auth + rate limit", () => {
  it("requires an authenticated actor for write/personal tools", () => {
    const cap = makeActorActionCap({ perActorPerMin: 100 });
    const writeTool = { name: "concord.dtu.create", requiresAuth: true };
    const anon = mcpCallGuard(writeTool, { sessionId: "s1" }, cap);
    assert.equal(anon.allow, false);
    assert.match(anon.error, /authentication_required/);
    const authed = mcpCallGuard(writeTool, { authInfo: { actor: { userId: "u1" } } }, cap);
    assert.equal(authed.allow, true);
  });

  it("allows anonymous use of read tools but rate-limits per caller", () => {
    const cap = makeActorActionCap({ perActorPerMin: 2, now: () => 0 }); // 2 tokens, frozen clock
    const readTool = { name: "concord.verify" };
    assert.equal(mcpCallGuard(readTool, { sessionId: "s1" }, cap).allow, true);
    assert.equal(mcpCallGuard(readTool, { sessionId: "s1" }, cap).allow, true);
    const third = mcpCallGuard(readTool, { sessionId: "s1" }, cap);
    assert.equal(third.allow, false);
    assert.match(third.error, /rate_limited/);
    // a different caller has its own bucket
    assert.equal(mcpCallGuard(readTool, { sessionId: "s2" }, cap).allow, true);
  });
});

describe("the verified-compute wedge is exposed", () => {
  it("exposes concord.verify (reason.verify) and concord.math (CAS)", () => {
    const names = listExposedTools().map((t) => t.name);
    assert.ok(names.includes("concord.verify"), "reason.verify exposed");
    assert.ok(names.includes("concord.math"), "math CAS exposed");
    assert.ok(names.includes("concord.dtu.search"), "existing tools still present");
  });
});

describe("RFC 9728 Protected Resource Metadata", () => {
  it("returns a spec-shaped PRM doc pointing at the resource + auth server", () => {
    const prm = protectedResourceMetadata("https://concord-os.org");
    assert.equal(prm.resource, "https://concord-os.org/mcp");
    assert.ok(Array.isArray(prm.authorization_servers) && prm.authorization_servers.length >= 1);
    assert.deepEqual(prm.bearer_methods_supported, ["header"]);
    assert.ok(prm.scopes_supported.includes("concord:read") && prm.scopes_supported.includes("concord:write"));
  });
});
