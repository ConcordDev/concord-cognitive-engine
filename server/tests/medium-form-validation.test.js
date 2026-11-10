import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBounties from "../domains/bounties.js";
import registerClassroom from "../domains/classroom.js";
import registerObserve from "../domains/observe.js";
import registerSandbox from "../domains/sandbox.js";
import registerSubWorlds from "../domains/sub-worlds.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(domain, name, params) {
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerBounties(register);
  registerClassroom(register);
  registerObserve(register);
  registerSandbox(register);
  registerSubWorlds(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("form validation sweep", () => {
  it("refuses a bounty reward of 0, a negative, or letters", () => {
    const base = { title: "Find the leak", description: "A real leak in the north pipe run." };
    const zero = call("bounties", "create", { ...base, rewardCc: 0 });
    assert.equal(zero.ok, false);
    assert.match(`${zero.field || ""} ${zero.error || ""}`, /rewardCc/);
    const negative = call("bounties", "create", { ...base, rewardCc: -5 });
    assert.equal(negative.ok, false);
    assert.match(`${negative.field || ""} ${negative.error || ""}`, /rewardCc/);
    const letters = call("bounties", "create", { ...base, rewardCc: "abc" });
    assert.equal(letters.ok, false);
    const ok = call("bounties", "create", { ...base, rewardCc: 25 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.bounty.rewardCc, 25);
  });

  it("refuses assignment points outside 0 to 1000", () => {
    const bad = call("classroom", "assignment-create", { title: "Quiz", cohortId: 1, points: -5 });
    assert.equal(bad.ok, false);
    assert.equal(bad.field, "points");
    const blank = call("classroom", "assignment-create", { title: "   ", cohortId: 1 });
    assert.equal(blank.ok, false);
    assert.match(blank.message, /title/);
    const ok = call("classroom", "assignment-create", { title: "Quiz", cohortId: 1, points: 10 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.assignment.points, 10);
  });

  it("refuses a blank or over-long dashboard title instead of naming it Untitled", () => {
    const blank = call("observe", "dashboardSave", { title: "   " });
    assert.equal(blank.ok, false);
    assert.match(blank.message, /title/i);
    const long = call("observe", "dashboardSave", { title: "d".repeat(200) });
    assert.equal(long.ok, false);
    assert.equal(long.field, "title");
    const ok = call("observe", "dashboardSave", { title: "Latency" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.dashboard.title, "Latency");
  });

  it("refuses an empty loadout name instead of saving Fist loadout", () => {
    const blank = call("sandbox", "saveLoadout", { name: "  ", weaponId: "fist", skillId: "none" });
    assert.equal(blank.ok, false);
    assert.match(blank.message, /Loadout name/);
    const ok = call("sandbox", "saveLoadout", { name: "Training", weaponId: "fist", skillId: "none" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.loadout.name, "Training");
  });

  it("refuses a sub-world capacity outside 1 to 200 instead of clamping it", () => {
    const negative = call("sub_worlds", "spawn", { name: "North hall", capacity: -5 });
    assert.equal(negative.ok, false);
    assert.equal(negative.field, "capacity");
    const huge = call("sub_worlds", "spawn", { name: "North hall", capacity: 99999 });
    assert.equal(huge.ok, false);
    const ok = call("sub_worlds", "spawn", { name: "North hall", capacity: 24 });
    assert.equal(ok.ok, true);
    const id = ok.result.world?.world_id || ok.result.world_id;
    assert.equal((ok.result.world || ok.result).capacity, 24);
    const updated = call("sub_worlds", "update_settings", { worldId: id, capacity: 0 });
    assert.equal(updated.ok, false);
  });
});
