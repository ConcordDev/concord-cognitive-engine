// server/tests/conkay-knowledge-extensions.test.js
// Q43/A#29 — the eleven discipline extensions beyond materials were
// stubs ("stored but not validated"). Each now has a real schema +
// rules. One well-formed and one malformed payload per discipline,
// plus the cross-field rules.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateExtensions, listExtensions } from "../lib/conkay/knowledge/extensions/index.js";

const v = (extensions) => validateExtensions({ extensions });

const VALID = {
  chemistry: { formula: "CaCO3", phase: "solid", identifiers: { cas: "471-34-1", inchiKey: "VTYYLEPIYHJVHJ-UHFFFAOYSA-K" }, stoichiometry: [{ species: "CaCO3", coefficient: 1 }], purity: { value: 99.5, unit: "%" } },
  fluids: { basis: "mole", composition: [{ component: "water", fraction: 0.7 }, { component: "ethanol", fraction: 0.3 }], density: { value: 950, unit: "kg/m3" } },
  recipes: { quantities: [{ ingredient: "flour", amount: { value: 500, unit: "g" } }], yield: { value: 1, unit: "loaf" }, testedAs: "culinary", allergens: ["gluten"] },
  engineering: { materials: ["steel"], dimensions: { length: { value: 2, unit: "m" } }, loads: [{ name: "live", magnitude: { value: 5, unit: "kN" } }], standards: ["EN 1993"] },
  math: { equations: ["y = m*x + b"], variables: [{ name: "m", definition: "slope", unit: null }], tolerance: 1e-6 },
  electronics: { componentType: "resistor", ratings: { voltage: { value: 50, unit: "V" }, power: { value: 0.25, unit: "W" } } },
  biology: { organism: "Quercus robur", taxonomy: { kingdom: "Plantae", species: "Q. robur" }, traits: ["deciduous"] },
  energy: { systemType: "storage", capacity: { value: 10, unit: "kWh" }, efficiency: 0.92 },
  agriculture: { cropOrLivestock: "maize", soilType: "loam", yieldPerArea: { value: 8, unit: "t/ha" } },
  geology: { rockType: "sedimentary", mineralComposition: ["calcite"], ageMa: 120 },
  software: { language: "JavaScript", runtime: "node", license: "MIT", dependencies: [] },
};

describe("discipline extensions validate (Q43)", () => {
  it("all extensions report implemented", () => {
    for (const e of listExtensions()) assert.equal(e.status, "implemented", e.name);
  });

  for (const [name, data] of Object.entries(VALID)) {
    it(`${name}: a well-formed record passes with no errors or warnings`, () => {
      const r = v({ [name]: data });
      assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
      assert.deepEqual(r.warnings, []);
    });

    it(`${name}: an unknown field is an error, not a warning`, () => {
      const r = v({ [name]: { ...data, definitelyNotAField: 1 } });
      assert.ok(r.errors.some((e) => /unexpected property/.test(e)), JSON.stringify(r));
      assert.deepEqual(r.warnings, []);
    });
  }

  it("cross-field rules fire: fluids fractions, chemistry coefficients, math duplicate variables, recipes yield", () => {
    assert.ok(v({ fluids: { composition: [{ component: "a", fraction: 0.8 }, { component: "b", fraction: 0.5 }] } }).errors.some((e) => /sum/.test(e)));
    assert.ok(v({ chemistry: { stoichiometry: [{ species: "H2", coefficient: 0 }] } }).errors.some((e) => /coefficient/.test(e)));
    assert.ok(v({ chemistry: { purity: { value: 140, unit: "%" } } }).errors.some((e) => /purity/.test(e)));
    assert.ok(v({ math: { variables: [{ name: "x" }, { name: "x" }] } }).errors.some((e) => /twice/.test(e)));
    assert.ok(v({ recipes: { yield: { value: 0, unit: "loaf" } } }).errors.some((e) => /yield/.test(e)));
    assert.ok(v({ energy: { efficiency: 1.4 } }).errors.some((e) => /efficiency/.test(e)), "efficiency range is schema-enforced");
    assert.ok(v({ chemistry: { identifiers: { cas: "not-a-cas" } } }).errors.some((e) => /identifiers/.test(e)), "CAS pattern enforced (anyOf shape failure at the identifiers path)");
  });
});
