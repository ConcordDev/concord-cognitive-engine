import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLogistics from "../domains/logistics.js";
import registerAccounting from "../domains/accounting.js";
import registerOcean from "../domains/ocean.js";
import registerMarkets from "../domains/markets.js";
import registerObserve from "../domains/observe.js";
import registerVote from "../domains/vote.js";
import registerAgriculture from "../domains/agriculture.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(domain, name, params, artifact) {
  return actions.get(`${domain}.${name}`)(ctx, artifact || { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerLogistics(register);
  registerAccounting(register);
  registerOcean(register);
  registerMarkets(register);
  registerObserve(register);
  registerVote(register);
  registerAgriculture(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("silent validation messages", () => {
  it("refuses a bad fleet vehicle and a non-positive load weight", () => {
    assert.match(call("logistics", "fleet-vehicles-add", { number: "T", capacityLbs: -5 }).message, /Capacity/);
    assert.match(call("logistics", "fleet-vehicles-add", { number: "T", year: 99999 }).message, /Year/);
    const ok = call("logistics", "fleet-vehicles-add", { number: "T-1", capacityLbs: 1000, year: 2020 });
    assert.equal(ok.ok, true);
    assert.match(call("logistics", "loads-post", { origin: "A", destination: "B", ratePerMile: 2, weightLbs: -5 }).message, /Weight/);
    assert.equal(call("logistics", "loads-post", { origin: "", destination: "B", ratePerMile: 2, weightLbs: 10 }).ok, false);
  });

  it("refuses a blank customer and a non-positive invoice total", () => {
    assert.match(call("accounting", "invoice-create", { customerName: "  ", total: 10 }).message, /Customer/);
    assert.match(call("accounting", "invoice-create", { customerName: "Ada", total: -1 }).message, /Total/);
    assert.equal(call("accounting", "invoice-create", { customerName: "Ada", total: 25 }).ok, true);
  });

  it("refuses a spot name longer than 160 characters", () => {
    const long = call("ocean", "spot-add", { name: "n".repeat(300) });
    assert.equal(long.ok, false);
    assert.match(long.message, /160/);
    assert.equal(call("ocean", "spot-add", { name: "Mavericks" }).ok, true);
  });

  it("refuses a negative market stake instead of creating the market", () => {
    const bad = call("markets", "market-create", {
      question: "Will it rain tomorrow?", resolutionCriteria: "A weather station reports rain.", seedSparks: -5,
    });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /Stake/);
  });

  it("refuses a non-numeric monitor threshold", () => {
    const bad = call("observe", "monitorSave", { metric: "cpu", threshold: "abc" });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /Threshold/);
    assert.equal(call("observe", "monitorSave", { metric: "cpu", threshold: 90 }).ok, true);
  });

  it("refuses a negative poll duration and quorum", () => {
    const base = { title: "Budget", options: ["yes", "no"] };
    assert.match(call("vote", "poll-create", { ...base, durationDays: -5 }).message, /Duration/);
    assert.match(call("vote", "poll-create", { ...base, quorum: -1 }).message, /Quorum/);
    const ok = call("vote", "poll-create", { ...base, durationDays: 7, quorum: 1 });
    assert.equal(ok.ok, true);
    assert.ok(ok.result.poll.deadline);
  });

  it("refuses a negative harvest yield", () => {
    const field = call("agriculture", "field-create", { name: "North", acreage: 40 });
    assert.equal(field.ok, true);
    const bad = call("agriculture", "harvest-log", {
      fieldId: field.result.field.id, crop: "corn", acresHarvested: 10, yieldBushels: -5,
    });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /Yield/);
  });

});
