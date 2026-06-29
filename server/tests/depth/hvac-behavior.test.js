// tests/depth/hvac-behavior.test.js
// REAL behavioral tests for the hvac lens-action domain (32 actions).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("hvac — calc actions (exact values)", () => {
  it("loadCalculation: BTU/tonnage scale with conditioned area", async () => {
    const r = await lensRun("hvac", "loadCalculation", { data: { squareFootage: 2000, stories: 2, insulation: "average" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.requiredBTU, 55000);
    assert.equal(r.result.tonnage, 4.6);                      // 55000 / 12000
    const small = await lensRun("hvac", "loadCalculation", { data: { squareFootage: 1000, stories: 1, insulation: "average" } });
    assert.ok(small.result.requiredBTU < r.result.requiredBTU, "less area ⇒ smaller load");
  });

  it("energyAudit: annual cost = monthly × 12, with savings estimate", async () => {
    const r = await lensRun("hvac", "energyAudit", { data: { squareFootage: 2000, monthlyBill: 300, systemAge: 15 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.annualCost, 3600);                  // 300 × 12
    assert.equal(r.result.costPerSqFt, 1.8);                  // 3600 / 2000
    assert.ok(r.result.potentialAnnualSavings > 0, "an aging system shows savings potential");
  });

  it("zoneBalance: returns per-zone deviation analysis", async () => {
    const r = await lensRun("hvac", "zoneBalance", { params: { zones: [{ name: "up" }, { name: "down" }] }, data: { zones: [{ name: "up" }, { name: "down" }] } });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.zones) && r.result.zones.length >= 2);
    assert.equal(typeof r.result.maxDeviation, "number");
  });
});

describe("hvac — CRUD lifecycle", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("hvac-crud"); });

  it("tech-add → tech-list: an added technician is listed", async () => {
    const added = await lensRun("hvac", "tech-add", { params: { name: "Jo", skills: ["ac"] } }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.technician.name, "Jo");
    const id = added.result.technician.id;
    const list = await lensRun("hvac", "tech-list", { params: {} }, ctx);
    assert.ok((list.result.technicians || []).some((t) => t.id === id), "technician listed");
  });

  it("tech roster is user-scoped", async () => {
    await lensRun("hvac", "tech-add", { params: { name: "Max" } }, ctx);
    const other = await depthCtx("hvac-other");
    const list = await lensRun("hvac", "tech-list", { params: {} }, other);
    assert.ok(!(list.result.technicians || []).some((t) => t.name === "Max"), "rosters isolated per user");
  });

  it("dispatch-board: returns lanes + a stats block", async () => {
    const r = await lensRun("hvac", "dispatch-board", { params: {} }, ctx);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.lanes) && Array.isArray(r.result.unassigned));
    assert.equal(typeof r.result.stats.technicians, "number");
  });
});

describe("hvac — maintenanceSchedule (wave 11 top-up)", () => {
  it("diy/pro task counts partition the 8-task list; old lastService is overdue", async () => {
    const r = await lensRun("hvac", "maintenanceSchedule", { data: { systemType: "Heat-Pump", lastServiceDate: "2000-01-01" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.systemType, "heat-pump");
    // 8 tasks: 4 diy (filter, condenser, thermostat, drain line) + 4 pro
    assert.equal(r.result.tasks.length, 8);
    assert.equal(r.result.diyTasks, 4);
    assert.equal(r.result.proTasks, 4);
    assert.equal(r.result.diyTasks + r.result.proTasks, r.result.tasks.length);
    // serviced in 2000 → way past a year
    assert.equal(r.result.overdue, true);
    assert.equal(r.result.nextServiceDue, "Schedule service soon");
    assert.ok(r.result.daysSinceService > 365);
  });

  it("no lastServiceDate → daysSinceService sentinel 999, overdue", async () => {
    const r = await lensRun("hvac", "maintenanceSchedule", { data: {} });
    assert.equal(r.result.daysSinceService, 999);
    assert.equal(r.result.lastService, "unknown");
    assert.equal(r.result.overdue, true);
  });
});

describe("hvac — appointment lifecycle (wave 11 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("hvac-t11-appt"); });

  it("create → assign (to a real tech) → status → board reflects it → delete", async () => {
    const tech = await lensRun("hvac", "tech-add", { params: { name: "Rivera", skills: ["heatpump"] } }, ctx);
    const techId = tech.result.technician.id;

    const created = await lensRun("hvac", "appointment-create", { params: { title: "AC tune-up", date: "2026-07-01", durationHrs: 3, priority: "high" } }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.appointment.status, "scheduled");
    assert.equal(created.result.appointment.durationHrs, 3);
    assert.equal(created.result.appointment.priority, "high");
    const apptId = created.result.appointment.id;

    const assigned = await lensRun("hvac", "appointment-assign", { params: { id: apptId, technicianId: techId } }, ctx);
    assert.equal(assigned.ok, true);
    assert.equal(assigned.result.appointment.technicianId, techId);

    const statused = await lensRun("hvac", "appointment-status", { params: { id: apptId, status: "dispatched" } }, ctx);
    assert.equal(statused.result.appointment.status, "dispatched");

    const board = await lensRun("hvac", "dispatch-board", { params: { date: "2026-07-01" } }, ctx);
    const lane = board.result.lanes.find((l) => l.technician.id === techId);
    assert.ok(lane && lane.appointments.some((a) => a.id === apptId), "assigned appt rides the tech lane");
    assert.equal(board.result.stats.assigned, 1);
    assert.equal(board.result.stats.scheduledHours, 3);

    const del = await lensRun("hvac", "appointment-delete", { params: { id: apptId } }, ctx);
    assert.equal(del.result.deleted, apptId);
  });

  it("assign rejects an unknown technician", async () => {
    const created = await lensRun("hvac", "appointment-create", { params: { title: "Furnace check" } }, ctx);
    const r = await lensRun("hvac", "appointment-assign", { params: { id: created.result.appointment.id, technicianId: "tech_does_not_exist" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /technician not found/);
  });

  it("status rejects an invalid status value", async () => {
    const created = await lensRun("hvac", "appointment-create", { params: { title: "Coil clean" } }, ctx);
    const r = await lensRun("hvac", "appointment-status", { params: { id: created.result.appointment.id, status: "teleported" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /invalid status/);
  });

  it("appointment-create rejects a missing title", async () => {
    const r = await lensRun("hvac", "appointment-create", { params: {} }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /title required/);
  });

  it("tech-delete removes the technician from the roster", async () => {
    const added = await lensRun("hvac", "tech-add", { params: { name: "Temp" } }, ctx);
    const id = added.result.technician.id;
    const del = await lensRun("hvac", "tech-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("hvac", "tech-list", { params: {} }, ctx);
    assert.ok(!(list.result.technicians || []).some((t) => t.id === id), "deleted tech gone from list");
  });
});

describe("hvac — booking → confirmation (wave 11 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("hvac-t11-book"); });

  it("request → list shows pending → confirm promotes into a real appointment", async () => {
    const req = await lensRun("hvac", "booking-request", { params: { customer: "Acme Co", phone: "555-0100", serviceType: "repair", preferredDate: "2026-08-02" } }, ctx);
    assert.equal(req.ok, true);
    assert.equal(req.result.booking.status, "requested");
    assert.match(req.result.booking.confirmation, /^HVAC-/);
    const bookingId = req.result.booking.id;

    const list = await lensRun("hvac", "booking-list", { params: {} }, ctx);
    assert.equal(list.result.pending, 1);
    assert.ok(list.result.bookings.some((b) => b.id === bookingId));

    const conf = await lensRun("hvac", "booking-confirm", { params: { id: bookingId } }, ctx);
    assert.equal(conf.ok, true);
    assert.equal(conf.result.booking.status, "confirmed");
    assert.equal(conf.result.booking.appointmentId, conf.result.appointment.id);
    // confirm carried the booking's preferred date onto the appointment
    assert.equal(conf.result.appointment.date, "2026-08-02");

    // the promoted appointment shows up on the dispatch board
    const board = await lensRun("hvac", "dispatch-board", { params: {} }, ctx);
    assert.ok(board.result.unassigned.some((a) => a.id === conf.result.appointment.id), "promoted appt is unassigned");

    const after = await lensRun("hvac", "booking-list", { params: {} }, ctx);
    assert.equal(after.result.pending, 0, "confirmed booking no longer pending");
  });

  it("booking-request rejects when neither phone nor email is given", async () => {
    const r = await lensRun("hvac", "booking-request", { params: { customer: "No Contact" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /phone or email required/);
  });

  it("booking-confirm decline marks the booking declined without an appointment", async () => {
    const req = await lensRun("hvac", "booking-request", { params: { customer: "Decliner", email: "d@x.io" } }, ctx);
    const r = await lensRun("hvac", "booking-confirm", { params: { id: req.result.booking.id, decline: true } }, ctx);
    assert.equal(r.result.booking.status, "declined");
    assert.equal(r.result.appointment, undefined);
  });
});

describe("hvac — asset service history (wave 11 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("hvac-t11-asset"); });

  it("add → list computes ageYears from installYear → log-service prepends history → delete", async () => {
    const nowYear = new Date().getFullYear();
    const add = await lensRun("hvac", "asset-add", { params: { address: "12 Oak St", installYear: nowYear - 8, equipmentType: "central-ac", warrantyExpires: "2099-01-01" } }, ctx);
    assert.equal(add.ok, true);
    const assetId = add.result.asset.id;

    const list = await lensRun("hvac", "asset-list", { params: { address: "oak" } }, ctx);
    const found = list.result.assets.find((x) => x.id === assetId);
    assert.ok(found, "address filter matches");
    assert.equal(found.ageYears, 8);
    assert.equal(found.warrantyActive, true);
    assert.equal(found.serviceCount, 0);

    const svc1 = await lensRun("hvac", "asset-log-service", { params: { assetId, serviceType: "tune-up", cost: 120 } }, ctx);
    assert.equal(svc1.result.asset.history.length, 1);
    const svc2 = await lensRun("hvac", "asset-log-service", { params: { assetId, serviceType: "repair", cost: 300 } }, ctx);
    assert.equal(svc2.result.asset.history.length, 2);
    // unshift → newest first
    assert.equal(svc2.result.asset.history[0].serviceType, "repair");

    const list2 = await lensRun("hvac", "asset-list", { params: {} }, ctx);
    assert.equal(list2.result.assets.find((x) => x.id === assetId).serviceCount, 2);

    const del = await lensRun("hvac", "asset-delete", { params: { id: assetId } }, ctx);
    assert.equal(del.result.deleted, assetId);
  });

  it("asset-add rejects a missing service address", async () => {
    const r = await lensRun("hvac", "asset-add", { params: { client: "Nameless" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /service address required/);
  });

  it("asset-log-service rejects an unknown asset", async () => {
    const r = await lensRun("hvac", "asset-log-service", { params: { assetId: "asset_nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /asset not found/);
  });
});

describe("hvac — payment processing (wave 11 top-up — exact fee math)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("hvac-t11-pay"); });

  it("card charge: fee = 2.9% + $0.30, net = amount − fee", async () => {
    const r = await lensRun("hvac", "payment-charge", { params: { invoiceId: "INV-1", amount: 100, method: "card" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.payment.processingFee, 3.20);   // 2.90 + 0.30
    assert.equal(r.result.payment.net, 96.80);
    assert.equal(r.result.payment.status, "paid");
    assert.match(r.result.payment.reference, /^TXN-/);
  });

  it("ach charge: fee = 0.8%, no flat fee", async () => {
    const r = await lensRun("hvac", "payment-charge", { params: { invoiceId: "INV-2", amount: 100, method: "ach" } }, ctx);
    assert.equal(r.result.payment.processingFee, 0.80);
    assert.equal(r.result.payment.net, 99.20);
  });

  it("cash charge: zero fee", async () => {
    const r = await lensRun("hvac", "payment-charge", { params: { invoiceId: "INV-3", amount: 50, method: "cash" } }, ctx);
    assert.equal(r.result.payment.processingFee, 0);
    assert.equal(r.result.payment.net, 50);
  });

  it("payment-list summary sums collected & fees across the three charges, then refund flips status", async () => {
    const list = await lensRun("hvac", "payment-list", { params: {} }, ctx);
    // 100 + 100 + 50 collected
    assert.equal(list.result.summary.count, 3);
    assert.equal(list.result.summary.collected, 250);
    assert.equal(list.result.summary.fees, 4.00);          // 3.20 + 0.80 + 0
    assert.equal(list.result.summary.net, 246.00);

    const target = list.result.payments.find((p) => p.invoiceId === "INV-1");
    const ref = await lensRun("hvac", "payment-refund", { params: { id: target.id } }, ctx);
    assert.equal(ref.result.payment.status, "refunded");
    // double-refund rejected
    const ref2 = await lensRun("hvac", "payment-refund", { params: { id: target.id } }, ctx);
    assert.equal(ref2.result.ok, false);
    assert.match(ref2.result.error, /already refunded/);
  });

  it("payment-charge rejects a non-positive amount", async () => {
    const r = await lensRun("hvac", "payment-charge", { params: { invoiceId: "INV-X", amount: 0 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /must be positive/);
  });
});

describe("hvac — estimate e-sign (wave 11 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("hvac-t11-sign"); });

  it("request-signature → sign: round-trip flips status to signed", async () => {
    const req = await lensRun("hvac", "estimate-request-signature", { params: { estimateId: "EST-9", amount: 1250, client: "Vega" } }, ctx);
    assert.equal(req.ok, true);
    assert.equal(req.result.signatureRequest.status, "sent");
    assert.equal(req.result.signatureRequest.amount, 1250);
    assert.match(req.result.signatureRequest.token, /^SIGN-/);
    const id = req.result.signatureRequest.id;

    const signed = await lensRun("hvac", "estimate-sign", { params: { id, signedName: "Maria Vega" } }, ctx);
    assert.equal(signed.result.signatureRequest.status, "signed");
    assert.equal(signed.result.signatureRequest.signedName, "Maria Vega");
    assert.ok(signed.result.signatureRequest.signedAt);

    // re-sign rejected
    const again = await lensRun("hvac", "estimate-sign", { params: { id, signedName: "Maria Vega" } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /already signed/);
  });

  it("request-signature rejects a non-positive amount", async () => {
    const r = await lensRun("hvac", "estimate-request-signature", { params: { estimateId: "EST-0", amount: 0 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /amount required/);
  });

  it("estimate-sign rejects an empty signer name", async () => {
    const req = await lensRun("hvac", "estimate-request-signature", { params: { estimateId: "EST-7", amount: 99 } }, ctx);
    const r = await lensRun("hvac", "estimate-sign", { params: { id: req.result.signatureRequest.id } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /signer name required/);
  });
});

describe("hvac — maintenance agreements (wave 11 top-up — recurring revenue)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("hvac-t11-agr"); });

  it("premium agreement schedules 4 evenly-spread visits & exposes MRR/ARR", async () => {
    const r = await lensRun("hvac", "agreement-create", { params: { client: "Tower LLC", tier: "premium", startDate: "2026-01-01" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.agreement.tier, "premium");
    assert.equal(r.result.agreement.visitsPerYear, 4);
    assert.equal(r.result.agreement.annualPrice, 499);
    assert.equal(r.result.agreement.visits.length, 4);
    // first visit at start, seq 1..4 ascending
    assert.equal(r.result.agreement.visits[0].dueDate, "2026-01-01");
    assert.deepEqual(r.result.agreement.visits.map((v) => v.seq), [1, 2, 3, 4]);

    const list = await lensRun("hvac", "agreement-list", { params: {} }, ctx);
    const found = list.result.agreements.find((a) => a.id === r.result.agreement.id);
    assert.ok(found);
    // mrr = 499/12 = 41.5833… ; MRR = round(41.5833*100)/100 = 41.58.
    // ARR is computed from the UNrounded mrr: round(41.5833*12*100)/100 = round(499*100)/100 = 499
    // (the source deliberately doesn't compound the MRR rounding error).
    assert.equal(list.result.monthlyRecurringRevenue, 41.58);
    assert.equal(list.result.annualRecurringRevenue, 499);
    assert.equal(list.result.activeCount, 1);
  });

  it("unknown tier falls back to standard (2 visits, $279)", async () => {
    const r = await lensRun("hvac", "agreement-create", { params: { client: "Default Co", tier: "platinum-deluxe" } }, ctx);
    assert.equal(r.result.agreement.tier, "standard");
    assert.equal(r.result.agreement.visitsPerYear, 2);
    assert.equal(r.result.agreement.annualPrice, 279);
  });

  it("complete-visit marks a visit done; cancel deactivates the agreement", async () => {
    const r = await lensRun("hvac", "agreement-create", { params: { client: "Cycle Co", tier: "basic" } }, ctx);
    const id = r.result.agreement.id;
    const done = await lensRun("hvac", "agreement-complete-visit", { params: { id, seq: 1 } }, ctx);
    assert.equal(done.result.visit.status, "completed");
    assert.ok(done.result.agreement.visits.some((v) => v.seq === 1 && v.status === "completed"));

    const cancel = await lensRun("hvac", "agreement-cancel", { params: { id } }, ctx);
    assert.equal(cancel.result.agreement.status, "cancelled");
    assert.equal(cancel.result.agreement.autoRenew, false);
  });

  it("agreement-create rejects a missing client", async () => {
    const r = await lensRun("hvac", "agreement-create", { params: { tier: "basic" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /client required/);
  });
});

describe("hvac — field-visit mobile workflow (wave 11 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("hvac-t11-field"); });

  it("start (from real appt) → update parts → complete totals parts cost", async () => {
    const appt = await lensRun("hvac", "appointment-create", { params: { title: "On-site", client: "Field Co" } }, ctx);
    const appointmentId = appt.result.appointment.id;

    const start = await lensRun("hvac", "field-visit-start", { params: { appointmentId, technician: "Sam" } }, ctx);
    assert.equal(start.ok, true);
    assert.equal(start.result.visit.status, "on_site");
    // default standard checklist has 8 items
    assert.equal(start.result.visit.checklist.length, 8);
    const visitId = start.result.visit.id;

    // tick a checklist item + add two parts
    await lensRun("hvac", "field-visit-update", { params: { id: visitId, checkIndex: 0, done: true } }, ctx);
    await lensRun("hvac", "field-visit-update", { params: { id: visitId, part: { name: "Capacitor", quantity: 2, unitPrice: 25 } } }, ctx);
    const upd = await lensRun("hvac", "field-visit-update", { params: { id: visitId, part: { name: "Contactor", quantity: 1, unitPrice: 40 } } }, ctx);
    assert.equal(upd.result.visit.partsUsed.length, 2);
    assert.equal(upd.result.visit.checklist[0].done, true);

    const done = await lensRun("hvac", "field-visit-complete", { params: { id: visitId } }, ctx);
    assert.equal(done.result.visit.status, "completed");
    // 2×25 + 1×40 = 90
    assert.equal(done.result.partsTotal, 90);

    // completing the visit completed the parent appointment
    const board = await lensRun("hvac", "dispatch-board", { params: {} }, ctx);
    assert.ok(!board.result.unassigned.some((a) => a.id === appointmentId), "completed appt drops off unassigned");

    const list = await lensRun("hvac", "field-visit-list", { params: { appointmentId } }, ctx);
    const fv = list.result.visits.find((v) => v.id === visitId);
    assert.equal(fv.partsCount, 2);
    assert.equal(fv.checklistProgress, 13);   // 1 of 8 done → round(12.5) = 13
  });

  it("field-visit-start rejects an unknown appointment", async () => {
    const r = await lensRun("hvac", "field-visit-start", { params: { appointmentId: "appt_nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /appointment not found/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Wave-11 top-up additions: exact hand-computed values for the deterministic
// calc macros (load multipliers, energy-audit grade/issues, zone deviation),
// plus CRUD edge paths the existing suite hadn't exercised.
// ─────────────────────────────────────────────────────────────────────────

describe("hvac — loadCalculation multiplier math (wave 11 top-up)", () => {
  it("excellent insulation + hot climate scales base BTU exactly", async () => {
    // base = 1600 × 25 = 40000 ; × 0.8 (excellent) × 1.3 (hot) × 1 (1 story) = 41600
    const r = await lensRun("hvac", "loadCalculation", { data: { squareFootage: 1600, stories: 1, insulation: "Excellent", climate: "HOT" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.requiredBTU, 41600);
    assert.equal(r.result.tonnage, 3.5);                  // round(41600/12000*10)/10
    assert.equal(r.result.unitSize, "3.5 ton system");    // ceil(3.5*2)/2
    assert.equal(r.result.estimatedCost, 12250);          // round(3.5*3500)
    assert.equal(r.result.seerRecommendation, "SEER 16+");// hot climate
    assert.equal(r.result.insulation, "excellent");       // lower-cased
    assert.equal(r.result.climate, "hot");
  });

  it("poor insulation costs MORE BTU than excellent for identical geometry", async () => {
    const base = { squareFootage: 1200, stories: 1, climate: "temperate" };
    const poor = await lensRun("hvac", "loadCalculation", { data: { ...base, insulation: "poor" } });
    const exc = await lensRun("hvac", "loadCalculation", { data: { ...base, insulation: "excellent" } });
    // poor → 1.2× , excellent → 0.8× of base 30000
    assert.equal(poor.result.requiredBTU, 36000);   // 30000 × 1.2
    assert.equal(exc.result.requiredBTU, 24000);    // 30000 × 0.8
    assert.ok(poor.result.requiredBTU > exc.result.requiredBTU, "poorer insulation ⇒ larger load");
  });

  it("a second story adds a 10% multiplier; cold climate recommends SEER 14+", async () => {
    // 1000×25=25000 × 1.0 (avg) × 1.2 (cold) × 1.1 (2 stories) = 33000
    const r = await lensRun("hvac", "loadCalculation", { data: { squareFootage: 1000, stories: 2, insulation: "average", climate: "cold" } });
    assert.equal(r.result.requiredBTU, 33000);
    assert.equal(r.result.seerRecommendation, "SEER 14+");
    assert.ok(r.result.energyEstimate.includes("kWh/day at peak"));
  });
});

describe("hvac — energyAudit grade & issue logic (wave 11 top-up)", () => {
  it("aging high-cost system: exact savings, B grade, two flagged issues", async () => {
    // monthly 400 → annual 4800 ; costPerSqFt = round(4800/2000*100)/100 = 2.4 → grade B
    // efficiencyLoss = min(50, 20*2) = 40% ; potentialMonthly = round(400*40/100) = 160
    const r = await lensRun("hvac", "energyAudit", { data: { squareFootage: 2000, monthlyBill: 400, systemAge: 20 } });
    assert.equal(r.result.annualCost, 4800);
    assert.equal(r.result.costPerSqFt, 2.4);
    assert.equal(r.result.efficiencyLoss, "40%");
    assert.equal(r.result.potentialMonthlySavings, 160);
    assert.equal(r.result.potentialAnnualSavings, 1920);
    assert.equal(r.result.grade, "B");
    // systemAge>15 → replacement ; systemAge>10 → refrigerant ; costPerSqFt 2.4 not >3 → no cost issue
    assert.equal(r.result.issues.length, 2);
    assert.ok(r.result.issues.some((i) => i.includes("replacement")));
    assert.ok(r.result.issues.some((i) => i.includes("Refrigerant")));
  });

  it("efficiencyLoss caps at 50% for very old systems", async () => {
    // systemAge 40 → 40*2 = 80, clamped to 50
    const r = await lensRun("hvac", "energyAudit", { data: { squareFootage: 1000, monthlyBill: 100, systemAge: 40 } });
    assert.equal(r.result.efficiencyLoss, "50%");
    assert.equal(r.result.potentialMonthlySavings, 50);  // round(100*50/100)
  });

  it("low-cost new system earns an A grade with no REAL issues (all-clear note only)", async () => {
    // monthly 100 → annual 1200 ; costPerSqFt = 1200/1000 = 1.2 → <1.5 → A ; age 2 → no real flags.
    // energyAudit always surfaces a status: with zero real problems it returns exactly the
    // "No major efficiency red flags detected" all-clear note (domains/hvac.js:65 — `issues`
    // doubles as savingsOpportunities), so the count is 1, not 0. Assert no REAL issue is flagged.
    const r = await lensRun("hvac", "energyAudit", { data: { squareFootage: 1000, monthlyBill: 100, systemAge: 2 } });
    assert.equal(r.result.costPerSqFt, 1.2);
    assert.equal(r.result.grade, "A");
    assert.equal(r.result.issues.length, 1);
    assert.match(r.result.issues[0], /no major efficiency red flags/i);
    assert.ok(!r.result.issues.some((s) => s.includes("replacement") || s.includes("Refrigerant") || s.includes("above average")));
  });
});

describe("hvac — zoneBalance deviation analysis (wave 11 top-up)", () => {
  it("computes per-zone deviation, max/avg, worst zone & unbalanced recommendations", async () => {
    const zones = [
      { name: "Living", currentTemp: 78, targetTemp: 72 },  // dev 6
      { name: "Bedroom", currentTemp: 73, targetTemp: 72 },  // dev 1
    ];
    const r = await lensRun("hvac", "zoneBalance", { data: { zones } });
    assert.equal(r.ok, true);
    assert.equal(r.result.maxDeviation, 6);
    assert.equal(r.result.avgDeviation, 3.5);   // round((6+1)/2*10)/10
    assert.equal(r.result.balanced, false);     // 6 not < 3
    assert.equal(r.result.worstZone, "Living");
    // maxDeviation 6 > 5 → the strong 3-item recommendation set
    assert.equal(r.result.recommendations.length, 3);
    assert.ok(r.result.recommendations.some((x) => x.includes("damper")));
    const living = r.result.zones.find((z) => z.zone === "Living");
    assert.equal(living.deviation, 6);
  });

  it("a tight spread reads as balanced with the well-balanced recommendation", async () => {
    const zones = [
      { name: "A", currentTemp: 72, targetTemp: 72 },  // dev 0
      { name: "B", currentTemp: 73, targetTemp: 72 },  // dev 1
    ];
    const r = await lensRun("hvac", "zoneBalance", { data: { zones } });
    assert.equal(r.result.maxDeviation, 1);
    assert.equal(r.result.balanced, true);   // 1 < 3
    assert.deepEqual(r.result.recommendations, ["System is well-balanced"]);
  });

  it("no zones returns the add-zones prompt rather than crashing on Math.max", async () => {
    const r = await lensRun("hvac", "zoneBalance", { data: { zones: [] } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add zones/);
  });
});

describe("hvac — CRUD edge paths (wave 11 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("hvac-t11-edge"); });

  it("tech-add rejects a missing name", async () => {
    const r = await lensRun("hvac", "tech-add", { params: { skills: ["ac"] } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /technician name required/);
  });

  it("tech-list surfaces assignedCount of open appointments per technician", async () => {
    const tech = await lensRun("hvac", "tech-add", { params: { name: "Quinn" } }, ctx);
    const techId = tech.result.technician.id;
    const a1 = await lensRun("hvac", "appointment-create", { params: { title: "Job 1" } }, ctx);
    const a2 = await lensRun("hvac", "appointment-create", { params: { title: "Job 2" } }, ctx);
    await lensRun("hvac", "appointment-assign", { params: { id: a1.result.appointment.id, technicianId: techId } }, ctx);
    await lensRun("hvac", "appointment-assign", { params: { id: a2.result.appointment.id, technicianId: techId } }, ctx);
    // completing one should drop it out of the open count
    await lensRun("hvac", "appointment-status", { params: { id: a2.result.appointment.id, status: "completed" } }, ctx);
    const list = await lensRun("hvac", "tech-list", { params: {} }, ctx);
    const row = list.result.technicians.find((t) => t.id === techId);
    assert.equal(row.assignedCount, 1);   // a1 open, a2 completed
  });

  it("agreement-complete-visit rejects an out-of-range visit seq", async () => {
    const agr = await lensRun("hvac", "agreement-create", { params: { client: "Edge Co", tier: "basic" } }, ctx);
    const r = await lensRun("hvac", "agreement-complete-visit", { params: { id: agr.result.agreement.id, seq: 99 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /visit not found/);
  });

  it("agreement-list exposes nextVisit as the earliest scheduled date", async () => {
    const agr = await lensRun("hvac", "agreement-create", { params: { client: "Next Co", tier: "premium", startDate: "2026-03-01" } }, ctx);
    const id = agr.result.agreement.id;
    const list = await lensRun("hvac", "agreement-list", { params: {} }, ctx);
    const found = list.result.agreements.find((a) => a.id === id);
    // premium → 4 visits, first due exactly at startDate
    assert.equal(found.nextVisit.dueDate, "2026-03-01");
    assert.equal(found.nextVisit.seq, 1);
  });

  it("estimate-sign decline path marks the request declined", async () => {
    const req = await lensRun("hvac", "estimate-request-signature", { params: { estimateId: "EST-D", amount: 500 } }, ctx);
    const r = await lensRun("hvac", "estimate-sign", { params: { id: req.result.signatureRequest.id, signedName: "Nope", declined: true } }, ctx);
    assert.equal(r.result.signatureRequest.status, "declined");
    assert.equal(r.result.signatureRequest.signedAt, null);
  });

  it("field-visit-update can remove a previously-added part", async () => {
    const appt = await lensRun("hvac", "appointment-create", { params: { title: "Parts swap" } }, ctx);
    const start = await lensRun("hvac", "field-visit-start", { params: { appointmentId: appt.result.appointment.id } }, ctx);
    const visitId = start.result.visit.id;
    const added = await lensRun("hvac", "field-visit-update", { params: { id: visitId, part: { name: "Fuse", quantity: 3, unitPrice: 5 } } }, ctx);
    const partId = added.result.visit.partsUsed[0].id;
    const removed = await lensRun("hvac", "field-visit-update", { params: { id: visitId, removePartId: partId } }, ctx);
    assert.equal(removed.result.visit.partsUsed.length, 0);
  });
});
