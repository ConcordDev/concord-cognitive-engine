// Malformed SMILES (unbalanced parens, same-atom ring closure) must refuse
// cleanly via ok:false — never a TypeError out of smilesToGraph.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerChemActions from "../domains/chem.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) { ACTIONS.set(name, fn); }
function call(name, input) {
  const ctx = { actor: { userId: "user_a" }, userId: "user_a" };
  const art = { id: null, domain: "chem", type: "domain_action", data: input, meta: {} };
  return ACTIONS.get(name)(ctx, art, input);
}

before(() => { globalThis._concordSTATE = {}; registerChemActions(registerLensAction); });

describe("chem smilesToGraph — malformed input", () => {
  for (const bad of ["C)C", "C11", "C(C"]) {
    for (const m of ["parse-smiles", "structure-layout", "save-structure"]) {
      it(`${m} refuses ${JSON.stringify(bad)}`, async () => {
        const r = await call(m, { smiles: bad });
        assert.equal(r.ok, false);
        assert.equal(r.error, "invalid_input");
        assert.equal(r.reason, "invalid_smiles");
      });
    }
  }
  for (const good of ["CC(C)C", "c1ccccc1"]) {
    it(`still parses ${good}`, async () => {
      const r = await call("parse-smiles", { smiles: good });
      assert.equal(r.ok, true);
    });
  }
});
