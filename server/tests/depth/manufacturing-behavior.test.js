// tests/depth/manufacturing-behavior.test.js — REAL behavioral tests (manufacturing lens-actions).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, macroRuntime } from "./_harness.js";

describe("manufacturing — calc actions (exact values)", () => {
  it("oeeCalculate: OEE = availability × performance × quality", async () => {
    // planned 480, downtime 80 → avail 83%; ideal 1 × 400 / 400 → perf 100%; 380/400 → quality 95% → OEE 79
    const r = await lensRun("manufacturing", "oeeCalculate", { params: { plannedTime: 480, downtime: 80, idealCycleTime: 1, totalPieces: 400, goodPieces: 380 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.availability, 83);
    assert.equal(r.result.quality, 95);
    assert.equal(r.result.oee, 79);
  });
  it("oeeCalculate: more good pieces ⇒ higher quality ⇒ higher OEE", async () => {
    const lo = await lensRun("manufacturing", "oeeCalculate", { params: { plannedTime: 480, downtime: 0, idealCycleTime: 1, totalPieces: 400, goodPieces: 300 } });
    const hi = await lensRun("manufacturing", "oeeCalculate", { params: { plannedTime: 480, downtime: 0, idealCycleTime: 1, totalPieces: 400, goodPieces: 400 } });
    assert.ok(hi.result.oee > lo.result.oee);
  });
  it("safetyRate: computes an incident rate from hours worked", async () => {
    const r = await lensRun("manufacturing", "safetyRate", { params: { hoursWorked: 200000, recordableIncidents: 3 } });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.incidentRate, "number");
  });
  it("work-orders: returns the (possibly empty) work-order list", async () => {
    const r = await lensRun("manufacturing", "work-orders", { params: {} });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.orders));
  });
});

describe("manufacturing — CRUD", () => {
  let ctx; before(async () => { ctx = await depthCtx("mfg-crud"); });
  it("andon-raise → andon-board: a raised andon shows open on the board", async () => {
    const raised = await lensRun("manufacturing", "andon-raise", { params: { station: "Line 1", reason: "jam" } }, ctx);
    assert.equal(raised.ok, true);
    assert.equal(raised.result.alert.status, "open");
    const id = raised.result.alert.id;
    const board = await lensRun("manufacturing", "andon-board", { params: {} }, ctx);
    assert.ok((board.result.alerts || []).some((a) => a.id === id), "the raised alert is on the board");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// wave 12 top-up — uncovered DETERMINISTIC macros (exact hand-computed values,
// round-trips, and rejections). No bare-ok / typeof-only assertions.
// ──────────────────────────────────────────────────────────────────────────

describe("manufacturing — cost & quality calc (wave 12 top-up)", () => {
  it("bomCost: total = Σ(quantity × unitCost), exact", async () => {
    const r = await lensRun("manufacturing", "bomCost", {
      data: { title: "Widget", components: [
        { name: "Bracket", quantity: 2, unitCost: 10 },   // 20
        { name: "Bolt", quantity: 3, unitCost: 5 },        // 15
        { name: "Washer", quantity: 4, unitCost: 0.25 },   // 1
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCost, 36);            // 20 + 15 + 1
    assert.equal(r.result.componentCount, 3);
    assert.ok(r.result.components.some((c) => c.part === "Bracket" && c.lineCost === 20));
  });

  it("bomCost: empty BOM ⇒ zero cost", async () => {
    const r = await lensRun("manufacturing", "bomCost", { data: { components: [] } });
    assert.equal(r.result.totalCost, 0);
    assert.equal(r.result.componentCount, 0);
  });

  it("defectAnalysis: defect rate = defects / inspected, severity tally, low risk", async () => {
    const r = await lensRun("manufacturing", "defectAnalysis", {
      data: {
        inspected: 100,
        defects: [
          { type: "scratch", severity: "minor" },
          { type: "scratch", severity: "minor" },
          { type: "scratch", severity: "minor" },
          { type: "dent", severity: "major" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.defectCount, 4);
    assert.equal(r.result.defectRatePct, 4);          // 4/100 = 4.00%
    assert.equal(r.result.bySeverity.minor, 3);
    assert.equal(r.result.bySeverity.major, 1);
    assert.equal(r.result.topDefect, "scratch");      // 3 > 1
    assert.equal(r.result.riskLevel, "low");          // no critical, major ≤ 2
  });

  it("defectAnalysis: a critical defect raises risk to high", async () => {
    const r = await lensRun("manufacturing", "defectAnalysis", {
      data: { inspected: 50, defects: [{ type: "crack", severity: "critical" }] },
    });
    assert.equal(r.result.riskLevel, "high");
    assert.equal(r.result.defectRatePct, 2);          // 1/50 = 2.00%
  });
});

describe("manufacturing — work-order flow calc (wave 12 top-up)", () => {
  it("advanceStep: advancing from step 0 of 4 ⇒ 25% complete, in_progress", async () => {
    const r = await lensRun("manufacturing", "advanceStep", {
      data: { workOrder: "WO-7", currentStep: 0, steps: [{ name: "Cut" }, { name: "Weld" }, { name: "Paint" }, { name: "QA" }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.currentStep, 1);
    assert.equal(r.result.totalSteps, 4);
    assert.equal(r.result.percentComplete, 25);
    assert.equal(r.result.status, "in_progress");
    assert.equal(r.result.currentStepName, "Cut");
  });

  it("advanceStep: advancing into the final step marks complete at 100%", async () => {
    const r = await lensRun("manufacturing", "advanceStep", {
      data: { currentStep: 2, steps: [{ name: "A" }, { name: "B" }, { name: "C" }] },
    });
    assert.equal(r.result.currentStep, 3);
    assert.equal(r.result.percentComplete, 100);
    assert.equal(r.result.status, "complete");
    assert.equal(r.result.nextStepName, null);
  });

  it("generateTraveler: traveler reflects the routing step count + part number", async () => {
    const r = await lensRun("manufacturing", "generateTraveler", {
      data: { title: "WO-9", partNumber: "PN-123", quantity: 5, steps: [{ name: "Mill" }, { name: "Drill" }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.stepCount, 2);
    assert.equal(r.result.partNumber, "PN-123");
    assert.equal(r.result.quantity, 5);
    assert.match(r.result.content, /PN-123/);
  });

  it("logDowntime: availability impact = duration / plannedTime; maintenance categorised", async () => {
    const r = await lensRun("manufacturing", "logDowntime", {
      data: { machine: "CNC-1", plannedTime: 480 },
      params: { reason: "scheduled maintenance", durationMinutes: 48 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.availabilityImpactPct, 10);   // 48/480 = 10.00%
    assert.equal(r.result.category, "maintenance");
    assert.equal(r.result.machine, "CNC-1");
  });

  it("scheduleOptimize: orders sequenced by ascending priority then due date", async () => {
    const r = await lensRun("manufacturing", "scheduleOptimize", {
      data: { workOrders: [
        { id: "low", priority: 5, dueDate: "2026-01-01" },
        { id: "urgent", priority: 1, dueDate: "2026-03-01" },
        { id: "mid-early", priority: 3, dueDate: "2026-01-15" },
        { id: "mid-late", priority: 3, dueDate: "2026-02-15" },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 4);
    const seq = r.result.sequence.map((s) => s.id);
    assert.deepEqual(seq, ["urgent", "mid-early", "mid-late", "low"]);
  });
});

describe("manufacturing — finite-capacity scheduling (wave 12 top-up)", () => {
  let ctx; before(async () => { ctx = await depthCtx("mfg-sched-t12"); });
  it("schedule-job-add → schedule-gantt: jobs placed back-to-back, load summed, late flagged", async () => {
    const a = await lensRun("manufacturing", "schedule-job-add", {
      params: { name: "Batch-A", resource: "Line A", durationHours: 4, priority: 1, dueDate: "2099-01-01" },
    }, ctx);
    assert.equal(a.ok, true);
    // a job with a due date in the past must be flagged late by the gantt
    const b = await lensRun("manufacturing", "schedule-job-add", {
      params: { name: "Batch-B", resource: "Line A", durationHours: 2, priority: 2, dueDate: "2000-01-01" },
    }, ctx);
    assert.equal(b.ok, true);
    const g = await lensRun("manufacturing", "schedule-gantt", { params: { horizonStart: "2050-06-01T00:00:00.000Z" } }, ctx);
    assert.equal(g.ok, true);
    const cap = g.result.capacity.find((c) => c.resource === "Line A");
    assert.equal(cap.loadHours, 6);                 // 4 + 2 back-to-back
    assert.equal(cap.jobCount, 2);
    assert.equal(g.result.lateJobs, 1);             // Batch-B due in 2000
    assert.ok(g.result.jobs.some((j) => j.name === "Batch-B" && j.late === true));
  });

  it("schedule-job-add: non-positive duration is rejected", async () => {
    const r = await lensRun("manufacturing", "schedule-job-add", { params: { name: "Bad", durationHours: 0 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /durationHours/);
  });

  it("schedule-job-reschedule: rescheduling a missing job is rejected", async () => {
    const r = await lensRun("manufacturing", "schedule-job-reschedule", { params: { jobId: "nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /not found/);
  });
});

describe("manufacturing — lot traceability (wave 12 top-up)", () => {
  let ctx; before(async () => { ctx = await depthCtx("mfg-lot-t12"); });
  it("lot-register → lot-genealogy: a finished lot traces upstream to its parent raw lot", async () => {
    const raw = await lensRun("manufacturing", "lot-register", { params: { lotNumber: "RAW-1", material: "Steel", kind: "raw_material", quantity: 100 } }, ctx);
    assert.equal(raw.ok, true);
    const fin = await lensRun("manufacturing", "lot-register", { params: { lotNumber: "FIN-1", material: "Frame", kind: "finished_good", parentLots: ["RAW-1"] } }, ctx);
    assert.equal(fin.ok, true);
    const gen = await lensRun("manufacturing", "lot-genealogy", { params: { lotNumber: "FIN-1" } }, ctx);
    assert.equal(gen.ok, true);
    assert.ok(gen.result.upstream.children.some((c) => c.lotNumber === "RAW-1"), "FIN-1 traces up to RAW-1");
    // and RAW-1's downstream includes FIN-1
    const down = await lensRun("manufacturing", "lot-genealogy", { params: { lotNumber: "RAW-1" } }, ctx);
    assert.ok(down.result.downstream.some((d) => d.lotNumber === "FIN-1"), "RAW-1 traces down to FIN-1");
  });

  it("lots-list: kind filter returns only finished goods", async () => {
    const r = await lensRun("manufacturing", "lots-list", { params: { kind: "finished_good" } }, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.lots.some((l) => l.lotNumber === "FIN-1"));
    assert.ok(!r.result.lots.some((l) => l.lotNumber === "RAW-1"));
  });

  it("lot-register: a duplicate lot number is rejected", async () => {
    const r = await lensRun("manufacturing", "lot-register", { params: { lotNumber: "RAW-1", material: "Steel" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /already registered/);
  });

  it("lot-genealogy: an unknown lot is rejected", async () => {
    const r = await lensRun("manufacturing", "lot-genealogy", { params: { lotNumber: "GHOST" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /not found/);
  });
});

describe("manufacturing — inventory / WIP (wave 12 top-up)", () => {
  let ctx; before(async () => { ctx = await depthCtx("mfg-inv-t12"); });
  it("inventory-upsert → inventory-status: value = onHand × unitCost; available = onHand − allocated", async () => {
    const up = await lensRun("manufacturing", "inventory-upsert", { params: { sku: "SKU-1", name: "Bolt", onHand: 10, unitCost: 5, reorderPoint: 3 } }, ctx);
    assert.equal(up.ok, true);
    assert.equal(up.result.item.onHand, 10);
    const st = await lensRun("manufacturing", "inventory-status", { params: {} }, ctx);
    const item = st.result.items.find((x) => x.sku === "SKU-1");
    assert.equal(item.value, 50);                   // 10 × 5
    assert.equal(item.available, 10);               // nothing allocated yet
    assert.equal(item.belowReorder, false);         // 10 > 3
  });

  it("inventory-allocate: allocating reduces availability; status reflects it", async () => {
    const alloc = await lensRun("manufacturing", "inventory-allocate", { params: { sku: "SKU-1", quantity: 4, workOrderId: "WO-1" } }, ctx);
    assert.equal(alloc.ok, true);
    assert.equal(alloc.result.item.allocated, 4);
    const st = await lensRun("manufacturing", "inventory-status", { params: {} }, ctx);
    const item = st.result.items.find((x) => x.sku === "SKU-1");
    assert.equal(item.available, 6);                // 10 − 4
  });

  it("inventory-allocate: over-allocation beyond available stock is rejected", async () => {
    const r = await lensRun("manufacturing", "inventory-allocate", { params: { sku: "SKU-1", quantity: 999 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /insufficient stock/);
  });
});

describe("manufacturing — IoT & instructions (wave 12 top-up)", () => {
  let ctx; before(async () => { ctx = await depthCtx("mfg-iot-t12"); });
  it("iot-reading-ingest → iot-machine-state: uptime% over readings + cycle span", async () => {
    await lensRun("manufacturing", "iot-reading-ingest", { params: { machineId: "M1", machineState: "running", cycleCount: 100 } }, ctx);
    await lensRun("manufacturing", "iot-reading-ingest", { params: { machineId: "M1", machineState: "running", cycleCount: 110 } }, ctx);
    await lensRun("manufacturing", "iot-reading-ingest", { params: { machineId: "M1", machineState: "down", cycleCount: 110, downtimeReason: "jam" } }, ctx);
    const st = await lensRun("manufacturing", "iot-machine-state", { params: { machineId: "M1" } }, ctx);
    assert.equal(st.ok, true);
    assert.equal(st.result.currentState, "down");
    assert.equal(st.result.uptimePct, 67);          // round(2/3 × 100)
    assert.equal(st.result.cyclesInWindow, 10);      // 110 − 100
    assert.ok(st.result.downtimeReasons.some((d) => d.reason === "jam" && d.count === 1));
  });

  it("iot-machine-state: unknown machine returns an empty source", async () => {
    const r = await lensRun("manufacturing", "iot-machine-state", { params: { machineId: "NOPE" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "empty");
  });

  it("work-instruction-create → step-complete: completing a step advances progress %", async () => {
    const wi = await lensRun("manufacturing", "work-instruction-create", {
      params: { title: "Assemble Frame", steps: [{ instruction: "Place base" }, { instruction: "Fasten bolts" }] },
    }, ctx);
    assert.equal(wi.ok, true);
    const setId = wi.result.instructionSet.id;
    const done = await lensRun("manufacturing", "work-instruction-step-complete", { params: { instructionSetId: setId, stepIndex: 1 } }, ctx);
    assert.equal(done.ok, true);
    assert.equal(done.result.progress.done, 1);
    assert.equal(done.result.progress.total, 2);
    assert.equal(done.result.progress.pct, 50);
  });

  it("work-instruction-create: no steps is rejected", async () => {
    const r = await lensRun("manufacturing", "work-instruction-create", { params: { title: "Empty", steps: [] } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /at least one step/);
  });
});

describe("manufacturing — NCR/CAPA & maintenance (wave 12 top-up)", () => {
  let ctx; before(async () => { ctx = await depthCtx("mfg-ncr-t12"); });
  it("ncr-create → ncr-advance: advancing walks the stage machine open → investigation", async () => {
    const ncr = await lensRun("manufacturing", "ncr-create", { params: { title: "Cracked weld", severity: "major" } }, ctx);
    assert.equal(ncr.ok, true);
    assert.equal(ncr.result.ncr.stage, "open");
    const id = ncr.result.ncr.id;
    const adv = await lensRun("manufacturing", "ncr-advance", { params: { ncrId: id } }, ctx);
    assert.equal(adv.ok, true);
    assert.equal(adv.result.ncr.stage, "investigation");
  });

  it("ncr-advance: closing stamps closedAt; ncr-list surfaces it", async () => {
    const ncr = await lensRun("manufacturing", "ncr-create", { params: { title: "Scrap batch" } }, ctx);
    const id = ncr.result.ncr.id;
    const closed = await lensRun("manufacturing", "ncr-advance", { params: { ncrId: id, stage: "closed", rootCause: "tool wear" } }, ctx);
    assert.equal(closed.result.ncr.stage, "closed");
    assert.equal(closed.result.ncr.rootCause, "tool wear");
    assert.ok(closed.result.ncr.closedAt, "closedAt is stamped");
    const list = await lensRun("manufacturing", "ncr-list", { params: { stage: "closed" } }, ctx);
    assert.ok(list.result.ncrs.some((n) => n.id === id));
  });

  it("ncr-advance: an invalid stage is rejected", async () => {
    const ncr = await lensRun("manufacturing", "ncr-create", { params: { title: "X" } }, ctx);
    const r = await lensRun("manufacturing", "ncr-advance", { params: { ncrId: ncr.result.ncr.id, stage: "bogus" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /invalid stage/);
  });

  it("maintenance-plan-create → maintenance-schedule: overdue plan flagged overdue", async () => {
    // lastPerformed long ago + short interval ⇒ nextDue is in the past ⇒ overdue
    const plan = await lensRun("manufacturing", "maintenance-plan-create", {
      params: { machineId: "PUMP-1", task: "Grease bearings", intervalDays: 7, lastPerformed: "2000-01-01T00:00:00.000Z" },
    }, ctx);
    assert.equal(plan.ok, true);
    const id = plan.result.plan.id;
    const sched = await lensRun("manufacturing", "maintenance-schedule", { params: {} }, ctx);
    assert.equal(sched.ok, true);
    assert.ok(sched.result.overdueCount >= 1);
    assert.ok(sched.result.plans.some((p) => p.id === id && p.state === "overdue"));
  });

  it("maintenance-complete: completing pushes nextDue forward (no longer overdue)", async () => {
    const plan = await lensRun("manufacturing", "maintenance-plan-create", {
      params: { machineId: "PUMP-2", task: "Inspect seals", intervalDays: 30, lastPerformed: "2000-01-01T00:00:00.000Z" },
    }, ctx);
    const id = plan.result.plan.id;
    const done = await lensRun("manufacturing", "maintenance-complete", { params: { planId: id } }, ctx);
    assert.equal(done.ok, true);
    // nextDue is now in the future relative to the just-set lastPerformed
    assert.ok(Date.parse(done.result.plan.nextDue) > Date.parse(done.result.plan.lastPerformed));
  });

  it("maintenance-plan-create: non-positive interval is rejected", async () => {
    const r = await lensRun("manufacturing", "maintenance-plan-create", { params: { machineId: "M", task: "T", intervalDays: 0 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /intervalDays/);
  });
});

describe("manufacturing — andon lifecycle (wave 12 top-up)", () => {
  let ctx; before(async () => { ctx = await depthCtx("mfg-andon-t12"); });
  it("andon-raise → andon-update(acknowledge → resolve): records a response time + clears from open", async () => {
    const raised = await lensRun("manufacturing", "andon-raise", { params: { station: "Line 2", reason: "tool break", severity: "critical" } }, ctx);
    assert.equal(raised.ok, true);
    const id = raised.result.alert.id;
    const ack = await lensRun("manufacturing", "andon-update", { params: { alertId: id, action: "acknowledge" } }, ctx);
    assert.equal(ack.result.alert.status, "acknowledged");
    const res = await lensRun("manufacturing", "andon-update", { params: { alertId: id, action: "resolve" } }, ctx);
    assert.equal(res.result.alert.status, "resolved");
    assert.equal(typeof res.result.alert.responseSeconds, "number");
    assert.ok(res.result.alert.responseSeconds >= 0);
    const board = await lensRun("manufacturing", "andon-board", { params: {} }, ctx);
    assert.ok(!board.result.alerts.filter((a) => a.status !== "resolved").some((a) => a.id === id), "resolved alert is no longer open");
  });

  it("andon-update: an unknown action is rejected", async () => {
    const raised = await lensRun("manufacturing", "andon-raise", { params: { reason: "x" } }, ctx);
    const r = await lensRun("manufacturing", "andon-update", { params: { alertId: raised.result.alert.id, action: "bogus" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /acknowledge\|resolve/);
  });
});

describe("manufacturing — SPC chart statistics (wave 12 top-up)", () => {
  it("spc-chart: empty product feed returns the empty-source contract", async () => {
    const r = await lensRun("manufacturing", "spc-chart", { params: { product: "Gizmo-NoSamples" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "empty");
    assert.deepEqual(r.result.samples, []);
    assert.equal(r.result.product, "Gizmo-NoSamples");
  });

  it("spc-chart: a missing product is rejected", async () => {
    const r = await lensRun("manufacturing", "spc-chart", { params: {} });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /product required/);
  });

  it("spc-chart: computes Cpk / centerline / control limits / ppm over seeded samples", async () => {
    // Seed two gauge samples [8, 12] directly into the SPC store (no spc-sample-log
    // macro is registered, so the wired path is exercised by seeding STATE for the
    // SAME user the chart is read with). mean=10, σ=2; specs ±[4,16] on sample[0]:
    //   Cpk = min((16-10)/(3·2), (10-4)/(3·2)) = min(1,1) = 1.00
    //   control limits = 10 ± 3·2 = [4, 16]; both samples in-spec ⇒ ppm 0, inControl
    const { STATE, ctx } = await macroRuntime("mfg-spc-t12");
    const userId = ctx.actor.userId;
    // ensure the lens state exists, then seed
    if (!STATE.manufacturingLens) {
      STATE.manufacturingLens = { machines: new Map(), workOrders: new Map(), spcSamples: new Map() };
    }
    STATE.manufacturingLens.spcSamples.set(`${userId}::WidgetX`, [
      { at: "2026-01-01T00:00:00.000Z", value: 8, upperSpec: 16, lowerSpec: 4 },
      { at: "2026-01-01T00:01:00.000Z", value: 12, upperSpec: 16, lowerSpec: 4 },
    ]);
    const r = await lensRun("manufacturing", "spc-chart", { params: { product: "WidgetX" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "wired-feed");
    assert.equal(r.result.centerLine, 10);          // mean of [8,12]
    assert.equal(r.result.upperControl, 16);        // 10 + 3·2
    assert.equal(r.result.lowerControl, 4);         // 10 − 3·2
    assert.equal(r.result.cpk, 1);                  // min((16-10)/6,(10-4)/6) = 1.00
    assert.equal(r.result.ppm, 0);                  // none out of spec
    assert.equal(r.result.inControl, true);
  });

  it("spc-chart: an out-of-spec sample drives ppm up and flags out-of-control", async () => {
    // values [10, 10, 100]: mean = 40, σ = sqrt(((30²)+(30²)+(60²))/3) = sqrt(1800) ≈ 42.43
    // spec ±[0,20] on sample[0] ⇒ 100 is out of spec ⇒ 1/3 out ⇒ ppm = round(333333.33) = 333333
    const { STATE, ctx } = await macroRuntime("mfg-spc-oos-t12");
    const userId = ctx.actor.userId;
    if (!STATE.manufacturingLens) {
      STATE.manufacturingLens = { machines: new Map(), workOrders: new Map(), spcSamples: new Map() };
    }
    STATE.manufacturingLens.spcSamples.set(`${userId}::WidgetY`, [
      { at: "2026-01-01T00:00:00.000Z", value: 10, upperSpec: 20, lowerSpec: 0 },
      { at: "2026-01-01T00:01:00.000Z", value: 10, upperSpec: 20, lowerSpec: 0 },
      { at: "2026-01-01T00:02:00.000Z", value: 100, upperSpec: 20, lowerSpec: 0 },
    ]);
    const r = await lensRun("manufacturing", "spc-chart", { params: { product: "WidgetY" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.ppm, 333333);             // round((1/3)·1_000_000)
  });
});

describe("manufacturing — status feeds & instruction listing (wave 12 top-up)", () => {
  it("oee-status: with no machines registered returns the empty-source contract", async () => {
    const r = await lensRun("manufacturing", "oee-status", { params: {} });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "empty");
    assert.deepEqual(r.result.machines, []);
    assert.match(r.result.notes, /MES\/SCADA/);
  });

  it("work-instruction-create → work-instructions-list: list reflects the created set; workOrderId filter narrows", async () => {
    const ctx = await depthCtx("mfg-wilist-t12");
    const wi = await lensRun("manufacturing", "work-instruction-create", {
      params: { title: "Press Frame", workOrderId: "WO-42", steps: [{ instruction: "Align" }] },
    }, ctx);
    assert.equal(wi.ok, true);
    const setId = wi.result.instructionSet.id;
    const all = await lensRun("manufacturing", "work-instructions-list", { params: {} }, ctx);
    assert.equal(all.ok, true);
    assert.equal(all.result.count, 1);
    assert.ok(all.result.instructionSets.some((x) => x.id === setId && x.title === "Press Frame"));
    // a non-matching workOrderId filter returns nothing
    const miss = await lensRun("manufacturing", "work-instructions-list", { params: { workOrderId: "WO-NONE" } }, ctx);
    assert.equal(miss.result.count, 0);
    // the matching workOrderId filter returns the set
    const hit = await lensRun("manufacturing", "work-instructions-list", { params: { workOrderId: "WO-42" } }, ctx);
    assert.ok(hit.result.instructionSets.some((x) => x.id === setId));
  });
});
