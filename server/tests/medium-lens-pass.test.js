import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGovernment from "../domains/government.js";
import registerAutomotive from "../domains/automotive.js";
import registerMasonry from "../domains/masonry.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(domain, name, params) {
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerGovernment(register);
  registerAutomotive(register);
  registerMasonry(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("government, automotive, and masonry mediums", () => {
  it("names a permit timeline in weeks and a violation tier", () => {
    const permit = call("government", "permitTimeline", { permitType: "building" });
    assert.equal(permit.ok, true);
    assert.equal(permit.result.benchmark, 30);
    assert.equal(permit.result.estimatedWeeks, 5);
    const violation = call("government", "violationEscalation", { severity: "high" });
    assert.equal(violation.ok, true);
    assert.equal(violation.result.tier, "high");
    assert.match(violation.result.nextStep, /deadline/);
  });

  it("returns a notice subscription after reload", () => {
    const sub = call("government", "notifications-subscribe", {
      subjectKind: "permit", subjectId: "p-1", channel: "email", contact: "ada@example.com",
    });
    assert.equal(sub.ok, true);
    const listed = call("government", "notifications-list", {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.subscriptions.length, 1);
    assert.equal(listed.result.subscriptions[0].subjectId, "p-1");
  });

  it("explains a zero mile span when the only reading is the odometer", () => {
    const vehicle = call("automotive", "vehicles-create", { name: "Wagon", odometer: 65000 });
    assert.equal(vehicle.ok, true);
    const id = vehicle.result.vehicle.id;
    const alone = call("automotive", "cost-of-ownership", { vehicleId: id });
    assert.equal(alone.result.milesTracked, 0);
    assert.match(alone.result.note, /65000/);
    const fill = call("automotive", "fuel-log", { vehicleId: id, odometer: 60000, volume: 10, totalCost: 40 });
    assert.equal(fill.ok, true);
    const spanned = call("automotive", "cost-of-ownership", { vehicleId: id });
    assert.equal(spanned.result.milesTracked, 5000);
  });

  it("removes a job's inspections when the job is deleted", () => {
    const job = call("masonry", "schedule-add", { title: "North wall", startDate: "2026-06-01" });
    assert.equal(job.ok, true);
    const inspection = call("masonry", "inspection-add", {
      jobId: job.result.id, inspectionType: "final_walkthrough", inspector: "Ada", scheduledDate: "2026-06-02",
    });
    assert.equal(inspection.ok, true);
    const removed = call("masonry", "schedule-delete", { id: job.result.id });
    assert.equal(removed.ok, true);
    assert.equal(removed.result.removedInspections, 1);
    assert.equal(call("masonry", "inspection-list", {}).result.inspections.length, 0);
  });
});
