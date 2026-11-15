import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMasonry from "../domains/masonry.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(name, params) {
  return actions.get(`masonry.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMasonry(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("masonry records can be updated in place", () => {
  it("updates a saved takeoff when the same id is saved again", () => {
    const created = call("takeoff-save", {
      name: "North wall", material: "brick", wastePct: 5,
      segments: [{ label: "Wall", lengthFeet: 20, heightFeet: 8 }],
    });
    assert.equal(created.ok, true);
    const updated = call("takeoff-save", {
      id: created.result.id, name: "North wall revised", material: "brick", wastePct: 5,
      segments: [{ label: "Wall", lengthFeet: 24, heightFeet: 8 }],
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.id, created.result.id);
    assert.equal(updated.result.name, "North wall revised");
    assert.equal(call("takeoff-list", {}).result.takeoffs.length, 1);
  });

  it("updates a scheduled job when the same id is saved again", () => {
    const created = call("schedule-add", { title: "Pour", startDate: "2026-06-01", durationDays: 2 });
    assert.equal(created.ok, true);
    const updated = call("schedule-add", { id: created.result.id, title: "Pour revised", startDate: "2026-06-03", durationDays: 3 });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.title, "Pour revised");
    assert.equal(call("schedule-list", {}).result.jobs.length, 1);
  });
});
