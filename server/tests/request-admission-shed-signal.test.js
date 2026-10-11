// Shedding-rate + admitting-flip signals into repair-cortex observe().
// One event per pressure window, one event per admitting transition.
// Not one event per rejected request.
//
// Run: node --test server/tests/request-admission-shed-signal.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  createLoadSheddingMiddleware,
  noteAdmittingTransition,
  _resetAdmissionForTest,
  _setStrikesForTest,
  _setAdmissionSignalClockForTest,
  _setAdmissionObserveForTest,
} from "../lib/request-admission.js";
import { _setLagMsForTest, stopEventLoopPressureMonitor } from "../lib/event-loop-pressure.js";

function makeReq({ path: reqPath, authed = false } = {}) {
  return { path: reqPath, user: authed ? { id: "user-1" } : undefined };
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

describe("request-admission shedding signal", { concurrency: false }, () => {
  /** @type {{ context: string, message: string }[]} */
  let events;

  beforeEach(() => {
    events = [];
    _resetAdmissionForTest();
    _setLagMsForTest(0);
    _setAdmissionObserveForTest((err, context) => {
      events.push({ context, message: err.message });
    });
    process.env.CONCORD_LOAD_SHED_LAG_MS = "300";
    process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED = "900";
    process.env.CONCORD_SHED_SIGNAL_MIN = "3";
    delete process.env.CONCORD_LOAD_SHED_ENABLED;
  });

  afterEach(() => {
    _resetAdmissionForTest();
    _setLagMsForTest(0);
    stopEventLoopPressureMonitor();
    delete process.env.CONCORD_LOAD_SHED_LAG_MS;
    delete process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED;
    delete process.env.CONCORD_SHED_SIGNAL_MIN;
    delete process.env.CONCORD_SHED_SIGNAL_WINDOW_MS;
    delete process.env.CONCORD_LOAD_SHED_ENABLED;
  });

  it("does not signal under normal load", () => {
    _setLagMsForTest(0);
    _setStrikesForTest(0);
    const middleware = createLoadSheddingMiddleware();
    for (let i = 0; i < 20; i++) {
      let nextCalled = false;
      const res = makeRes();
      middleware(makeReq({ path: "/api/public/feed" }), res, () => { nextCalled = true; });
      assert.equal(nextCalled, true);
      assert.equal(res.statusCode, null);
    }
    assert.equal(events.length, 0);
  });

  it("fires once when a pressure episode sheds past the threshold, not per request", () => {
    _setLagMsForTest(500);
    _setStrikesForTest(3);
    const middleware = createLoadSheddingMiddleware();
    for (let i = 0; i < 2; i++) {
      const res = makeRes();
      let nextCalled = false;
      middleware(makeReq({ path: "/api/public/feed" }), res, () => { nextCalled = true; });
      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 503);
    }
    assert.equal(events.length, 0, "below the threshold must stay quiet");

    for (let i = 0; i < 8; i++) {
      const res = makeRes();
      middleware(makeReq({ path: "/api/public/feed" }), res, () => {});
      assert.equal(res.statusCode, 503);
    }
    assert.equal(events.length, 1);
    assert.equal(events[0].context, "request_admission:shedding");
    assert.match(events[0].message, /shedding 3 requests/);
    assert.match(events[0].message, /sheddable\/event_loop_lag/);
  });

  it("emits again on the next window, still once for that window", () => {
    let now = 1_000_000;
    _setAdmissionSignalClockForTest(() => now);
    _setLagMsForTest(500);
    _setStrikesForTest(3);
    const middleware = createLoadSheddingMiddleware();
    for (let i = 0; i < 3; i++) {
      middleware(makeReq({ path: "/api/public/feed" }), makeRes(), () => {});
    }
    assert.equal(events.length, 1);
    now += 10_000;
    for (let i = 0; i < 6; i++) {
      middleware(makeReq({ path: "/api/public/feed" }), makeRes(), () => {});
    }
    assert.equal(events.length, 2);
    assert.equal(events[1].context, "request_admission:shedding");
  });

  it("emits one event per admitting flip and none while the flag holds", () => {
    noteAdmittingTransition(true);
    assert.equal(events.length, 0, "startup state is already admitting");
    noteAdmittingTransition(false);
    noteAdmittingTransition(false);
    noteAdmittingTransition(false);
    assert.equal(events.length, 1);
    assert.equal(events[0].context, "request_admission:admitting");
    assert.match(events[0].message, /true -> false/);
    noteAdmittingTransition(true);
    noteAdmittingTransition(true);
    assert.equal(events.length, 2);
    assert.match(events[1].message, /false -> true/);
  });

  it("/ready reports the admitting transition through noteAdmittingTransition", () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../routes/system.js"),
      "utf8",
    );
    const ready = src.slice(src.indexOf('app.get("/ready"'), src.indexOf('app.get("/api/health"'));
    const verdictAt = ready.indexOf("const ready =");
    const admittingAt = ready.indexOf("checks.admitting");
    assert.ok(admittingAt > verdictAt, "admitting must stay after the verdict");
    assert.match(ready, /noteAdmittingTransition\(checks\.admitting\)/);
  });

  it("the default sink delivers one shedding event to observe()", async () => {
    _setAdmissionObserveForTest(null);
    _setLagMsForTest(500);
    _setStrikesForTest(3);
    const middleware = createLoadSheddingMiddleware();
    for (let i = 0; i < 6; i++) {
      const res = makeRes();
      middleware(makeReq({ path: "/api/public/feed" }), res, () => {});
      assert.equal(res.statusCode, 503);
    }
    const { getErrorAccumulator } = await import("../emergent/repair-cortex.js");
    let hits = [];
    for (let i = 0; i < 20; i++) {
      hits = getErrorAccumulator().entries.filter((e) => e.context === "request_admission:shedding");
      if (hits.length) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(hits.length, 1);
    assert.equal(hits[0].count, 1, "six shed requests must still be a single observe()");
    assert.match(hits[0].message, /shedding 3 requests/);
  });
});
