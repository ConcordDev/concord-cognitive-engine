// Chem full-lens build (GB-1021) — the S1 validation gates and the S4
// notebook-update lifecycle, tested at the handler level in the same
// dispatch shape the live registry uses (mirrors chem-lens-macros.test.js).
//
// What this pins:
//   1. balanceReaction refuses what it cannot honestly balance — a formula
//      that parses to no elements ("banana"), an unknown element symbol,
//      and an equation that cannot conserve atoms. Each used to receipt
//      Success: the verification iterated the (empty) element set and
//      vacuously passed, in BOTH balancers (the chem.js macro and the
//      compute layer's chemistry.balanceReaction — the one /api/lens/run
//      actually serves, whose guard sat inside the per-element loop).
//   2. Valid equations still balance, in both balancers, with the shapes
//      their consumers read.
//   3. notebook-update completes the notebook lifecycle: edit in place,
//      partial updates keep the rest, an emptied title refuses, and another
//      user's entry is not found (never editable across accounts).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerChemActions from "../domains/chem.js";
import { balanceReaction as computeBalance } from "../lib/compute/chemistry-compute.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "chem", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`chem.${name} not registered`);
  const virtualArtifact = { id: null, domain: "chem", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerChemActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in hermetic test"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("chem S1 — the domain balancer validates before it receipts", () => {
  it("balances methane and returns the equation + product list", () => {
    const r = call("balanceReaction", ctxA, { equation: "CH4 + O2 -> CO2 + H2O" });
    assert.equal(r.ok, true);
    assert.equal(r.result.equation, "CH4 + 2O2 → CO2 + 2H2O");
    assert.deepEqual(r.result.products, [
      { formula: "CO2", coefficient: 1 },
      { formula: "H2O", coefficient: 2 },
    ]);
  });

  it("refuses a formula that parses to no elements, by name", () => {
    const r = call("balanceReaction", ctxA, { equation: "banana -> split" });
    assert.equal(r.ok, false);
    assert.match(r.error, /banana/);
  });

  it("refuses an unknown element symbol, by name", () => {
    const r = call("balanceReaction", ctxA, { equation: "Xx2 + O2 -> Xx2O" });
    assert.equal(r.ok, false);
    assert.match(r.error, /Xx/);
  });

  it("refuses an equation that cannot conserve atoms", () => {
    const r = call("balanceReaction", ctxA, { equation: "H2 + O2 -> H2O + He" });
    assert.equal(r.ok, false);
    assert.match(r.error, /could not balance/);
  });
});

describe("chem S1 — the compute balancer (the one /api/lens/run serves) validates too", () => {
  it("balances methane to the string shape its consumers read", () => {
    const r = computeBalance({ equation: "CH4 + O2 -> CO2 + H2O" });
    assert.equal(r.ok, true);
    assert.equal(r.balanced, "CH4 + 2O2 → CO2 + 2H2O");
    assert.deepEqual(r.productCoeffs, { CO2: 1, H2O: 2 });
  });

  it("refuses banana -> split instead of receipting '0banana → split'", () => {
    const r = computeBalance({ equation: "banana -> split" });
    assert.equal(r.ok, false);
    assert.match(r.error, /banana/);
  });

  it("refuses an unknown element symbol", () => {
    const r = computeBalance({ equation: "Xx2 + O2 -> Xx2O" });
    assert.equal(r.ok, false);
    assert.match(r.error, /Xx/);
  });

  it("still reduces by GCD (the Fe2O3 case the gcd suite pins)", () => {
    const r = computeBalance({ equation: "Fe + O2 -> Fe2O3" });
    assert.equal(r.ok, true);
    assert.equal(r.balanced, "4Fe + 3O2 → 2Fe2O3");
  });
});

describe("chem S4 — notebook-update completes the lifecycle", () => {
  function seed(ctx) {
    const r = call("notebook-add", ctx, {
      title: "Esterification run", equation: "CH3COOH + C2H5OH -> CH3COOC2H5 + H2O",
      procedure: "Reflux 2h", observations: "Sweet smell", yieldPercent: 71, tags: ["ester"],
    });
    assert.equal(r.ok, true);
    return r.result;
  }

  it("edits fields in place and stamps updatedAt", () => {
    const entry = seed(ctxA);
    const r = call("notebook-update", ctxA, { id: entry.id, observations: "Fruity smell", yieldPercent: 83 });
    assert.equal(r.ok, true);
    assert.equal(r.result.observations, "Fruity smell");
    assert.equal(r.result.yieldPercent, 83);
    assert.equal(r.result.title, "Esterification run", "untouched fields stay");
    assert.ok(r.result.updatedAt, "updatedAt stamped");
    const list = call("notebook-list", ctxA, {});
    assert.equal(list.result.entries[0].observations, "Fruity smell");
  });

  it("refuses to empty the title", () => {
    const entry = seed(ctxA);
    const r = call("notebook-update", ctxA, { id: entry.id, title: "  " });
    assert.equal(r.ok, false);
    assert.match(r.error, /title required/);
  });

  it("cannot edit another user's entry", () => {
    const entry = seed(ctxA);
    const r = call("notebook-update", ctxB, { id: entry.id, title: "Hijacked" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
    const list = call("notebook-list", ctxA, {});
    assert.equal(list.result.entries[0].title, "Esterification run");
  });

  it("reports a missing id honestly", () => {
    const r = call("notebook-update", ctxA, { id: "lab_missing", title: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});
