// Platform-internal lens domains (debug, ops, system) use the same
// requireRole middleware as other admin routes. A member is refused, an
// admin-or-higher role is allowed, an anonymous caller is refused, and a
// member can still run a normal lens domain. organ and root are not in
// the set. This file does not boot server.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRoleGate } from "../lib/role-gate.js";
import { runLensActionMcp } from "../lib/mcp-execution-bridge.js";
import {
  PLATFORM_INTERNAL_LENS_DOMAINS,
  PLATFORM_INTERNAL_LENS_ROLES,
  enforcePlatformInternalLensRole,
  isPlatformInternalLensDomain,
  platformInternalLensDenial,
} from "../lib/platform-internal-lens-gate.js";

const { requireRole } = createRoleGate(() => "hybrid");
const { requireRole: requireRolePublic } = createRoleGate(() => "public");

const ROLES = ["owner", "admin", "sovereign", "founder"];
const SAMPLES = [
  ["debug", "alert-list"],
  ["ops", "alertList"],
  ["system", "health"],
];

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    wrote: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.wrote = true; return this; },
  };
}

function userReq(role, scopes = ["read", "write"]) {
  return { user: { id: `u_${role}`, role, scopes }, ctx: {} };
}

function dispatch(domain, req, gate = requireRole) {
  const res = mockRes();
  let ran = false;
  const denied = enforcePlatformInternalLensRole(req, res, domain, gate);
  if (!denied) ran = true;
  return { denied, ran, status: res.statusCode, body: res.body, wrote: res.wrote };
}

describe("platform-internal lens role gate", () => {
  it("covers debug, ops, and system, and leaves organ and root alone", () => {
    assert.deepEqual([...PLATFORM_INTERNAL_LENS_DOMAINS], ["debug", "ops", "system"]);
    assert.deepEqual([...PLATFORM_INTERNAL_LENS_ROLES], ROLES);
    assert.equal(isPlatformInternalLensDomain("organ"), false);
    assert.equal(isPlatformInternalLensDomain("root"), false);
    assert.equal(isPlatformInternalLensDomain("sentinel"), false);
  });

  it("refuses a member with the admin-route 403 body and does not run the handler", () => {
    for (const [domain] of SAMPLES) {
      const out = dispatch(domain, userReq("member"));
      assert.equal(out.denied, true, domain);
      assert.equal(out.ran, false, domain);
      assert.equal(out.status, 403, domain);
      assert.equal(out.body.ok, false);
      assert.equal(out.body.error, "Insufficient permissions");
      assert.deepEqual(out.body.requiredRoles, ROLES);
    }
  });

  it("allows owner, admin, founder, and sovereign, and runs the handler", () => {
    for (const role of ROLES) {
      for (const [domain] of SAMPLES) {
        const out = dispatch(domain, userReq(role));
        assert.equal(out.denied, false, `${role} ${domain}`);
        assert.equal(out.ran, true, `${role} ${domain}`);
        assert.equal(out.wrote, false, `${role} ${domain}`);
      }
    }
  });

  it("refuses an anonymous caller with the admin-route 401 body", () => {
    for (const [domain] of SAMPLES) {
      const out = dispatch(domain, { ctx: {} });
      assert.equal(out.ran, false, domain);
      assert.equal(out.status, 401, domain);
      assert.deepEqual(out.body, { ok: false, error: "Authentication required" });
    }
  });

  it("still lets a member run a normal lens action", () => {
    const out = dispatch("music", userReq("member"));
    assert.equal(out.denied, false);
    assert.equal(out.ran, true);
    assert.equal(out.wrote, false);
    assert.equal(dispatch("cooking", { ctx: {} }).ran, true);
  });

  it("refuses council and allows an internal caller and a wildcard scope", () => {
    const council = dispatch("system", userReq("council"));
    assert.equal(council.status, 403);
    assert.equal(council.ran, false);

    const internal = platformInternalLensDenial(
      { internal: true, actor: { userId: "system", role: "member", scopes: ["read"] } },
      "ops",
      requireRole,
    );
    assert.equal(internal, null);

    const star = dispatch("debug", userReq("member", ["*"]));
    assert.equal(star.denied, false);
    assert.equal(star.ran, true);
  });

  it("maps a macro ctx to the same refusal a route would send", () => {
    const member = platformInternalLensDenial(
      { actor: { userId: "m1", role: "member", scopes: ["read", "write"] } },
      "system",
      requireRole,
    );
    assert.equal(member.status, 403);
    assert.equal(member.body.error, "Insufficient permissions");
    assert.deepEqual(member.body.requiredRoles, ROLES);

    const anon = platformInternalLensDenial(
      { actor: { userId: "anon", role: "viewer", scopes: ["read"] } },
      "debug",
      requireRole,
    );
    assert.equal(anon.status, 401);
    assert.equal(anon.body.error, "Authentication required");

    assert.equal(
      platformInternalLensDenial(
        { actor: { userId: "a1", role: "admin", scopes: ["read", "write"] } },
        "ops",
        requireRole,
      ),
      null,
    );
    assert.equal(
      platformInternalLensDenial(
        { actor: { userId: "m1", role: "member" } },
        "organ",
        requireRole,
      ),
      null,
    );
  });

  it("follows requireRole in public auth mode", () => {
    const out = dispatch("system", { ctx: {} }, requireRolePublic);
    assert.equal(out.denied, false);
    assert.equal(out.ran, true);
  });

  it("the chat bridge hook refuses a member and still runs a normal lens action", async () => {
    const prevDeny = globalThis.__concordPlatformInternalLensDenial;
    const prevActions = globalThis.__concordLensActions;
    const ran = new Set();
    globalThis.__concordPlatformInternalLensDenial = (ctx, domain) =>
      platformInternalLensDenial(ctx, domain, requireRole);
    globalThis.__concordLensActions = new Map([
      ["system.health", async () => { ran.add("system.health"); return { ok: true, result: { status: "up" } }; }],
      ["music.list", async () => { ran.add("music.list"); return { ok: true, result: { n: 1 } }; }],
    ]);
    const member = { id: "member-1", userId: "member-1", role: "member", scopes: ["read", "write"] };
    // Unscoped sessions are admitted by the bridge; the domain gate still applies.
    const memberSession = { ...member, scopes: [] };
    const admin = { id: "admin-1", userId: "admin-1", role: "admin", scopes: [] };
    try {
      const denied = await runLensActionMcp(null, { domain: "system", action: "health" }, null, { actor: memberSession });
      assert.equal(denied.ok, false);
      assert.equal(denied.error, "Insufficient permissions");
      assert.deepEqual(denied.requiredRoles, ROLES);
      assert.equal(ran.has("system.health"), false);

      const allowed = await runLensActionMcp(null, { domain: "system", action: "health" }, null, { actor: admin });
      assert.equal(allowed.ok, true);
      assert.equal(ran.has("system.health"), true);

      ran.clear();
      const music = await runLensActionMcp(null, { domain: "music", action: "list" }, null, { actor: memberSession });
      assert.equal(music.ok, true);
      assert.equal(ran.has("music.list"), true);

      const domainKey = { ...member, scopes: ["ops"] };
      const scopedMember = await runLensActionMcp(null, { domain: "ops", action: "alertList" }, null, { actor: domainKey });
      assert.equal(scopedMember.ok, false);
      assert.equal(scopedMember.error, "Insufficient permissions");
    } finally {
      if (prevDeny === undefined) delete globalThis.__concordPlatformInternalLensDenial;
      else globalThis.__concordPlatformInternalLensDenial = prevDeny;
      if (prevActions === undefined) delete globalThis.__concordLensActions;
      else globalThis.__concordLensActions = prevActions;
    }
  });
});

describe("platform-internal lens gate is wired before dispatch", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const serverSrc = readFileSync(join(root, "server.js"), "utf8");
  const domainSrc = readFileSync(join(root, "routes/domain.js"), "utf8");
  const bridgeSrc = readFileSync(join(root, "lib/mcp-execution-bridge.js"), "utf8");

  function sliceBetween(src, start, end) {
    const i = src.indexOf(start);
    assert.ok(i >= 0, `missing ${start}`);
    const j = src.indexOf(end, i + start.length);
    assert.ok(j > i, `missing ${end} after ${start}`);
    return src.slice(i, j);
  }

  it("POST /api/lens/run checks the role before dual-registry dispatch", () => {
    const route = sliceBetween(serverSrc, 'app.post("/api/lens/run"', 'app.post("/api/lens/:domain/:id/run"');
    const gateAt = route.indexOf("enforcePlatformInternalLensRole");
    const resolveAt = route.indexOf("_resolveDualRegistry");
    assert.ok(gateAt >= 0 && resolveAt > gateAt);
    assert.ok(route.indexOf("domain and action required") < gateAt);
  });

  it("artifact run, lens.run, gateway, MCP, and macros/run call the same helper first", () => {
    const artifact = sliceBetween(serverSrc, 'app.post("/api/lens/:domain/:id/run"', 'app.get("/api/lens/:domain/:id/export"');
    assert.ok(artifact.indexOf("enforcePlatformInternalLensRole") < artifact.indexOf('runMacro("lens", "run"'));

    const lensRun = sliceBetween(serverSrc, 'register("lens", "run"', 'register("lens", "export"');
    assert.ok(lensRun.indexOf("platformInternalLensDenial") < lensRun.indexOf("invokeLensHandler"));

    const wrapper = serverSrc.match(/async function _runMacroFromGateway[\s\S]*?^function /m);
    assert.ok(wrapper, "could not isolate _runMacroFromGateway");
    assert.ok(wrapper[0].indexOf("platformInternalLensDenial") < wrapper[0].indexOf("_dispatchDesignCommand"));
    assert.match(wrapper[0], /_lensActionForbiddenForAnon\(/);
    assert.match(wrapper[0], /path:\s*"\/api\/lens\/run"/);
    assert.doesNotMatch(wrapper[0], /role:\s*"system"/);

    const mcp = serverSrc.match(/async function runMcpTool[\s\S]*?globalThis\.__concordRunMcpTool/);
    assert.ok(mcp, "could not isolate runMcpTool");
    assert.ok(mcp[0].indexOf("platformInternalLensDenial") < mcp[0].indexOf("_resolveDualRegistry"));

    const macros = sliceBetween(domainSrc, 'app.post("/api/macros/run"', 'app.get("/api/grc/schema"');
    assert.ok(macros.indexOf("isPlatformInternalLensDomain") < macros.indexOf("runMacro("));
    assert.ok(macros.indexOf("enforcePlatformInternalLensRole") < macros.indexOf("runMacro("));

    const reg = serverSrc.match(/registerDomainRoutes\(app, \{[\s\S]*?\}\);/);
    assert.ok(reg);
    assert.match(reg[0], /\brequireRole\b/);
    assert.match(serverSrc, /globalThis\.__concordPlatformInternalLensDenial/);

    const chat = bridgeSrc.match(/export async function runLensActionMcp[\s\S]*?const resolved = resolveDualRegistry/);
    assert.ok(chat);
    assert.match(chat[0], /__concordPlatformInternalLensDenial/);
  });
});
