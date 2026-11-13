// server/tests/bio-sequence-alphabet.test.js
//
// FIX-bio-001: the sequence analyzer computed GC%/Tm over any characters
// — 'ATGXYZ' came back as DNA with GC 16.7% and Tm 8.0 °C and no word
// that X/Y/Z are not nucleotides. sequence-analyze now validates the
// kind's alphabet (IUPAC ambiguity codes stay valid) and refuses by
// naming the offending characters.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerBioActions from "../domains/bio.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function analyze(params) {
  const fn = ACTIONS.get("bio.sequence-analyze");
  if (!fn) throw new Error("sequence-analyze not registered");
  return fn({ actor: { userId: "u1" }, userId: "u1" }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerBioActions(register); });

describe("bio sequence-analyze alphabet validation (FIX-bio-001)", () => {
  it("refuses 'ATGXYZ' naming X and Z (the audit case; Y is a valid IUPAC code)", () => {
    // Correction (2026-11-13, post-landing): this case originally
    // expected "X, Y, Z" — contradicting the IUPAC case below, since
    // Y (pyrimidine) IS a valid ambiguity code for DNA. The code was
    // right; the expectation was wrong. ATGXYZ is refused naming the
    // genuinely invalid characters, X and Z.
    const r = analyze({ sequence: "ATGXYZ", kind: "dna" });
    assert.equal(r.ok, false);
    assert.match(r.error, /X, Z are not valid nucleotides for a DNA sequence/);
  });

  it("valid DNA still analyzes with the audit's own metrics", () => {
    const r = analyze({ sequence: "ATGCGT", kind: "dna" });
    assert.equal(r.ok, true);
    assert.equal(r.result.gcPercent, 50);
    assert.equal(r.result.length, 6);
  });

  it("IUPAC ambiguity codes stay valid DNA (N, R, Y, S, W, K, M, B, D, H, V)", () => {
    const r = analyze({ sequence: "ACGTRYSWKMBDHVN", kind: "dna" });
    assert.equal(r.ok, true, `ambiguity codes must pass: ${JSON.stringify(r)}`);
  });

  it("U is refused for DNA but valid for RNA; T is refused for RNA", () => {
    const dnaU = analyze({ sequence: "AUGC", kind: "dna" });
    assert.equal(dnaU.ok, false);
    assert.match(dnaU.error, /U is not valid/);
    const rna = analyze({ sequence: "AUGC", kind: "rna" });
    assert.equal(rna.ok, true);
    const rnaT = analyze({ sequence: "ATGC", kind: "rna" });
    assert.equal(rnaT.ok, false);
    assert.match(rnaT.error, /T is not valid/);
  });

  it("protein refuses digits by name and accepts the standard residues", () => {
    const bad = analyze({ sequence: "ACD123", kind: "protein" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /not valid amino-acid codes for a PROTEIN sequence/);
    const good = analyze({ sequence: "ACDEFGHIKLMNPQRSTVWY", kind: "protein" });
    assert.equal(good.ok, true);
  });
});
