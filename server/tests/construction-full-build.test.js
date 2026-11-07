// server/tests/construction-full-build.test.js
// Construction full lens build (GB-1088 wave 1) — Review 5's findings:
// F2 the CPM computed in insertion order, so a task entered before its
// dependency silently produced a wrong duration/critical path; F5 the
// takeoff's waste was folded with no figure anywhere; F9 an "approved"
// submittal review landed as status "closed" and the punch Open counter
// counted only the literal "open" status.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let registerConstructionActions;
before(async () => {
  ({ default: registerConstructionActions } = await import("../domains/construction.js"));
});

function harness() {
  const actions = {};
  registerConstructionActions((domain, name, fn) => { actions[`${domain}.${name}`] = fn; });
  return actions;
}
const ctx = { actor: { userId: "gc-1" }, userId: "gc-1" };
function call(actions, name, data) {
  return actions[`construction.${name}`](ctx, { data: data || {} }, data || {});
}

describe("construction full build — F2 CPM is entry-order independent", () => {
  it("schedules every task and finds the true critical path when the dependent task is entered FIRST", () => {
    const a = harness();
    // Review 5's fixture, in the order the pass entered it: the dependent
    // task (Foundation) ahead of its dependency (Excavation).
    const r = call(a, "criticalPath", { tasks: [
      { name: "Foundation", duration: 10, dependencies: ["Excavation"] },
      { name: "Excavation", duration: 5, dependencies: [] },
      { name: "Permits", duration: 3, dependencies: [] },
    ] });
    assert.equal(r.ok, true);
    assert.equal(r.result.projectDuration, 15, "Excavation 5d -> Foundation 10d = 15 days");
    assert.deepEqual(r.result.criticalPath, ["Excavation", "Foundation"]);
    assert.equal(r.result.criticalTaskCount, 2);
    assert.equal(r.result.tasks.length, 3, "every entered task has a schedule row, Foundation included");
    const f = r.result.tasks.find(t => t.name === "Foundation");
    assert.equal(f.earlyStart, 5);
    assert.equal(f.earlyFinish, 15);
    assert.equal(f.onCriticalPath, true);
  });

  it("gives the same answer in dependency-first order (no regression)", () => {
    const a = harness();
    const r = call(a, "criticalPath", { tasks: [
      { name: "Excavate", duration: 5, dependencies: [] },
      { name: "Foundation", duration: 10, dependencies: ["Excavate"] },
      { name: "Framing", duration: 15, dependencies: ["Foundation"] },
    ] });
    assert.equal(r.result.projectDuration, 30);
    assert.deepEqual(r.result.criticalPath, ["Excavate", "Foundation", "Framing"]);
  });

  it("ganttSchedule shares the computation — same duration, every bar dated", () => {
    const a = harness();
    const r = call(a, "ganttSchedule", { tasks: [
      { name: "Foundation", duration: 10, dependencies: ["Excavation"] },
      { name: "Excavation", duration: 5, dependencies: [] },
    ], startDate: "2026-11-02" });
    assert.equal(r.ok, true);
    assert.equal(r.result.projectDuration, 15);
    assert.equal(r.result.bars.length, 2);
    const f = r.result.bars.find(b => b.name === "Foundation");
    assert.equal(f.startDate, "2026-11-07");
    assert.equal(f.endDate, "2026-11-17");
  });

  it("refuses a dependency cycle honestly instead of printing a wrong schedule", () => {
    const a = harness();
    const r = call(a, "criticalPath", { tasks: [
      { name: "A", duration: 2, dependencies: ["B"] },
      { name: "B", duration: 2, dependencies: ["A"] },
    ] });
    assert.equal(r.ok, false);
    assert.match(r.error, /cycle/);
  });
});

describe("construction full build — F3/F5 contracts", () => {
  it("progressReport returns every entered phase with computed overall figures", () => {
    const a = harness();
    const r = call(a, "progressReport", { phases: [
      { name: "Foundation", plannedPercent: 50, actualPercent: 25 },
      { name: "Framing", plannedPercent: 20, actualPercent: 20 },
    ] });
    assert.equal(r.result.phases.length, 2, "the first phase renders too");
    assert.equal(r.result.phases[0].phase, "Foundation");
    assert.equal(r.result.overallPlannedPercent, 35);
    assert.equal(r.result.overallActualPercent, 23);
    assert.equal(r.result.projectStatus, "significant-delay");
  });

  it("takeoff shows waste as a figure and costs quantity-with-waste × rate exactly", () => {
    const a = harness();
    const r = call(a, "takeoffEstimate", { lineItems: [
      { description: "Concrete", quantity: 1.23, unit: "cy", unitCost: 150, wastePercent: 10 },
    ] });
    const line = r.result.lineItems[0];
    assert.equal(line.wasteQuantity, 0.12, "10% of 1.23, shown not folded");
    assert.equal(line.lineCost, 202.95, "1.353 × $150 exactly (Review 5's verified figure)");
    assert.equal(r.result.subtotalMaterials, 202.95);
    assert.ok(r.result.grandTotal > 0, "the result carries the grand total the panel prints");
  });
});

describe("construction full build — F9 status words and counters", () => {
  it("an approved submittal review lands with the verdict as its status", () => {
    const a = harness();
    globalThis._concordSTATE = {};
    const c = call(a, "submittal-create", { title: "Steel", specSection: "05 12 00" });
    const ok = call(a, "submittal-review", { id: c.result.submittal.id, action: "approved" });
    assert.equal(ok.result.submittal.status, "approved");
    const noted = call(a, "submittal-create", { title: "Glass", specSection: "08 00 00" });
    const an = call(a, "submittal-review", { id: noted.result.submittal.id, action: "approved_as_noted" });
    assert.equal(an.result.submittal.status, "approved_as_noted");
  });

  it("the punch Open counter counts in-progress work as outstanding", () => {
    const a = harness();
    globalThis._concordSTATE = {};
    const one = call(a, "punch-add", { description: "Paint scuff" });
    call(a, "punch-add", { description: "Trim gap" });
    call(a, "punch-update", { id: one.result.item.id, status: "in_progress" });
    const list = call(a, "punch-list", {});
    assert.equal(list.result.total, 2);
    assert.equal(list.result.inProgress, 1);
    assert.equal(list.result.open, 2, "open + in-progress are both outstanding work");
  });
});
