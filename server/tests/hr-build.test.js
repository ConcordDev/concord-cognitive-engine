// HR build (GB-1088 Wave 1) — pins for the R5 first-pass findings:
//   F3  payroll stubs carry stateTax: null when no rate is supplied, and the
//       run records that exclusion in its assumptions (the FE renders the
//       null as "excluded" instead of crashing on it).
//   F4  compliance-doc-list counts acknowledgements over CURRENT active
//       employees only — the same rule compliance-status applies — so a
//       departed employee's ack no longer prints "1 acked / 0 pending · 0%".
//   F5  i9-status: "missing" means NO record on file; a filed-but-unverified
//       record counts as the distinct "pending".
//   F6  laborForecast clamps prediction-interval lower bounds at zero when
//       every observed value is >= 0 (a non-negative quantity), and does not
//       clamp a series that actually goes negative.
//   F7  the offboard → rehire round-trip the FE now surfaces: offboard is a
//       status flip, the record is retained, rehire restores active.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerHRActions from "../domains/hr.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`hr.${name}`);
  if (!fn) throw new Error(`hr.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerHRActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});
afterEach(() => { delete globalThis.__concordLensActions; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

function seedEmployee(name, hireDate = "2020-01-01") {
  const r = call("employee-add", ctxA, { name, salary: 52000, hireDate });
  assert.equal(r.ok, true);
  return r.result.employee;
}

describe("hr build — F3 payroll state-tax exclusion shape", () => {
  it("stub.stateTax is null (excluded, not zero) and the run records why", () => {
    seedEmployee("Paid Person");
    const r = call("payroll-run", ctxA, { frequency: "biweekly", periodLabel: "PP-X" });
    assert.equal(r.ok, true);
    assert.equal(r.result.run.stubs[0].stateTax, null);
    assert.equal(r.result.run.assumptions.stateTaxRate.value, null);
    assert.ok(r.result.run.missingInputs.includes("stateTaxRate"));
    assert.ok(r.result.run.stubs[0].netPay > 0);
  });
});

describe("hr build — F4 acknowledgement counts over active employees", () => {
  it("a departed employee's ack leaves the doc's counts entirely", () => {
    const emp = seedEmployee("Departing");
    const doc = call("compliance-doc-add", ctxA, { title: "Handbook" }).result.document;
    call("compliance-acknowledge", ctxA, { employeeId: emp.id, docId: doc.id });
    let listed = call("compliance-doc-list", ctxA).result.documents[0];
    assert.equal(listed.acknowledgedCount, 1);
    assert.equal(listed.acknowledgedRate, 100);
    call("employee-offboard", ctxA, { id: emp.id });
    seedEmployee("Replacement");
    listed = call("compliance-doc-list", ctxA).result.documents[0];
    assert.equal(listed.acknowledgedCount, 0);
    assert.equal(listed.pendingCount, 1);
    assert.equal(listed.acknowledgedRate, 0);
    const status = call("compliance-status", ctxA).result;
    assert.equal(status.totalRequired, 1);
    assert.equal(status.totalAcknowledged, 0);
    assert.equal(status.compliancePct, 0);
  });
});

describe("hr build — F5 I-9 missing vs pending", () => {
  it("a pending record is pending, not missing", () => {
    const a = seedEmployee("Has Pending");
    seedEmployee("Has Nothing");
    call("i9-add", ctxA, { employeeId: a.id, documentType: "us_passport", documentIdentifier: "X123" });
    const st = call("i9-status", ctxA).result;
    assert.equal(st.activeEmployees, 2);
    assert.equal(st.verified, 0);
    assert.equal(st.pending, 1);
    assert.equal(st.missing, 1);
    assert.equal(st.compliancePct, 0);
    const rec = call("i9-list", ctxA).result.records[0];
    call("i9-verify", ctxA, { id: rec.id });
    const st2 = call("i9-status", ctxA).result;
    assert.equal(st2.verified, 1);
    assert.equal(st2.pending, 0);
    assert.equal(st2.missing, 1);
    assert.equal(st2.compliancePct, 50);
  });
});

describe("hr build — F6 forecast intervals bounded at zero", () => {
  function seedEngines(values) {
    const data = values.map((v, i) => ({
      year: String(2024 + Math.floor(i / 12)), period: `M${String((i % 12) + 1).padStart(2, "0")}`,
      periodName: "Jan", value: v,
    }));
    const map = new Map();
    map.set("hr.bls-series-lookup", async () => ({
      ok: true,
      result: { series: [{ seriesID: "LNS14000000", catalog: {}, data }], startYear: "2024", endYear: "2026", authenticated: false },
    }));
    map.set("temporal.forecast", async () => ({
      ok: true,
      result: {
        method: "holt-double-exponential", parameters: { alpha: 0.5, beta: 0.1, gamma: null },
        horizon: 12, trend: { direction: "flat", perPeriod: 0, lastLevel: 4.2 },
        accuracy: { mse: 1, rmse: 1, mape: "1.0" }, accuracyLabel: "good",
        predictions: [{ step: 12, forecast: 4.1, lower95: -10.291, upper95: 18.5, lower80: -3.5, upper80: 9.25 }],
      },
    }));
    globalThis.__concordLensActions = map;
  }

  it("clamps lower bounds at 0 for a non-negative series", async () => {
    seedEngines(Array.from({ length: 24 }, () => 4.2));
    const r = await call("laborForecast", ctxA, { seriesId: "LNS14000000" });
    assert.equal(r.ok, true);
    assert.equal(r.result.intervalsBoundedAtZero, true);
    assert.equal(r.result.forecast[0].lower95, 0);
    assert.equal(r.result.forecast[0].lower80, 0);
    assert.equal(r.result.forecast[0].upper95, 18.5);
    assert.equal(r.result.forecast[0].forecast, 4.1);
  });

  it("does not clamp a series that actually goes negative", async () => {
    const values = Array.from({ length: 24 }, () => 4.2);
    values[3] = -0.5;
    seedEngines(values);
    const r = await call("laborForecast", ctxA, { seriesId: "LNS14000000" });
    assert.equal(r.ok, true);
    assert.equal(r.result.intervalsBoundedAtZero, false);
    assert.equal(r.result.forecast[0].lower95, -10.291);
  });
});

describe("hr build — F7 offboard / rehire round-trip", () => {
  it("offboard retains the record; rehire restores active", () => {
    const emp = seedEmployee("Boomerang");
    call("employee-offboard", ctxA, { id: emp.id });
    const active = call("employee-list", ctxA).result.employees;
    assert.equal(active.length, 0);
    const all = call("employee-list", ctxA, { includeInactive: true }).result.employees;
    assert.equal(all.length, 1);
    assert.equal(all[0].status, "terminated");
    assert.ok(all[0].terminationDate);
    const back = call("employee-offboard", ctxA, { id: emp.id, rehire: true });
    assert.equal(back.result.employee.status, "active");
    assert.equal(back.result.employee.terminationDate, null);
    assert.equal(call("employee-list", ctxA).result.employees.length, 1);
  });
});
