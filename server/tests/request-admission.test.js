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
  observeLagWindow,
  isInteractiveRequest,
  _resetAdmissionForTest,
  _setStrikesForTest,
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

  it("login/register/refresh/csrf-token are PROTECTED even with no session (real prod bug, 2026-08-23)", () => {
    assert.equal(classifyRequest(makeReq({ path: "/api/auth/login", authed: false })), PRIORITY.PROTECTED);
    assert.equal(classifyRequest(makeReq({ path: "/api/auth/register", authed: false })), PRIORITY.PROTECTED);
    assert.equal(classifyRequest(makeReq({ path: "/api/auth/refresh", authed: false })), PRIORITY.PROTECTED);
    assert.equal(classifyRequest(makeReq({ path: "/api/auth/csrf-token", authed: false })), PRIORITY.PROTECTED);
  });

  it("the public ConKay demo solve is PROTECTED with no session (first-solve 503, 2026-10-09)", () => {
    assert.equal(classifyRequest(makeReq({ path: "/api/conkay/demo/beam" })), PRIORITY.PROTECTED);
    assert.equal(classifyRequest(makeReq({ path: "/api/conkay/demo/sweep" })), PRIORITY.PROTECTED);
    assert.equal(classifyRequest(makeReq({ path: "/api/conkay/demo/materials" })), PRIORITY.PROTECTED);
    assert.equal(classifyRequest({ url: "/api/conkay/demo/beam?length=1000&loadN=5" }), PRIORITY.PROTECTED);
  });

  it("the demo lane is narrow: other /api/conkay paths and look-alikes stay SHEDDABLE", () => {
    assert.equal(classifyRequest(makeReq({ path: "/api/conkay/design" })), PRIORITY.SHEDDABLE);
    assert.equal(classifyRequest(makeReq({ path: "/api/conkay/demo/export" })), PRIORITY.SHEDDABLE);
    assert.equal(classifyRequest(makeReq({ path: "/api/conkay/demo/beamx" })), PRIORITY.SHEDDABLE);
    assert.equal(classifyRequest(makeReq({ path: "/x/api/conkay/demo/beam" })), PRIORITY.SHEDDABLE);
  });

  it("a demo solve is admitted at lag that sheds anonymous traffic, and still sheds past the protected bar", () => {
    const p = classifyRequest(makeReq({ path: "/api/conkay/demo/beam" }));
    const sustained = { enabled: true, shedLagMs: 300, shedLagMsProtected: 900, strikes: 3, strikesRequired: 3 };
    assert.equal(decideAdmission(PRIORITY.SHEDDABLE, 500, sustained).admit, false);
    assert.equal(decideAdmission(p, 500, sustained).admit, true);
    assert.equal(decideAdmission(p, 1200, sustained).admit, false);
  });

  it("authenticated chat and lens run are interactive; bulk and anonymous are not", () => {
    assert.equal(isInteractiveRequest(makeReq({ path: "/api/lens/run", authed: true })), true);
    assert.equal(isInteractiveRequest(makeReq({ path: "/api/chat", authed: true })), true);
    assert.equal(isInteractiveRequest(makeReq({ path: "/api/chat/stream", authed: true })), true);
    assert.equal(isInteractiveRequest(makeReq({ path: "/api/chat-agent/stream", authed: true })), true);
    assert.equal(isInteractiveRequest(makeReq({ path: "/api/lens/run", authed: false })), false);
    assert.equal(isInteractiveRequest(makeReq({ path: "/api/export/my-data", authed: true })), false);
    assert.equal(isInteractiveRequest(makeReq({ path: "/api/auth/login", authed: false })), false);
  });

  it("other /api/auth/* paths (e.g. logout, password-reset) are NOT swept into the auth-critical carve-out", () => {
    assert.equal(classifyRequest(makeReq({ path: "/api/auth/logout", authed: false })), PRIORITY.SHEDDABLE);
    assert.equal(classifyRequest(makeReq({ path: "/api/auth/forgot-password", authed: false })), PRIORITY.SHEDDABLE);
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

  it("SHEDDABLE is admitted below threshold, shed above it once strikes are met", () => {
    const opts = { shedLagMs: 300, shedLagMsProtected: 900, strikes: 3, strikesRequired: 3 };
    assert.equal(decideAdmission(PRIORITY.SHEDDABLE, 299, opts).admit, true);
    const decision = decideAdmission(PRIORITY.SHEDDABLE, 301, opts);
    assert.equal(decision.admit, false);
    assert.equal(decision.reason, "event_loop_lag");
    assert.equal(decision.thresholdMs, 300);
  });

  it("one over-bar sample does not shed — strikes have to be sustained", () => {
    const opts = { shedLagMs: 300, shedLagMsProtected: 900, strikes: 1, strikesRequired: 3 };
    assert.equal(decideAdmission(PRIORITY.SHEDDABLE, 5000, opts).admit, true);
    assert.equal(decideAdmission(PRIORITY.PROTECTED, 5000, opts).admit, true);
    const sustained = { ...opts, strikes: 3 };
    assert.equal(decideAdmission(PRIORITY.SHEDDABLE, 301, sustained).admit, false);
  });

  it("PROTECTED tolerates lag that would shed SHEDDABLE traffic", () => {
    const opts = { shedLagMs: 300, shedLagMsProtected: 900, strikes: 3, strikesRequired: 3 };
    assert.equal(decideAdmission(PRIORITY.PROTECTED, 500, opts).admit, true);
  });

  it("PROTECTED sheds only past its own, higher threshold, and only when sustained", () => {
    const opts = { shedLagMs: 300, shedLagMsProtected: 900, strikes: 3, strikesRequired: 3 };
    const decision = decideAdmission(PRIORITY.PROTECTED, 901, opts);
    assert.equal(decision.admit, false);
    assert.equal(decision.reason, "event_loop_lag_critical");
    assert.equal(decision.thresholdMs, 900);
    assert.equal(decideAdmission(PRIORITY.PROTECTED, 901, { ...opts, strikes: 2 }).admit, true);
  });

  it("kill switch (enabled:false) admits everything regardless of lag", () => {
    const opts = { enabled: false, shedLagMs: 1, shedLagMsProtected: 1 };
    assert.equal(decideAdmission(PRIORITY.SHEDDABLE, 99999, opts).admit, true);
    assert.equal(decideAdmission(PRIORITY.PROTECTED, 99999, opts).admit, true);
  });
});

describe("request-admission — createLoadSheddingMiddleware (integration, real lag signal)", () => {
  afterEach(async () => {
    _setLagMsForTest(0);
    _resetAdmissionForTest();
    stopEventLoopPressureMonitor();
    delete process.env.CONCORD_LOAD_SHED_ENABLED;
    delete process.env.CONCORD_LOAD_SHED_LAG_MS;
    delete process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED;
    delete process.env.CONCORD_LOAD_SHED_STRIKES;
    delete process.env.CONCORD_LOAD_SHED_ADMISSION_WAIT_MS;
    delete process.env.CONCORD_LOAD_SHED_ADMISSION_POLL_MS;
    delete process.env.CONCORD_LOAD_SHED_INTERACTIVE_QUEUE;
    const backup = await import("../lib/sqlite-online-backup.js");
    backup._setSqliteBackupRunningForTest(false);
  });

  it("under simulated high lag: health check succeeds, a protected request succeeds, a sheddable request gets 503 + Retry-After", () => {
    process.env.CONCORD_LOAD_SHED_LAG_MS = "300";
    process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED = "900";
    _setLagMsForTest(500); // above the sheddable threshold, below the protected threshold
    // Three consecutive windows — one spike must not be enough.
    observeLagWindow({ sustainedMs: 500, latestMs: 500 });
    observeLagWindow({ sustainedMs: 500, latestMs: 500 });
    observeLagWindow({ sustainedMs: 500, latestMs: 500 });

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

  it("one spike (high lag, no strikes) does not shed sheddable or interactive traffic", () => {
    process.env.CONCORD_LOAD_SHED_LAG_MS = "300";
    process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED = "900";
    _setLagMsForTest(5000);

    const middleware = createLoadSheddingMiddleware();
    let nextCalled = false;
    const shedRes = makeRes();
    middleware(makeReq({ path: "/api/lens/run", authed: false }), shedRes, () => { nextCalled = true; });
    assert.equal(nextCalled, true, "a single spike must not 503 anonymous traffic");
    assert.equal(shedRes.statusCode, null);

    nextCalled = false;
    const interactive = makeRes();
    middleware(makeReq({ path: "/api/lens/run", authed: true }), interactive, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(interactive.statusCode, null);
  });

  it("sustained lag sheds anonymous traffic and still queues an authenticated lens run", async () => {
    process.env.CONCORD_LOAD_SHED_LAG_MS = "300";
    process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED = "900";
    process.env.CONCORD_LOAD_SHED_ADMISSION_WAIT_MS = "60";
    process.env.CONCORD_LOAD_SHED_ADMISSION_POLL_MS = "15";
    _setLagMsForTest(1500);
    _setStrikesForTest(3);

    const middleware = createLoadSheddingMiddleware();

    let anonNext = false;
    const anon = makeRes();
    middleware(makeReq({ path: "/api/lens/run", authed: false }), anon, () => { anonNext = true; });
    assert.equal(anonNext, false);
    assert.equal(anon.statusCode, 503);
    assert.equal(anon.body.error, "service_overloaded");
    assert.equal(anon.body.code === "service_overloaded" || anon.body.code === "service_warming", true);

    // Interactive: not an instant 503. Pressure clears on the next poll.
    let lensNext = false;
    const lens = makeRes();
    const pending = middleware(makeReq({ path: "/api/lens/run", authed: true }), lens, () => { lensNext = true; });
    assert.equal(lensNext, false, "must queue rather than reject immediately");
    assert.equal(lens.statusCode, null);
    _setLagMsForTest(0);
    _setStrikesForTest(0);
    await pending;
    assert.equal(lensNext, true, "queued interactive request is admitted once pressure clears");
    assert.equal(lens.statusCode, null);
  });

  it("authenticated interactive requests get busy_retry with Retry-After when the wait expires", async () => {
    process.env.CONCORD_LOAD_SHED_LAG_MS = "300";
    process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED = "900";
    process.env.CONCORD_LOAD_SHED_ADMISSION_WAIT_MS = "40";
    process.env.CONCORD_LOAD_SHED_ADMISSION_POLL_MS = "10";
    process.env.CONCORD_LOAD_SHED_RETRY_AFTER_S = "3";
    _setLagMsForTest(1500);
    _setStrikesForTest(3);

    const middleware = createLoadSheddingMiddleware();
    let nextCalled = false;
    const res = makeRes();
    await middleware(makeReq({ path: "/api/chat", authed: true }), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.ok(res.body.queuedMs >= 20, "must wait before giving up, not insta-503");
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, "service_overloaded");
    assert.equal(res.body.code, "busy_retry");
    assert.match(res.body.message, /busy/i);
    assert.equal(res.headers["Retry-After"], "3");
    delete process.env.CONCORD_LOAD_SHED_RETRY_AFTER_S;
  });

  it("login and authenticated traffic stay admitted while the SQLite backup worker is running", async () => {
    const backup = await import("../lib/sqlite-online-backup.js");
    process.env.CONCORD_LOAD_SHED_LAG_MS = "300";
    process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED = "900";
    _setLagMsForTest(5000);
    _setStrikesForTest(5);
    backup._setSqliteBackupRunningForTest(true);
    const middleware = createLoadSheddingMiddleware();
    let loginNext = false;
    middleware(makeReq({ path: "/api/auth/login" }), makeRes(), () => { loginNext = true; });
    assert.equal(loginNext, true, "login must not 503 during the startup snapshot");
    let lensNext = false;
    middleware(makeReq({ path: "/api/lens/run", authed: true }), makeRes(), () => { lensNext = true; });
    assert.equal(lensNext, true);
    backup._setSqliteBackupRunningForTest(false);
  });

  it("a non-interactive protected route still sheds immediately once pressure is sustained", () => {
    process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED = "900";
    _setLagMsForTest(1500);
    _setStrikesForTest(3);
    const middleware = createLoadSheddingMiddleware();
    let nextCalled = false;
    const res = makeRes();
    middleware(makeReq({ path: "/api/auth/login" }), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.reason, "event_loop_lag_critical");
    assert.notEqual(res.body.code, "busy_retry");
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
