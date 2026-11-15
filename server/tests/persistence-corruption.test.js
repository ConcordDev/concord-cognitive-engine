// Persistence and value-corruption checks from FIX_ORDER_DRAFT section 1h.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCarpentry from "../domains/carpentry.js";
import registerLand from "../domains/landscaping.js";
import registerHealth from "../domains/healthcare.js";
import registerLegal from "../domains/legal.js";
import registerFinance from "../domains/finance.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}) {
  const fn = actions.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
const ctx = { actor: { userId: "owner" }, userId: "owner" };

before(() => {
  registerCarpentry(register);
  registerLand(register);
  registerHealth(register);
  registerLegal(register);
  registerFinance(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("persistence and corruption", () => {
  it("keeps a carpentry takeoff after the compute returns", () => {
    const built = call("carpentry", "materialTakeoff", ctx, {
      projectName: "QA deck",
      items: [{ name: "2x6", quantity: 2, unitCost: 8 }],
      wastePct: 0, laborHours: 0, laborRate: 0, overheadPct: 0, marginPct: 0,
    });
    assert.equal(built.ok, true);
    assert.equal(built.result.total, 16);
    const listed = call("carpentry", "estimate-list", ctx, {}).result.estimates;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, built.result.estimateId);
    assert.equal(listed[0].projectName, "QA deck");
    assert.equal(listed[0].total, 16);
  });

  it("keeps a zero-total landscaping proposal", () => {
    const built = call("landscaping", "proposal-build", ctx, {
      client: "QA",
      project: "Empty bed",
      lineItems: [{ description: "Consult", quantity: 1, unitCost: 0 }],
    });
    assert.equal(built.ok, true);
    assert.equal(built.result.total, 0);
    const listed = call("landscaping", "proposal-list", ctx, {}).result.proposals;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, built.result.id);
    assert.equal(listed[0].total, 0);
  });

  it("refuses a body temperature of 200 and a heart rate of 999 instead of storing them", () => {
    const temp = call("healthcare", "vitals-record", ctx, { patientId: "p1", tempF: 200 });
    assert.equal(temp.ok, false);
    const hr = call("healthcare", "vitals-record", ctx, { patientId: "p1", heartRate: 999 });
    assert.equal(hr.ok, false);
    const stored = call("healthcare", "vitals-record", ctx, { patientId: "p1", tempF: 98.6, heartRate: 72 });
    assert.equal(stored.ok, true);
    assert.equal(stored.result.vitals.tempF, 98.6);
    assert.notEqual(stored.result.vitals.tempF, 2);
    const list = call("healthcare", "vitals-list", ctx, { patientId: "p1" }).result.vitals;
    assert.equal(list.length, 1);
    assert.equal(list[0].tempF, 98.6);
  });

  it("refuses a legal time entry of a trillion hours", () => {
    const matter = call("legal", "matters-create", ctx, { name: "QA", clientName: "Ada" }).result.matter;
    const huge = call("legal", "time-entries-create", ctx, { matterId: matter.id, hours: 999999999999, description: "oops" });
    assert.equal(huge.ok, false);
    assert.match(huge.error, /at most 336/);
    const list = call("legal", "time-entries-list", ctx, { matterId: matter.id }).result.entries;
    assert.equal(list.length, 0);
    const ok = call("legal", "time-entries-create", ctx, { matterId: matter.id, hours: 1.5, description: "review" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.entry.hours, 1.5);
  });

  it("sums a net-worth snapshot from the numeric fields (10 + 5 - 3 = 12)", () => {
    const snap = call("finance", "net-worth-snapshot", ctx, { cash: 10, investments: 5, liabilities: 3 }).result.snapshot;
    assert.equal(snap.total, 12);
    assert.notEqual(snap.total, 120);
  });

  it("stores a cash-flow amount of 5 as 5", () => {
    const tx = call("finance", "transactions-ingest", ctx, { description: "QA coffee", amount: 5 }).result.transaction;
    assert.equal(tx.amount, 5);
    assert.notEqual(tx.amount, -55);
  });
});
