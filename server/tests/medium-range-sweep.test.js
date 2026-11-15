import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerForestry from "../domains/forestry.js";
import registerEnergy from "../domains/energy.js";
import registerPlumbing from "../domains/plumbing.js";
import registerMaterials from "../domains/materials.js";
import registerElectrical from "../domains/electrical.js";
import registerCarpentry from "../domains/carpentry.js";
import registerAr from "../domains/ar.js";
import { createBond } from "../lib/civic-bonds.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(domain, name, params) {
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerForestry(register);
  registerEnergy(register);
  registerPlumbing(register);
  registerMaterials(register);
  registerElectrical(register);
  registerCarpentry(register);
  registerAr(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("range sweep", () => {
  it("refuses a blank or over-long stand name and a negative acreage", () => {
    const blank = call("forestry", "stand-add", { name: "   ", acres: 4 });
    assert.equal(blank.ok, false);
    assert.match(blank.message, /Stand name/);
    const long = call("forestry", "stand-add", { name: "n".repeat(300), acres: 4 });
    assert.equal(long.ok, false);
    assert.equal(long.field, "name");
    const acres = call("forestry", "stand-add", { name: "North ridge", acres: -5 });
    assert.equal(acres.ok, false);
    assert.equal(acres.field, "acres");
    const ok = call("forestry", "stand-add", { name: "North ridge", acres: 12 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.stand.acres, 12);
  });

  it("refuses a negative device wattage instead of storing zero", () => {
    const bad = call("energy", "device-add", { name: "Heater", wattage: -50 });
    assert.equal(bad.ok, false);
    assert.equal(bad.field, "wattage");
    const ok = call("energy", "device-add", { name: "Heater", wattage: 1500 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.device.wattage, 1500);
  });

  it("refuses a negative job duration instead of showing 0.5 hours", () => {
    const bad = call("plumbing", "dispatchAssign", { jobTitle: "Leak", durationHours: -1 });
    assert.equal(bad.ok, false);
    assert.equal(bad.field, "durationHours");
    const ok = call("plumbing", "dispatchAssign", { jobTitle: "Leak", durationHours: 2 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.assignment.durationHours, 2);
  });

  it("refuses a civic-bond target of 0 or a negative amount", () => {
    const db = { prepare() { throw new Error("should not insert"); } };
    const zero = createBond(db, { worldId: "w1", title: "Bridge", targetAmount: 0 });
    assert.equal(zero.ok, false);
    assert.equal(zero.field, "targetAmount");
    const negative = createBond(db, { worldId: "w1", title: "Bridge", targetAmount: -5 });
    assert.equal(negative.ok, false);
    assert.match(negative.message, /at least 1/);
  });

  it("refuses a negative material density", () => {
    const bad = call("materials", "shortlist-add", { name: "Lead", density: -2 });
    assert.equal(bad.ok, false);
    assert.equal(bad.field, "density");
    const ok = call("materials", "shortlist-add", { name: "Lead", density: 11.3 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.material.properties.density, 11.3);
  });

  it("refuses a blank or over-long electrical job name", () => {
    const blank = call("electrical", "checklistCreate", { template: "rough_in", jobName: "  " });
    assert.equal(blank.ok, false);
    assert.match(blank.message, /Job name/);
    const long = call("electrical", "checklistCreate", { template: "rough_in", jobName: "j".repeat(200) });
    assert.equal(long.ok, false);
    assert.equal(long.field, "jobName");
    const ok = call("electrical", "checklistCreate", { template: "rough_in", jobName: "123 Oak" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.jobName, "123 Oak");
  });

  it("refuses a zero, negative, or over-long carpentry takeoff line", () => {
    const zero = call("carpentry", "materialTakeoff", { projectName: "Deck", items: [{ name: "cedar", quantity: 0, unitCost: 4 }] });
    assert.equal(zero.ok, false);
    assert.equal(zero.field, "quantity");
    const negative = call("carpentry", "materialTakeoff", { projectName: "Deck", items: [{ name: "cedar", quantity: -5, unitCost: 4 }] });
    assert.equal(negative.ok, false);
    assert.equal(negative.field, "quantity");
    const long = call("carpentry", "materialTakeoff", { projectName: "n".repeat(600), items: [{ name: "cedar", quantity: 2, unitCost: 4 }] });
    assert.equal(long.ok, false);
    assert.equal(long.field, "projectName");
    const ok = call("carpentry", "materialTakeoff", { projectName: "Deck", items: [{ name: "cedar", quantity: 2, unitCost: 4 }] });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.items[0].quantity, 2);
  });

  it("refuses a blank AR scene name", () => {
    const blank = call("ar", "sceneSave", { scene: { name: "   " } });
    assert.equal(blank.ok, false);
    assert.match(blank.message, /Scene name/);
    const ok = call("ar", "sceneSave", { scene: { name: "Lobby" } });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.scene.name, "Lobby");
  });
});
