import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHealth from "../domains/healthcare.js";
import registerSelf from "../domains/self.js";
import registerBlack from "../domains/black-market.js";
import registerMarketing from "../domains/marketing.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function call(domain, name, params = {}) {
  const fn = actions.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name}`);
  return fn({ actor: { userId: "owner" }, userId: "owner" }, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerHealth(register);
  registerSelf(register);
  registerBlack(register);
  registerMarketing(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("high guards", () => {
  it("removes a patient the owner created", () => {
    const patient = call("healthcare", "patients-create", { firstName: "Ada", lastName: "Lovelace" }).result.patient;
    assert.equal(call("healthcare", "patients-delete", { id: patient.id }).result.deleted, patient.id);
    assert.equal(call("healthcare", "patients-list", {}).result.patients.length, 0);
  });

  it("refuses an empty, negative, or absurd self reading and deletes a real one", () => {
    assert.equal(call("self", "logMetric", { metric: "weight_kg", value: "" }).ok, false);
    assert.equal(call("self", "logMetric", { metric: "weight_kg", value: -1 }).ok, false);
    assert.equal(call("self", "logMetric", { metric: "weight_kg", value: 999999 }).ok, false);
    const reading = call("self", "logMetric", { metric: "weight_kg", value: 70 }).result.reading;
    assert.equal(call("self", "reading-delete", { id: reading.id }).result.deleted, reading.id);
    assert.equal(call("self", "readings", {}).result.count, 0);
  });

  it("refuses a negative auction bid and a year-long duration", () => {
    const base = { title: "Note", preview: "a", payload: "b" };
    assert.equal(call("black-market", "auction-create", { ...base, minBid: -5 }).ok, false);
    assert.equal(call("black-market", "auction-create", { ...base, durationMin: 999999 }).ok, false);
    assert.equal(call("black-market", "auction-create", { ...base, minBid: 10, durationMin: 30 }).ok, true);
  });

  it("refuses a negative or alphabetic campaign budget", () => {
    assert.equal(call("marketing", "campaign-create", { name: "A", budget: -20 }).ok, false);
    assert.equal(call("marketing", "campaign-create", { name: "B", budget: "abc" }).ok, false);
    assert.equal(call("marketing", "campaign-create", { name: "C", budget: 40 }).result.campaign.budget, 40);
  });
});
