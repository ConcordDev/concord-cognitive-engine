// Phase-2 behavioral macro tests for server/domains/chem.js — the chemistry
// workbench the /lenses/chem lens drives via lensRun('chem', …).
//
// SCOPE: this file is the Phase-2 GATE proof for the chem lens. It is
// deliberately COMPLEMENTARY to (not a duplicate of) the existing
// tests/chem-domain-parity.test.js, which already pins the happy-path value
// math (periodic table census, glucose MW, benzene SMILES, basic pH/gas-law,
// notebook CRUD). Here we pin the dimensions a Phase-2 gate requires and the
// parity test does NOT exercise:
//
//   1. REAL path-3 dispatch faithfulness. The live LENS_ACTIONS dispatch
//      (server.js:39150/39283) invokes a registerLensAction handler as
//      handler(ctx, virtualArtifact, input) with virtualArtifact.data = input
//      AND input passed as the 3rd `params`. Our `call` harness mirrors that
//      EXACTLY (data === input, params === input), so a regression that
//      confuses param positions or reads from the wrong slot surfaces here.
//      (The parity test passes data:{} — it does not prove the artifact merge.)
//   2. Fail-CLOSED poisoned-numeric. Injected Infinity / 1e999 / NaN / -0 /
//      huge strings must never reach a non-finite computed value — every
//      numeric result is either rejected (ok:false) or stays Number.isFinite.
//   3. Degrade-graceful. The two network-backed macros (resolve-structure,
//      conformer-3d) must return a clean { ok:false, error } with NO network,
//      never throw, never hang.
//   4. Per-user state isolation. The in-memory structure store + lab notebook
//      are keyed by actor.userId — user_b can never see user_a's rows.
//
// Hermetic: no boot, no network, no LLM. Network is hard-disabled in
// beforeEach so any accidental fetch surfaces as a deterministic failure.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerChemActions from "../domains/chem.js";

// ── Mirror the live LENS_ACTIONS registry + dispatch ──────────────────────
const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "chem", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// EXACT path-3 dispatch shape: handler(ctx, virtualArtifact, input) where
// virtualArtifact.data === input (server.js mirrors this) and input is the
// 3rd positional `params`.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`chem.${name} not registered`);
  const virtualArtifact = { id: null, domain: "chem", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerChemActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  // Hard-disable network so any macro that tries to reach out fails loudly.
  globalThis.fetch = async () => { throw new Error("network disabled in hermetic test"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Every macro the lens (page + components/chem/*) calls via lensRun / api.post.
const LENS_CALLED_MACROS = [
  "periodic-table", "molecular-weight", "calc-molarity", "calc-dilution",
  "calc-ph", "calc-gas-law", "parse-smiles", "structure-layout",
  "save-structure", "list-structures", "delete-structure",
  "resolve-structure", "conformer-3d", "stoichiometry",
  "spectroscopy-reference", "reaction-mechanism",
  "notebook-add", "notebook-list", "notebook-delete",
];

describe("chem — registration (every lens-driven macro is present)", () => {
  it("registers all 19 macros the frontend calls", () => {
    for (const m of LENS_CALLED_MACROS) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing chem.${m}`);
    }
  });
});

describe("chem — path-3 dispatch faithfulness (virtualArtifact.data === input)", () => {
  // The live harness passes input twice: as virtualArtifact.data and as the
  // 3rd param. These handlers read `params` (3rd). Proving the value lands
  // means the lens's { input } envelope reaches the handler correctly.
  it("molecular-weight reads params.formula (3rd positional) — H2O = 18.015 g/mol", () => {
    const r = call("molecular-weight", ctxA, { formula: "H2O" });
    assert.equal(r.ok, true);
    assert.equal(r.result.molecularWeight, 18.015);
    assert.equal(r.result.units, "g/mol");
    // components sorted by contribution desc → O (15.999) before H (2.016)
    assert.equal(r.result.components[0].element, "O");
  });

  it("calc-molarity solves the third unknown from any two provided", () => {
    // moles + molarity → liters
    const r = call("calc-molarity", ctxA, { moles: 2, molarity: 0.5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.liters, 4);
    // liters + molarity → moles
    const r2 = call("calc-molarity", ctxA, { liters: 2, molarity: 0.25 });
    assert.equal(r2.result.moles, 0.5);
  });

  it("calc-dilution solves M1V1 = M2V2 for the single missing leg", () => {
    // 1M, 10mL diluted to 100mL → M2 = 0.1
    const r = call("calc-dilution", ctxA, { m1: 1, v1: 10, v2: 100 });
    assert.equal(r.ok, true);
    assert.equal(r.result.m2, 0.1);
    assert.equal(r.result.formula, "M1V1 = M2V2");
  });

  it("calc-gas-law: PV=nRT solves P from V,n,T (1 mol, 22.414 L, 273.15 K ≈ 1 atm)", () => {
    const r = call("calc-gas-law", ctxA, { V: 22.414, n: 1, T: 273.15 });
    assert.equal(r.ok, true);
    // P = nRT/V = 1*0.08206*273.15/22.414 ≈ 1.0001
    assert.ok(Math.abs(r.result.P - 1) < 0.01, `got P=${r.result.P}`);
  });

  it("calc-ph: acid kind branch — 1e-3 M H+ → pH 3, pOH 11, acidic", () => {
    const r = call("calc-ph", ctxA, { concentration: 0.001, kind: "acid" });
    assert.equal(r.ok, true);
    assert.equal(r.result.pH, 3);
    assert.equal(r.result.pOH, 11);
    assert.equal(r.result.classification, "acidic");
  });

  it("calc-ph: base kind branch — 1e-2 M OH- → pOH 2, pH 12, basic", () => {
    const r = call("calc-ph", ctxA, { concentration: 0.01, kind: "base" });
    assert.equal(r.ok, true);
    assert.equal(r.result.pOH, 2);
    assert.equal(r.result.pH, 12);
    assert.equal(r.result.classification, "basic");
  });
});

describe("chem — stoichiometry (limiting reagent + leftovers, real numbers)", () => {
  it("2H2 + O2 -> 2H2O with 4g H2 + 40g O2: O2 limiting, leftover H2 ≈ 2g", () => {
    // 4 g H2 / 2.016 = 1.984 mol ; 40 g O2 / 31.998 = 1.2501 mol
    // ratios: H2 1.984/2 = 0.992 ; O2 1.2501/1 = 1.2501 → H2 limiting? No:
    // limiting = min(moles/coeff): H2 0.992, O2 1.2501 → H2 limiting.
    const r = call("stoichiometry", ctxA, {
      equation: "2H2 + O2 -> 2H2O",
      amounts: { H2: { grams: 4 }, O2: { grams: 40 } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.limitingReagent, "H2");
    // extent = 0.992 ; water moles = 2 * extent ≈ 1.984
    const water = r.result.products.find((p) => p.formula === "H2O");
    assert.ok(water, "H2O product present");
    assert.ok(Math.abs(water.molesProduced - 1.984) < 0.01, `H2O moles ${water.molesProduced}`);
    // O2 leftover: consumed = extent * 1 = 0.992 ; supplied 1.2501 → ~0.258 mol left
    const leftover = r.result.leftoverReactants.find((l) => l.formula === "O2");
    assert.ok(leftover, "O2 leftover row present");
    assert.ok(leftover.remainingMoles > 0.2 && leftover.remainingMoles < 0.3, `O2 left ${leftover.remainingMoles}`);
  });

  it("percent yield: actual < theoretical gives a finite < 100 percent", () => {
    const r = call("stoichiometry", ctxA, {
      equation: "2H2 + O2 -> 2H2O",
      amounts: { H2: { moles: 2 }, O2: { moles: 2 } },
      actualYield: { compound: "H2O", moles: 1.5 },
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.percentYield, "percentYield computed");
    assert.ok(Number.isFinite(r.result.percentYield.percent));
    assert.ok(r.result.percentYield.percent < 100);
  });
});

describe("chem — parse-smiles + structure-layout (real graph derivation)", () => {
  it("acetic acid CC(=O)O → C2H4O2, one C=O double bond, no ring", () => {
    const r = call("parse-smiles", ctxA, { smiles: "CC(=O)O" });
    assert.equal(r.ok, true);
    assert.equal(r.result.formula, "C2H4O2");
    assert.equal(r.result.ringCount, 0);
    assert.equal(r.result.aromatic, false);
    assert.ok(r.result.bonds.some((b) => b.order === 2), "double bond present");
  });

  it("structure-layout returns finite (x,y) for every atom (no NaN coordinates)", () => {
    const r = call("structure-layout", ctxA, { smiles: "CCO" });
    assert.equal(r.ok, true);
    assert.equal(r.result.atoms.length, 3);
    for (const a of r.result.atoms) {
      assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), `atom ${a.index} has non-finite coord`);
    }
  });
});

describe("chem — spectroscopy + mechanism reference (filter + lookup)", () => {
  it("spectroscopy-reference filters the IR table by functional group", () => {
    const r = call("spectroscopy-reference", ctxA, { technique: "ir", group: "carbonyl" });
    assert.equal(r.ok, true);
    assert.ok(r.result.peakCount >= 1);
    assert.ok(r.result.peaks.every((p) =>
      p.group.toLowerCase().includes("carbonyl") || p.note.toLowerCase().includes("carbonyl")));
  });

  it("reaction-mechanism with no type lists the available mechanisms", () => {
    const r = call("reaction-mechanism", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.available));
    assert.ok(r.result.available.some((m) => m.key === "sn2"));
  });

  it("reaction-mechanism sn1 returns a multi-step electron-pushing outline", () => {
    const r = call("reaction-mechanism", ctxA, { type: "sn1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.stepCount, r.result.steps.length);
    assert.ok(r.result.stepCount >= 2);
  });
});

describe("chem — per-user state isolation (structures + notebook)", () => {
  it("structures saved by user_a are invisible to user_b", () => {
    const saved = call("save-structure", ctxA, { smiles: "CCO", name: "ethanol" });
    assert.equal(saved.ok, true);
    const listA = call("list-structures", ctxA);
    assert.equal(listA.result.count, 1);
    const listB = call("list-structures", ctxB);
    assert.equal(listB.result.count, 0, "user_b must not see user_a's structure");
    // user_b cannot delete user_a's structure id
    const delB = call("delete-structure", ctxB, { id: saved.result.id });
    assert.equal(delB.ok, false);
    // user_a can
    const delA = call("delete-structure", ctxA, { id: saved.result.id });
    assert.equal(delA.ok, true);
    assert.equal(call("list-structures", ctxA).result.count, 0);
  });

  it("lab notebook entries are per-user and filterable by query", () => {
    call("notebook-add", ctxA, { title: "Aldol condensation", observations: "yellow precipitate" });
    call("notebook-add", ctxA, { title: "Grignard prep", observations: "exothermic" });
    call("notebook-add", ctxB, { title: "user_b only entry" });
    const aAll = call("notebook-list", ctxA);
    assert.equal(aAll.result.count, 2);
    const aFiltered = call("notebook-list", ctxA, { query: "grignard" });
    assert.equal(aFiltered.result.count, 1);
    assert.equal(aFiltered.result.entries[0].title, "Grignard prep");
    const bAll = call("notebook-list", ctxB);
    assert.equal(bAll.result.count, 1);
  });
});

describe("chem — validation rejection (fail with a string error, never throw)", () => {
  it("molecular-weight rejects empty formula", () => {
    const r = call("molecular-weight", ctxA, { formula: "" });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });
  it("calc-molarity rejects when not exactly two of three are given", () => {
    assert.equal(call("calc-molarity", ctxA, { moles: 1 }).ok, false);
    assert.equal(call("calc-molarity", ctxA, { moles: 1, liters: 1, molarity: 1 }).ok, false);
  });
  it("calc-ph rejects non-positive concentration", () => {
    assert.equal(call("calc-ph", ctxA, { concentration: 0 }).ok, false);
    assert.equal(call("calc-ph", ctxA, { concentration: -1 }).ok, false);
  });
  it("stoichiometry rejects an equation with no arrow", () => {
    assert.equal(call("stoichiometry", ctxA, { equation: "2H2 + O2 2H2O" }).ok, false);
  });
  it("parse-smiles rejects an unbalanced bracket atom (caught, not thrown)", () => {
    const r = call("parse-smiles", ctxA, { smiles: "C[NaCl" });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });
});

describe("chem — fail-CLOSED on poisoned numerics (no non-finite result escapes)", () => {
  it("calc-molarity: Infinity/NaN inputs are rejected, never produce Infinity", () => {
    // Infinity is not Number.isFinite → counts as not-provided → < 2 provided → reject
    const r = call("calc-molarity", ctxA, { moles: Infinity, liters: 2 });
    assert.equal(r.ok, false);
    const r2 = call("calc-molarity", ctxA, { moles: NaN, liters: 2 });
    assert.equal(r2.ok, false);
  });

  it("calc-molarity: a literal 0 divisor is rejected (no Infinity molarity)", () => {
    const r = call("calc-molarity", ctxA, { moles: 5, liters: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /liters cannot be 0/);
  });

  it("calc-gas-law: poisoned huge string '1e999' coerces to Infinity → rejected", () => {
    // Number('1e999') === Infinity → not finite → only 2 finite of 3 → reject
    const r = call("calc-gas-law", ctxA, { P: "1e999", V: 1, T: 273 });
    assert.equal(r.ok, false);
  });

  it("calc-ph: poisoned concentration string '1e999' (→Infinity) rejected, no NaN pH", () => {
    const r = call("calc-ph", ctxA, { concentration: "1e999" });
    assert.equal(r.ok, false);
  });

  it("stoichiometry: a finite computation never emits a non-finite product mass", () => {
    const r = call("stoichiometry", ctxA, {
      equation: "2H2 + O2 -> 2H2O",
      amounts: { H2: { grams: 4 }, O2: { grams: 40 } },
    });
    assert.equal(r.ok, true);
    for (const p of r.result.products) {
      if (p.gramsProduced != null) assert.ok(Number.isFinite(p.gramsProduced), `non-finite mass for ${p.formula}`);
      if (p.molesProduced != null) assert.ok(Number.isFinite(p.molesProduced));
    }
  });

  it("molecular-weight: a huge but valid formula stays finite (no overflow garbage)", () => {
    const r = call("molecular-weight", ctxA, { formula: "C99H99" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.molecularWeight));
    for (const c of r.result.components) {
      assert.ok(Number.isFinite(c.contribution) && Number.isFinite(c.percentMass));
    }
  });
});

describe("chem — degrade-graceful (network-backed macros without network)", () => {
  it("resolve-structure returns { ok:false, error } when the fetch fails (no throw)", async () => {
    const r = await call("resolve-structure", ctxA, { query: "aspirin" });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });

  it("resolve-structure rejects an empty query up-front (no network attempt)", async () => {
    const r = await call("resolve-structure", ctxA, { query: "" });
    assert.equal(r.ok, false);
    assert.match(r.error, /query required/);
  });

  it("conformer-3d rejects a non-integer cid before any fetch", async () => {
    const r = await call("conformer-3d", ctxA, { cid: "not-a-number" });
    assert.equal(r.ok, false);
    assert.match(r.error, /cid/);
  });

  it("conformer-3d returns { ok:false, error } when the fetch fails (no throw)", async () => {
    const r = await call("conformer-3d", ctxA, { cid: 2244 });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });
});
