// Owner delete paths that the desks were missing: masonry proposals,
// change orders, and inspections; landscaping jobs; plumbing dispatch,
// invoices, plans, inspections, and clients; pharmacy refills closed
// when the medication is archived.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMasonry from "../domains/masonry.js";
import registerLandscaping from "../domains/landscaping.js";
import registerPlumbing from "../domains/plumbing.js";
import registerPharmacy from "../domains/pharmacy.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}) {
  const fn = actions.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
const ctx = { actor: { userId: "owner" }, userId: "owner" };
const other = { actor: { userId: "other" }, userId: "other" };

before(() => {
  registerMasonry(register);
  registerLandscaping(register);
  registerPlumbing(register);
  registerPharmacy(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("missing delete controls", () => {
  it("deletes the owner's masonry proposal, change order, and inspection, and not someone else's", () => {
    const proposal = call("masonry", "proposal-create", ctx, {
      client: "QA Client", projectTitle: "Wall", lineItems: [{ description: "Brick", quantity: 1, unit: "each", unitCost: 1 }],
    }).result;
    assert.equal(call("masonry", "proposal-delete", other, { id: proposal.id }).ok, false);
    assert.equal(call("masonry", "proposal-delete", ctx, { id: proposal.id }).ok, true);
    assert.equal(call("masonry", "proposal-list", ctx, {}).result.proposals.length, 0);

    const job = call("masonry", "schedule-add", ctx, { title: "Job", startDate: "2026-11-11" }).result;
    const co = call("masonry", "change-order-create", ctx, { jobId: job.id, description: "Extra course" }).result;
    assert.equal(call("masonry", "change-order-delete", ctx, { id: co.id }).result.deleted, co.id);
    assert.equal(call("masonry", "change-order-list", ctx, {}).result.changeOrders.length, 0);

    const insp = call("masonry", "inspection-add", ctx, {
      jobId: job.id, inspectionType: "final_walkthrough", inspector: "Ann", scheduledDate: "2026-11-12",
    }).result;
    assert.equal(call("masonry", "inspection-delete", ctx, { id: insp.id }).ok, true);
    assert.equal(call("masonry", "inspection-list", ctx, {}).result.inspections.length, 0);
  });

  it("deletes a landscaping job the owner scheduled", () => {
    const job = call("landscaping", "job-schedule", ctx, { title: "QA hedge" }).result.job;
    assert.equal(call("landscaping", "job-delete", other, { id: job.id }).ok, false);
    assert.equal(call("landscaping", "job-delete", ctx, { id: job.id }).result.deleted, job.id);
    assert.equal(call("landscaping", "job-list", ctx, {}).result.jobs.length, 0);
  });

  it("deletes a plumbing job, invoice, plan, inspection, and client", () => {
    const assignment = call("plumbing", "dispatchAssign", ctx, { jobTitle: "Leak" }).result.assignment;
    assert.equal(call("plumbing", "dispatchDelete", ctx, { assignmentId: assignment.id }).result.deleted, assignment.id);

    const invoice = call("plumbing", "invoiceFromQuote", ctx, {
      client: "QA Client",
      lines: [{ name: "Trap", quantity: 1, unitPrice: 25 }],
    }).result.invoice;
    assert.equal(call("plumbing", "invoiceDelete", ctx, { invoiceId: invoice.id }).ok, true);
    assert.equal(call("plumbing", "invoiceList", ctx, {}).result.count, 0);

    const client = call("plumbing", "clientAdd", ctx, { name: "QA Client" }).result.client;
    const plan = call("plumbing", "planCreate", ctx, { clientId: client.id, title: "Flush" }).result.plan;
    assert.equal(call("plumbing", "planDelete", ctx, { id: plan.id }).ok, true);
    assert.equal(call("plumbing", "planList", ctx, {}).result.plans.length, 0);

    const again = call("plumbing", "dispatchAssign", ctx, { jobTitle: "Second" }).result.assignment;
    const insp = call("plumbing", "inspectionAdd", ctx, {
      assignmentId: again.id, inspectionType: "rough_in", inspector: "Lee",
      jurisdiction: "City", scheduledDate: "2026-11-12",
    }).result.inspection;
    assert.equal(call("plumbing", "inspectionDelete", ctx, { id: insp.id }).ok, true);
    assert.equal(call("plumbing", "inspectionList", ctx, {}).result.inspections.length, 0);
    assert.equal(call("plumbing", "clientDelete", ctx, { clientId: client.id }).ok, true);
    assert.equal(call("plumbing", "clientList", ctx, {}).result.count, 0);
  });

  it("cancelling a refill, and archiving its medication, drops it from open requests", () => {
    const med = call("pharmacy", "med-add", ctx, { name: "Lisinopril", quantity: 30 }).result.medication;
    const refill = call("pharmacy", "refill-request", ctx, { medId: med.id }).result.refill;
    assert.equal(call("pharmacy", "pharmacy-dashboard", ctx, {}).result.openRefillRequests, 1);
    call("pharmacy", "refill-update", ctx, { id: refill.id, status: "cancelled" });
    assert.equal(call("pharmacy", "pharmacy-dashboard", ctx, {}).result.openRefillRequests, 0);

    const med2 = call("pharmacy", "med-add", ctx, { name: "Atorvastatin", quantity: 30 }).result.medication;
    call("pharmacy", "refill-request", ctx, { medId: med2.id });
    call("pharmacy", "med-archive", ctx, { id: med2.id });
    assert.equal(call("pharmacy", "pharmacy-dashboard", ctx, {}).result.openRefillRequests, 0);
  });
});
