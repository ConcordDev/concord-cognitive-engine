// Contract tests for the periodic-table element browser macros in
// server/domains/materials.js (materials.element-list / element-detail)
// and the curated dataset they read from (server/lib/periodic-table-data.js).
//
// Spot-checks a handful of well-known exact published constants (IUPAC
// standard atomic weights, CRC melting/boiling points) rather than
// trusting the dataset blindly, per the "compute-don't-guess" /
// "honest by construction" invariants in CLAUDE.md.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerMaterialsActions from "../domains/materials.js";
import { ELEMENTS } from "../lib/periodic-table-data.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  const fn = ACTIONS.get(`materials.${name}`);
  assert.ok(fn, `materials.${name} not registered`);
  return fn({}, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMaterialsActions(register); });

describe("periodic-table-data.js dataset integrity", () => {
  it("has exactly 118 elements, all with a unique atomic number and symbol", () => {
    assert.equal(ELEMENTS.length, 118);
    assert.equal(new Set(ELEMENTS.map((e) => e.z)).size, 118);
    assert.equal(new Set(ELEMENTS.map((e) => e.symbol)).size, 118);
    // Contiguous 1..118, no gaps or duplicates.
    const sorted = [...ELEMENTS.map((e) => e.z)].sort((a, b) => a - b);
    for (let i = 0; i < 118; i++) assert.equal(sorted[i], i + 1);
  });

  it("Hydrogen matches published constants (IUPAC/NIST)", () => {
    const h = ELEMENTS.find((e) => e.symbol === "H");
    assert.equal(h.z, 1);
    assert.equal(h.name, "Hydrogen");
    assert.equal(h.standardAtomicWeight, 1.008);
    assert.equal(h.group, 1);
    assert.equal(h.period, 1);
  });

  it("Carbon matches published constants and has an honest null melting point", () => {
    const c = ELEMENTS.find((e) => e.symbol === "C");
    assert.equal(c.z, 6);
    assert.equal(c.name, "Carbon");
    assert.equal(c.standardAtomicWeight, 12.011);
    // Carbon sublimes/decomposes at 1 atm rather than having a
    // conventional melting point there — null is the honest value,
    // not a missing-data bug.
    assert.equal(c.meltingPointC, null);
  });

  it("Gold matches published density/melting-point constants", () => {
    const au = ELEMENTS.find((e) => e.symbol === "Au");
    assert.equal(au.z, 79);
    assert.equal(au.name, "Gold");
    assert.ok(Math.abs(au.density - 19.3) < 0.1, `density ${au.density} should be ~19.3 g/cm3`);
    assert.ok(Math.abs(au.meltingPointC - 1064.18) < 0.5, `melting point ${au.meltingPointC} should be ~1064.18C`);
    assert.equal(au.densityUnit, "g/cm3");
  });

  it("Iron matches published density/melting-point constants", () => {
    const fe = ELEMENTS.find((e) => e.symbol === "Fe");
    assert.equal(fe.z, 26);
    assert.ok(Math.abs(fe.density - 7.874) < 0.05);
    assert.ok(Math.abs(fe.meltingPointC - 1538) < 2);
  });

  it("gas-phase elements report density in g/L, not g/cm3", () => {
    const he = ELEMENTS.find((e) => e.symbol === "He");
    assert.equal(he.phase, "Gas");
    assert.equal(he.densityUnit, "g/L (gas, 0C 1atm)");
    assert.ok(he.density < 1, "gas density in g/L should be well under 1");
  });

  it("Technetium has no standard atomic weight — mass number of longest-lived isotope instead", () => {
    const tc = ELEMENTS.find((e) => e.symbol === "Tc");
    assert.equal(tc.standardAtomicWeight, null);
    assert.equal(tc.massNumberOfLongestLivedIsotope, 98);
  });

  it("Uranium (naturally occurring radioactive) DOES have a conventional standard atomic weight", () => {
    const u = ELEMENTS.find((e) => e.symbol === "U");
    assert.ok(u.standardAtomicWeight != null, "Uranium has a conventional IUPAC atomic weight despite being radioactive");
    assert.ok(Math.abs(u.standardAtomicWeight - 238.0289) < 0.01);
    assert.equal(u.massNumberOfLongestLivedIsotope, null);
  });

  it("superheavy elements Z>=104 have null bulk physical properties (never isolated in weighable quantity)", () => {
    const superheavy = ELEMENTS.filter((e) => e.z >= 104);
    assert.equal(superheavy.length, 15);
    for (const e of superheavy) {
      assert.equal(e.density, null, `${e.symbol} density should be null`);
      assert.equal(e.meltingPointC, null, `${e.symbol} meltingPointC should be null`);
      assert.equal(e.boilingPointC, null, `${e.symbol} boilingPointC should be null`);
      assert.equal(e.unmeasuredBulkProperties, true);
      // None of them invented a standard atomic weight either.
      assert.equal(e.standardAtomicWeight, null);
      assert.ok(Number.isInteger(e.massNumberOfLongestLivedIsotope));
    }
  });

  it("no element has an invented/fabricated placeholder value like 0 or -1 standing in for null", () => {
    for (const e of ELEMENTS) {
      if (e.density != null) assert.ok(e.density > 0, `${e.symbol} density must be a real positive number or null`);
      if (e.standardAtomicWeight != null) assert.ok(e.standardAtomicWeight > 0, `${e.symbol} atomic weight must be real or null`);
    }
  });
});

describe("materials.element-list", () => {
  it("returns all 118 curated elements", () => {
    const r = call("element-list", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 118);
    assert.equal(r.result.totalElements, 118);
    assert.equal(r.result.elements.length, 118);
  });

  it("each element carries a derived categoryGroup", () => {
    const r = call("element-list", {});
    for (const e of r.result.elements) {
      assert.ok(typeof e.categoryGroup === "string" && e.categoryGroup.length > 0);
    }
  });

  it("filters by category group", () => {
    const r = call("element-list", { category: "noble-gas" });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 6); // He, Ne, Ar, Kr, Xe, Rn (+ Og predicted)
    for (const e of r.result.elements) assert.equal(e.categoryGroup, "noble-gas");
  });

  it("filters by period", () => {
    const r = call("element-list", { period: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2); // H, He
  });

  it("filters by block", () => {
    const r = call("element-list", { block: "f" });
    assert.equal(r.ok, true);
    // La..Yb (14) + Ac..No (14) = 28. This dataset places Lu and Lr in the
    // d-block (the CAS/historical convention) rather than f-block — the
    // La-vs-Lu group-3 placement is a genuine, still-debated question in
    // the literature, not a defect; 28 is what this cited source uses.
    assert.equal(r.result.count, 28);
  });
});

describe("materials.element-detail", () => {
  it("returns a known element by symbol with real properties preserved", () => {
    const r = call("element-detail", { symbol: "Au" });
    assert.equal(r.ok, true);
    assert.equal(r.result.element.name, "Gold");
    assert.equal(r.result.element.z, 79);
    assert.ok(r.result.element.density > 0);
  });

  it("returns a known element by atomic number", () => {
    const r = call("element-detail", { z: 6 });
    assert.equal(r.ok, true);
    assert.equal(r.result.element.symbol, "C");
  });

  it("preserves null for a genuinely unmeasured superheavy element instead of zeroing it", () => {
    const r = call("element-detail", { symbol: "Og" });
    assert.equal(r.ok, true);
    assert.equal(r.result.element.name, "Oganesson");
    assert.equal(r.result.element.density, null);
    assert.equal(r.result.element.meltingPointC, null);
    assert.equal(r.result.element.unmeasuredBulkProperties, true);
    // The dataset must not silently fall back to 0 for a missing value —
    // that would read as "measured zero density" and be a fabrication.
    assert.notEqual(r.result.element.density, 0);
  });

  it("returns a convenience pointer to the real mp-search macro, not a duplicate MP client", () => {
    const r = call("element-detail", { symbol: "Si" });
    assert.equal(r.ok, true);
    assert.equal(r.result.findMaterials.macro, "materials.mp-search");
    assert.deepEqual(r.result.findMaterials.params, { elements: ["Si"] });
  });

  it("rejects an unknown element without fabricating one", () => {
    const r = call("element-detail", { symbol: "Xx" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown element/);
  });

  it("rejects when no query is supplied", () => {
    const r = call("element-detail", {});
    assert.equal(r.ok, false);
  });
});
