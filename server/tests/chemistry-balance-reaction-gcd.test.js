// balanceReaction reduced by the smallest coefficient instead of the GCD:
// Fe + O2 -> Fe2O3 came back 2 Fe + 2 O2 -> Fe2O3 (4 O in, 3 O out).
import test from "node:test";
import assert from "node:assert/strict";
import { balanceReaction } from "../lib/compute/chemistry-compute.js";

const CASES = [
  ["Fe + O2 -> Fe2O3", { Fe: 4, O2: 3, Fe2O3: 2 }],
  ["Al + O2 -> Al2O3", { Al: 4, O2: 3, Al2O3: 2 }],
  ["H2 + O2 -> H2O", { H2: 2, O2: 1, H2O: 2 }],
  ["N2 + H2 -> NH3", { N2: 1, H2: 3, NH3: 2 }],
  ["CH4 + O2 -> CO2 + H2O", { CH4: 1, O2: 2, CO2: 1, H2O: 2 }],
  ["C3H8 + O2 -> CO2 + H2O", { C3H8: 1, O2: 5, CO2: 3, H2O: 4 }],
  ["C2H6 + O2 -> CO2 + H2O", { C2H6: 2, O2: 7, CO2: 4, H2O: 6 }],
  ["KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2", { KMnO4: 2, HCl: 16, KCl: 2, MnCl2: 2, H2O: 8, Cl2: 5 }],
];

for (const [eq, want] of CASES) {
  test(`balances ${eq}`, () => {
    const r = balanceReaction({ equation: eq });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.coefficients, want);
  });
}

test("an impossible equation is an error, never an unbalanced answer", () => {
  const r = balanceReaction({ equation: "H2 -> O2" });
  assert.equal(r.ok, false);
  assert.match(r.error, /could not balance/);
});
