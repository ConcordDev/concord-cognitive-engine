// Contract tests for server/domains/consulting.js — STATE-backed
// invoicing, proposals, staffing, expenses, timer, retainers,
// profitability, and client-portal macros.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerConsultingActions from "../domains/consulting.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`consulting.${name}`);
  if (!fn) throw new Error(`consulting.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerConsultingActions(register); });

beforeEach(() => {
  // Fresh STATE per test so users don't leak across cases.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

function makeEngagement() {
  const r = call("engagement-create", ctxA, { name: "Strategy Refresh", client: "Acme", rate: 200, budgetHours: 100 });
  assert.equal(r.ok, true);
  return r.result.engagement;
}

describe("consulting.invoice-* (invoicing from logged time)", () => {
  it("generates an invoice rolling up unbilled time entries", () => {
    const eng = makeEngagement();
    call("time-log", ctxA, { engagementId: eng.id, hours: 5, note: "Discovery" });
    call("time-log", ctxA, { engagementId: eng.id, hours: 3, note: "Workshop" });
    const r = call("invoice-create", ctxA, { engagementId: eng.id, taxRate: 0.1, dueInDays: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.invoice.subtotal, 1600);
    assert.equal(r.result.invoice.tax, 160);
    assert.equal(r.result.invoice.total, 1760);
    assert.equal(r.result.invoice.status, "sent");
    assert.equal(r.result.invoice.lineItems.length, 2);
  });

  it("rejects invoicing when there is no unbilled time", () => {
    const eng = makeEngagement();
    const r = call("invoice-create", ctxA, { engagementId: eng.id });
    assert.equal(r.ok, false);
  });

  it("does not double-bill time across two invoices", () => {
    const eng = makeEngagement();
    call("time-log", ctxA, { engagementId: eng.id, hours: 4 });
    call("invoice-create", ctxA, { engagementId: eng.id });
    const second = call("invoice-create", ctxA, { engagementId: eng.id });
    assert.equal(second.ok, false);
  });

  it("marks an invoice paid and reflects collected totals", () => {
    const eng = makeEngagement();
    call("time-log", ctxA, { engagementId: eng.id, hours: 2 });
    const inv = call("invoice-create", ctxA, { engagementId: eng.id }).result.invoice;
    const paid = call("invoice-mark-paid", ctxA, { id: inv.id });
    assert.equal(paid.ok, true);
    assert.equal(paid.result.invoice.status, "paid");
    const list = call("invoice-list", ctxA, {});
    assert.equal(list.result.collected, 400);
  });

  it("exports a printable invoice document", () => {
    const eng = makeEngagement();
    call("time-log", ctxA, { engagementId: eng.id, hours: 1 });
    const inv = call("invoice-create", ctxA, { engagementId: eng.id }).result.invoice;
    const exp = call("invoice-export", ctxA, { id: inv.id });
    assert.equal(exp.ok, true);
    assert.match(exp.result.document, /INVOICE INV-0001/);
  });

  it("deletes an invoice and releases its time entries", () => {
    const eng = makeEngagement();
    call("time-log", ctxA, { engagementId: eng.id, hours: 3 });
    const inv = call("invoice-create", ctxA, { engagementId: eng.id }).result.invoice;
    const del = call("invoice-delete", ctxA, { id: inv.id });
    assert.equal(del.ok, true);
    const reInv = call("invoice-create", ctxA, { engagementId: eng.id });
    assert.equal(reInv.ok, true);
  });
});

describe("consulting.proposal-* (builder + e-signature)", () => {
  it("returns reusable section templates", () => {
    const r = call("proposal-templates", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.sections.length >= 6);
  });

  it("creates a proposal, fills a section, and tracks completeness", () => {
    const created = call("proposal-create", ctxA, { title: "Acme Transformation", client: "Acme", value: 50000 });
    assert.equal(created.ok, true);
    const id = created.result.proposal.id;
    const key = created.result.proposal.sections[0].key;
    const upd = call("proposal-update-section", ctxA, { id, sectionKey: key, content: "Overview text" });
    assert.equal(upd.ok, true);
    const list = call("proposal-list", ctxA, {});
    assert.ok(list.result.proposals[0].completeness > 0);
  });

  it("captures an e-signature and flips status to accepted", () => {
    const id = call("proposal-create", ctxA, { title: "P" }).result.proposal.id;
    const signed = call("proposal-sign", ctxA, { id, signerName: "Jane Client" });
    assert.equal(signed.ok, true);
    assert.equal(signed.result.proposal.status, "accepted");
    assert.equal(signed.result.proposal.signature.signerName, "Jane Client");
  });

  it("rejects a signature without a signer name", () => {
    const id = call("proposal-create", ctxA, { title: "P" }).result.proposal.id;
    const r = call("proposal-sign", ctxA, { id });
    assert.equal(r.ok, false);
  });

  it("deletes a proposal", () => {
    const id = call("proposal-create", ctxA, { title: "Throwaway" }).result.proposal.id;
    assert.equal(call("proposal-delete", ctxA, { id }).ok, true);
    assert.equal(call("proposal-list", ctxA, {}).result.count, 0);
  });
});

describe("consulting.engagement-update", () => {
  it("updates engagement status, rate, and budget hours", () => {
    const eng = makeEngagement();
    const r = call("engagement-update", ctxA, { id: eng.id, status: "on_hold", rate: 250, budgetHours: 120 });
    assert.equal(r.ok, true);
    assert.equal(r.result.engagement.status, "on_hold");
    assert.equal(r.result.engagement.rate, 250);
    assert.equal(r.result.engagement.budgetHours, 120);
  });
});

describe("consulting.staffing (resource planner)", () => {
  it("allocates consultants across engagements and flags overbooking", () => {
    const eng = makeEngagement();
    const con = call("consultant-create", ctxA, { name: "Sam", role: "Senior", weeklyCapacity: 40, costRate: 120 });
    assert.equal(con.ok, true);
    const a1 = call("allocation-create", ctxA, { consultantId: con.result.consultant.id, engagementId: eng.id, week: "2026-W21", hours: 50 });
    assert.equal(a1.ok, true);
    const plan = call("staffing-plan", ctxA, {});
    assert.equal(plan.ok, true);
    assert.equal(plan.result.rows[0].byWeek[0].overbooked, true);
    assert.equal(plan.result.allocations.length, 1);
    assert.equal(plan.result.allocations[0].consultantName, "Sam");
  });

  it("rejects allocation for an unknown consultant", () => {
    const eng = makeEngagement();
    const r = call("allocation-create", ctxA, { consultantId: "nope", engagementId: eng.id, week: "2026-W21", hours: 8 });
    assert.equal(r.ok, false);
  });

  it("deletes an allocation and a consultant (cascading allocations)", () => {
    const eng = makeEngagement();
    const con = call("consultant-create", ctxA, { name: "Lee" }).result.consultant;
    const alloc = call("allocation-create", ctxA, { consultantId: con.id, engagementId: eng.id, week: "2026-W22", hours: 10 }).result.allocation;
    assert.equal(call("allocation-delete", ctxA, { id: alloc.id }).ok, true);
    const con2 = call("consultant-create", ctxA, { name: "Pat" }).result.consultant;
    call("allocation-create", ctxA, { consultantId: con2.id, engagementId: eng.id, week: "2026-W23", hours: 5 });
    assert.equal(call("consultant-delete", ctxA, { id: con2.id }).ok, true);
    const plan = call("staffing-plan", ctxA, {});
    assert.equal(plan.result.allocations.length, 0);
  });
});

describe("consulting.expense-* (expense + reimbursables)", () => {
  it("creates an expense attached to an engagement", () => {
    const eng = makeEngagement();
    const r = call("expense-create", ctxA, { engagementId: eng.id, description: "Flights", amount: 450, reimbursable: true });
    assert.equal(r.ok, true);
    const list = call("expense-list", ctxA, {});
    assert.equal(list.result.total, 450);
    assert.equal(list.result.reimbursable, 450);
  });

  it("updates expense status to approved", () => {
    const eng = makeEngagement();
    const exp = call("expense-create", ctxA, { engagementId: eng.id, description: "Hotel", amount: 200 }).result.expense;
    const upd = call("expense-update", ctxA, { id: exp.id, status: "approved" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.expense.status, "approved");
  });

  it("deletes an expense", () => {
    const eng = makeEngagement();
    const exp = call("expense-create", ctxA, { engagementId: eng.id, description: "Meal", amount: 30 }).result.expense;
    assert.equal(call("expense-delete", ctxA, { id: exp.id }).ok, true);
    assert.equal(call("expense-list", ctxA, {}).result.count, 0);
  });
});

describe("consulting.timer-* (live start/stop timer)", () => {
  it("starts a timer, reports running status, and stops into a time entry", () => {
    const eng = makeEngagement();
    const start = call("timer-start", ctxA, { engagementId: eng.id, note: "Live work" });
    assert.equal(start.ok, true);
    const status = call("timer-status", ctxA, {});
    assert.equal(status.result.running, true);
    const stop = call("timer-stop", ctxA, {});
    assert.equal(stop.ok, true);
    assert.ok(stop.result.entry.hours > 0);
  });

  it("rejects starting two timers at once", () => {
    const eng = makeEngagement();
    call("timer-start", ctxA, { engagementId: eng.id });
    const r = call("timer-start", ctxA, { engagementId: eng.id });
    assert.equal(r.ok, false);
  });

  it("cancels a running timer without logging time", () => {
    const eng = makeEngagement();
    call("timer-start", ctxA, { engagementId: eng.id });
    const c = call("timer-cancel", ctxA, {});
    assert.equal(c.ok, true);
    assert.equal(call("timer-status", ctxA, {}).result.running, false);
  });
});

describe("consulting.retainer-* (recurring billing)", () => {
  it("creates a retainer and computes MRR", () => {
    const r = call("retainer-create", ctxA, { client: "Acme", monthlyAmount: 5000, cadence: "monthly", includedHours: 20 });
    assert.equal(r.ok, true);
    const list = call("retainer-list", ctxA, {});
    assert.equal(list.result.mrr, 5000);
  });

  it("bills a retainer period and computes overage hours", () => {
    const ret = call("retainer-create", ctxA, { client: "Acme", monthlyAmount: 4000, includedHours: 10 }).result.retainer;
    const billed = call("retainer-bill", ctxA, { id: ret.id, hoursUsed: 14 });
    assert.equal(billed.ok, true);
    assert.equal(billed.result.period.overageHours, 4);
  });

  it("pauses a retainer (excluded from MRR) and deletes it", () => {
    const ret = call("retainer-create", ctxA, { client: "Beta", monthlyAmount: 3000 }).result.retainer;
    const upd = call("retainer-update", ctxA, { id: ret.id, status: "paused" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.retainer.status, "paused");
    assert.equal(call("retainer-list", ctxA, {}).result.mrr, 0);
    assert.equal(call("retainer-delete", ctxA, { id: ret.id }).ok, true);
    assert.equal(call("retainer-list", ctxA, {}).result.count, 0);
  });
});

describe("consulting.profitability-report", () => {
  it("computes cost vs billed margin per engagement", () => {
    const eng = makeEngagement();
    call("time-log", ctxA, { engagementId: eng.id, hours: 10 });
    call("expense-create", ctxA, { engagementId: eng.id, description: "Travel", amount: 300 });
    const r = call("profitability-report", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.rows.length, 1);
    assert.equal(r.result.rows[0].billed, 2000);
    assert.ok(r.result.rows[0].margin < 2000);
    assert.ok(typeof r.result.overallMarginPct === "number");
  });
});

describe("consulting.portal-* (client portal)", () => {
  it("shares a deliverable and collects an external approval", () => {
    const eng = makeEngagement();
    const share = call("portal-share", ctxA, { title: "Phase 1 Report", engagementId: eng.id, client: "Acme", summary: "Findings" });
    assert.equal(share.ok, true);
    assert.equal(share.result.share.approvalStatus, "awaiting");
    const resp = call("portal-respond", ctxA, { id: share.result.share.id, decision: "approved", respondedBy: "Jane" });
    assert.equal(resp.ok, true);
    assert.equal(resp.result.share.approvalStatus, "approved");
    const list = call("portal-list", ctxA, {});
    assert.equal(list.result.approved, 1);
  });

  it("rejects an invalid portal decision", () => {
    const share = call("portal-share", ctxA, { title: "Doc", client: "Acme" }).result.share;
    const r = call("portal-respond", ctxA, { id: share.id, decision: "maybe" });
    assert.equal(r.ok, false);
  });

  it("deletes a shared deliverable", () => {
    const share = call("portal-share", ctxA, { title: "Draft", client: "Acme" }).result.share;
    assert.equal(call("portal-delete", ctxA, { id: share.id }).ok, true);
    assert.equal(call("portal-list", ctxA, {}).result.count, 0);
  });
});
