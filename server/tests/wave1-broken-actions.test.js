// Hermetic pins for wave-1 broken-action honesty.
// A wrong-typed collection or an unsupported conversion must come back as
// invalid_input, with no "is not a function" / handler_error text.
// Does not boot server.js (this worktree skip-worktrees scripts/scaffold-world.mjs).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerMaterials from "../domains/materials.js";
import registerFood from "../domains/food.js";
import registerEngineering from "../domains/engineering.js";
import registerChem from "../domains/chem.js";
import registerElectrical from "../domains/electrical.js";
import { createThreatDTU } from "../lib/concord-shield.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
registerMaterials(register);
registerFood(register);
registerEngineering(register);
registerChem(register);
registerElectrical(register);

const ctx = { actor: { userId: "wave1" }, userId: "wave1" };
function call(key, data = {}, params = {}) {
  return ACTIONS.get(key)(ctx, { id: "a", data, meta: {} }, params);
}

describe("wave1 broken actions — honest invalid_input", () => {
  it("materials non-string material is invalid_input, not a leaked TypeError", () => {
    for (const name of ["fractographyAnalysis", "fractographyRootCause", "corrosionRisk"]) {
      const r = call(`materials.${name}`, { material: 12345 });
      assert.equal(r.ok, false, name);
      assert.equal(r.error, "invalid_input", name);
      assert.equal(r.reason, "type_error", name);
      assert.equal(JSON.stringify(r).includes("is not a function"), false, name);
    }
  });

  it("food.costPlate empty or non-array menu is invalid_input", () => {
    const empty = call("food.costPlate", { menuItems: [] });
    assert.equal(empty.ok, false);
    assert.equal(empty.error, "invalid_input");
    assert.equal(empty.reason, "no_menu_items");
    const bad = call("food.costPlate", { menuItems: 5 });
    assert.equal(bad.error, "invalid_input");
    assert.equal(bad.reason, "not_a_function");
  });

  it("engineering.unitConvert refuses an unsupported pair and a non-string unit", () => {
    const bad = call("engineering.unitConvert", {}, { value: 1, from: "mm", to: "kg" });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_input");
    assert.equal(bad.reason, "unsupported_conversion");
    const typed = call("engineering.unitConvert", {}, { value: 1, from: 1, to: "in" });
    assert.equal(typed.error, "invalid_input");
    assert.equal(typed.reason, "type_error");
    const ok = call("engineering.unitConvert", {}, { value: 25.4, from: "mm", to: "in" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.output, "1 in");
  });

  it("chem.parse-smiles does not leak a parser TypeError", () => {
    const r = call("chem.parse-smiles", {}, { smiles: "1CC" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.equal(r.reason, "invalid_smiles");
    assert.equal(JSON.stringify(r).includes("bonds"), false);
  });

  it("electrical.conduitFill rejects a non-array conductor list", () => {
    const r = call("electrical.conduitFill", { conductors: 10 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.equal(r.reason, "not_a_function");
  });

  it("createThreatDTU accepts a non-array behavior without throwing", () => {
    const dtu = createThreatDTU({ subtype: "virus", severity: 5, behavior: "not-a-list" });
    assert.equal(Array.isArray(dtu.behavior), true);
    assert.equal(dtu.behavior.length, 0);
  });
});
