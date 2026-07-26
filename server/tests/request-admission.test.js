// Launch-readiness (2026-07-25) — front-door load-shedding admission
// control. See server/lib/request-admission.js for the full rationale.
//
// Uses the REAL event-loop-pressure signal (`_setLagMsForTest`, the same
// test helper `event-loop-pressure.test.js` uses) rather than a fake lag
// source, so the integration tests below exercise the actual wiring the
// middleware uses in server.js, not a mock of it.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  PRIORITY,
  classifyRequest,
  decideAdmission,
  createLoadSheddingMiddleware,
} from "../lib/request-admission.js";
import { _setLagMsForTest, stopEventLoopPressureMonitor } from "../lib/event-loop-pressure.js";

function makeReq({ path, authed = false }) {
  return { path, user: authed ? { id: "user-1" } : undefined };
}

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe("request-admission — classifyRequest", () => {
  it("health/ready/metrics/brain-health are CRITICAL regardless of auth", () => {
    assert.equal(classifyRequest(makeReq({ path: "/health" })), PRIORITY.CRITICAL);
    assert.equal(classifyRequest(makeReq({ path: "/ready" })), PRIORITY.CRITICAL);
    assert.equal(classifyRequest(makeReq({ path: "/metrics" })), PRIORITY.CRITICAL);
    assert.equal(classifyRequest(makeReq({ path: "/api/brain/health", authed: true })), PRIORITY.CRITICAL);
    assert.equal(classifyRequest(makeReq({ path: "/api/status" })), PRIORITY.CRITICAL);
  });

  it("authenticated, non-bulk traffic is PROTECTED", () => {
    assert.equal(classifyRequest(makeReq({ path: "/api/lens/run", authed: true })), PRIORITY.PROTECTED);
    assert.equal(classifyRequest(makeReq({ path: "/api/chat", authed: true })), PRIORITY.PROTECTED);
  });

  it("unauthenticated traffic is SHEDDABLE", () => {
    assert.equal(classifyRequest(makeReq({ path: "/api/lens/run", authed: false })), PRIORITY.SHEDDABLE);
  });

  it("bulk-shaped paths are SHEDDABLE even when authenticated", () => {
    assert.equal(classifyRequest(makeReq({ path: "/api/export/my-data", authed: true })), PRIORITY.SHEDDABLE);
    assert.equal(classifyRequest(makeReq({ path: "/api/ingest/bulk-upload", authed: true })), PRIORITY.SHEDDABLE);
    assert.equal(classifyRequest(makeReq({ path: "/api/artifact/abc123/download", authed: true })), PRIORITY.SHEDDABLE);
    assert.equal(classifyRequest(makeReq({ path: "/api/substrate/import", authed: true })), PRIORITY.SHEDDABLE);
  });
});

describe("request-admission — decideAdmission (pure)", () => {
  it("CRITICAL is always admitted, even at extreme lag", () => {
    assert.equal(decideAdmission(PRIORITY.CRITICAL, 99999).admit, true);
  });

  it("SHEDDABLE is admitted below threshold, shed above it", () => {
    const opts = { shedLagMs: 300, shedLagMsProtected: 900 };
    assert.equal(decideAdmission(PRIORITY.SHEDDABLE, 299, opts).admit, true);
    const decision = decideAdmission(PRIORITY.SHEDDABLE, 301, opts);
    assert.equal(decision.admit, false);
    assert.equal(decision.reason, "event_loop_lag");
    assert.equal(decision.thresholdMs, 300);
  });

  it("PROTECTED tolerates lag that would shed SHEDDABLE traffic", () => {
    const opts = { shedLagMs: 300, shedLagMsProtected: 900 };
    assert.equal(decideAdmission(PRIORITY.PROTECTED, 500, opts).admit, true);
  });

  it("PROTECTED sheds only past its own, higher threshold", () => {
    const opts = { shedLagMs: 300, shedLagMsProtected: 900 };
    const decision = decideAdmission(PRIORITY.PROTECTED, 901, opts);
    assert.equal(decision.admit, false);
    assert.equal(decision.reason, "event_loop_lag_critical");
    assert.equal(decision.thresholdMs, 900);
  });

  it("kill switch (enabled:false) admits everything regardless of lag", () => {
    const opts = { enabled: false, shedLagMs: 1, shedLagMsProtected: 1 };
    assert.equal(decideAdmission(PRIORITY.SHEDDABLE, 99999, opts).admit, true);
    assert.equal(decideAdmission(PRIORITY.PROTECTED, 99999, opts).admit, true);
  });
});

describe("request-admission — createLoadSheddingMiddleware (integration, real lag signal)", () => {
  afterEach(() => {
    _setLagMsForTest(0);
    stopEventLoopPressureMonitor();
    delete process.env.CONCORD_LOAD_SHED_ENABLED;
    delete process.env.CONCORD_LOAD_SHED_LAG_MS;
    delete process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED;
  });

  it("under simulated high lag: health check succeeds, a protected request succeeds, a sheddable request gets 503 + Retry-After", () => {
    process.env.CONCORD_LOAD_SHED_LAG_MS = "300";
    process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED = "900";
    _setLagMsForTest(500); // above the sheddable threshold, below the protected threshold

    const shed = [];
    const middleware = createLoadSheddingMiddleware({ onShed: (p, r) => shed.push([p, r]) });

    // Health check — never evaluated against lag at all.
    let nextCalled = false;
    const healthRes = makeRes();
    middleware(makeReq({ path: "/health" }), healthRes, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(healthRes.statusCode, null);

    // Protected (authenticated, in-session) request — tolerated at this lag.
    nextCalled = false;
    const protectedRes = makeRes();
    middleware(makeReq({ path: "/api/lens/run", authed: true }), protectedRes, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(protectedRes.statusCode, null);

    // Sheddable (unauthenticated) request — rejected honestly.
    nextCalled = false;
    const shedRes = makeRes();
    middleware(makeReq({ path: "/api/lens/run", authed: false }), shedRes, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(shedRes.statusCode, 503);
    assert.ok(shedRes.headers["Retry-After"], "Retry-After header must be set on a shed response");
    assert.equal(Number(shedRes.headers["Retry-After"]) > 0, true);
    assert.equal(shedRes.body.ok, false);
    assert.equal(shedRes.body.error, "service_overloaded");
    assert.equal(shedRes.body.reason, "event_loop_lag");
    assert.deepEqual(shed, [[PRIORITY.SHEDDABLE, "event_loop_lag"]]);
  });

  it("under EXTREME lag, even a protected (authenticated) request is shed — last-resort tier", () => {
    process.env.CONCORD_LOAD_SHED_LAG_MS = "300";
    process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED = "900";
    _setLagMsForTest(1000);

    const middleware = createLoadSheddingMiddleware();
    let nextCalled = false;
    const res = makeRes();
    middleware(makeReq({ path: "/api/lens/run", authed: true }), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.reason, "event_loop_lag_critical");
  });

  it("health check is NEVER shed, even at extreme lag", () => {
    _setLagMsForTest(999999);
    const middleware = createLoadSheddingMiddleware();
    let nextCalled = false;
    middleware(makeReq({ path: "/ready" }), makeRes(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  // Mutation-verification: this proves the assertions above are actually
  // exercising the gate, not passing vacuously. Same request + same high
  // lag reading as the first test's "sheddable request gets 503" case —
  // but with the kill switch off, admission must be restored. If the
  // shedding gate were removed (or silently broken), THIS test's premise
  // ("shedding is what caused the 503 above") would be meaningless; this
  // proves toggling the one thing that distinguishes the two scenarios
  // (gate on vs. off) flips the outcome.
  it("mutation check: disabling the gate (kill switch) restores admission for the identical high-lag scenario", () => {
    process.env.CONCORD_LOAD_SHED_ENABLED = "0";
    process.env.CONCORD_LOAD_SHED_LAG_MS = "300";
    _setLagMsForTest(500);

    const middleware = createLoadSheddingMiddleware();
    let nextCalled = false;
    const res = makeRes();
    middleware(makeReq({ path: "/api/lens/run", authed: false }), res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
  });
});
