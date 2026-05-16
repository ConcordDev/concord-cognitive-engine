import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerChemActions from "../domains/chem.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`chem.${name}`);
  if (!fn) throw new Error(`chem.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerChemActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("chem — periodic table", () => {
  it("returns the seeded elements map", () => {
    const r = call("periodic-table", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.count > 60);
    assert.equal(r.result.elements.H.name, "Hydrogen");
  });
});

describe("chem — molecular weight", () => {
  it("computes H2O", () => {
    const r = call("molecular-weight", ctxA, { formula: "H2O" });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.molecularWeight - 18.015) < 0.01);
  });

  it("computes glucose C6H12O6", () => {
    const r = call("molecular-weight", ctxA, { formula: "C6H12O6" });
    assert.ok(Math.abs(r.result.molecularWeight - 180.156) < 0.5);
  });

  it("handles parentheses Ca(OH)2", () => {
    const r = call("molecular-weight", ctxA, { formula: "Ca(OH)2" });
    assert.ok(Math.abs(r.result.molecularWeight - 74.093) < 0.5);
  });

  it("percent composition sums to ~100%", () => {
    const r = call("molecular-weight", ctxA, { formula: "NaCl" });
    const total = r.result.components.reduce((s, c) => s + c.percentMass, 0);
    assert.ok(Math.abs(total - 100) < 0.1);
  });

  it("rejects unknown element", () => {
    const r = call("molecular-weight", ctxA, { formula: "Xx2" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown element/);
  });

  it("rejects empty formula", () => {
    const r = call("molecular-weight", ctxA, { formula: "" });
    assert.equal(r.ok, false);
    assert.match(r.error, /formula required/);
  });
});

describe("chem — molarity calculator", () => {
  it("computes M from moles + liters", () => {
    const r = call("calc-molarity", ctxA, { moles: 0.5, liters: 1 });
    assert.equal(r.result.molarity, 0.5);
  });

  it("computes liters from moles + M", () => {
    const r = call("calc-molarity", ctxA, { moles: 1, molarity: 0.5 });
    assert.equal(r.result.liters, 2);
  });

  it("rejects 1 input (need 2)", () => {
    const r = call("calc-molarity", ctxA, { moles: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /exactly 2/);
  });
});

describe("chem — dilution M1V1=M2V2", () => {
  it("solves for v1 when other 3 given", () => {
    const r = call("calc-dilution", ctxA, { m1: 1, m2: 0.1, v2: 100 });
    assert.equal(r.result.v1, 10);
  });

  it("rejects 4 inputs (need 3)", () => {
    const r = call("calc-dilution", ctxA, { m1: 1, v1: 10, m2: 0.1, v2: 100 });
    assert.equal(r.ok, false);
    assert.match(r.error, /exactly 3/);
  });
});

describe("chem — pH calculator", () => {
  it("0.01M H+ acid → pH 2", () => {
    const r = call("calc-ph", ctxA, { concentration: 0.01, kind: "acid" });
    assert.equal(r.result.pH, 2);
    assert.equal(r.result.classification, "acidic");
  });

  it("0.001M OH- base → pH 11", () => {
    const r = call("calc-ph", ctxA, { concentration: 0.001, kind: "base" });
    assert.equal(r.result.pH, 11);
    assert.equal(r.result.classification, "basic");
  });

  it("rejects negative concentration", () => {
    const r = call("calc-ph", ctxA, { concentration: -0.1 });
    assert.equal(r.ok, false);
  });
});

describe("chem — ideal gas law PV=nRT", () => {
  it("solves for T given P V n at STP-ish", () => {
    // 1 atm, 22.4 L, 1 mol → T ≈ 273 K
    const r = call("calc-gas-law", ctxA, { P: 1, V: 22.4, n: 1 });
    assert.ok(Math.abs(r.result.T - 273) < 1.5);
  });

  it("rejects 2 inputs (need 3)", () => {
    const r = call("calc-gas-law", ctxA, { P: 1, V: 22.4 });
    assert.equal(r.ok, false);
    assert.match(r.error, /exactly 3/);
  });
});
