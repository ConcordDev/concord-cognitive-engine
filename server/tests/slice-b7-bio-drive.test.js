import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBioActions from "../domains/bio.js";

const actions = new Map();
registerBioActions((domain, name, fn) => actions.set(`${domain}:${name}`, fn));
function call(name, input = {}, userId = "u1") {
  const fn = actions.get(`bio:${name}`);
  assert.ok(fn, `missing action ${name}`);
  return fn({ actor: { userId } }, { id: null, domain: "bio", type: "domain_action", data: input, meta: {} }, input);
}
beforeEach(() => { globalThis._concordSTATE = {}; });

test("FIX-bio-003: sequence-update edits name/description/sequence in place", () => {
  const s = call("sequence-save", { name: "pUC19 frag", sequence: "acgt acgt", kind: "dna", description: "old" }).result.sequence;
  assert.equal(s.sequence, "ACGTACGT");
  assert.equal(s.length, 8);
  const u = call("sequence-update", { id: s.id, name: "pUC19 fragment", description: "new note", sequence: "TTTT" });
  assert.equal(u.ok, true);
  assert.equal(u.result.sequence.name, "pUC19 fragment");
  assert.equal(u.result.sequence.description, "new note");
  assert.equal(u.result.sequence.sequence, "TTTT");
  assert.equal(u.result.sequence.length, 4); // length recomputed
  const list = call("sequence-list", {});
  assert.equal(list.result.sequences[0].name, "pUC19 fragment");
  assert.equal(call("sequence-update", { id: s.id, name: " " }).ok, false);
  assert.equal(call("sequence-update", { id: s.id, sequence: " " }).ok, false);
  assert.equal(call("sequence-update", { id: "nope", name: "X" }).ok, false);
});
