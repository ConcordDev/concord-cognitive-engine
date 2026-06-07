/**
 * ConKay honest event spine — macro:* lifecycle contract (Track B / Phase 0).
 *
 * The keystone of the honest hologram: app.post("/api/lens/run") emits a REAL
 * lifecycle (`macro:started` → optional `macro:stage` → `macro:completed`) to
 * the caller's `user:<id>` room when the request opts in with a correlation id
 * (header `x-conkay-run-id` or body `__runId`). The HUD animates the actual
 * call beginning/ending — never a guessed spinner.
 *
 * This pins two halves of the contract:
 *   1. The EVENT_SHAPES registry recognises the three events and validates the
 *      exact payloads the handler emits (and rejects malformed ones). The
 *      dev-mode validator runs inline inside realtimeEmit, so a drift between
 *      the handler payload and the registry would warn at runtime — this test
 *      catches it at CI time instead.
 *   2. realtimeEmit accepts the new `{ userId }` targeting option without
 *      throwing (it routes to the user:<id> room). In the no-listen test env
 *      REALTIME.io is null, so it returns the socket-not-ready shape — which is
 *      enough to prove the option is plumbed end-to-end.
 *
 * Run: node --test tests/conkay-macro-lifecycle.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EVENT_SHAPES, validateEvent } from "../lib/event-shapes.js";

describe("ConKay macro lifecycle — EVENT_SHAPES registration", () => {
  it("registers macro:started, macro:stage, macro:completed", () => {
    assert.ok(EVENT_SHAPES["macro:started"], "macro:started must be registered");
    assert.ok(EVENT_SHAPES["macro:stage"], "macro:stage must be registered");
    assert.ok(EVENT_SHAPES["macro:completed"], "macro:completed must be registered");
  });

  it("macro:started / macro:completed require the runId correlation id", () => {
    assert.ok(EVENT_SHAPES["macro:started"].required.includes("runId"));
    assert.ok(EVENT_SHAPES["macro:completed"].required.includes("runId"));
    assert.ok(EVENT_SHAPES["macro:stage"].required.includes("runId"));
  });
});

describe("ConKay macro lifecycle — payload validation (mirrors the handler emits)", () => {
  it("accepts the macro:started payload the handler emits", () => {
    // emitMacroLife("macro:started", {}) → { runId, domain, action }
    const v = validateEvent("macro:started", { runId: "r-1", domain: "math", action: "naturalQuery" });
    assert.equal(v.ok, true, JSON.stringify(v));
  });

  it("accepts the macro:completed success payload (ok:true, real ms)", () => {
    const v = validateEvent("macro:completed", { runId: "r-1", domain: "math", action: "naturalQuery", ok: true, ms: 42 });
    assert.equal(v.ok, true, JSON.stringify(v));
  });

  it("accepts the macro:completed failure payload (ok:false + error)", () => {
    const v = validateEvent("macro:completed", { runId: "r-1", domain: "math", action: "naturalQuery", ok: false, ms: 17, error: "macro_unavailable" });
    assert.equal(v.ok, true, JSON.stringify(v));
  });

  it("accepts a macro:stage payload (for future stage-emitting macros)", () => {
    const v = validateEvent("macro:stage", { runId: "r-1", stage: "route→math", index: 1, total: 3 });
    assert.equal(v.ok, true, JSON.stringify(v));
  });

  it("rejects a macro:started missing the runId", () => {
    const v = validateEvent("macro:started", { domain: "math", action: "naturalQuery" });
    assert.equal(v.ok, false);
    assert.ok((v.missing || []).includes("runId"));
  });

  it("rejects a macro:completed missing the ok verdict", () => {
    const v = validateEvent("macro:completed", { runId: "r-1", domain: "math", action: "naturalQuery", ms: 5 });
    assert.equal(v.ok, false);
    assert.ok((v.missing || []).includes("ok"));
  });
});

describe("ConKay macro lifecycle — realtimeEmit userId targeting", () => {
  it("realtimeEmit accepts the { userId } option without throwing", async () => {
    const { realtimeEmit } = (await import("../server.js")).__TEST__;
    // The new per-user targeting branch routes to the user:<id> room. It MUST
    // accept the userId option and return a result object (never throw),
    // whichever transport is live: { ok:true } when realtime is up, or
    // { ok:false, reason:"socket_not_ready" } when no socket is bound.
    const out = realtimeEmit(
      "macro:started",
      { runId: "r-test", domain: "math", action: "naturalQuery" },
      { userId: "user-123" },
    );
    assert.ok(out && typeof out === "object", "must return a result object");
    assert.ok(
      out.ok === true || out.reason === "socket_not_ready",
      `unexpected realtimeEmit result: ${JSON.stringify(out)}`,
    );
  });
});
