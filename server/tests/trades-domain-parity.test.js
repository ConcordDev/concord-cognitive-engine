import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/trades.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`trades.${name}`);
  if (!fn) throw new Error(`trades.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

describe("trades — customers", () => {
  it("creates + lists customer", () => {
    call("customer-upsert", ctxA, { name: "Acme Corp", phone: "555-1234" });
    const r = call("customer-list", ctxA);
    assert.equal(r.result.customers.length, 1);
  });

  it("INVARIANT: customers scoped per-user", () => {
    call("customer-upsert", ctxA, { name: "a-only" });
    const b = call("customer-list", ctxB);
    assert.equal(b.result.customers.length, 0);
  });

  it("rejects empty name", () => {
    const r = call("customer-upsert", ctxA, { name: "  " });
    assert.equal(r.ok, false);
  });
});

describe("trades — jobs", () => {
  let custId;
  beforeEach(() => {
    custId = call("customer-upsert", ctxA, { name: "Test Cust" }).result.customer.id;
  });

  it("creates job for existing customer", () => {
    const r = call("job-create", ctxA, { customerId: custId, description: "Fix AC", priority: "high", estimatedHours: 2 });
    assert.equal(r.ok, true);
    assert.match(r.result.job.number, /^JOB-\d{5}$/);
    assert.equal(r.result.job.status, "unassigned");
    assert.equal(r.result.job.priority, "high");
  });

  it("rejects unknown customer", () => {
    const r = call("job-create", ctxA, { customerId: "bogus", description: "x" });
    assert.equal(r.ok, false);
  });

  it("rejects empty description", () => {
    const r = call("job-create", ctxA, { customerId: custId, description: "  " });
    assert.equal(r.ok, false);
  });

  it("status transitions through pipeline", () => {
    const j = call("job-create", ctxA, { customerId: custId, description: "x" });
    call("job-update-status", ctxA, { id: j.result.job.id, status: "dispatched" });
    call("job-update-status", ctxA, { id: j.result.job.id, status: "completed" });
    const list = call("job-list", ctxA, { status: "completed" });
    assert.equal(list.result.jobs.length, 1);
  });

  it("job-list sorts by priority (emergency first)", () => {
    call("job-create", ctxA, { customerId: custId, description: "low job", priority: "low" });
    call("job-create", ctxA, { customerId: custId, description: "emergency", priority: "emergency" });
    const r = call("job-list", ctxA);
    assert.equal(r.result.jobs[0].priority, "emergency");
  });

  it("assigning tech moves status to dispatched", () => {
    const j = call("job-create", ctxA, { customerId: custId, description: "x" });
    call("job-assign", ctxA, { id: j.result.job.id, tech: "Alice" });
    const list = call("job-list", ctxA);
    assert.equal(list.result.jobs[0].status, "dispatched");
    assert.equal(list.result.jobs[0].assignedTech, "Alice");
  });
});

describe("trades — maintenance contracts", () => {
  let custId;
  beforeEach(() => {
    custId = call("customer-upsert", ctxA, { name: "Customer" }).result.customer.id;
  });

  it("creates contract", () => {
    const r = call("contract-create", ctxA, { customerId: custId, cadence: "quarterly", monthlyRate: 75, description: "HVAC PM" });
    assert.equal(r.ok, true);
    assert.equal(r.result.contract.cadence, "quarterly");
  });

  it("cancel sets active=false", () => {
    const c = call("contract-create", ctxA, { customerId: custId, monthlyRate: 50 });
    call("contract-cancel", ctxA, { id: c.result.contract.id });
    const list = call("contract-list", ctxA);
    assert.equal(list.result.contracts[0].active, false);
  });

  it("rejects negative monthlyRate", () => {
    const r = call("contract-create", ctxA, { customerId: custId, monthlyRate: -10 });
    assert.equal(r.ok, false);
  });
});
