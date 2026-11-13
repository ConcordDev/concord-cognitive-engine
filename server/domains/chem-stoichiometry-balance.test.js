// chem-stoichiometry-balance.test.js
// FIX-chem-001 (GB-1521 slice B6) — the stoichiometry action silently
// accepted unbalanced equations and returned yields computed from
// coefficients that do not conserve atoms. It now refuses, naming the
// element that is off; a balanced equation computes as before.
//
// Run: node --test server/domains/chem-stoichiometry-balance.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerChemActions from "./chem.js";

const actions = new Map();
registerChemActions((domain, action, fn) => actions.set(`${domain}:${action}`, fn));
const stoich = actions.get("chem:stoichiometry");
const ctx = { actor: { userId: "test" }, userId: "test" };

describe("chem-001 — stoichiometry refuses unbalanced equations", () => {
  it("registers the action", () => {
    assert.equal(typeof stoich, "function");
  });
  it("H2 + O2 -> H2O is refused, naming oxygen", () => {
    const r = stoich(ctx, null, { equation: "H2 + O2 -> H2O", amounts: { H2: { grams: 2 }, O2: { grams: 32 } } });
    assert.equal(r.ok, false);
    assert.match(r.error, /not balanced/);
    assert.match(r.error, /O has 2 atoms on the left and 1 on the right/);
  });
  it("a balanced equation still computes a limiting reagent", () => {
    const r = stoich(ctx, null, { equation: "2H2 + O2 -> 2H2O", amounts: { H2: { grams: 4 }, O2: { grams: 40 } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.limitingReagent, "H2");
  });
  it("an equation short on one side is refused too", () => {
    const r = stoich(ctx, null, { equation: "CH4 + O2 -> CO2 + H2O", amounts: { CH4: { grams: 16 } } });
    assert.equal(r.ok, false);
    assert.match(r.error, /not balanced/);
  });
});
