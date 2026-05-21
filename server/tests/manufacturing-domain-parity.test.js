import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerManufacturingActions from "../domains/manufacturing.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`manufacturing.${name}`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerManufacturingActions(register); });
beforeEach(() => { globalThis._concordSTATE = { dtus: new Map() }; globalThis._concordSaveStateDebounced = () => {}; });
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("manufacturing parity macros (real MES/SCADA feeds only)", () => {
  it("oee-status returns empty + setup hint when no feed wired", () => {
    const r = call("oee-status", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.machines, []);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /MES|SCADA|OPC-UA|MQTT|MTConnect/);
  });

  it("oee-status returns real machines when state is populated", () => {
    const STATE = globalThis._concordSTATE;
    STATE.manufacturingLens = {
      machines: new Map([["user_a", [
        { id: "mac_0", name: "CNC-01", status: "running", availability: 92, performance: 85, quality: 99, oee: 77 },
      ]]]),
      workOrders: new Map(),
      spcSamples: new Map(),
    };
    const r = call("oee-status", ctxA, {});
    assert.equal(r.result.machines.length, 1);
    assert.equal(r.result.source, "wired-feed");
  });

  it("work-orders returns empty + setup hint when no ERP wired", () => {
    const r = call("work-orders", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.orders, []);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /ERP|Tulip|Plex|NetSuite/);
  });

  it("spc-chart returns empty + setup hint when no QA gauge feed wired", () => {
    const r = call("spc-chart", ctxA, { product: "Widget-001" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.samples, []);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /QA gauge|spc-sample-log/);
  });

  it("spc-chart computes Cpk + PPM from real logged samples", () => {
    const STATE = globalThis._concordSTATE;
    STATE.manufacturingLens = {
      machines: new Map(),
      workOrders: new Map(),
      spcSamples: new Map([[`user_a::Widget-001`, [
        { at: new Date(Date.now() - 4 * 60000).toISOString(), value: 25.01, upperSpec: 25.1, lowerSpec: 24.9 },
        { at: new Date(Date.now() - 3 * 60000).toISOString(), value: 25.03, upperSpec: 25.1, lowerSpec: 24.9 },
        { at: new Date(Date.now() - 2 * 60000).toISOString(), value: 24.98, upperSpec: 25.1, lowerSpec: 24.9 },
        { at: new Date(Date.now() - 1 * 60000).toISOString(), value: 25.02, upperSpec: 25.1, lowerSpec: 24.9 },
        { at: new Date(Date.now()).toISOString(), value: 25.00, upperSpec: 25.1, lowerSpec: 24.9 },
      ]]]),
    };
    const r = call("spc-chart", ctxA, { product: "Widget-001" });
    assert.equal(r.result.samples.length, 5);
    assert.ok(typeof r.result.cpk === "number");
    assert.equal(r.result.source, "wired-feed");
    assert.ok(r.result.upperSpec > r.result.lowerSpec);
  });

  it("spc-chart rejects empty product", () => {
    assert.equal(call("spc-chart", ctxA, { product: "" }).ok, false);
  });

  it("regression: pre-existing macros register", () => {
    assert.ok(ACTIONS.size >= 6);
  });
});

describe("manufacturing shop-floor execution suite (parity backlog)", () => {
  it("work-instruction-create + list + step-complete", () => {
    const c = call("work-instruction-create", ctxA, {
      title: "Assemble HA-400", product: "HA-400",
      steps: [{ instruction: "Torque bolts" }, { instruction: "Pressure test", checkpoint: true }],
    });
    assert.equal(c.ok, true);
    assert.equal(c.result.instructionSet.steps.length, 2);
    const setId = c.result.instructionSet.id;
    const list = call("work-instructions-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    const step = call("work-instruction-step-complete", ctxA, { instructionSetId: setId, stepIndex: 1, completed: true });
    assert.equal(step.ok, true);
    assert.equal(step.result.progress.done, 1);
  });

  it("work-instruction-create rejects missing title / steps", () => {
    assert.equal(call("work-instruction-create", ctxA, { steps: [{ instruction: "x" }] }).ok, false);
    assert.equal(call("work-instruction-create", ctxA, { title: "T", steps: [] }).ok, false);
  });

  it("iot-reading-ingest + iot-machine-state computes uptime + Pareto", () => {
    assert.equal(call("iot-machine-state", ctxA, { machineId: "M1" }).result.source, "empty");
    call("iot-reading-ingest", ctxA, { machineId: "M1", machineState: "running", cycleCount: 100 });
    call("iot-reading-ingest", ctxA, { machineId: "M1", machineState: "down", cycleCount: 100, downtimeReason: "tool change" });
    call("iot-reading-ingest", ctxA, { machineId: "M1", machineState: "running", cycleCount: 140 });
    const st = call("iot-machine-state", ctxA, { machineId: "M1" });
    assert.equal(st.ok, true);
    assert.equal(st.result.source, "wired-feed");
    assert.equal(st.result.cyclesInWindow, 40);
    assert.equal(st.result.uptimePct, 67);
    assert.equal(st.result.downtimeReasons[0].reason, "tool change");
  });

  it("iot-reading-ingest rejects missing machineId", () => {
    assert.equal(call("iot-reading-ingest", ctxA, {}).ok, false);
  });

  it("schedule-job-add + schedule-gantt finite-capacity places jobs back-to-back", () => {
    call("schedule-job-add", ctxA, { name: "WO-1", resource: "Line A", durationHours: 4, priority: 1 });
    call("schedule-job-add", ctxA, { name: "WO-2", resource: "Line A", durationHours: 3, priority: 2 });
    const g = call("schedule-gantt", ctxA, {});
    assert.equal(g.ok, true);
    assert.equal(g.result.jobs.length, 2);
    assert.ok(Date.parse(g.result.jobs[1].startAt) >= Date.parse(g.result.jobs[0].endAt));
  });

  it("schedule-job-add rejects non-positive duration; reschedule moves a job", () => {
    assert.equal(call("schedule-job-add", ctxA, { name: "X", durationHours: 0 }).ok, false);
    const a = call("schedule-job-add", ctxA, { name: "WO-9", resource: "Line A", durationHours: 2 });
    const r = call("schedule-job-reschedule", ctxA, { jobId: a.result.job.id, resource: "Line B" });
    assert.equal(r.ok, true);
    assert.equal(r.result.job.resource, "Line B");
    assert.equal(call("schedule-job-reschedule", ctxA, { jobId: "nope" }).ok, false);
  });

  it("lot-register + lot-genealogy traces upstream + downstream", () => {
    call("lot-register", ctxA, { lotNumber: "RM-1", material: "Aluminium", kind: "raw_material" });
    call("lot-register", ctxA, { lotNumber: "RM-2", material: "Steel", kind: "raw_material" });
    call("lot-register", ctxA, { lotNumber: "FG-1", material: "Pump", kind: "finished_good", parentLots: ["RM-1", "RM-2"] });
    const gen = call("lot-genealogy", ctxA, { lotNumber: "FG-1" });
    assert.equal(gen.ok, true);
    assert.equal(gen.result.upstream.children.length, 2);
    const up = call("lot-genealogy", ctxA, { lotNumber: "RM-1" });
    assert.equal(up.result.downstream[0].lotNumber, "FG-1");
    assert.equal(call("lots-list", ctxA, { kind: "raw_material" }).result.count, 2);
  });

  it("lot-register rejects duplicates and missing fields", () => {
    call("lot-register", ctxA, { lotNumber: "DUP", material: "M" });
    assert.equal(call("lot-register", ctxA, { lotNumber: "DUP", material: "M" }).ok, false);
    assert.equal(call("lot-register", ctxA, { material: "M" }).ok, false);
  });

  it("andon-raise + andon-update + andon-board tracks response time", () => {
    const a = call("andon-raise", ctxA, { station: "CNC-01", reason: "Coolant low", severity: "high" });
    assert.equal(a.ok, true);
    call("andon-update", ctxA, { alertId: a.result.alert.id, action: "acknowledge" });
    const r = call("andon-update", ctxA, { alertId: a.result.alert.id, action: "resolve" });
    assert.equal(r.result.alert.status, "resolved");
    assert.ok(r.result.alert.responseSeconds != null);
    const board = call("andon-board", ctxA, {});
    assert.equal(board.ok, true);
    assert.equal(board.result.openCount, 0);
  });

  it("andon-raise rejects missing reason; andon-update rejects bad action", () => {
    assert.equal(call("andon-raise", ctxA, {}).ok, false);
    const a = call("andon-raise", ctxA, { reason: "x" });
    assert.equal(call("andon-update", ctxA, { alertId: a.result.alert.id, action: "bogus" }).ok, false);
  });

  it("ncr-create + ncr-advance walks CAPA stages to closed", () => {
    const n = call("ncr-create", ctxA, { title: "Scratch", severity: "major", quantityAffected: 5 });
    assert.equal(n.ok, true);
    assert.match(n.result.ncr.number, /^NCR-\d{4}$/);
    const id = n.result.ncr.id;
    const adv = call("ncr-advance", ctxA, { ncrId: id, rootCause: "Tool wear" });
    assert.equal(adv.result.ncr.stage, "investigation");
    assert.equal(adv.result.ncr.rootCause, "Tool wear");
    const closed = call("ncr-advance", ctxA, { ncrId: id, stage: "closed" });
    assert.equal(closed.result.ncr.stage, "closed");
    assert.ok(closed.result.ncr.closedAt);
    assert.equal(call("ncr-list", ctxA, {}).result.openCount, 0);
  });

  it("ncr-create rejects missing title; ncr-advance rejects bad ids", () => {
    assert.equal(call("ncr-create", ctxA, {}).ok, false);
    assert.equal(call("ncr-advance", ctxA, { ncrId: "nope" }).ok, false);
  });

  it("maintenance-plan-create + complete + schedule annotates due states", () => {
    const p = call("maintenance-plan-create", ctxA, { machineId: "CNC-01", task: "Lube", intervalDays: 30 });
    assert.equal(p.ok, true);
    const sched = call("maintenance-schedule", ctxA, {});
    assert.equal(sched.ok, true);
    assert.equal(sched.result.plans.length, 1);
    assert.ok(["scheduled", "due_soon", "overdue"].includes(sched.result.plans[0].state));
    const done = call("maintenance-complete", ctxA, { planId: p.result.plan.id });
    assert.equal(done.ok, true);
  });

  it("maintenance-plan-create rejects bad interval", () => {
    assert.equal(call("maintenance-plan-create", ctxA, { machineId: "M", task: "T", intervalDays: 0 }).ok, false);
  });

  it("inventory-upsert + allocate + status tracks WIP and reorder", () => {
    const u = call("inventory-upsert", ctxA, { sku: "RM-AL", name: "Aluminium", onHand: 100, reorderPoint: 20, unitCost: 5 });
    assert.equal(u.ok, true);
    const alloc = call("inventory-allocate", ctxA, { sku: "RM-AL", quantity: 30, workOrderId: "WO-1" });
    assert.equal(alloc.ok, true);
    const st = call("inventory-status", ctxA, {});
    assert.equal(st.ok, true);
    assert.equal(st.result.items[0].available, 70);
    assert.equal(st.result.totalValue, 500);
  });

  it("inventory-allocate rejects over-allocation and unknown sku", () => {
    call("inventory-upsert", ctxA, { sku: "LOW", onHand: 5 });
    assert.equal(call("inventory-allocate", ctxA, { sku: "LOW", quantity: 99 }).ok, false);
    assert.equal(call("inventory-allocate", ctxA, { sku: "ghost", quantity: 1 }).ok, false);
  });
});
