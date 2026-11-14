// chem-balance-coefficients.test.js
// FIX-chem-002 — balanceReaction fed each token to parseFormula
// unstripped, so a typed coefficient folded into the atom counts: the
// exact equations users type from textbooks returned self-consistent
// garbage (2H2 + O2 -> 2H2O came back "22H2 + O2 -> 22H2O"). The action
// now strips the leading coefficient it exists to solve for. Bare
// equations balance exactly as before, and stoichiometry is untouched
// (typed coefficients are load-bearing there — FIX-chem-001).
//
// Run: node --test server/domains/chem-balance-coefficients.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerChemActions from "./chem.js";

const actions = new Map();
registerChemActions((domain, action, fn) => actions.set(`${domain}:${action}`, fn));
const balance = actions.get("chem:balanceReaction");
const ctx = { actor: { userId: "test" }, userId: "test" };

describe("chem-002 — balanceReaction and typed coefficients", () => {
  it("registers the action", () => {
    assert.equal(typeof balance, "function");
  });

  it("the ticket's equations balance to the ticket's expected outputs", () => {
    const cases = [
      ["H2 + O2 -> H2O", "2H2 + O2 → 2H2O"],
      ["2H2 + O2 -> 2H2O", "2H2 + O2 → 2H2O"],
      ["Fe + O2 -> Fe2O3", "4Fe + 3O2 → 2Fe2O3"],
      ["4Fe + 3O2 -> 2Fe2O3", "4Fe + 3O2 → 2Fe2O3"],
      ["C3H8 + O2 -> CO2 + H2O", "C3H8 + 5O2 → 3CO2 + 4H2O"],
      ["C3H8 + 5O2 -> 3CO2 + 4H2O", "C3H8 + 5O2 → 3CO2 + 4H2O"],
    ];
    for (const [input, expected] of cases) {
      const r = balance(ctx, null, { equation: input });
      assert.equal(r.ok, true, `${input} refused: ${r.error}`);
      assert.equal(r.result.equation, expected, `${input} balanced wrong`);
      assert.equal(r.result.balanced, true);
    }
  });

  it("no coefficient is ever folded into a formula in the output", () => {
    const r = balance(ctx, null, { equation: "2H2 + O2 -> 2H2O" });
    assert.equal(r.ok, true);
    for (const side of [...r.result.reactants, ...r.result.products]) {
      assert.match(side.formula, /^[A-Z]/, `formula ${side.formula} starts with an element, not a digit`);
    }
    assert.deepEqual(
      r.result.coefficients.map((c) => `${c.coefficient}${c.compound}`),
      ["2H2", "1O2", "2H2O"],
    );
  });

  it("the reactants/products array path strips coefficients too", () => {
    const r = balance(ctx, { data: { reactants: ["2H2", "O2"], products: ["2H2O"] } }, {});
    assert.equal(r.ok, true, `array path refused: ${r.error}`);
    assert.equal(r.result.equation, "2H2 + O2 → 2H2O");
  });

  it("garbage is still refused, never receipted as balanced", () => {
    const r = balance(ctx, null, { equation: "banana + O2 -> split" });
    assert.equal(r.ok, false);
    const impossible = balance(ctx, null, { equation: "H2 -> O2" });
    assert.equal(impossible.ok, false);
  });
});
