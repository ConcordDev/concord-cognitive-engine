// Contract tests for server/domains/invariant.js — continuous monitoring,
// counterexample generation, invariant library, temporal logic, violation
// history, and quantified invariants.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerInvariantActions from "../domains/invariant.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`invariant.${name}`);
  if (!fn) throw new Error(`invariant.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerInvariantActions(register); });

// Fresh per-user STATE before every test so monitors/history don't leak.
beforeEach(() => {
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("invariant.registerMonitor / listMonitors", () => {
  it("registers a monitor and lists it", () => {
    const r = call("registerMonitor", ctxA, { name: "balance non-negative", expression: "balance >= 0", severity: "high" });
    assert.equal(r.ok, true);
    assert.ok(r.result.monitor.id);
    assert.equal(r.result.monitor.severity, "high");
    const l = call("listMonitors", ctxA, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.summary.total, 1);
    assert.equal(l.result.summary.active, 1);
  });

  it("rejects missing name / expression", () => {
    assert.equal(call("registerMonitor", ctxA, { expression: "x > 0" }).ok, false);
    assert.equal(call("registerMonitor", ctxA, { name: "n" }).ok, false);
  });

  it("rejects an unsafe expression", () => {
    const r = call("registerMonitor", ctxA, { name: "evil", expression: "process.exit(1)" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unsafe_expression|forbidden/);
  });
});

describe("invariant.checkMonitors (continuous monitoring)", () => {
  it("detects a violation across a simulated tick and records it", () => {
    call("registerMonitor", ctxA, { name: "stock positive", expression: "stock >= 0", severity: "critical" });
    const pass = call("checkMonitors", ctxA, { state: { stock: 5 } });
    assert.equal(pass.ok, true);
    assert.equal(pass.result.summary.passed, 1);
    const fail = call("checkMonitors", ctxA, { state: { stock: -3 } });
    assert.equal(fail.result.summary.violations, 1);
    assert.equal(fail.result.newViolations.length, 1);
    const vh = call("violationHistory", ctxA, {});
    assert.equal(vh.result.summary.total, 1);
    assert.equal(vh.result.summary.critical, 1);
  });

  it("setMonitorActive pauses a monitor so it is skipped", () => {
    const reg = call("registerMonitor", ctxA, { name: "m", expression: "x > 0" });
    const off = call("setMonitorActive", ctxA, { monitorId: reg.result.monitor.id, active: false });
    assert.equal(off.ok, true);
    const chk = call("checkMonitors", ctxA, { state: { x: -1 } });
    assert.equal(chk.result.summary.evaluated, 0);
  });

  it("removeMonitor deletes the monitor", () => {
    const reg = call("registerMonitor", ctxA, { name: "m", expression: "x > 0" });
    const rm = call("removeMonitor", ctxA, { monitorId: reg.result.monitor.id });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.totalMonitors, 0);
  });
});

describe("invariant.counterexample", () => {
  it("identifies failing records and blames a field", () => {
    const r = call("counterexample", ctxA, {
      expression: "age >= 18",
      recordKey: "id",
      records: [
        { id: "a", age: 25 },
        { id: "b", age: 12 },
        { id: "c", age: 9 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.holds, false);
    assert.equal(r.result.counterexampleCount, 2);
    assert.equal(r.result.mostLikelyCause, "age");
    assert.equal(r.result.counterexamples[0].recordId, "b");
  });

  it("reports holds=true when all records pass", () => {
    const r = call("counterexample", ctxA, { expression: "n > 0", records: [{ n: 1 }, { n: 2 }] });
    assert.equal(r.result.holds, true);
    assert.equal(r.result.counterexampleCount, 0);
  });

  it("rejects missing expression / records", () => {
    assert.equal(call("counterexample", ctxA, { records: [{}] }).ok, false);
    assert.equal(call("counterexample", ctxA, { expression: "x > 0" }).ok, false);
  });
});

describe("invariant.templates", () => {
  it("returns the full library with categories", () => {
    const r = call("templates", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.templates.length >= 6);
    assert.ok(r.result.categories.includes("uniqueness"));
    assert.ok(r.result.categories.includes("range"));
  });

  it("filters by category", () => {
    const r = call("templates", ctxA, { category: "temporal" });
    assert.ok(r.result.templates.every(t => t.category === "temporal"));
    assert.ok(r.result.templates.length >= 2);
  });
});

describe("invariant.temporalCheck", () => {
  it("always: detects the first violating step", () => {
    const r = call("temporalCheck", ctxA, {
      operator: "always",
      condition: "level >= 0",
      history: [{ level: 5 }, { level: 2 }, { level: -1 }, { level: 0 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.holds, false);
    assert.equal(r.result.violationStep, 2);
  });

  it("eventually: finds the witness step", () => {
    const r = call("temporalCheck", ctxA, {
      operator: "eventually",
      condition: "ready == true",
      history: [{ ready: false }, { ready: false }, { ready: true }],
    });
    assert.equal(r.result.holds, true);
    assert.equal(r.result.witnessStep, 2);
  });

  it("until: condition must hold up to until-state", () => {
    const ok = call("temporalCheck", ctxA, {
      operator: "until",
      condition: "loading == true",
      until: "done == true",
      history: [{ loading: true, done: false }, { loading: true, done: false }, { loading: false, done: true }],
    });
    assert.equal(ok.result.holds, true);
    const bad = call("temporalCheck", ctxA, {
      operator: "until",
      condition: "loading == true",
      until: "done == true",
      history: [{ loading: true, done: false }, { loading: false, done: false }, { loading: false, done: true }],
    });
    assert.equal(bad.result.holds, false);
  });

  it("uses recorded snapshots when no history is supplied", () => {
    call("recordSnapshot", ctxA, { state: { x: 1 }, label: "s1" });
    call("recordSnapshot", ctxA, { state: { x: 2 }, label: "s2" });
    const r = call("temporalCheck", ctxA, { operator: "always", condition: "x > 0" });
    assert.equal(r.ok, true);
    assert.equal(r.result.holds, true);
    assert.equal(r.result.historyLength, 2);
    const cl = call("clearHistory", ctxA, {});
    assert.equal(cl.result.historyLength, 0);
  });

  it("rejects bad operator / missing condition", () => {
    assert.equal(call("temporalCheck", ctxA, { operator: "nope", condition: "x" }).ok, false);
    assert.equal(call("temporalCheck", ctxA, { operator: "always" }).ok, false);
  });
});

describe("invariant.violationHistory / resolveViolation", () => {
  it("filters by resolution status and resolves", () => {
    call("registerMonitor", ctxA, { name: "m", expression: "v >= 0" });
    call("checkMonitors", ctxA, { state: { v: -1 } });
    const open = call("violationHistory", ctxA, { resolved: false });
    assert.equal(open.result.summary.open, 1);
    const vid = open.result.violations[0].id;
    const res = call("resolveViolation", ctxA, { violationId: vid, resolution: "fixed at source" });
    assert.equal(res.ok, true);
    assert.equal(res.result.violation.resolved, true);
    const after = call("violationHistory", ctxA, { resolved: false });
    assert.equal(after.result.summary.open, 0);
  });

  it("resolveViolation rejects unknown id", () => {
    assert.equal(call("resolveViolation", ctxA, { violationId: "nope" }).ok, false);
  });
});

describe("invariant.quantifiedCheck", () => {
  it("forall: finds the counterexample", () => {
    const r = call("quantifiedCheck", ctxA, {
      quantifier: "forall",
      predicate: "price > 0",
      collection: [{ price: 10 }, { price: 0 }, { price: 5 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.holds, false);
    assert.equal(r.result.counterexample.index, 1);
    assert.equal(r.result.failingCount, 1);
  });

  it("exists: finds the witness", () => {
    const r = call("quantifiedCheck", ctxA, {
      quantifier: "exists",
      predicate: "admin == true",
      collection: [{ admin: false }, { admin: true }],
    });
    assert.equal(r.result.holds, true);
    assert.equal(r.result.witness.index, 1);
  });

  it("rejects bad quantifier / empty collection", () => {
    assert.equal(call("quantifiedCheck", ctxA, { quantifier: "x", predicate: "y" }).ok, false);
    assert.equal(call("quantifiedCheck", ctxA, { quantifier: "forall", predicate: "y", collection: [] }).ok, false);
  });
});
