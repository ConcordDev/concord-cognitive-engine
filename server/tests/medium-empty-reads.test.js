import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFitness from "../domains/fitness.js";
import registerStudio from "../domains/studio.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(domain, name, params) {
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerFitness(register);
  registerStudio(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("empty reads stay successful", () => {
  it("returns an empty VO2max and race prediction when no run is logged", () => {
    const vo2 = call("fitness", "vo2max-estimate", {});
    assert.equal(vo2.ok, true);
    assert.equal(vo2.result.empty, true);
    assert.equal(vo2.result.vo2max, null);
    const race = call("fitness", "race-predictor", {});
    assert.equal(race.ok, true);
    assert.equal(race.result.empty, true);
    assert.deepEqual(race.result.predictions, []);
  });

  it("returns no collaborators when a studio session has not been started", () => {
    const presence = call("studio", "collab-presence", { projectId: "missing" });
    assert.equal(presence.ok, true);
    assert.equal(presence.result.session, null);
    assert.deepEqual(presence.result.collaborators, []);
  });
});
