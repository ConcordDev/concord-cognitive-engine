import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFitness from "../domains/fitness.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params) {
  return ACTIONS.get(`fitness.${name}`)(
    { actor: { userId: "user_a" } },
    { id: null, data: {}, meta: {} },
    params,
  );
}
before(() => { registerFitness(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("fitness HRV delete", () => {
  it("removes one HRV sample and leaves the others", () => {
    const a = call("hrv-log", { rmssd: 40, date: "2026-06-01" });
    const b = call("hrv-log", { rmssd: 55, date: "2026-06-02" });
    assert.equal(a.ok, true);
    const removed = call("hrv-delete", { id: a.result.sample.id });
    assert.equal(removed.ok, true);
    const status = call("hrv-status", {});
    assert.equal(status.result.recent.length, 1);
    assert.equal(status.result.recent[0].id, b.result.sample.id);
  });
});
