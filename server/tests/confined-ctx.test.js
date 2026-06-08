/**
 * Phase 2 contract tests — the confined-`ctx` capability sandbox.
 *
 * Pins that a confined context confines: it reaches ONLY allowlisted macros, can
 * never reach forbidden/privileged domains or another user's data, holds no raw
 * db / mintCoins, and degrades to honest capability_denied (never a throw, never
 * a silent escalation). Security and the "concord-sdk" builder surface are the
 * same allowlist viewed from two sides.
 *
 * Run: node --test server/tests/confined-ctx.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate333 } from "../migrations/333_confined_kv.js";
import {
  makeConfinedCtx,
  compileManifest,
  assertConfined,
} from "../lib/confined-ctx.js";
import { makeActorActionCap } from "../lib/agent-guardrails.js";

// A fake runMacro that records what it was called with (so we can assert the
// confined actor + that NO db was handed through).
function spyRunMacro() {
  const calls = [];
  const fn = async (domain, name, input, ctx) => {
    calls.push({ domain, name, input, ctx });
    return { ok: true, result: { echoed: `${domain}.${name}` } };
  };
  fn.calls = calls;
  return fn;
}

describe("compileManifest", () => {
  it("grants a whole domain via 'domain.*' or bare 'domain'", () => {
    const m = compileManifest(["dtu.*", "discovery"]);
    assert.equal(m("dtu", "create"), true);
    assert.equal(m("dtu", "anything"), true);
    assert.equal(m("discovery", "search"), true);
    assert.equal(m("music", "play"), false);
  });
  it("grants a single macro via 'domain.macro'", () => {
    const m = compileManifest(["discovery.search"]);
    assert.equal(m("discovery", "search"), true);
    assert.equal(m("discovery", "trending"), false);
  });
});

describe("makeConfinedCtx — capability confinement", () => {
  it("requires userId + runMacro", () => {
    assert.throws(() => makeConfinedCtx({ runMacro: () => {} }), /userId required/);
    assert.throws(() => makeConfinedCtx({ userId: "u" }), /runMacro required/);
  });

  it("allows a manifest-granted macro and delegates with a confined, non-internal agent actor (no db)", async () => {
    const run = spyRunMacro();
    const ctx = makeConfinedCtx({ userId: "u1", runMacro: run, manifest: { macros: ["dtu.*", "discovery.search"] } });
    const r = await ctx.runMacro("dtu", "create", { title: "x" });
    assert.equal(r.ok, true);
    const call = run.calls[0];
    assert.equal(call.ctx.actor.userId, "u1");
    assert.equal(call.ctx.actor.is_agent, true);
    assert.equal(call.ctx.actor.internal, false);
    assert.equal(call.ctx.actor.confined, true);
    assert.equal("db" in call.ctx, false, "no raw db handed to the delegate");
  });

  it("denies a macro NOT in the manifest (default-deny)", async () => {
    const run = spyRunMacro();
    const ctx = makeConfinedCtx({ userId: "u1", runMacro: run, manifest: { macros: ["discovery.search"] } });
    const r = await ctx.runMacro("music", "play", {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "capability_denied");
    assert.equal(run.calls.length, 0, "forbidden call never reaches the real runMacro");
  });

  it("denies forbidden/operator domains EVEN IF the manifest grants them", async () => {
    const run = spyRunMacro();
    // a malicious manifest tries to grant code/repair/admin/config
    const ctx = makeConfinedCtx({ userId: "u1", runMacro: run, manifest: { macros: ["code.*", "repair.*", "admin.*", "config.*"] } });
    for (const [d, n] of [["code", "exec"], ["repair", "force-cycle"], ["admin", "anything"], ["config", "set"]]) {
      const r = await ctx.runMacro(d, n, {});
      assert.equal(r.ok, false, `${d}.${n} must be denied`);
      assert.equal(r.error, "capability_denied");
    }
    assert.equal(run.calls.length, 0);
  });

  it("hard-denies privileged money movers regardless of manifest", async () => {
    const run = spyRunMacro();
    const ctx = makeConfinedCtx({ userId: "u1", runMacro: run, manifest: { macros: ["economy.*"] } });
    const r = await ctx.runMacro("economy", "mint", { amount: 1e9 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "capability_denied");
  });

  it("the ctx exposes NO raw db and NO mintCoins; assertConfined passes", () => {
    const run = spyRunMacro();
    const ctx = makeConfinedCtx({ userId: "u1", runMacro: run, manifest: { macros: ["dtu.*"] } });
    assert.equal("db" in ctx, false);
    assert.equal("mintCoins" in ctx, false);
    assert.equal("mintCoins" in ctx.sdk, false);
    assert.equal(assertConfined(ctx).ok, true);
  });

  it("enforces a per-actor action cap", async () => {
    const run = spyRunMacro();
    const cap = makeActorActionCap({ perActorPerMin: 2, now: () => 0 }); // 2 tokens, clock frozen
    const ctx = makeConfinedCtx({ userId: "u1", runMacro: run, manifest: { macros: ["dtu.*"] }, actionCap: cap });
    assert.equal((await ctx.runMacro("dtu", "create", {})).ok, true);
    assert.equal((await ctx.runMacro("dtu", "create", {})).ok, true);
    const third = await ctx.runMacro("dtu", "create", {});
    assert.equal(third.ok, false);
    assert.equal(third.error, "rate_limited");
  });
});

describe("concord-sdk — the builder face of the same allowlist", () => {
  let db;
  beforeEach(() => { db = new Database(":memory:"); migrate333(db); });
  afterEach(() => { db.close(); });

  it("sdk.kv is per-user scoped — user B cannot read user A's key (object-capability)", () => {
    const run = spyRunMacro();
    const a = makeConfinedCtx({ userId: "ua", runMacro: run, db, manifest: {} });
    const b = makeConfinedCtx({ userId: "ub", runMacro: run, db, manifest: {} });
    assert.equal(a.sdk.kv.set("secret", { v: 42 }), true);
    assert.deepEqual(a.sdk.kv.get("secret"), { v: 42 });
    assert.equal(b.sdk.kv.get("secret"), null, "user B holds no reference to user A's data");
    assert.deepEqual(a.sdk.kv.keys(), ["secret"]);
    assert.deepEqual(b.sdk.kv.keys(), []);
    assert.equal(a.sdk.kv.delete("secret"), true);
    assert.equal(a.sdk.kv.get("secret"), null);
  });

  it("sdk exposes the bundled dep catalog + the allowlisted macro fn, nothing raw", () => {
    const run = spyRunMacro();
    const ctx = makeConfinedCtx({ userId: "u1", runMacro: run, db, manifest: { macros: ["dtu.*"] } });
    assert.ok(Array.isArray(ctx.sdk.deps) && ctx.sdk.deps.includes("three") && ctx.sdk.deps.includes("monaco-editor"));
    assert.equal(typeof ctx.sdk.macro, "function");
    assert.equal("db" in ctx.sdk, false);
  });
});
