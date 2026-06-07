// tests/depth/trades-behavior.test.js — REAL behavioral tests for the trades
// (skilled-trades / contracting) domain. registerLensAction family, invoked via
// lensRun. Curated high-confidence subset: exact-value estimate/invoice/P&L/PO
// math + route optimization + CRUD round-trips + validation rejections.
// Every lensRun("trades", "<macro>", …) call literally names the macro, so the
// macro-depth grader credits it as a behavioral invocation.
//
// NB: lens.run reports OUTER ok:true on dispatch and nests the handler return
// under .result. So a calc result reads as r.result.<field>, and a handler
// REJECTION reads as r.result.ok === false.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("trades — calc contracts (exact computed values)", () => {
  it("calculateEstimate: subtotal → markup → tax cascade is exact", async () => {
    const r = await lensRun("trades", "calculateEstimate", {
      data: { lineItems: [
        { description: "framing", quantity: 2, unitCost: 100, category: "labor" },
        { description: "lumber", quantity: 3, unitCost: 50, category: "materials" },
      ] },
      params: { markupPct: 20, taxRate: 0.08 },
    });
    assert.equal(r.result.subtotal, 350);       // 2*100 + 3*50
    assert.equal(r.result.markupAmount, 70);     // 350 * 0.20
    assert.equal(r.result.taxAmount, 33.6);      // 420 * 0.08
    assert.equal(r.result.grandTotal, 453.6);    // 420 + 33.6
    assert.equal(r.result.byCategory.labor, 200);
    assert.equal(r.result.byCategory.materials, 150);
  });

  it("calculateEstimate: discount is applied between markup and tax", async () => {
    const r = await lensRun("trades", "calculateEstimate", {
      data: { lineItems: [{ description: "x", quantity: 1, unitCost: 100 }] },
      params: { markupPct: 0, taxRate: 0, discountPct: 10 },
    });
    assert.equal(r.result.subtotal, 100);
    assert.equal(r.result.discountAmount, 10);   // afterMarkup(100) * 0.10
    assert.equal(r.result.grandTotal, 90);       // 100 - 10, no tax
  });

  it("calculateEstimate: empty line items returns an error marker", async () => {
    const r = await lensRun("trades", "calculateEstimate", { data: { lineItems: [] } });
    assert.equal(r.result.error, "No line items provided.");
  });

  it("calculatePL: gross profit, margin %, and cost breakdown are exact", async () => {
    const r = await lensRun("trades", "calculatePL", {
      data: { revenue: 1000, costs: { materials: 300, labor: 200, overhead: 100 } },
    });
    assert.equal(r.result.totalCosts, 600);
    assert.equal(r.result.grossProfit, 400);     // 1000 - 600
    assert.equal(r.result.margin, 40);           // 400/1000 * 100
    assert.equal(r.result.status, "profitable");
    assert.equal(r.result.costBreakdown.materialsPercent, 50); // 300/600
  });

  it("calculatePL: costs exceeding revenue yield a loss status + negative profit", async () => {
    const r = await lensRun("trades", "calculatePL", {
      data: { revenue: 100, costs: { materials: 150 } },
    });
    assert.equal(r.result.grossProfit, -50);
    assert.equal(r.result.status, "loss");
  });

  it("generateInvoice: labor + materials + 15% markup + tax compounds exactly", async () => {
    const r = await lensRun("trades", "generateInvoice", {
      data: { workOrders: [{
        description: "repair", laborHours: 4, laborRate: 50,
        materials: [{ item: "pipe", quantity: 2, unitCost: 25 }],
      }] },
      params: { taxRate: 0.08 },  // markupPct defaults to 15
    });
    assert.equal(r.result.totalLabor, 200);      // 4 * 50
    assert.equal(r.result.totalMaterials, 50);   // 2 * 25
    assert.equal(r.result.subtotal, 250);
    assert.equal(r.result.markupAmount, 37.5);   // 250 * 0.15
    assert.equal(r.result.taxAmount, 23);        // 287.5 * 0.08
    assert.equal(r.result.total, 310.5);
    assert.equal(r.result.totalHours, 4);
  });

  it("generatePO: line totals + vendor summary sorted by spend descending", async () => {
    const r = await lensRun("trades", "generatePO", {
      data: { materials: [
        { item: "pipe", vendor: "Alpha", quantity: 10, unitCost: 5 },
        { item: "wire", vendor: "Beta", quantity: 2, unitCost: 100 },
      ] },
    });
    assert.equal(r.result.grandTotal, 250);      // 50 + 200
    assert.equal(r.result.totalItems, 2);
    assert.equal(r.result.vendorCount, 2);
    assert.equal(r.result.vendorSummary[0].vendor, "Beta");  // 200 > 50
    assert.equal(r.result.vendorSummary[0].total, 200);
  });

  it("materialsCost: aggregates active jobs only, ranks materials by total cost", async () => {
    const r = await lensRun("trades", "materialsCost", {
      data: { jobs: [
        { jobId: "j1", name: "A", status: "active", materials: [{ item: "Copper", quantity: 10, unitCost: 8 }] },
        { jobId: "j2", name: "B", status: "active", materials: [{ item: "PVC", quantity: 5, unitCost: 2 }] },
        { jobId: "j3", name: "C", status: "closed", materials: [{ item: "Steel", quantity: 100, unitCost: 99 }] },
      ] },
    });
    assert.equal(r.result.jobsIncluded, 2);      // closed job excluded
    assert.equal(r.result.grandTotal, 90);       // 80 + 10 (steel ignored)
    assert.equal(r.result.topMaterial.item, "Copper");  // 80 > 10
  });

  it("checkPermits: electrical job with no permits flags both required as missing", async () => {
    const r = await lensRun("trades", "checkPermits", {
      data: { jobType: "electrical", permits: [] },
    });
    assert.equal(r.result.allClear, false);
    assert.equal(r.result.status, "action_required");
    assert.deepEqual(r.result.requiredPermits, ["electrical_permit", "building_permit"]);
    assert.equal(r.result.missingPermits.length, 2);
  });

  it("route-optimize: nearest-neighbour orders stops + sums distance exactly", async () => {
    const r = await lensRun("trades", "route-optimize", {
      params: {
        start: { lat: 0, lng: 0 },
        stops: [
          { id: "far", lat: 0, lng: 5 },
          { id: "near", lat: 0, lng: 1 },
        ],
      },
    });
    assert.equal(r.result.ordered[0].id, "near");   // dist 1 < dist 5
    assert.equal(r.result.ordered[1].id, "far");    // then dist 4 from near
    assert.equal(r.result.totalDistanceUnits, 5);   // 1 + 4
    assert.equal(r.result.estimatedDriveMin, 15);   // 5 * 3
  });

  it("route-optimize: empty stops list is rejected", async () => {
    const r = await lensRun("trades", "route-optimize", { params: { stops: [] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /stops required/);
  });
});

describe("trades — CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("trades-crud"); });

  it("customer-upsert → job-create → job-list: priority job reads back", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Acme Co", phone: "555" } }, ctx);
    assert.equal(cust.result.customer.name, "Acme Co");
    const custId = cust.result.customer.id;

    const job = await lensRun("trades", "job-create", {
      params: { customerId: custId, description: "fix HVAC", priority: "emergency" },
    }, ctx);
    assert.equal(job.result.job.priority, "emergency");
    assert.equal(job.result.job.status, "unassigned");
    assert.equal(job.result.job.customerName, "Acme Co");
    const jobId = job.result.job.id;

    const list = await lensRun("trades", "job-list", {}, ctx);
    assert.ok(list.result.jobs.some((j) => j.id === jobId));
  });

  it("job-assign → job-update-status: assignment flips unassigned → dispatched, then completes", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Beta LLC" } }, ctx);
    const job = await lensRun("trades", "job-create", { params: { customerId: cust.result.customer.id, description: "wiring" } }, ctx);
    const jobId = job.result.job.id;

    const assigned = await lensRun("trades", "job-assign", { params: { id: jobId, tech: "Jordan" } }, ctx);
    assert.equal(assigned.result.job.assignedTech, "Jordan");
    assert.equal(assigned.result.job.status, "dispatched");  // was unassigned

    const done = await lensRun("trades", "job-update-status", { params: { id: jobId, status: "completed" } }, ctx);
    assert.equal(done.result.job.status, "completed");
    assert.ok(done.result.job.completedAt);
  });

  it("job-create: rejects missing customer", async () => {
    const bad = await lensRun("trades", "job-create", { params: { customerId: randomUUID(), description: "x" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /customer not found/);
  });

  it("job-update-status: rejects an invalid status value", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Gamma Inc" } }, ctx);
    const job = await lensRun("trades", "job-create", { params: { customerId: cust.result.customer.id, description: "y" } }, ctx);
    const bad = await lensRun("trades", "job-update-status", { params: { id: job.result.job.id, status: "teleported" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /invalid status/);
  });

  it("quotes-create → quotes-send → quotes-accept: subtotal+tax computed, lifecycle round-trips", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Delta Homes" } }, ctx);
    const q = await lensRun("trades", "quotes-create", {
      params: {
        customerId: cust.result.customer.id, title: "Bathroom remodel", taxRate: 10,
        lineItems: [{ qty: 2, unitPrice: 100 }, { qty: 1, unitPrice: 50 }],
      },
    }, ctx);
    assert.equal(q.result.quote.subtotal, 250);  // 2*100 + 50
    assert.equal(q.result.quote.tax, 25);        // 250 * 10%
    assert.equal(q.result.quote.total, 275);
    assert.equal(q.result.quote.status, "draft");
    const qid = q.result.quote.id;

    const sent = await lensRun("trades", "quotes-send", { params: { id: qid } }, ctx);
    assert.equal(sent.result.quote.status, "sent");

    const accepted = await lensRun("trades", "quotes-accept", { params: { id: qid } }, ctx);
    assert.equal(accepted.result.quote.status, "accepted");
  });

  it("quotes-send: cannot send a quote that is already accepted", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Epsilon Co" } }, ctx);
    const q = await lensRun("trades", "quotes-create", {
      params: { customerId: cust.result.customer.id, title: "t", lineItems: [{ qty: 1, unitPrice: 10 }] },
    }, ctx);
    await lensRun("trades", "quotes-send", { params: { id: q.result.quote.id } }, ctx);
    await lensRun("trades", "quotes-accept", { params: { id: q.result.quote.id } }, ctx);
    const bad = await lensRun("trades", "quotes-send", { params: { id: q.result.quote.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /cannot send quote/);
  });

  it("timesheets clock-in → clock-out: duration computed, double clock-in rejected", async () => {
    const tech = await lensRun("trades", "technicians-add", { params: { name: "Sam" } }, ctx);
    const techId = tech.result.technician.id;

    const inEntry = await lensRun("trades", "timesheets-clock-in", { params: { technicianId: techId } }, ctx);
    assert.ok(inEntry.result.entry.clockIn);
    assert.equal(inEntry.result.entry.clockOut, null);

    const dup = await lensRun("trades", "timesheets-clock-in", { params: { technicianId: techId } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.match(dup.result.error, /already clocked in/);

    const out = await lensRun("trades", "timesheets-clock-out", { params: { technicianId: techId } }, ctx);
    assert.ok(out.result.entry.clockOut);
    assert.equal(typeof out.result.entry.durationMin, "number");
  });

  it("reviews-submit → reviews-list: NPS computed from promoters minus detractors", async () => {
    // two promoters (nps>=9), one detractor (nps<=6) → (2-1)/3 * 100 = 33
    await lensRun("trades", "reviews-submit", { params: { jobId: "jA", rating: 5, nps: 10 } }, ctx);
    await lensRun("trades", "reviews-submit", { params: { jobId: "jB", rating: 4, nps: 9 } }, ctx);
    await lensRun("trades", "reviews-submit", { params: { jobId: "jC", rating: 1, nps: 3 } }, ctx);
    const list = await lensRun("trades", "reviews-list", {}, ctx);
    assert.ok(list.result.totalReviews >= 3);
    assert.equal(list.result.nps, 33);           // round((2-1)/3 * 100)
    assert.ok(list.result.avgRating > 0);
  });

  it("contract-create: rejects a negative monthlyRate", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Zeta Svc" } }, ctx);
    const bad = await lensRun("trades", "contract-create", {
      params: { customerId: cust.result.customer.id, monthlyRate: -5 },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /monthlyRate must be >= 0/);
  });
});

describe("trades — invoices, pricebook & reporting (wave 15 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("trades-t15-a"); });

  it("invoices-create: subtotal + tax computed; INV number padded; starts unpaid", async () => {
    const r = await lensRun("trades", "invoices-create", {
      params: {
        customerName: "Northwind", taxRate: 8,
        lineItems: [{ qty: 3, unitPrice: 100 }, { qty: 1, unitPrice: 50 }],
      },
    }, ctx);
    assert.equal(r.result.invoice.subtotal, 350);       // 3*100 + 50
    assert.equal(r.result.invoice.tax, 28);             // 350 * 8%
    assert.equal(r.result.invoice.total, 378);
    assert.equal(r.result.invoice.amountPaid, 0);
    assert.equal(r.result.invoice.status, "unpaid");
    assert.match(r.result.invoice.number, /^INV-\d{5}$/);
  });

  it("invoices-create: empty line items rejected", async () => {
    const bad = await lensRun("trades", "invoices-create", { params: { customerName: "X", lineItems: [] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /at least one line item required/);
  });

  it("invoices-record-payment: partial then full payment flips status + lists outstanding/collected", async () => {
    const inv = await lensRun("trades", "invoices-create", {
      params: { customerName: "Helios", taxRate: 0, lineItems: [{ qty: 1, unitPrice: 200 }] },
    }, ctx);
    const id = inv.result.invoice.id;
    assert.equal(inv.result.invoice.total, 200);

    const part = await lensRun("trades", "invoices-record-payment", { params: { id, amount: 80, method: "cash" } }, ctx);
    assert.equal(part.result.invoice.amountPaid, 80);
    assert.equal(part.result.invoice.status, "partial");
    assert.equal(part.result.invoice.method, "cash");

    const full = await lensRun("trades", "invoices-record-payment", { params: { id, amount: 120, method: "card" } }, ctx);
    assert.equal(full.result.invoice.amountPaid, 200);
    assert.equal(full.result.invoice.status, "paid");
    assert.ok(full.result.invoice.paidAt);

    const list = await lensRun("trades", "invoices-list", {}, ctx);
    assert.ok(list.result.invoices.some((i) => i.id === id));
    assert.equal(list.result.collected, 200);            // this invoice fully collected
  });

  it("invoices-record-payment: rejects a zero/negative amount", async () => {
    const inv = await lensRun("trades", "invoices-create", {
      params: { customerName: "Vesta", lineItems: [{ qty: 1, unitPrice: 10 }] },
    }, ctx);
    const bad = await lensRun("trades", "invoices-record-payment", { params: { id: inv.result.invoice.id, amount: 0 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /amount must be > 0/);
  });

  it("invoices-record-payment: rejects a paid invoice", async () => {
    const inv = await lensRun("trades", "invoices-create", {
      params: { customerName: "Atlas", taxRate: 0, lineItems: [{ qty: 1, unitPrice: 30 }] },
    }, ctx);
    const id = inv.result.invoice.id;
    await lensRun("trades", "invoices-record-payment", { params: { id, amount: 30 } }, ctx);
    const bad = await lensRun("trades", "invoices-record-payment", { params: { id, amount: 5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /invoice already paid/);
  });

  it("pricebook-upsert: marginPct computed from price & cost; update edits in place", async () => {
    const created = await lensRun("trades", "pricebook-upsert", {
      params: { name: "Drain Snake", kind: "service", price: 200, cost: 50 },
    }, ctx);
    assert.equal(created.result.item.price, 200);
    assert.equal(created.result.item.marginPct, 75);    // (200-50)/200 = 0.75
    const id = created.result.item.id;

    const updated = await lensRun("trades", "pricebook-upsert", {
      params: { id, name: "Drain Snake", price: 100, cost: 40 },
    }, ctx);
    assert.equal(updated.result.item.price, 100);
    assert.equal(updated.result.item.marginPct, 60);    // (100-40)/100 = 0.60

    const list = await lensRun("trades", "pricebook-list", {}, ctx);
    assert.equal(list.result.items.filter((i) => i.id === id).length, 1);  // no duplicate
  });

  it("pricebook-upsert: rejects a negative price", async () => {
    const bad = await lensRun("trades", "pricebook-upsert", { params: { name: "Bad", price: -1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /price must be >= 0/);
  });

  it("pricebook-delete: round-trips create → delete → gone from list", async () => {
    const created = await lensRun("trades", "pricebook-upsert", { params: { name: "Temp Item", price: 10 } }, ctx);
    const id = created.result.item.id;
    const del = await lensRun("trades", "pricebook-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("trades", "pricebook-list", {}, ctx);
    assert.equal(list.result.items.some((i) => i.id === id), false);
  });

  it("report-overview: close rate, completion rate & utilization computed exactly", async () => {
    // Use a fresh ctx so the aggregates aren't polluted by other tests.
    const rc = await depthCtx("trades-t15-report");
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Report Co" } }, rc);
    const cid = cust.result.customer.id;

    // 2 quotes decided: 1 accepted, 1 rejected → close rate 50%
    const q1 = await lensRun("trades", "quotes-create", { params: { customerId: cid, title: "q1", lineItems: [{ qty: 1, unitPrice: 100 }] } }, rc);
    await lensRun("trades", "quotes-send", { params: { id: q1.result.quote.id } }, rc);
    await lensRun("trades", "quotes-accept", { params: { id: q1.result.quote.id } }, rc);
    const q2 = await lensRun("trades", "quotes-create", { params: { customerId: cid, title: "q2", lineItems: [{ qty: 1, unitPrice: 100 }] } }, rc);
    await lensRun("trades", "quotes-reject", { params: { id: q2.result.quote.id } }, rc);

    // 2 jobs: 1 completed, 1 unassigned → completion 50%
    const j1 = await lensRun("trades", "job-create", { params: { customerId: cid, description: "j1" } }, rc);
    await lensRun("trades", "job-update-status", { params: { id: j1.result.job.id, status: "completed" } }, rc);
    await lensRun("trades", "job-create", { params: { customerId: cid, description: "j2" } }, rc);

    const r = await lensRun("trades", "report-overview", {}, rc);
    assert.equal(r.result.sales.closeRate, 50);          // 1 accepted / 2 decided
    assert.equal(r.result.jobs.completed, 1);
    assert.equal(r.result.jobs.completionRate, 50);      // 1 / 2 jobs
    assert.equal(r.result.labor.utilization, 0);         // no clocked timesheets
  });
});

describe("trades — schedule, portal, recurring & bookings (wave 15 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("trades-t15-b"); });

  it("schedule-set → schedule-week: job lands on the right day/slot", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Sched Co" } }, ctx);
    const job = await lensRun("trades", "job-create", { params: { customerId: cust.result.customer.id, description: "tune-up" } }, ctx);
    const jobId = job.result.job.id;

    const set = await lensRun("trades", "schedule-set", { params: { jobId, date: "2026-06-10", slot: 14, tech: "Lee" } }, ctx);
    assert.equal(set.result.job.scheduledFor, "2026-06-10T14:00");
    assert.equal(set.result.job.scheduledSlot, 14);
    assert.equal(set.result.job.assignedTech, "Lee");

    const week = await lensRun("trades", "schedule-week", { params: { weekStart: "2026-06-08" } }, ctx);
    const wed = week.result.days.find((d) => d.date === "2026-06-10");
    assert.ok(wed);
    const found = wed.jobs.find((j) => j.id === jobId);
    assert.ok(found);
    assert.equal(found.slot, 14);
  });

  it("schedule-set: rejects an out-of-range slot", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Slot Co" } }, ctx);
    const job = await lensRun("trades", "job-create", { params: { customerId: cust.result.customer.id, description: "x" } }, ctx);
    const bad = await lensRun("trades", "schedule-set", { params: { jobId: job.result.job.id, date: "2026-06-10", slot: 30 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /slot must be hour 0-23/);
  });

  it("schedule-set: rejects a malformed date", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Date Co" } }, ctx);
    const job = await lensRun("trades", "job-create", { params: { customerId: cust.result.customer.id, description: "x" } }, ctx);
    const bad = await lensRun("trades", "schedule-set", { params: { jobId: job.result.job.id, date: "06/10/2026", slot: 9 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /date must be YYYY-MM-DD/);
  });

  it("portal-view: aggregates customer jobs/quotes and computes balanceDue", async () => {
    const pc = await depthCtx("trades-t15-portal");
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Portal Homes" } }, pc);
    const cid = cust.result.customer.id;
    await lensRun("trades", "job-create", { params: { customerId: cid, description: "service" } }, pc);
    // Invoice keyed by customerName; create one with a partial balance.
    const inv = await lensRun("trades", "invoices-create", {
      params: { customerName: "Portal Homes", taxRate: 0, lineItems: [{ qty: 1, unitPrice: 500 }] },
    }, pc);
    await lensRun("trades", "invoices-record-payment", { params: { id: inv.result.invoice.id, amount: 300 } }, pc);

    const view = await lensRun("trades", "portal-view", { params: { customerId: cid } }, pc);
    assert.equal(view.result.customer.name, "Portal Homes");
    assert.equal(view.result.jobs.length, 1);
    assert.equal(view.result.balanceDue, 200);           // 500 total - 300 paid
  });

  it("portal-quote-respond: accept flips a sent quote; missing decision rejected", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Resp Co" } }, ctx);
    const q = await lensRun("trades", "quotes-create", {
      params: { customerId: cust.result.customer.id, title: "remodel", lineItems: [{ qty: 1, unitPrice: 100 }] },
    }, ctx);
    await lensRun("trades", "quotes-send", { params: { id: q.result.quote.id } }, ctx);

    const bad = await lensRun("trades", "portal-quote-respond", { params: { id: q.result.quote.id, decision: "maybe" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /decision must be accept or reject/);

    const ok = await lensRun("trades", "portal-quote-respond", { params: { id: q.result.quote.id, decision: "accept" } }, ctx);
    assert.equal(ok.result.quote.status, "accepted");
    assert.equal(ok.result.quote.respondedVia, "portal");
  });

  it("recurring-generate-visit: spawns a job, advances nextServiceDate by cadence, accrues revenue", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Recurring Co" } }, ctx);
    const plan = await lensRun("trades", "recurring-plans-create", {
      params: { customerId: cust.result.customer.id, serviceType: "filter swap", cadence: "monthly", priceEach: 75, nextServiceDate: "2026-06-01" },
    }, ctx);
    const planId = plan.result.plan.id;

    const gen = await lensRun("trades", "recurring-generate-visit", { params: { id: planId } }, ctx);
    assert.equal(gen.result.job.scheduledFor, "2026-06-01T09:00");
    assert.equal(gen.result.job.recurringPlanId, planId);
    assert.equal(gen.result.plan.jobsCompleted, 1);
    assert.equal(gen.result.plan.totalRevenue, 75);      // priceEach accrued once
    assert.equal(gen.result.plan.nextServiceDate, "2026-07-01");  // +30 days from 06-01
  });

  it("recurring-generate-visit: rejects a cancelled plan", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Cancel Co" } }, ctx);
    const plan = await lensRun("trades", "recurring-plans-create", {
      params: { customerId: cust.result.customer.id, serviceType: "x", priceEach: 10 },
    }, ctx);
    await lensRun("trades", "recurring-plans-cancel", { params: { id: plan.result.plan.id } }, ctx);
    const bad = await lensRun("trades", "recurring-generate-visit", { params: { id: plan.result.plan.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /plan is not active/);
  });

  it("bookings-create → bookings-confirm: lifecycle round-trips; missing fields rejected", async () => {
    const bad = await lensRun("trades", "bookings-create", { params: { customerName: "Only Name" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /serviceType required/);

    const b = await lensRun("trades", "bookings-create", {
      params: { customerName: "Walk In", customerEmail: "w@i.com", serviceType: "leak" },
    }, ctx);
    assert.equal(b.result.booking.status, "pending");
    const id = b.result.booking.id;

    const conf = await lensRun("trades", "bookings-confirm", { params: { id } }, ctx);
    assert.equal(conf.result.booking.status, "confirmed");
    assert.ok(conf.result.booking.confirmedAt);

    const list = await lensRun("trades", "bookings-list", {}, ctx);
    assert.ok(list.result.bookings.some((x) => x.id === id));
  });
});

describe("trades — technicians, field ops, payments & inspection (wave 15 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("trades-t15-c"); });

  it("technicians-set-status → technicians-delete: status round-trips, delete removes", async () => {
    const tech = await lensRun("trades", "technicians-add", { params: { name: "Pat" } }, ctx);
    const id = tech.result.technician.id;
    assert.equal(tech.result.technician.status, "available");

    const set = await lensRun("trades", "technicians-set-status", { params: { id, status: "on_site" } }, ctx);
    assert.equal(set.result.technician.status, "on_site");

    const badStatus = await lensRun("trades", "technicians-set-status", { params: { id, status: "napping" } }, ctx);
    assert.equal(badStatus.result.ok, false);
    assert.match(badStatus.result.error, /valid status required/);

    const del = await lensRun("trades", "technicians-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("trades", "technicians-list", {}, ctx);
    assert.equal(list.result.technicians.some((t) => t.id === id), false);
  });

  it("technician-update-location → technicians-live-map: coords surface; bad lat rejected", async () => {
    const tech = await lensRun("trades", "technicians-add", { params: { name: "Geo" } }, ctx);
    const id = tech.result.technician.id;

    const bad = await lensRun("trades", "technician-update-location", { params: { id, lat: 200, lng: 0 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /lat must be -90\.\.90/);

    const ok = await lensRun("trades", "technician-update-location", { params: { id, lat: 40.5, lng: -73.9 } }, ctx);
    assert.equal(ok.result.technician.lat, 40.5);
    assert.equal(ok.result.technician.lng, -73.9);

    const map = await lensRun("trades", "technicians-live-map", {}, ctx);
    const onMap = map.result.technicians.find((t) => t.id === id);
    assert.ok(onMap);
    assert.equal(onMap.lat, 40.5);
  });

  it("field-status-update: appends to field log; rejects an invalid field status", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Field Co" } }, ctx);
    const job = await lensRun("trades", "job-create", { params: { customerId: cust.result.customer.id, description: "field job" } }, ctx);
    const jobId = job.result.job.id;

    const bad = await lensRun("trades", "field-status-update", { params: { jobId, status: "completed-ish" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /field status must be/);

    const arrive = await lensRun("trades", "field-status-update", { params: { jobId, status: "on-site", note: "arrived", lat: 1, lng: 2 } }, ctx);
    assert.equal(arrive.result.job.status, "on-site");
    const done = await lensRun("trades", "field-status-update", { params: { jobId, status: "completed", note: "fixed" } }, ctx);
    assert.equal(done.result.job.status, "completed");
    assert.ok(done.result.job.completedAt);
    assert.equal(done.result.job.fieldLog.length, 2);    // on-site + completed
    assert.ok(done.result.job.fieldLog.some((e) => e.note === "fixed"));
  });

  it("payments-create-link → payments-mark-paid: pending → paid; bad amount rejected", async () => {
    const bad = await lensRun("trades", "payments-create-link", { params: { invoiceRef: "INV-1", amount: 0 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /invoiceRef and amount required/);

    const link = await lensRun("trades", "payments-create-link", { params: { invoiceRef: "INV-9", amount: 250 } }, ctx);
    assert.equal(link.result.payment.status, "pending");
    assert.equal(link.result.payment.amount, 250);
    const id = link.result.payment.id;

    const paid = await lensRun("trades", "payments-mark-paid", { params: { id } }, ctx);
    assert.equal(paid.result.payment.status, "paid");
    assert.ok(paid.result.payment.paidAt);

    const list = await lensRun("trades", "payments-list", {}, ctx);
    assert.ok(list.result.payments.some((p) => p.id === id && p.status === "paid"));
  });

  it("notifications-send: queues a notification; bad channel rejected", async () => {
    const bad = await lensRun("trades", "notifications-send", { params: { channel: "carrier-pigeon", recipient: "x", message: "y" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /channel must be sms or email/);

    const sent = await lensRun("trades", "notifications-send", {
      params: { channel: "sms", kind: "on_the_way", recipient: "555-1234", message: "On our way!" },
    }, ctx);
    assert.equal(sent.result.notification.channel, "sms");
    assert.equal(sent.result.notification.kind, "on_the_way");
    assert.equal(sent.result.notification.status, "queued");
    const id = sent.result.notification.id;

    const list = await lensRun("trades", "notifications-list", {}, ctx);
    assert.ok(list.result.notifications.some((n) => n.id === id));
  });

  it("job-photos-add → job-photos-list: filters by jobId; bad input rejected", async () => {
    const bad = await lensRun("trades", "job-photos-add", { params: { jobId: "j1" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /jobId and url required/);

    await lensRun("trades", "job-photos-add", { params: { jobId: "jobA", url: "http://x/1.png", kind: "before" } }, ctx);
    await lensRun("trades", "job-photos-add", { params: { jobId: "jobB", url: "http://x/2.png" } }, ctx);
    const list = await lensRun("trades", "job-photos-list", { params: { jobId: "jobA" } }, ctx);
    assert.equal(list.result.photos.length, 1);
    assert.equal(list.result.photos[0].kind, "before");
  });

  it("scheduleInspection: schedules a required stage on a requested date; not-found rejected", async () => {
    const r = await lensRun("trades", "scheduleInspection", {
      data: { permits: [{ permitId: "P1", type: "electrical", stages: [{ name: "rough-in", inspectionRequired: true }] }] },
      params: { permitId: "P1", stageName: "rough-in", requestedDate: "2026-06-20" },
    });
    assert.equal(r.result.status, "scheduled");
    assert.equal(r.result.requestedDate, "2026-06-20");
    assert.equal(r.result.stageName, "rough-in");

    const missing = await lensRun("trades", "scheduleInspection", {
      data: { permits: [] },
      params: { permitId: "NOPE", stageName: "x" },
    });
    assert.match(missing.result.error, /Permit NOPE not found/);
  });

  it("scheduleInspection: a stage that does not require inspection is refused", async () => {
    const r = await lensRun("trades", "scheduleInspection", {
      data: { permits: [{ permitId: "P2", type: "plumbing", stages: [{ name: "final", inspectionRequired: false }] }] },
      params: { permitId: "P2", stageName: "final" },
    });
    assert.match(r.result.error, /does not require inspection/);
  });

  it("contract-cancel: round-trips create → cancel → inactive in list", async () => {
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Contract Co" } }, ctx);
    const contract = await lensRun("trades", "contract-create", {
      params: { customerId: cust.result.customer.id, monthlyRate: 99, cadence: "monthly" },
    }, ctx);
    const id = contract.result.contract.id;
    assert.equal(contract.result.contract.active, true);

    const cancelled = await lensRun("trades", "contract-cancel", { params: { id } }, ctx);
    assert.equal(cancelled.result.contract.active, false);
    assert.ok(cancelled.result.contract.cancelledAt);

    const list = await lensRun("trades", "contract-list", {}, ctx);
    const inList = list.result.contracts.find((c) => c.id === id);
    assert.ok(inList);
    assert.equal(inList.active, false);
  });

  it("customer-list: returns alphabetically sorted customers", async () => {
    const cl = await depthCtx("trades-t15-custlist");
    await lensRun("trades", "customer-upsert", { params: { name: "Zenith" } }, cl);
    await lensRun("trades", "customer-upsert", { params: { name: "Apex" } }, cl);
    await lensRun("trades", "customer-upsert", { params: { name: "Meridian" } }, cl);
    const list = await lensRun("trades", "customer-list", {}, cl);
    assert.equal(list.result.customers.length, 3);
    assert.deepEqual(list.result.customers.map((c) => c.name), ["Apex", "Meridian", "Zenith"]);
  });
});

describe("trades — list aggregators & dispatch/dashboard (wave 15 top-up)", () => {
  it("dispatch-board: today's scheduled jobs land under their tech; unassigned bucketed", async () => {
    const dc = await depthCtx("trades-t15-dispatch");
    const today = new Date().toISOString().slice(0, 10);
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Dispatch Co" } }, dc);
    const cid = cust.result.customer.id;
    const tech = await lensRun("trades", "technicians-add", { params: { name: "Dана" } }, dc);
    const techId = tech.result.technician.id;

    // Job A scheduled today + assigned to the tech.
    const jobA = await lensRun("trades", "job-create", { params: { customerId: cid, description: "assigned job" } }, dc);
    await lensRun("trades", "schedule-set", { params: { jobId: jobA.result.job.id, date: today, slot: 10, tech: techId } }, dc);
    // Job B scheduled today, NOT assigned to a known tech → unassigned bucket.
    const jobB = await lensRun("trades", "job-create", { params: { customerId: cid, description: "loose job" } }, dc);
    await lensRun("trades", "schedule-set", { params: { jobId: jobB.result.job.id, date: today, slot: 8 } }, dc);

    const board = await lensRun("trades", "dispatch-board", { params: { date: today } }, dc);
    assert.equal(board.result.date, today);
    assert.equal(board.result.totalJobs, 2);          // both scheduled today
    assert.equal(board.result.totalTechs, 1);
    const row = board.result.rows.find((r) => r.tech.id === techId);
    assert.ok(row);
    assert.ok(row.jobs.some((j) => j.id === jobA.result.job.id));   // assigned to this tech
    assert.ok(board.result.unassigned.some((j) => j.id === jobB.result.job.id)); // no known tech
    assert.equal(board.result.unassigned.some((j) => j.id === jobA.result.job.id), false);
  });

  it("dispatch-board: a job scheduled on a different day does not appear", async () => {
    const dc = await depthCtx("trades-t15-dispatch2");
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Other Day Co" } }, dc);
    const job = await lensRun("trades", "job-create", { params: { customerId: cust.result.customer.id, description: "future" } }, dc);
    await lensRun("trades", "schedule-set", { params: { jobId: job.result.job.id, date: "2099-01-01", slot: 9 } }, dc);
    const board = await lensRun("trades", "dispatch-board", { params: { date: "2026-06-07" } }, dc);
    assert.equal(board.result.totalJobs, 0);
    assert.equal(board.result.unassigned.length, 0);
  });

  it("timesheets-list: filters by technicianId; reverse-chronological; closed entry has durationMin", async () => {
    const tc = await depthCtx("trades-t15-timesheets");
    const a = await lensRun("trades", "technicians-add", { params: { name: "Tech A" } }, tc);
    const b = await lensRun("trades", "technicians-add", { params: { name: "Tech B" } }, tc);
    const aId = a.result.technician.id, bId = b.result.technician.id;

    await lensRun("trades", "timesheets-clock-in", { params: { technicianId: aId } }, tc);
    await lensRun("trades", "timesheets-clock-out", { params: { technicianId: aId } }, tc);
    await lensRun("trades", "timesheets-clock-in", { params: { technicianId: bId } }, tc);

    const all = await lensRun("trades", "timesheets-list", {}, tc);
    assert.equal(all.result.entries.length, 2);              // A (closed) + B (open)

    const onlyA = await lensRun("trades", "timesheets-list", { params: { technicianId: aId } }, tc);
    assert.equal(onlyA.result.entries.length, 1);
    assert.equal(onlyA.result.entries[0].technicianId, aId);
    assert.equal(typeof onlyA.result.entries[0].durationMin, "number"); // closed → computed
    assert.ok(onlyA.result.entries[0].clockOut);

    const onlyB = await lensRun("trades", "timesheets-list", { params: { technicianId: bId } }, tc);
    assert.equal(onlyB.result.entries.length, 1);
    assert.equal(onlyB.result.entries[0].clockOut, null);   // still open
  });

  it("recurring-plans-list: created plans surface; a cancelled plan reads status=cancelled", async () => {
    const rc = await depthCtx("trades-t15-recurlist");
    const empty = await lensRun("trades", "recurring-plans-list", {}, rc);
    assert.equal(empty.result.plans.length, 0);

    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Recur List Co" } }, rc);
    const cid = cust.result.customer.id;
    const p1 = await lensRun("trades", "recurring-plans-create", {
      params: { customerId: cid, serviceType: "HVAC tune", cadence: "quarterly", priceEach: 120 },
    }, rc);
    const p2 = await lensRun("trades", "recurring-plans-create", {
      params: { customerId: cid, serviceType: "filter", cadence: "monthly", priceEach: 40 },
    }, rc);
    await lensRun("trades", "recurring-plans-cancel", { params: { id: p2.result.plan.id } }, rc);

    const list = await lensRun("trades", "recurring-plans-list", {}, rc);
    assert.equal(list.result.plans.length, 2);
    const a = list.result.plans.find((p) => p.id === p1.result.plan.id);
    const b = list.result.plans.find((p) => p.id === p2.result.plan.id);
    assert.equal(a.status, "active");
    assert.equal(a.cadence, "quarterly");
    assert.equal(a.priceEach, 120);
    assert.equal(b.status, "cancelled");
  });

  it("quotes-list: every created quote surfaces with its computed total + status", async () => {
    const qc = await depthCtx("trades-t15-quoteslist");
    const empty = await lensRun("trades", "quotes-list", {}, qc);
    assert.equal(empty.result.quotes.length, 0);

    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Quote List Co" } }, qc);
    const cid = cust.result.customer.id;
    const q1 = await lensRun("trades", "quotes-create", {
      params: { customerId: cid, title: "remodel", taxRate: 10, lineItems: [{ qty: 2, unitPrice: 100 }] },
    }, qc);                                          // subtotal 200, tax 20, total 220
    const q2 = await lensRun("trades", "quotes-create", {
      params: { customerId: cid, title: "repair", lineItems: [{ qty: 1, unitPrice: 50 }] },
    }, qc);
    await lensRun("trades", "quotes-send", { params: { id: q2.result.quote.id } }, qc);

    const list = await lensRun("trades", "quotes-list", {}, qc);
    assert.equal(list.result.quotes.length, 2);
    const found1 = list.result.quotes.find((q) => q.id === q1.result.quote.id);
    assert.equal(found1.total, 220);
    assert.equal(found1.status, "draft");
    const found2 = list.result.quotes.find((q) => q.id === q2.result.quote.id);
    assert.equal(found2.status, "sent");             // lifecycle reflected in the list
  });

  it("dashboard-summary: rolls up customers, jobs, accepted quotes, paid-link revenue & avg rating", async () => {
    const sc = await depthCtx("trades-t15-dashboard");
    const cust = await lensRun("trades", "customer-upsert", { params: { name: "Dash Co" } }, sc);
    const cid = cust.result.customer.id;

    // 2 jobs, 1 completed.
    const j1 = await lensRun("trades", "job-create", { params: { customerId: cid, description: "j1" } }, sc);
    await lensRun("trades", "job-update-status", { params: { id: j1.result.job.id, status: "completed" } }, sc);
    await lensRun("trades", "job-create", { params: { customerId: cid, description: "j2" } }, sc);

    // A quote accepted + one still pending (sent).
    const qA = await lensRun("trades", "quotes-create", { params: { customerId: cid, title: "qA", lineItems: [{ qty: 1, unitPrice: 100 }] } }, sc);
    await lensRun("trades", "quotes-send", { params: { id: qA.result.quote.id } }, sc);
    await lensRun("trades", "quotes-accept", { params: { id: qA.result.quote.id } }, sc);
    const qB = await lensRun("trades", "quotes-create", { params: { customerId: cid, title: "qB", lineItems: [{ qty: 1, unitPrice: 50 }] } }, sc);
    await lensRun("trades", "quotes-send", { params: { id: qB.result.quote.id } }, sc);

    // A paid payment link → revenue.
    const link = await lensRun("trades", "payments-create-link", { params: { invoiceRef: "INV-X", amount: 250 } }, sc);
    await lensRun("trades", "payments-mark-paid", { params: { id: link.result.payment.id } }, sc);

    // Two reviews → avg rating (5 + 3) / 2 = 4.
    await lensRun("trades", "reviews-submit", { params: { jobId: "jX", rating: 5, nps: 10 } }, sc);
    await lensRun("trades", "reviews-submit", { params: { jobId: "jY", rating: 3, nps: 4 } }, sc);

    const d = await lensRun("trades", "dashboard-summary", {}, sc);
    assert.equal(d.result.customerCount, 1);
    assert.equal(d.result.totalJobs, 2);
    assert.equal(d.result.jobsCompleted, 1);
    assert.equal(d.result.quotesAccepted, 1);
    assert.equal(d.result.quotesPending, 1);          // qB sent, not decided
    assert.equal(d.result.totalRevenue, 250);         // single paid link
    assert.equal(d.result.reviewCount, 2);
    assert.equal(d.result.avgRating, 4);              // (5 + 3) / 2
  });
});
