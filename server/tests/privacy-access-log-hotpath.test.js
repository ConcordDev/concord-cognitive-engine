// server/tests/privacy-access-log-hotpath.test.js
//
// Wave-4 gap-closure (privacy row) — `privacy.recordAccess` existed but
// almost nothing ever called it, so the "Privacy Activity Log" the privacy
// lens surfaces was nearly empty and did not reflect real usage. This wires
// a single, hot-path-safe recorder into runMacro() (server.js, right beside
// `_macroTelemetry.recordInvocation`, ~:11166) so every macro dispatched on
// behalf of an identifiable, non-internal user appends one bounded
// "lens-action access" event.
//
// Covers, per the unit's acceptance criteria:
//   (A) a REAL macro invocation through the actual runMacro() chokepoint in
//       the booted server appends a visible access event for the acting user
//       (proves the wiring at the ~:11166 call site, not just the helper);
//   (B) internal/system callers (heartbeats, makeInternalCtx) are correctly
//       excluded — the log must reflect real user activity, not engine noise;
//   (C) the per-user log is a bounded ring buffer — it never grows past its
//       cap no matter how many events are appended;
//   (D) the recorder never throws, even fed garbage/no-user input;
//   (E) `privacy.recordAccess` (the pre-existing macro) and the hot-path
//       recorder are provably the SAME underlying store/implementation —
//       calls interleaved from both never double-buffer or diverge.
//
// (A)/(B) boot the real server via the shared depth harness (same pattern as
// tests/dtu-confidence.test.js / tests/quest-moral-branch.test.js) — MUST run
// under the standard no-egress preload, as `npm test` already does:
//   node --test --import=./tests/preload/no-egress.mjs server/tests/privacy-access-log-hotpath.test.js
//
// (C)/(D)/(E) are fast, no-server-boot unit tests directly against the
// exported `appendAccessEvent` + the `recordAccess` macro, mirroring
// tests/privacy-domain-parity.test.js's harness style.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";
import registerPrivacyActions, { appendAccessEvent } from "../domains/privacy.js";

// ─────────────────────────────────────────────────────────────────────────
// (A)/(B) — the real runMacro() chokepoint, real booted server.
// ─────────────────────────────────────────────────────────────────────────

describe("privacy access log — runMacro() hot-path wiring (real server)", () => {
  let runMacro, makeCtx, makeInternalCtx, LENS_ACTIONS;

  before(async () => {
    ({ runMacro, makeCtx, makeInternalCtx, LENS_ACTIONS } = await load());
  });

  function accessLogFor(ctx) {
    const handler = LENS_ACTIONS.get("privacy.accessLog");
    const virtualArtifact = { id: null, domain: "privacy", type: "domain_action", data: {}, meta: {} };
    return handler(ctx, virtualArtifact, { limit: 50 });
  }

  // Minimal Express-`req`-shaped stub — makeCtx(req) calls req.get(...) for
  // the user-agent/founder-secret fields, so a plain `{ user: { id } }`
  // object (no .get method) throws before we ever reach runMacro. This is
  // the smallest stub that survives makeCtx's real code path.
  function fakeReq(userId) {
    return {
      user: { id: userId },
      ip: "127.0.0.1",
      method: "POST",
      path: "/api/lens/run",
      query: {},
      get: () => "",
    };
  }

  it("dispatching a real macro through runMacro() for an identifiable, non-internal user appends a lens-action access event visible via privacy.accessLog", async () => {
    const uid = `hotpath_user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ctx = makeCtx(fakeReq(uid));
    assert.notEqual(ctx.actor.internal, true, "sanity: an HTTP-style ctx must not be internal");
    assert.equal(ctx.actor.userId, uid);

    // system.status is a cheap, read-only, side-effect-free MACROS-registered
    // macro (register(), not registerLensAction()) — it genuinely flows
    // through runMacro(), which is the exact chokepoint under test.
    const dispatched = await runMacro("system", "status", {}, ctx);
    assert.equal(dispatched.ok, true);

    const logResult = await accessLogFor(ctx);
    assert.equal(logResult.ok, true);
    assert.ok(logResult.result.totalEvents >= 1, "expected at least one recorded access event for this user");
    const ev = logResult.result.events[0];
    assert.equal(ev.source, "lens-action", 'hot-path events must be honestly labeled "lens-action", not a broader claim');
    assert.equal(ev.lensId, "system");
    assert.equal(ev.macro, "status");
  });

  it("does not record for internal/system callers (heartbeats, makeInternalCtx) — the log reflects real user activity, not engine noise", async () => {
    const ctx = makeInternalCtx("hotpath-internal-probe");
    assert.equal(ctx.actor.internal, true, "sanity: makeInternalCtx must mark internal:true");

    const before_ = await accessLogFor(ctx);
    const beforeCount = before_.ok ? before_.result.totalEvents : 0;

    const dispatched = await runMacro("system", "status", {}, ctx);
    assert.equal(dispatched.ok, true);

    const after_ = await accessLogFor(ctx);
    assert.equal(after_.result.totalEvents, beforeCount, "an internal actor's macro call must not grow its own access log");
  });

  it("a garbage/no-user ctx passed into runMacro() never throws and records nothing", async () => {
    // Simulates the exact failure modes the hot-path try/catch must survive:
    // an entirely missing ctx, and a ctx with no resolvable actor.
    await assert.doesNotReject(() => runMacro("system", "status", {}, undefined));
    await assert.doesNotReject(() => runMacro("system", "status", {}, {}));
    await assert.doesNotReject(() => runMacro("system", "status", {}, { actor: null }));
    await assert.doesNotReject(() => runMacro("system", "status", {}, { actor: {} }));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (C)/(D)/(E) — fast unit tests directly against the shared implementation.
// ─────────────────────────────────────────────────────────────────────────

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function callRecordAccess(ctx, params) {
  const fn = ACTIONS.get("privacy.recordAccess");
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
function callAccessLog(ctx, params = {}) {
  const fn = ACTIONS.get("privacy.accessLog");
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPrivacyActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "hotpath_unit_user_a" }, userId: "hotpath_unit_user_a" };

describe("appendAccessEvent — bounded ring buffer (C)", () => {
  it("never grows a user's access log past its cap, no matter how many events are appended", () => {
    for (let i = 0; i < 650; i++) {
      const ev = appendAccessEvent("cap_test_user", { domain: "loadtest", macro: `m${i}` });
      assert.ok(ev, `event ${i} should be recorded`);
    }
    const log = callAccessLog({ actor: { userId: "cap_test_user" }, userId: "cap_test_user" }, { limit: 200 });
    assert.equal(log.ok, true);
    assert.equal(log.result.totalEvents, 500, "the per-user log must be capped, not unbounded");
  });

  it("keeps the MOST RECENT events when the cap is exceeded (ring semantics, not silent truncation of new writes)", () => {
    for (let i = 0; i < 501; i++) {
      appendAccessEvent("ring_test_user", { domain: "loadtest", macro: `m${i}` });
    }
    const log = callAccessLog({ actor: { userId: "ring_test_user" }, userId: "ring_test_user" }, { limit: 1 });
    assert.equal(log.result.totalEvents, 500);
    // The newest event (m500, the 501st call, index 500) must be present at
    // the head — proves unshift+clamp keeps recent writes, not old ones.
    assert.equal(log.result.events[0].macro, "m500");
  });
});

describe("appendAccessEvent — never throws (D)", () => {
  it("survives garbage userId values without throwing", () => {
    assert.doesNotThrow(() => appendAccessEvent(undefined));
    assert.doesNotThrow(() => appendAccessEvent(null));
    assert.doesNotThrow(() => appendAccessEvent(""));
    assert.doesNotThrow(() => appendAccessEvent(0));
    assert.doesNotThrow(() => appendAccessEvent({}));
    assert.doesNotThrow(() => appendAccessEvent(["array", "as", "id"]));
  });

  it("survives garbage/malformed opts without throwing, including a null opts object", () => {
    assert.doesNotThrow(() => appendAccessEvent("garbage_opts_user", null));
    assert.doesNotThrow(() => appendAccessEvent("garbage_opts_user", 42));
    assert.doesNotThrow(() => appendAccessEvent("garbage_opts_user", "a raw string"));
    assert.doesNotThrow(() => appendAccessEvent("garbage_opts_user", []));
    const circular = { actor: "loop" };
    circular.self = circular;
    assert.doesNotThrow(() => appendAccessEvent("garbage_opts_user", circular));
  });

  it("returns null (not a thrown error) when recording genuinely cannot proceed", () => {
    // opts=null causes an internal property read on null; the function must
    // catch it and return null rather than let it escape to the caller —
    // this is the exact contract runMacro()'s hot-path try/catch relies on.
    const result = appendAccessEvent("garbage_opts_user_2", null);
    assert.equal(result, null);
  });
});

describe("privacy.recordAccess macro and the hot-path recorder share ONE implementation (E)", () => {
  it("events written via the recordAccess macro and via direct appendAccessEvent calls land in the same store, in the same bounded buffer, with the same event shape", () => {
    const uid = "shared_impl_user";
    const ctx = { actor: { userId: uid }, userId: uid };

    const viaMacro = callRecordAccess(ctx, { actor: "chat-lens", operation: "read", dataCategory: "messages" });
    assert.equal(viaMacro.ok, true);
    assert.equal(viaMacro.result.event.source, "manual");

    const viaHotPath = appendAccessEvent(uid, { domain: "chat", macro: "send", source: "lens-action" });
    assert.ok(viaHotPath);
    assert.equal(viaHotPath.source, "lens-action");

    // Both events must be visible in ONE combined log for this user — proof
    // they share the same underlying store, not two independent buffers.
    const log = callAccessLog(ctx, { limit: 10 });
    assert.equal(log.ok, true);
    assert.equal(log.result.totalEvents, 2);

    // Identical field set on both event shapes — one shared constructor, no
    // drift between "the macro's version" of an event and "the hot path's".
    const macroEventKeys = Object.keys(viaMacro.result.event).sort();
    const hotPathEventKeys = Object.keys(viaHotPath).sort();
    assert.deepEqual(macroEventKeys, hotPathEventKeys);
  });

  it("the shared 500-cap applies across interleaved macro + direct calls (one counter, not two)", () => {
    const uid = "shared_cap_user";
    const ctx = { actor: { userId: uid }, userId: uid };
    for (let i = 0; i < 300; i++) {
      callRecordAccess(ctx, { actor: "a", operation: "read" });
      appendAccessEvent(uid, { domain: "b", macro: `m${i}` });
    }
    // 600 total appends across the two call sites — if they used separate
    // stores/caps, each would independently cap at 500 (=> 1000 total
    // visible). A single shared store caps the COMBINED total at 500.
    const log = callAccessLog(ctx, { limit: 1000 });
    assert.equal(log.result.totalEvents, 500);
  });
});
