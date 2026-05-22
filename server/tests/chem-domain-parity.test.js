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
  it("returns the full 118 elements", () => {
    const r = call("periodic-table", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 118);
    assert.equal(r.result.elements.H.name, "Hydrogen");
    assert.equal(r.result.elements.Og.name, "Oganesson");
    assert.equal(r.result.elements.Og.z, 118);
  });

  it("covers all atomic numbers 1-118", () => {
    const r = call("periodic-table", ctxA);
    const zSet = new Set(Object.values(r.result.elements).map((el) => el.z));
    for (let z = 1; z <= 118; z++) {
      assert.ok(zSet.has(z), `missing atomic number ${z}`);
    }
  });

  it("includes all 15 lanthanides", () => {
    const r = call("periodic-table", ctxA);
    const lanthanides = Object.values(r.result.elements).filter((el) => el.category === "lanthanide");
    assert.equal(lanthanides.length, 15);
  });

  it("includes all 15 actinides", () => {
    const r = call("periodic-table", ctxA);
    const actinides = Object.values(r.result.elements).filter((el) => el.category === "actinide");
    assert.equal(actinides.length, 15);
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

// ─── 2026 parity backlog ───────────────────────────────────────

describe("chem — SMILES parsing", () => {
  it("parses ethanol CCO → C2H6O", () => {
    const r = call("parse-smiles", ctxA, { smiles: "CCO" });
    assert.equal(r.ok, true);
    assert.equal(r.result.formula, "C2H6O");
    assert.equal(r.result.heavyAtomCount, 3);
  });

  it("parses benzene c1ccccc1 → aromatic ring", () => {
    const r = call("parse-smiles", ctxA, { smiles: "c1ccccc1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.formula, "C6H6");
    assert.equal(r.result.ringCount, 1);
    assert.equal(r.result.aromatic, true);
  });

  it("rejects empty SMILES", () => {
    const r = call("parse-smiles", ctxA, { smiles: "" });
    assert.equal(r.ok, false);
  });
});

describe("chem — 2D structure layout", () => {
  it("produces drawable coordinates for CC(=O)O", () => {
    const r = call("structure-layout", ctxA, { smiles: "CC(=O)O" });
    assert.equal(r.ok, true);
    assert.ok(r.result.atoms.length >= 4);
    assert.ok(r.result.atoms.every((a) => typeof a.x === "number" && typeof a.y === "number"));
    assert.ok(r.result.bonds.length >= 3);
  });

  it("rejects bad SMILES", () => {
    const r = call("structure-layout", ctxA, { smiles: "C[" });
    assert.equal(r.ok, false);
  });
});

describe("chem — structure save / list / delete", () => {
  it("saves, lists then deletes a structure", () => {
    const save = call("save-structure", ctxA, { smiles: "CCO", name: "Ethanol" });
    assert.equal(save.ok, true);
    const id = save.result.id;
    const list = call("list-structures", ctxA);
    assert.equal(list.ok, true);
    assert.ok(list.result.structures.some((s) => s.id === id));
    const del = call("delete-structure", ctxA, { id });
    assert.equal(del.ok, true);
    const list2 = call("list-structures", ctxA);
    assert.ok(!list2.result.structures.some((s) => s.id === id));
  });

  it("delete of unknown id fails", () => {
    const r = call("delete-structure", ctxA, { id: "nope" });
    assert.equal(r.ok, false);
  });
});

describe("chem — stoichiometry", () => {
  it("finds limiting reagent + theoretical yield for water synthesis", () => {
    const r = call("stoichiometry", ctxA, {
      equation: "2H2 + O2 -> 2H2O",
      amounts: { H2: { grams: 4 }, O2: { grams: 40 } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.limitingReagent, "H2");
    assert.ok(r.result.products[0].gramsProduced > 0);
  });

  it("computes percent yield when actual supplied", () => {
    const r = call("stoichiometry", ctxA, {
      equation: "2H2 + O2 -> 2H2O",
      amounts: { H2: { grams: 4 }, O2: { grams: 40 } },
      actualYield: { compound: "H2O", grams: 30 },
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.percentYield);
    assert.ok(r.result.percentYield.percent > 0 && r.result.percentYield.percent <= 100);
  });

  it("rejects equation without arrow", () => {
    const r = call("stoichiometry", ctxA, { equation: "H2 O2 H2O" });
    assert.equal(r.ok, false);
  });
});

describe("chem — spectroscopy reference", () => {
  it("returns the IR peak table", () => {
    const r = call("spectroscopy-reference", ctxA, { technique: "ir" });
    assert.equal(r.ok, true);
    assert.ok(r.result.peaks.length > 0);
    assert.equal(r.result.unit, "cm⁻¹");
  });

  it("filters by functional group", () => {
    const r = call("spectroscopy-reference", ctxA, { technique: "ir", group: "carbonyl" });
    assert.equal(r.ok, true);
    assert.ok(r.result.peaks.every((p) =>
      p.group.toLowerCase().includes("carbonyl") || p.note.toLowerCase().includes("carbonyl")));
  });

  it("rejects unknown technique", () => {
    const r = call("spectroscopy-reference", ctxA, { technique: "xray" });
    assert.equal(r.ok, false);
  });
});

describe("chem — reaction mechanism", () => {
  it("lists available mechanisms with no type", () => {
    const r = call("reaction-mechanism", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.available.length > 0);
  });

  it("returns SN2 step outline with curved arrows", () => {
    const r = call("reaction-mechanism", ctxA, { type: "sn2" });
    assert.equal(r.ok, true);
    assert.ok(r.result.steps.length > 0);
    assert.ok(r.result.steps[0].arrows.length > 0);
  });

  it("rejects unknown mechanism", () => {
    const r = call("reaction-mechanism", ctxA, { type: "magic" });
    assert.equal(r.ok, false);
  });
});

describe("chem — lab notebook", () => {
  it("adds, lists then deletes an entry", () => {
    const add = call("notebook-add", ctxA, {
      title: "Aspirin synthesis", equation: "C7H6O3 + C4H6O3 -> C9H8O4 + C2H4O2",
      yieldPercent: 78, tags: ["esterification", "acetylation"],
    });
    assert.equal(add.ok, true);
    const id = add.result.id;
    const list = call("notebook-list", ctxA);
    assert.equal(list.ok, true);
    assert.ok(list.result.entries.some((e) => e.id === id));
    const del = call("notebook-delete", ctxA, { id });
    assert.equal(del.ok, true);
  });

  it("filters notebook by query", () => {
    call("notebook-add", ctxA, { title: "Grignard addition", tags: ["organometallic"] });
    const r = call("notebook-list", ctxA, { query: "grignard" });
    assert.equal(r.ok, true);
    assert.ok(r.result.entries.every((e) => e.title.toLowerCase().includes("grignard")));
  });

  it("rejects entry without title", () => {
    const r = call("notebook-add", ctxA, { equation: "A -> B" });
    assert.equal(r.ok, false);
  });
});
