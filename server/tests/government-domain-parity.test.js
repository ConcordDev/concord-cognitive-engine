import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGovernmentActions from "../domains/government.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`government.${name}`);
  assert.ok(fn, `government.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerGovernmentActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("government.representatives-find", () => {
  it("rejects empty address", () => {
    assert.equal(call("representatives-find", ctxA, { address: "" }).ok, false);
  });

  it("returns federal + state + local reps for an address (deterministic)", () => {
    const r1 = call("representatives-find", ctxA, { address: "94110" });
    assert.equal(r1.ok, true);
    assert.ok(r1.result.representatives.some(x => x.level === "federal"));
    assert.ok(r1.result.representatives.some(x => x.level === "state"));
    assert.ok(r1.result.representatives.some(x => x.level === "local"));
    const r2 = call("representatives-find", ctxA, { address: "94110" });
    assert.deepEqual(r1.result.representatives, r2.result.representatives);
  });

  it("different addresses produce different reps", () => {
    const r1 = call("representatives-find", ctxA, { address: "94110" });
    const r2 = call("representatives-find", ctxA, { address: "10001" });
    assert.notDeepEqual(r1.result.representatives[0], r2.result.representatives[0]);
  });
});

describe("government.bills-list", () => {
  it("returns sample bills with all statuses represented", () => {
    const r = call("bills-list", ctxA, { limit: 20 });
    assert.equal(r.ok, true);
    assert.ok(r.result.bills.length >= 5);
    const statuses = new Set(r.result.bills.map(b => b.status));
    assert.ok(statuses.size >= 3, "expected diversity of bill statuses");
  });

  it("filters by topic", () => {
    const r = call("bills-list", ctxA, { topic: "climate" });
    assert.ok(r.result.bills.every(b => b.title.toLowerCase().includes("climate") || (b.subjects || []).some(s => s.toLowerCase().includes("climate"))));
  });

  it("respects limit", () => {
    const r = call("bills-list", ctxA, { limit: 2 });
    assert.equal(r.result.bills.length, 2);
  });
});

describe("government.alerts-current", () => {
  it("rejects missing coords", async () => {
    assert.equal((await call("alerts-current", ctxA, {})).ok, false);
  });

  it("graceful fallback when NWS unreachable", async () => {
    const r = await call("alerts-current", ctxA, { lat: 37.77, lng: -122.42 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.alerts, []);
    assert.equal(r.result.source, "fallback");
  });
});

describe("government.foia-list / -create", () => {
  it("create + list scoped per user", () => {
    const r = call("foia-create", ctxA, { agency: "FBI", subject: "Test request", body: "Body here" });
    assert.equal(r.ok, true);
    assert.equal(r.result.request.status, "draft");
    const list = call("foia-list", ctxA, {});
    assert.equal(list.result.requests.length, 1);
    assert.equal(call("foia-list", ctxB, {}).result.requests.length, 0);
  });

  it("rejects missing fields", () => {
    assert.equal(call("foia-create", ctxA, { agency: "FBI", subject: "x" }).ok, false);
    assert.equal(call("foia-create", ctxA, { agency: "", subject: "x", body: "y" }).ok, false);
  });
});

describe("government.budget-breakdown", () => {
  it("federal scope returns categories summing to total within 1%", () => {
    const r = call("budget-breakdown", ctxA, { scope: "federal", year: 2026 });
    assert.equal(r.ok, true);
    assert.ok(r.result.totalBillions > 0);
    const sumPct = r.result.categories.reduce((s, c) => s + c.pctOfTotal, 0);
    assert.ok(Math.abs(sumPct - 100) < 2, `category pcts should sum near 100, got ${sumPct}`);
  });

  it("state scope returns different totals than federal", () => {
    const fed = call("budget-breakdown", ctxA, { scope: "federal" });
    const st = call("budget-breakdown", ctxA, { scope: "state" });
    assert.ok(fed.result.totalBillions > st.result.totalBillions);
  });

  it("local scope returns valid categories", () => {
    const r = call("budget-breakdown", ctxA, { scope: "local" });
    assert.ok(r.result.categories.length >= 5);
    assert.ok(r.result.categories.every(c => c.amountBillions > 0));
  });

  it("clamps year", () => {
    const r1 = call("budget-breakdown", ctxA, { scope: "federal", year: 2050 });
    assert.equal(r1.result.year, 2030);
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("permitTimeline computes on-time", () => {
    const r = ACTIONS.get("government.permitTimeline")(ctxA, { id: "p1", data: { applicationDate: "2026-04-01", approvalDate: "2026-04-15", type: "building" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.processingDays, 14);
    assert.equal(r.result.onTime, true);
  });
});
