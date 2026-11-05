// S-INV-1/2 pins: the Tester's dry-run evaluation records nothing,
// monitors edit in place, violations delete, and removal states what
// it retains.

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
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_inv_a" }, userId: "user_inv_a" };

function registerBalance() {
  const r = call("registerMonitor", ctxA, { name: "balance non-negative", expression: "balance >= 0", severity: "high" });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.monitor;
}

describe("invariant frame lifecycle (S-INV-1/2)", () => {
  it("a dry-run check evaluates against the monitors and records NOTHING", () => {
    registerBalance();
    const dry = call("checkMonitors", ctxA, { state: { balance: -5 }, dryRun: true });
    assert.equal(dry.ok, true, JSON.stringify(dry));
    const checked = dry.result.checked || dry.result.results || [];
    assert.ok(JSON.stringify(dry.result).includes("violation"), "the dry run names the violation");
    const hist = call("violationHistory", ctxA, {});
    assert.equal(hist.result.summary.total, 0, "no violation recorded from a hypothetical state");
    const list = call("listMonitors", ctxA, {});
    assert.equal(list.result.monitors[0].checkCount, 0, "counters unmoved by a dry run");
    // The real tick, by contrast, records.
    call("checkMonitors", ctxA, { state: { balance: -5 } });
    assert.equal(call("violationHistory", ctxA, {}).result.summary.total, 1);
  });

  it("the recorded violation carries the offending state (the receipt)", () => {
    registerBalance();
    call("checkMonitors", ctxA, { state: { balance: -5 } });
    const hist = call("violationHistory", ctxA, {});
    assert.equal(hist.result.violations[0].state.balance, -5);
  });

  it("updateMonitor edits the expression (re-validated) and the name", () => {
    const m = registerBalance();
    const upd = call("updateMonitor", ctxA, { monitorId: m.id, expression: "balance > 0", name: "balance positive" });
    assert.equal(upd.ok, true, JSON.stringify(upd));
    assert.equal(upd.result.monitor.expression, "balance > 0");
    const bad = call("updateMonitor", ctxA, { monitorId: m.id, expression: "process.exit(1)" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /unsafe_expression/);
  });

  it("deleteViolation removes the record; removeMonitor reports what it retains", () => {
    const m = registerBalance();
    call("checkMonitors", ctxA, { state: { balance: -5 } });
    const v = call("violationHistory", ctxA, {}).result.violations[0];
    const rm = call("removeMonitor", ctxA, { monitorId: m.id });
    assert.equal(rm.result.violationsRetained, 1);
    assert.equal(call("violationHistory", ctxA, {}).result.summary.total, 1, "retained, stated");
    const del = call("deleteViolation", ctxA, { violationId: v.id });
    assert.equal(del.ok, true);
    assert.equal(call("violationHistory", ctxA, {}).result.summary.total, 0);
  });
});
