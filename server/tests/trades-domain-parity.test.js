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

// ── Full-app parity (ServiceTitan + Jobber 2026) ────────────────

describe("trades.technicians-* + dispatch-board", () => {
  it("add / list / set-status / delete per-user scoped", () => {
    const a = call("technicians-add", ctxA, { name: "Mike Plumber", skills: ["plumbing", "hvac"] });
    assert.equal(a.ok, true);
    assert.equal(a.result.technician.status, "available");
    assert.equal(call("technicians-list", ctxA, {}).result.technicians.length, 1);
    assert.equal(call("technicians-list", ctxB, {}).result.technicians.length, 0);
    const upd = call("technicians-set-status", ctxA, { id: a.result.technician.id, status: "on_site" });
    assert.equal(upd.result.technician.status, "on_site");
    assert.equal(call("technicians-delete", ctxA, { id: a.result.technician.id }).ok, true);
  });
  it("rejects empty name and invalid status", () => {
    assert.equal(call("technicians-add", ctxA, { name: "" }).ok, false);
    const t = call("technicians-add", ctxA, { name: "X" });
    assert.equal(call("technicians-set-status", ctxA, { id: t.result.technician.id, status: "bogus" }).ok, false);
  });
  it("dispatch-board returns rows by tech + unassigned bucket", () => {
    const today = new Date().toISOString().slice(0, 10);
    const tech = call("technicians-add", ctxA, { name: "Tech A" });
    const cust = call("customer-upsert", ctxA, { name: "Acme" });
    const j1 = call("job-create", ctxA, { customerId: cust.result.customer.id, description: "Fix leak", scheduledFor: today });
    call("job-assign", ctxA, { id: j1.result.job.id, tech: tech.result.technician.id });
    call("job-create", ctxA, { customerId: cust.result.customer.id, description: "Other unassigned job", scheduledFor: today });
    const board = call("dispatch-board", ctxA, { date: today });
    assert.equal(board.result.totalJobs, 2);
    assert.equal(board.result.rows.length, 1);
    assert.equal(board.result.unassigned.length, 1);
  });
});

describe("trades.route-optimize (nearest-neighbour)", () => {
  it("orders stops by greedy nearest-neighbour from start", () => {
    const r = call("route-optimize", ctxA, {
      start: { lat: 0, lng: 0 },
      stops: [
        { id: "far", lat: 10, lng: 10 },
        { id: "close", lat: 1, lng: 1 },
        { id: "mid", lat: 5, lng: 5 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.ordered[0].id, "close");
    assert.equal(r.result.ordered[1].id, "mid");
    assert.equal(r.result.ordered[2].id, "far");
    assert.ok(r.result.totalDistanceUnits > 0);
  });
  it("rejects empty stops", () => {
    assert.equal(call("route-optimize", ctxA, { start: { lat: 0, lng: 0 }, stops: [] }).ok, false);
  });
});

describe("trades.quotes-* (create + send + accept/reject)", () => {
  it("create / send / accept cycle", () => {
    const q = call("quotes-create", ctxA, {
      customerId: "cust_1", title: "Bathroom remodel",
      lineItems: [{ desc: "Labor", qty: 20, unitPrice: 80 }, { desc: "Materials", qty: 1, unitPrice: 1200 }],
      taxRate: 8,
    });
    assert.equal(q.ok, true);
    assert.equal(q.result.quote.subtotal, 2800);
    assert.equal(q.result.quote.tax, 224);
    assert.equal(q.result.quote.total, 3024);
    assert.equal(q.result.quote.status, "draft");
    const sent = call("quotes-send", ctxA, { id: q.result.quote.id });
    assert.equal(sent.result.quote.status, "sent");
    const acc = call("quotes-accept", ctxA, { id: q.result.quote.id });
    assert.equal(acc.result.quote.status, "accepted");
  });
  it("rejects empty line items", () => {
    assert.equal(call("quotes-create", ctxA, { customerId: "x", title: "T", lineItems: [] }).ok, false);
  });
  it("cannot accept already-rejected quote", () => {
    const q = call("quotes-create", ctxA, { customerId: "c", title: "T", lineItems: [{ qty: 1, unitPrice: 100 }] });
    call("quotes-reject", ctxA, { id: q.result.quote.id });
    assert.equal(call("quotes-accept", ctxA, { id: q.result.quote.id }).ok, false);
  });
});

describe("trades.bookings-* (online intake)", () => {
  it("create / list / confirm cycle", () => {
    const b = call("bookings-create", ctxA, { customerName: "Jane", customerEmail: "j@x", serviceType: "plumbing", preferredDate: "2026-06-01" });
    assert.equal(b.ok, true);
    assert.equal(b.result.booking.status, "pending");
    assert.equal(call("bookings-list", ctxA, {}).result.bookings.length, 1);
    const c = call("bookings-confirm", ctxA, { id: b.result.booking.id });
    assert.equal(c.result.booking.status, "confirmed");
  });
  it("rejects missing required fields", () => {
    assert.equal(call("bookings-create", ctxA, { customerName: "", customerEmail: "x", serviceType: "y" }).ok, false);
    assert.equal(call("bookings-create", ctxA, { customerName: "X", customerEmail: "", serviceType: "y" }).ok, false);
  });
});

describe("trades.job-photos-*", () => {
  it("add + list scoped by jobId", () => {
    call("job-photos-add", ctxA, { jobId: "j1", url: "/a.jpg", kind: "before" });
    call("job-photos-add", ctxA, { jobId: "j1", url: "/b.jpg", kind: "after" });
    call("job-photos-add", ctxA, { jobId: "j2", url: "/c.jpg" });
    assert.equal(call("job-photos-list", ctxA, { jobId: "j1" }).result.photos.length, 2);
    assert.equal(call("job-photos-list", ctxA, {}).result.photos.length, 3);
  });
  it("rejects missing url", () => {
    assert.equal(call("job-photos-add", ctxA, { jobId: "j", url: "" }).ok, false);
  });
});

describe("trades.timesheets-* (clock in/out + duration calc)", () => {
  it("clock-in / clock-out cycle with duration", async () => {
    const ci = call("timesheets-clock-in", ctxA, { technicianId: "t1", jobId: "j1" });
    assert.equal(ci.ok, true);
    // Mutate the in-memory entry to make duration non-zero deterministically
    const e = globalThis._concordSTATE.tradesLens.timesheets.get("u")[0];
    e.clockIn = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const co = call("timesheets-clock-out", ctxA, { technicianId: "t1" });
    assert.equal(co.result.entry.durationMin, 60);
  });
  it("double clock-in blocked", () => {
    call("timesheets-clock-in", ctxA, { technicianId: "t2" });
    assert.equal(call("timesheets-clock-in", ctxA, { technicianId: "t2" }).ok, false);
  });
  it("clock-out without clock-in blocked", () => {
    assert.equal(call("timesheets-clock-out", ctxA, { technicianId: "nobody" }).ok, false);
  });
});

describe("trades.payments-* (link + mark-paid)", () => {
  it("create-link / mark-paid / list cycle", () => {
    const p = call("payments-create-link", ctxA, { invoiceRef: "INV-001", amount: 500 });
    assert.equal(p.ok, true);
    assert.equal(p.result.payment.status, "pending");
    const m = call("payments-mark-paid", ctxA, { id: p.result.payment.id });
    assert.equal(m.result.payment.status, "paid");
  });
  it("rejects invalid amount", () => {
    assert.equal(call("payments-create-link", ctxA, { invoiceRef: "X", amount: 0 }).ok, false);
  });
});

describe("trades.recurring-plans-* (service contracts)", () => {
  it("create / list / cancel cycle", () => {
    const p = call("recurring-plans-create", ctxA, { customerId: "c1", serviceType: "HVAC", cadence: "quarterly", priceEach: 200 });
    assert.equal(p.ok, true);
    assert.equal(p.result.plan.status, "active");
    const c = call("recurring-plans-cancel", ctxA, { id: p.result.plan.id });
    assert.equal(c.result.plan.status, "cancelled");
  });
  it("rejects invalid input", () => {
    assert.equal(call("recurring-plans-create", ctxA, { customerId: "c", serviceType: "", priceEach: 100 }).ok, false);
    assert.equal(call("recurring-plans-create", ctxA, { customerId: "c", serviceType: "x", priceEach: 0 }).ok, false);
  });
});

describe("trades.reviews-* (rating + NPS)", () => {
  it("submit + list calc avg + NPS", () => {
    call("reviews-submit", ctxA, { jobId: "j1", rating: 5, nps: 10, customerName: "Alice" });
    call("reviews-submit", ctxA, { jobId: "j2", rating: 4, nps: 9 });
    call("reviews-submit", ctxA, { jobId: "j3", rating: 2, nps: 4 });
    const r = call("reviews-list", ctxA, {});
    assert.equal(r.result.totalReviews, 3);
    assert.ok(r.result.avgRating > 3);
    // promoters 2, detractors 1, total 3 -> nps = round((2-1)/3 * 100) = 33
    assert.equal(r.result.nps, 33);
  });
  it("rejects zero rating", () => {
    assert.equal(call("reviews-submit", ctxA, { jobId: "j", rating: 0 }).ok, false);
  });
});

describe("trades.dashboard-summary (DispatchShell data source)", () => {
  it("aggregates jobs + techs + quotes + payments + reviews", () => {
    const today = new Date().toISOString().slice(0, 10);
    const t1 = call("technicians-add", ctxA, { name: "T1" });
    call("technicians-set-status", ctxA, { id: t1.result.technician.id, status: "on_site" });
    call("technicians-add", ctxA, { name: "T2" });
    const cust = call("customer-upsert", ctxA, { name: "Acme" });
    call("job-create", ctxA, { customerId: cust.result.customer.id, description: "Today's job", scheduledFor: today });
    const q = call("quotes-create", ctxA, { customerId: cust.result.customer.id, title: "Q1", lineItems: [{ qty: 1, unitPrice: 500 }] });
    call("quotes-send", ctxA, { id: q.result.quote.id });
    const pay = call("payments-create-link", ctxA, { invoiceRef: "INV-1", amount: 500 });
    call("payments-mark-paid", ctxA, { id: pay.result.payment.id });
    call("reviews-submit", ctxA, { jobId: "j", rating: 5 });
    const d = call("dashboard-summary", ctxA, {});
    assert.equal(d.result.jobsToday, 1);
    assert.equal(d.result.techsTotal, 2);
    assert.equal(d.result.techsOnJob, 1);
    assert.equal(d.result.techsAvailable, 1);
    assert.equal(d.result.quotesPending, 1);
    assert.equal(d.result.totalRevenue, 500);
    assert.equal(d.result.avgRating, 5);
  });
});
