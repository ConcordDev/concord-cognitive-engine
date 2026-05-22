// Tier-2 contract tests for the Cognition lens parity macros
// (compareModes / recommendMode / exportTrace / listExports / getExport /
// deleteExport). Pins per-user scoping, real HLR pass-through, and the
// rule-based mode classifier.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCognitionActions from "../domains/cognition.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`cognition.${name}`);
  if (!fn) throw new Error(`cognition.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerCognitionActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("cognition — compareModes", () => {
  it("runs two real HLR modes on one prompt", async () => {
    const r = await call("compareModes", ctxA, {
      question: "Does increased redundancy always improve system reliability?",
      modeA: "deductive",
      modeB: "adversarial",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.a.mode, "deductive");
    assert.equal(r.result.b.mode, "adversarial");
    assert.equal(r.result.a.ok, true);
    assert.equal(r.result.b.ok, true);
    assert.ok(r.result.a.chainCount >= 1);
    assert.ok(["deductive", "adversarial", "tie"].includes(r.result.higherConfidence));
  });

  it("rejects missing prompt", async () => {
    const r = await call("compareModes", ctxA, { modeA: "deductive", modeB: "inductive" });
    assert.equal(r.ok, false);
    assert.match(r.error, /required/);
  });

  it("rejects identical modes", async () => {
    const r = await call("compareModes", ctxA, {
      question: "Is X true?", modeA: "deductive", modeB: "deductive",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /differ/);
  });

  it("rejects an invalid mode", async () => {
    const r = await call("compareModes", ctxA, {
      question: "Is X true?", modeA: "deductive", modeB: "bogus",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid_mode/);
  });

  it("returns full per-step chains so the trace tree can render", async () => {
    const r = await call("compareModes", ctxA, {
      question: "Does parallelism reduce end-to-end latency?",
      modeA: "deductive",
      modeB: "inductive",
    });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.a.chains) && r.result.a.chains.length >= 1);
    const firstChain = r.result.a.chains[0];
    assert.ok(Array.isArray(firstChain.steps) && firstChain.steps.length >= 1);
    assert.ok(typeof firstChain.steps[0].description === "string");
  });
});

describe("cognition — recommendMode", () => {
  it("recommends temporal for an over-time question", () => {
    const r = call("recommendMode", ctxA, {
      question: "How will this market evolve over time in the future?",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.recommended, "temporal");
    assert.equal(r.result.ranking.length, 7);
  });

  it("recommends counterfactual for a what-if question", () => {
    const r = call("recommendMode", ctxA, {
      question: "What if the premise had not held — would the result still follow?",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.recommended, "counterfactual");
  });

  it("recommends abductive for a why question", () => {
    const r = call("recommendMode", ctxA, {
      question: "Why does the cache miss rate spike at midnight?",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.recommended, "abductive");
  });

  it("rejects an empty question", () => {
    const r = call("recommendMode", ctxA, { question: "  " });
    assert.equal(r.ok, false);
    assert.match(r.error, /required/);
  });
});

describe("cognition — trace export ledger", () => {
  it("exports a trace and lists it back", () => {
    const trace = {
      traceId: "hlr_trace_test1",
      input: { question: "Is recursion well-founded?", mode: "deductive" },
      chains: [{ chainId: "c1", steps: [] }],
    };
    const e = call("exportTrace", ctxA, { trace, title: "My trace", note: "for review" });
    assert.equal(e.ok, true);
    assert.ok(e.result.exportId);
    const l = call("listExports", ctxA);
    assert.equal(l.ok, true);
    assert.equal(l.result.count, 1);
    assert.equal(l.result.exports[0].title, "My trace");
    assert.equal(l.result.exports[0].mode, "deductive");
  });

  it("rejects export with no trace", () => {
    const r = call("exportTrace", ctxA, { title: "empty" });
    assert.equal(r.ok, false);
    assert.match(r.error, /trace_required/);
  });

  it("getExport returns the full trace", () => {
    const trace = { traceId: "hlr_trace_test2", input: { question: "Q" }, chains: [] };
    const e = call("exportTrace", ctxA, { trace });
    const g = call("getExport", ctxA, { exportId: e.result.exportId });
    assert.equal(g.ok, true);
    assert.equal(g.result.export.trace.traceId, "hlr_trace_test2");
  });

  it("deleteExport removes the entry", () => {
    const trace = { traceId: "hlr_trace_test3", input: { question: "Q" }, chains: [] };
    const e = call("exportTrace", ctxA, { trace });
    const d = call("deleteExport", ctxA, { exportId: e.result.exportId });
    assert.equal(d.ok, true);
    const l = call("listExports", ctxA);
    assert.equal(l.result.count, 0);
  });

  it("INVARIANT: exports are scoped per-user", () => {
    const trace = { traceId: "hlr_trace_a", input: { question: "Q" }, chains: [] };
    call("exportTrace", ctxA, { trace, title: "A-only" });
    const b = call("listExports", ctxB);
    assert.equal(b.result.count, 0);
  });
});

describe("cognition — driftAlerts", () => {
  it("returns a severity-tallied, time-ordered alert feed", async () => {
    const r = await call("driftAlerts", ctxA, { limit: 50 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.alerts));
    assert.ok(typeof r.result.total === "number");
    assert.deepEqual(
      r.result.severities,
      ["info", "warning", "alert", "critical"],
    );
    for (const sev of r.result.severities) {
      assert.ok(typeof r.result.bySeverity[sev] === "number");
    }
    assert.ok(typeof r.result.scannedAt === "string");
  });

  it("filters by a valid severity", async () => {
    const r = await call("driftAlerts", ctxA, { severity: "critical" });
    assert.equal(r.ok, true);
    assert.equal(r.result.appliedSeverity, "critical");
    for (const a of r.result.alerts) {
      assert.equal(a.severity, "critical");
    }
  });

  it("ignores an unrecognised severity rather than erroring", async () => {
    const r = await call("driftAlerts", ctxA, { severity: "nonsense" });
    assert.equal(r.ok, true);
    assert.equal(r.result.appliedSeverity, null);
  });
});
