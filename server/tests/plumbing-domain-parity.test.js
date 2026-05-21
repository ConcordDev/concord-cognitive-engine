// Contract tests for server/domains/plumbing.js — engineering calculators
// plus the per-user field-service substrate (dispatch board, price book,
// quote-to-invoice flow, technician mobile workflow, maintenance plans,
// customer notifications, parts-inventory deduction).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPlumbingActions from "../domains/plumbing.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact) {
  const fn = ACTIONS.get(`plumbing.${name}`);
  if (!fn) throw new Error(`plumbing.${name} not registered`);
  return fn(ctx, artifact || { id: null, data: {}, meta: {} }, params);
}

before(() => {
  // Field-service macros require globalThis._concordSTATE to back per-user Maps.
  globalThis._concordSTATE = {};
  registerPlumbingActions(register);
});

beforeEach(() => {
  // Fresh substrate each test so per-user lists don't leak.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("plumbing engineering calculators", () => {
  it("pipeSize recommends a nominal size", () => {
    const r = call("pipeSize", ctxA, {}, { data: { flowGPM: 10, velocityFPS: 5, material: "copper" } });
    assert.equal(r.ok, true);
    assert.match(r.result.recommendedSize, /nominal/);
  });

  it("waterHeaterSize sizes a tank from household count", () => {
    const r = call("waterHeaterSize", ctxA, {}, { data: { household: 4, simultaneousFixtures: 3 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.household, 4);
    assert.ok(r.result.peakDemandGPM > 0);
  });

  it("drainSlope returns IPC slope guidance", () => {
    const r = call("drainSlope", ctxA, {}, { data: { pipeSizeInches: 2, lengthFeet: 20 } });
    assert.equal(r.ok, true);
    assert.match(r.result.ipcCode, /IPC Table 704.1/);
  });

  it("fixtureCount totals WSFU and picks a meter size", () => {
    const r = call("fixtureCount", ctxA, {}, { data: { fixtures: [{ type: "toilet", count: 2 }, { type: "shower", count: 1 }] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.totalWSFU > 0);
    assert.ok(r.result.meterSize);
  });
});

describe("plumbing technicians + dispatch board", () => {
  it("techAdd requires a name and techList reports it", () => {
    assert.equal(call("techAdd", ctxA, {}).ok, false);
    const add = call("techAdd", ctxA, { name: "Mara Vance", skills: ["repipe", "drain"], phone: "555-0100" });
    assert.equal(add.ok, true);
    assert.ok(add.result.tech.id);
    const lst = call("techList", ctxA, {});
    assert.equal(lst.ok, true);
    assert.equal(lst.result.count, 1);
    assert.equal(lst.result.techs[0].openJobs, 0);
  });

  it("dispatchAssign rejects an unknown tech and assigns to a real one", () => {
    const tech = call("techAdd", ctxA, { name: "Dex" }).result.tech;
    assert.equal(call("dispatchAssign", ctxA, { jobTitle: "Leak", techId: "tech_bogus" }).ok, false);
    const assign = call("dispatchAssign", ctxA, {
      jobTitle: "Water heater swap", techId: tech.id, client: "Acme", date: "2026-06-01",
      startHour: 9, durationHours: 3, priority: "high",
    });
    assert.equal(assign.ok, true);
    assert.equal(assign.result.assignment.status, "scheduled");
  });

  it("dispatchBoard groups assignments into tech lanes with load hours", () => {
    const tech = call("techAdd", ctxA, { name: "Pia" }).result.tech;
    call("dispatchAssign", ctxA, { jobTitle: "A", techId: tech.id, date: "2026-06-02", durationHours: 2 });
    call("dispatchAssign", ctxA, { jobTitle: "B", date: "2026-06-02" });
    const board = call("dispatchBoard", ctxA, { date: "2026-06-02" });
    assert.equal(board.ok, true);
    assert.equal(board.result.lanes.length, 1);
    assert.equal(board.result.lanes[0].loadHours, 2);
    assert.equal(board.result.unassigned.length, 1);
  });

  it("dispatchUpdate changes status + tech", () => {
    const tech = call("techAdd", ctxA, { name: "Rue" }).result.tech;
    const a = call("dispatchAssign", ctxA, { jobTitle: "Sink", date: "2026-06-03" }).result.assignment;
    const upd = call("dispatchUpdate", ctxA, { assignmentId: a.id, techId: tech.id, status: "en_route" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.assignment.status, "en_route");
    assert.equal(upd.result.assignment.techId, tech.id);
  });

  it("techRemove deletes a technician", () => {
    const tech = call("techAdd", ctxA, { name: "Gone" }).result.tech;
    assert.equal(call("techRemove", ctxA, { techId: tech.id }).ok, true);
    assert.equal(call("techRemove", ctxA, { techId: tech.id }).ok, false);
  });
});

describe("plumbing price book with markup", () => {
  it("priceItemAdd computes price from cost + markup", () => {
    const r = call("priceItemAdd", ctxA, { name: "1/2in copper", kind: "part", cost: 4, markupPct: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.result.item.price, 6);
  });

  it("priceBookList reports average margin", () => {
    call("priceItemAdd", ctxA, { name: "Labor", kind: "labor", cost: 60, markupPct: 100 });
    call("priceItemAdd", ctxA, { name: "Valve", kind: "part", cost: 10, markupPct: 0 });
    const lst = call("priceBookList", ctxA, {});
    assert.equal(lst.ok, true);
    assert.equal(lst.result.count, 2);
    assert.equal(lst.result.avgMarginPct, 50);
  });

  it("priceItemUpdate recomputes price; priceItemRemove deletes", () => {
    const item = call("priceItemAdd", ctxA, { name: "P", cost: 10, markupPct: 0 }).result.item;
    const upd = call("priceItemUpdate", ctxA, { itemId: item.id, markupPct: 100 });
    assert.equal(upd.result.item.price, 20);
    assert.equal(call("priceItemRemove", ctxA, { itemId: item.id }).ok, true);
    assert.equal(call("priceItemRemove", ctxA, { itemId: item.id }).ok, false);
  });
});

describe("plumbing quote-to-invoice flow", () => {
  it("invoiceFromQuote rejects empty lines and builds a totalled invoice", () => {
    assert.equal(call("invoiceFromQuote", ctxA, { lines: [] }).ok, false);
    const inv = call("invoiceFromQuote", ctxA, {
      client: "Acme", taxPct: 10,
      lines: [{ name: "Pipe", quantity: 2, unitPrice: 25 }, { name: "Labor", quantity: 3, unitPrice: 60 }],
    });
    assert.equal(inv.ok, true);
    assert.equal(inv.result.invoice.subtotal, 230);
    assert.equal(inv.result.invoice.tax, 23);
    assert.equal(inv.result.invoice.total, 253);
    assert.equal(inv.result.invoice.status, "issued");
  });

  it("invoiceRecordPayment marks partial then paid", () => {
    const inv = call("invoiceFromQuote", ctxA, { lines: [{ name: "X", quantity: 1, unitPrice: 100 }] }).result.invoice;
    const p1 = call("invoiceRecordPayment", ctxA, { invoiceId: inv.id, amount: 40, method: "card" });
    assert.equal(p1.result.invoice.status, "partial");
    assert.equal(p1.result.balanceDue, 60);
    const p2 = call("invoiceRecordPayment", ctxA, { invoiceId: inv.id, amount: 60 });
    assert.equal(p2.result.invoice.status, "paid");
    assert.equal(p2.result.balanceDue, 0);
  });

  it("invoiceList reports outstanding + collected totals", () => {
    const inv = call("invoiceFromQuote", ctxA, { lines: [{ name: "X", quantity: 1, unitPrice: 200 }] }).result.invoice;
    call("invoiceRecordPayment", ctxA, { invoiceId: inv.id, amount: 50 });
    const lst = call("invoiceList", ctxA, {});
    assert.equal(lst.ok, true);
    assert.equal(lst.result.collected, 50);
    assert.equal(lst.result.outstanding, 150);
  });
});

describe("plumbing technician mobile workflow", () => {
  it("workflowStart seeds a default checklist for a real assignment", () => {
    assert.equal(call("workflowStart", ctxA, { assignmentId: "bogus" }).ok, false);
    const a = call("dispatchAssign", ctxA, { jobTitle: "Repair", date: "2026-06-04" }).result.assignment;
    const wf = call("workflowStart", ctxA, { assignmentId: a.id });
    assert.equal(wf.ok, true);
    assert.ok(wf.result.workflow.checklist.length > 0);
  });

  it("workflowUpdate ticks checklist items, adds photos, captures signature", () => {
    const a = call("dispatchAssign", ctxA, { jobTitle: "J", date: "2026-06-05" }).result.assignment;
    call("workflowStart", ctxA, { assignmentId: a.id });
    call("workflowUpdate", ctxA, { assignmentId: a.id, checkIndex: 0, done: true });
    call("workflowUpdate", ctxA, { assignmentId: a.id, photoCaption: "Before" });
    const sig = call("workflowUpdate", ctxA, { assignmentId: a.id, signature: "data:sig", signedBy: "Client" });
    assert.equal(sig.result.workflow.signedBy, "Client");
    assert.ok(sig.result.workflow.completedAt);
    const got = call("workflowGet", ctxA, { assignmentId: a.id });
    assert.equal(got.result.workflow.photos.length, 1);
    assert.ok(got.result.progress > 0);
  });
});

describe("plumbing maintenance plans", () => {
  it("planCreate requires a client and sets next visit", () => {
    assert.equal(call("planCreate", ctxA, {}).ok, false);
    const p = call("planCreate", ctxA, { client: "Acme", cadence: "quarterly", fee: 120, startDate: "2026-01-01" });
    assert.equal(p.ok, true);
    assert.ok(p.result.plan.nextVisit > "2026-01-01");
  });

  it("planLogVisit advances the schedule; planList reports recurring revenue", () => {
    const p = call("planCreate", ctxA, { client: "Acme", cadence: "monthly", fee: 50 }).result.plan;
    const before = p.nextVisit;
    const logged = call("planLogVisit", ctxA, { planId: p.id });
    assert.equal(logged.result.plan.visitsCompleted, 1);
    assert.notEqual(logged.result.plan.nextVisit, before);
    const lst = call("planList", ctxA, {});
    assert.equal(lst.result.recurringRevenue, 50);
  });
});

describe("plumbing customer notifications", () => {
  it("notifySend templates messages by kind", () => {
    assert.equal(call("notifySend", ctxA, {}).ok, false);
    const n = call("notifySend", ctxA, { client: "Pat", kind: "on_the_way", channel: "sms" });
    assert.equal(n.ok, true);
    assert.match(n.result.notice.message, /on the way/);
  });

  it("notifyLog tallies notices by kind", () => {
    call("notifySend", ctxA, { client: "A", kind: "confirmation" });
    call("notifySend", ctxA, { client: "B", kind: "confirmation" });
    call("notifySend", ctxA, { client: "C", kind: "reminder" });
    const log = call("notifyLog", ctxA, {});
    assert.equal(log.result.count, 3);
    assert.equal(log.result.byKind.confirmation, 2);
  });
});

describe("plumbing parts inventory + completion deduction", () => {
  it("partStock adds then restocks by name", () => {
    const first = call("partStock", ctxA, { name: "Wax ring", quantity: 10, reorderAt: 3, unitCost: 2 });
    assert.equal(first.result.restocked, false);
    const second = call("partStock", ctxA, { name: "wax ring", quantity: 5 });
    assert.equal(second.result.restocked, true);
    assert.equal(second.result.part.onHand, 15);
  });

  it("partList reports low stock and inventory value", () => {
    call("partStock", ctxA, { name: "Valve", quantity: 1, reorderAt: 5, unitCost: 8 });
    const lst = call("partList", ctxA, {});
    assert.ok(lst.result.lowStock.includes("Valve"));
    assert.equal(lst.result.inventoryValue, 8);
  });

  it("jobComplete deducts used parts and flags shortages", () => {
    const a = call("dispatchAssign", ctxA, { jobTitle: "Toilet", date: "2026-06-06" }).result.assignment;
    const part = call("partStock", ctxA, { name: "Flapper", quantity: 2, reorderAt: 5, unitCost: 3 }).result.part;
    const done = call("jobComplete", ctxA, {
      assignmentId: a.id,
      partsUsed: [{ partId: part.id, quantity: 3 }, { name: "Unknown", quantity: 1 }],
    });
    assert.equal(done.ok, true);
    assert.equal(done.result.assignment.status, "completed");
    assert.equal(done.result.deductions[0].deducted, 2);
    assert.ok(done.result.shortages.length >= 2);
  });
});

describe("plumbing ops summary + tenant isolation", () => {
  it("opsSummary aggregates dispatch, invoices, plans, parts", () => {
    const today = new Date().toISOString().slice(0, 10);
    call("dispatchAssign", ctxA, { jobTitle: "Today job", date: today });
    call("invoiceFromQuote", ctxA, { lines: [{ name: "X", quantity: 1, unitPrice: 100 }] });
    call("planCreate", ctxA, { client: "Acme", cadence: "annual", fee: 200 });
    call("partStock", ctxA, { name: "Low", quantity: 0, reorderAt: 5 });
    const s = call("opsSummary", ctxA, {});
    assert.equal(s.ok, true);
    assert.equal(s.result.jobsToday, 1);
    assert.equal(s.result.outstandingAR, 100);
    assert.equal(s.result.activePlans, 1);
    assert.equal(s.result.lowStockParts, 1);
  });

  it("per-user substrate does not leak between tenants", () => {
    call("techAdd", ctxA, { name: "A-tech" });
    const bList = call("techList", ctxB, {});
    assert.equal(bList.result.count, 0);
  });
});
