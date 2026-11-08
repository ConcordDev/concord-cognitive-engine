// Manufacturing build slices (GB-1089 full lens build, Review 5 first pass
// + Lead compilation): S1 honest empty-state notes · S2 production
// recording · S3 OEE derivation nulls · S4 delete verbs · S5 maintenance
// completion contract · S6 SPC spec honesty · F7 lot genealogy shape.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerManufacturingActions from "../domains/manufacturing.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`manufacturing.${name}`);
  if (!fn) throw new Error(`manufacturing.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerManufacturingActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("S1 — empty-state notes name real writes, never a feed that does not exist", () => {
  it("iot-machine-state empty note names iot-reading-ingest and no bridge", () => {
    const r = call("iot-machine-state", ctxA, { machineId: "CNC-99" });
    assert.equal(r.ok, true);
    assert.match(r.result.notes, /iot-reading-ingest/);
    assert.doesNotMatch(r.result.notes, /OPC-UA|MQTT|bridge/);
  });
});

describe("S2 — work-order-update records production", () => {
  it("quantityProduced-only update drives status (S2 remainder); status-only behaves as before", () => {
    const created = call("work-order-create", ctxA, { product: "Bracket-12", quantity: 25 });
    const id = created.result.order.id;
    assert.equal(created.result.order.quantityProduced, 0);

    // S2 re-pass remainder (2026-11-05): a partially produced order is
    // in_progress, not queued — the earlier pin ("leaves status
    // untouched") asserted the behaviour the re-pass failed.
    const qtyOnly = call("work-order-update", ctxA, { id, quantityProduced: 7 });
    assert.equal(qtyOnly.ok, true);
    assert.equal(qtyOnly.result.order.quantityProduced, 7);
    assert.equal(qtyOnly.result.order.status, "in_progress");

    const statusOnly = call("work-order-update", ctxA, { id, status: "in_progress" });
    assert.equal(statusOnly.ok, true);
    assert.equal(statusOnly.result.order.status, "in_progress");
    assert.equal(statusOnly.result.order.quantityProduced, 7);

    const both = call("work-order-update", ctxA, { id, status: "complete", quantityProduced: 25 });
    assert.equal(both.result.order.status, "complete");
    assert.equal(both.result.order.quantityProduced, 25);
  });

  it("refuses bad updates: negative quantity, neither field, bad status, another user's order", () => {
    const created = call("work-order-create", ctxA, { product: "Gear-9", quantity: 3 });
    const id = created.result.order.id;
    assert.equal(call("work-order-update", ctxA, { id, quantityProduced: -1 }).ok, false);
    assert.equal(call("work-order-update", ctxA, { id, quantityProduced: "abc" }).ok, false);
    assert.equal(call("work-order-update", ctxA, { id }).ok, false);
    assert.equal(call("work-order-update", ctxA, { id, status: "bogus" }).ok, false);
    assert.equal(call("work-order-update", ctxB, { id, quantityProduced: 1 }).ok, false);
    // The refused writes changed nothing.
    const list = call("work-orders", ctxA, {});
    assert.equal(list.result.orders[0].quantityProduced, 0);
    assert.equal(list.result.orders[0].status, "queued");
  });
});

describe("S3 — OEE derivation: performance is null until derivable, never a measured 0", () => {
  it("a freshly registered machine has performance null (quality and oee already null)", () => {
    const r = call("machine-register", ctxA, { machineId: "M1", name: "Mill", idealCycleTime: 1 });
    assert.equal(r.result.machine.performance, null);
    assert.equal(r.result.machine.quality, null);
    assert.equal(r.result.machine.oee, null);
  });

  it("one reading: status RUNNING + availability real, performance null, cyclesInWindow null", () => {
    call("machine-register", ctxA, { machineId: "M1", name: "Mill", idealCycleTime: 1 });
    call("iot-reading-ingest", ctxA, { machineId: "M1", machineState: "running", cycleCount: 100, at: "2026-11-01T00:00:00.000Z" });
    const board = call("oee-status", ctxA, {});
    const row = board.result.machines[0];
    assert.equal(row.status, "running");
    assert.equal(row.availability, 100);
    assert.equal(row.performance, null);
    assert.equal(row.oee, null);
    const st = call("iot-machine-state", ctxA, { machineId: "M1" });
    assert.equal(st.result.latestCycleCount, 100);
    assert.equal(st.result.cyclesInWindow, null);
  });

  it("two readings spanning run time derive a numeric performance and cycle span", () => {
    call("machine-register", ctxA, { machineId: "M1", name: "Mill", idealCycleTime: 1 });
    call("iot-reading-ingest", ctxA, { machineId: "M1", machineState: "running", cycleCount: 0, at: "2026-11-01T00:00:00.000Z" });
    call("iot-reading-ingest", ctxA, { machineId: "M1", machineState: "running", cycleCount: 10, at: "2026-11-01T00:10:00.000Z" });
    const board = call("oee-status", ctxA, {});
    // (1 min/cycle × 10 cycles) / 10 run minutes = 100%.
    assert.equal(board.result.machines[0].performance, 100);
    const st = call("iot-machine-state", ctxA, { machineId: "M1" });
    assert.equal(st.result.cyclesInWindow, 10);
  });

  it("S3 remainder: the re-pass case — a fresh machine derives PERF/QUAL/OEE from ONE reading carrying run time and counts", () => {
    // Review 5 re-pass (2026-11-05), S3 graded case: fresh machine,
    // ideal cycle 0.5 min, one running reading of 100 cycles — with the
    // ingest inputs this remainder adds: 50 run minutes, 95 good, 5 bad.
    call("machine-register", ctxA, { machineId: "M2", name: "Lathe", idealCycleTime: 0.5 });
    const ing = call("iot-reading-ingest", ctxA, {
      machineId: "M2", machineState: "running", cycleCount: 100,
      runTimeMinutes: 50, goodCount: 95, defectCount: 5,
      at: "2026-11-01T00:00:00.000Z",
    });
    assert.equal(ing.ok, true);
    const row = call("oee-status", ctxA, {}).result.machines[0];
    assert.equal(row.availability, 100);
    assert.equal(row.performance, 100); // (0.5 × 100 cycles) / 50 run minutes
    assert.equal(row.quality, 95); // 95 / (95 + 5)
    assert.equal(row.oee, 95); // 1.00 × 1.00 × 0.95
  });

  it("S3 remainder: quality sums count-carrying readings; a reading without counts leaves quality null", () => {
    call("machine-register", ctxA, { machineId: "M3", name: "Press", idealCycleTime: 1 });
    call("iot-reading-ingest", ctxA, { machineId: "M3", machineState: "running", cycleCount: 40, at: "2026-11-01T00:00:00.000Z" });
    let row = call("oee-status", ctxA, {}).result.machines[0];
    assert.equal(row.quality, null);
    assert.equal(row.oee, null);
    call("iot-reading-ingest", ctxA, { machineId: "M3", machineState: "running", cycleCount: 90, goodCount: 45, defectCount: 5, at: "2026-11-01T00:50:00.000Z" });
    row = call("oee-status", ctxA, {}).result.machines[0];
    assert.equal(row.quality, 90); // 45 / (45 + 5)
    assert.equal(row.performance, 100); // span path: (1 × 50 cycles) / 50 min
    assert.equal(row.oee, 90);
  });

  it("S3 remainder: ingest refuses unpaired counts and negative run time; refused readings change nothing", () => {
    call("machine-register", ctxA, { machineId: "M4", name: "Drill", idealCycleTime: 1 });
    assert.equal(call("iot-reading-ingest", ctxA, { machineId: "M4", machineState: "running", cycleCount: 5, goodCount: 5 }).ok, false);
    assert.equal(call("iot-reading-ingest", ctxA, { machineId: "M4", machineState: "running", cycleCount: 5, defectCount: 1 }).ok, false);
    assert.equal(call("iot-reading-ingest", ctxA, { machineId: "M4", machineState: "running", cycleCount: 5, runTimeMinutes: -3 }).ok, false);
    assert.equal(call("iot-reading-ingest", ctxA, { machineId: "M4", machineState: "running", cycleCount: 5, goodCount: -1, defectCount: 0 }).ok, false);
    const st = call("iot-machine-state", ctxA, { machineId: "M4" });
    assert.equal(st.result.source, "empty");
  });
});

describe("S2 remainder — status follows production", () => {
  it("full quantity completes; on_hold is never silently cleared; explicit status wins; zero leaves status", () => {
    const a = call("work-order-create", ctxA, { product: "Valve", quantity: 10 }).result.order;
    const full = call("work-order-update", ctxA, { id: a.id, quantityProduced: 10 });
    assert.equal(full.result.order.status, "complete");

    const b = call("work-order-create", ctxA, { product: "Pump", quantity: 10 }).result.order;
    call("work-order-update", ctxA, { id: b.id, status: "on_hold" });
    const held = call("work-order-update", ctxA, { id: b.id, quantityProduced: 4 });
    assert.equal(held.result.order.quantityProduced, 4);
    assert.equal(held.result.order.status, "on_hold");

    const c = call("work-order-create", ctxA, { product: "Motor", quantity: 10 }).result.order;
    const explicit = call("work-order-update", ctxA, { id: c.id, quantityProduced: 10, status: "on_hold" });
    assert.equal(explicit.result.order.status, "on_hold");

    const d = call("work-order-create", ctxA, { product: "Fan", quantity: 10 }).result.order;
    const zero = call("work-order-update", ctxA, { id: d.id, quantityProduced: 0 });
    assert.equal(zero.result.order.status, "queued");
  });
});

describe("S4 — every object type has an exit, caller-scoped", () => {
  it("machine-delete removes the machine and its readings; second delete errors", () => {
    call("machine-register", ctxA, { machineId: "M1", name: "Mill" });
    call("iot-reading-ingest", ctxA, { machineId: "M1", machineState: "running", cycleCount: 5 });
    assert.equal(call("machine-delete", ctxB, { machineId: "M1" }).ok, false);
    const del = call("machine-delete", ctxA, { machineId: "M1" });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted.id, "M1");
    assert.equal(call("oee-status", ctxA, {}).result.machines.length, 0);
    assert.equal(call("iot-machine-state", ctxA, { machineId: "M1" }).result.source, "empty");
    assert.equal(call("machine-delete", ctxA, { machineId: "M1" }).ok, false);
  });

  it("work-order-delete, lot-delete, andon-delete, ncr-delete", () => {
    const wo = call("work-order-create", ctxA, { product: "Shaft", quantity: 2 }).result.order;
    assert.equal(call("work-order-delete", ctxB, { id: wo.id }).ok, false);
    assert.equal(call("work-order-delete", ctxA, { id: wo.id }).ok, true);
    assert.equal(call("work-orders", ctxA, {}).result.orders.length, 0);

    call("lot-register", ctxA, { lotNumber: "LOT-1", material: "Steel" });
    assert.equal(call("lot-delete", ctxA, { lotNumber: "LOT-1" }).ok, true);
    assert.equal(call("lots-list", ctxA, {}).result.lots.length, 0);
    assert.equal(call("lot-delete", ctxA, { lotNumber: "LOT-1" }).ok, false);

    const alert = call("andon-raise", ctxA, { station: "CNC-01", reason: "Coolant low" }).result.alert;
    assert.equal(call("andon-delete", ctxA, { alertId: alert.id }).ok, true);
    assert.equal(call("andon-board", ctxA, {}).result.alerts.length, 0);

    const ncr = call("ncr-create", ctxA, { title: "Scratch" }).result.ncr;
    assert.equal(call("ncr-delete", ctxA, { ncrId: ncr.id }).ok, true);
    assert.equal(call("ncr-list", ctxA, {}).result.ncrs.length, 0);
  });

  it("maintenance-plan-delete, inventory-delete, work-instruction-delete, schedule-job-delete", () => {
    const plan = call("maintenance-plan-create", ctxA, { machineId: "CNC-01", task: "Lube", intervalDays: 30 }).result.plan;
    assert.equal(call("maintenance-plan-delete", ctxA, { planId: plan.id }).ok, true);
    assert.equal(call("maintenance-schedule", ctxA, {}).result.plans.length, 0);

    call("inventory-upsert", ctxA, { sku: "RM-1", onHand: 5, unitCost: 2.5 });
    assert.equal(call("inventory-delete", ctxB, { sku: "RM-1" }).ok, false);
    assert.equal(call("inventory-delete", ctxA, { sku: "RM-1" }).ok, true);
    assert.equal(call("inventory-status", ctxA, {}).result.items.length, 0);

    const set = call("work-instruction-create", ctxA, { title: "Assemble", steps: [{ instruction: "Bolt" }] }).result.instructionSet;
    assert.equal(call("work-instruction-delete", ctxA, { instructionSetId: set.id }).ok, true);
    assert.equal(call("work-instructions-list", ctxA, {}).result.instructionSets.length, 0);

    const job = call("schedule-job-add", ctxA, { name: "Job A", durationHours: 2 }).result.job;
    assert.equal(call("schedule-job-delete", ctxA, { jobId: job.id }).ok, true);
    assert.equal(call("schedule-gantt", ctxA, {}).result.jobs.length, 0);
  });
});

describe("S5 — maintenance completion contract (the walk's dead leg)", () => {
  it("plan-create → maintenance-complete advances lastPerformed and nextDue by the interval", () => {
    const plan = call("maintenance-plan-create", ctxA, {
      machineId: "CNC-01", task: "Spindle lubrication", intervalDays: 30,
      lastPerformed: "2026-10-03T00:00:00.000Z",
    }).result.plan;
    assert.equal(plan.nextDue, "2026-11-02T00:00:00.000Z");
    const done = call("maintenance-complete", ctxA, { planId: plan.id });
    assert.equal(done.ok, true);
    const performed = Date.parse(done.result.plan.lastPerformed);
    assert.ok(Math.abs(performed - Date.now()) < 60_000, "lastPerformed is the completion time");
    assert.equal(Date.parse(done.result.plan.nextDue) - performed, 30 * 86400000);
    const sched = call("maintenance-schedule", ctxA, {});
    assert.equal(sched.result.plans[0].state, "scheduled");
    assert.equal(call("maintenance-complete", ctxB, { planId: plan.id }).ok, false);
    assert.equal(call("maintenance-complete", ctxA, { planId: "pm_missing" }).ok, false);
  });
});

describe("S6 — SPC spec honesty", () => {
  const VALUES = [10, 12, 11, 13, 9]; // mean 11, population σ ≈ 1.414

  it("no spec on the samples: specSource 'derived', spec equals the control range, Cpk 1.00 by construction", () => {
    for (const v of VALUES) call("spc-sample-log", ctxA, { product: "PR5MF", value: v });
    const chart = call("spc-chart", ctxA, { product: "PR5MF" }).result;
    assert.equal(chart.specSource, "derived");
    assert.equal(chart.upperSpec, chart.upperControl);
    assert.equal(chart.lowerSpec, chart.lowerControl);
    assert.equal(chart.cpk, 1);
    assert.ok(Math.abs(chart.centerLine - 11) < 1e-9);
  });

  it("a real spec on the samples: specSource 'samples', the chart uses it, Cpk is a measurement", () => {
    for (const v of VALUES) call("spc-sample-log", ctxA, { product: "PR5MF", value: v, upperSpec: 15, lowerSpec: 5 });
    const chart = call("spc-chart", ctxA, { product: "PR5MF" }).result;
    assert.equal(chart.specSource, "samples");
    assert.equal(chart.upperSpec, 15);
    assert.equal(chart.lowerSpec, 5);
    // min((15−11), (11−5)) / (3σ) = 4 / 4.243 ≈ 0.94 — not the tautological 1.00.
    assert.equal(chart.cpk, 0.94);
    assert.notEqual(chart.upperSpec, chart.upperControl);
  });

  it("half a spec or an inverted spec is refused at log time", () => {
    assert.equal(call("spc-sample-log", ctxA, { product: "P", value: 1, upperSpec: 15 }).ok, false);
    assert.equal(call("spc-sample-log", ctxA, { product: "P", value: 1, upperSpec: 5, lowerSpec: 15 }).ok, false);
    assert.equal(call("spc-sample-log", ctxA, { product: "P", value: 1, upperSpec: "x", lowerSpec: 5 }).ok, false);
  });
});

describe("F7 — lot genealogy: upstream is the parents, never the lot itself", () => {
  it("W1's upstream lists R1 as its root; W1 does not appear upstream", () => {
    call("lot-register", ctxA, { lotNumber: "PR5MF-R1", material: "Resin", kind: "raw_material" });
    call("lot-register", ctxA, { lotNumber: "PR5MF-W1", material: "Widget", kind: "wip", parentLots: ["PR5MF-R1"] });
    const gen = call("lot-genealogy", ctxA, { lotNumber: "PR5MF-W1" }).result;
    assert.equal(gen.lot.lotNumber, "PR5MF-W1");
    assert.equal(gen.upstream.length, 1);
    assert.equal(gen.upstream[0].lotNumber, "PR5MF-R1");
    assert.ok(!JSON.stringify(gen.upstream).includes("PR5MF-W1"));
    // Downstream of R1 still shows W1 as its consumer.
    const down = call("lot-genealogy", ctxA, { lotNumber: "PR5MF-R1" }).result;
    assert.equal(down.downstream[0].lotNumber, "PR5MF-W1");
    assert.deepEqual(down.upstream, []);
  });

  it("a lot cannot name itself as its own parent, and a parent cycle cannot self-list", () => {
    assert.equal(call("lot-register", ctxA, { lotNumber: "SELF-1", material: "X", parentLots: ["SELF-1"] }).ok, false);
    call("lot-register", ctxA, { lotNumber: "CYC-A", material: "X", parentLots: ["CYC-B"] });
    call("lot-register", ctxA, { lotNumber: "CYC-B", material: "X", parentLots: ["CYC-A"] });
    const gen = call("lot-genealogy", ctxA, { lotNumber: "CYC-A" }).result;
    assert.equal(gen.upstream.length, 1);
    assert.equal(gen.upstream[0].lotNumber, "CYC-B");
    assert.ok(!JSON.stringify(gen.upstream).includes("CYC-A"));
  });
});

describe("F10 remainder — the routing traveler names the caller's work order", () => {
  // Production dispatch shape (server.js, POST /api/lens/run): the
  // handler's virtual artifact is minted { id: null, title: null,
  // data: input } and params IS the input — so this suite's call()
  // harness (data: {}) is NOT production shape for artifact-based
  // macros. These cases invoke the handler in production shape.
  function callTool(name, input) {
    const fn = ACTIONS.get(`manufacturing.${name}`);
    if (!fn) throw new Error(`manufacturing.${name} not registered`);
    return fn(ctxA, { id: null, title: null, data: input, meta: {} }, input);
  }

  it("generateTraveler prints the supplied work order id, never the placeholder, and lists the supplied steps", () => {
    const r = callTool("generateTraveler", { workOrderId: "WO-MW3XOTNGKG2EC", partNumber: "HA-400", quantity: 2, steps: ["Cut", "Turn"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.workOrder, "WO-MW3XOTNGKG2EC");
    assert.match(r.result.content, /WO: WO-MW3XOTNGKG2EC/);
    assert.doesNotMatch(r.result.content, /WO: work order/);
    assert.equal(r.result.stepCount, 2);
    assert.match(r.result.content, /01\. Cut/);
    assert.match(r.result.content, /02\. Turn/);
  });

  it("generateTraveler reads a wrapped artifact payload too (data.workOrderId)", () => {
    const fn = ACTIONS.get("manufacturing.generateTraveler");
    const input = { partNumber: "HA-400", quantity: 1, steps: [] };
    const r = fn(ctxA, { id: null, title: null, data: { workOrderId: "WO-WRAPPED-1" }, meta: {} }, input);
    assert.equal(r.result.workOrder, "WO-WRAPPED-1");
  });

  it("advanceStep walks the supplied steps in production shape", () => {
    const r = callTool("advanceStep", { steps: ["Cut", "Turn", "Drill"], currentStep: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalSteps, 3);
    assert.equal(r.result.currentStep, 1);
    assert.equal(r.result.status, "in_progress");
    assert.equal(r.result.percentComplete, 33);
  });

  it("an empty steps form says so about the form, not about a work-order record", () => {
    const r = callTool("generateTraveler", { workOrderId: "WO-EMPTY-1", partNumber: "HA-400", quantity: 1, steps: [] });
    assert.equal(r.result.stepCount, 0);
    assert.match(r.result.content, /no routing steps supplied/);
    assert.doesNotMatch(r.result.content, /defined on this work order/);
  });
});
