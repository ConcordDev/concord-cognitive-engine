import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBioActions from "../domains/bio.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`bio.${name}`);
  if (!fn) throw new Error(`bio.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerBioActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("bio — sequence analysis", () => {
  it("computes GC% and length for DNA", () => {
    const r = call("sequence-analyze", ctxA, { sequence: "ATGCATGC", kind: "dna" });
    assert.equal(r.ok, true);
    assert.equal(r.result.length, 8);
    assert.equal(r.result.gcPercent, 50);
  });

  it("detects ORFs in DNA with ATG start and stop codon", () => {
    // Build a clean ORF: ATG + 30 codons + TAA = 32 codons * 3 = 96 bp
    const orf = "ATG" + "GCT".repeat(30) + "TAA";
    const r = call("sequence-analyze", ctxA, { sequence: orf, kind: "dna" });
    assert.equal(r.ok, true);
    assert.ok(r.result.orfs.length > 0);
    assert.equal(r.result.orfs[0].frame, 1);
  });

  it("returns composition + MW for protein", () => {
    const r = call("sequence-analyze", ctxA, { sequence: "ACDEFGHIKLMNPQRSTVWY", kind: "protein" });
    assert.equal(r.ok, true);
    assert.equal(r.result.length, 20);
    assert.equal(r.result.molecularWeight, 2200);
    assert.equal(Object.keys(r.result.composition).length, 20);
  });

  it("rejects empty sequence", () => {
    const r = call("sequence-analyze", ctxA, { sequence: "", kind: "dna" });
    assert.equal(r.ok, false);
    assert.match(r.error, /sequence required/);
  });

  it("rejects invalid kind", () => {
    const r = call("sequence-analyze", ctxA, { sequence: "ATGC", kind: "bogus" });
    assert.equal(r.ok, false);
    assert.match(r.error, /kind must be/);
  });
});

describe("bio — primer design", () => {
  it("returns forward + reverse primers with Tm", () => {
    const seq = "ATGCATGCATGCATGCATGC".repeat(10); // 200 bp
    const r = call("primer-design", ctxA, { sequence: seq, targetLength: 20 });
    assert.equal(r.ok, true);
    assert.equal(r.result.forward.length, 20);
    assert.equal(r.result.reverse.length, 20);
    assert.ok(r.result.forward.tm > 0);
    assert.equal(r.result.productSize, 200);
  });

  it("rejects sequences shorter than 100 bp", () => {
    const r = call("primer-design", ctxA, { sequence: "ATGC".repeat(10) });
    assert.equal(r.ok, false);
    assert.match(r.error, />=/);
  });

  it("reverse primer is reverse-complement of 3' end", () => {
    const seq = "AAAA".repeat(50);
    const r = call("primer-design", ctxA, { sequence: seq, targetLength: 20 });
    // Reverse-complement of AAAA... is TTTT...
    assert.match(r.result.reverse.sequence, /^T+$/);
  });
});

describe("bio — pairwise alignment (Needleman-Wunsch)", () => {
  it("identical sequences score perfectly", () => {
    const r = call("align-pairwise", ctxA, { seqA: "GATTACA", seqB: "GATTACA" });
    assert.equal(r.ok, true);
    assert.equal(r.result.identity, 100);
    assert.equal(r.result.score, 14); // 7 matches × 2
  });

  it("totally different sequences have lower identity", () => {
    const r = call("align-pairwise", ctxA, { seqA: "AAAAA", seqB: "TTTTT" });
    assert.ok(r.result.identity < 50);
  });

  it("rejects missing sequence", () => {
    const r = call("align-pairwise", ctxA, { seqA: "ATGC" });
    assert.equal(r.ok, false);
    assert.match(r.error, /seqA and seqB required/);
  });

  it("alignment traceback strings have equal length", () => {
    const r = call("align-pairwise", ctxA, { seqA: "GATTACA", seqB: "GCATGCU" });
    assert.equal(r.result.alignA.length, r.result.alignB.length);
    assert.equal(r.result.alignA.length, r.result.alignBars.length);
  });
});

describe("bio — FASTA parsing", () => {
  it("parses multi-record FASTA", () => {
    const text = ">seq1 first\nATGCATGC\n>seq2 second\nGGGCCCAA";
    const r = call("parse-fasta", ctxA, { text });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.records[0].id, "seq1");
    assert.equal(r.result.records[0].sequence, "ATGCATGC");
    assert.equal(r.result.records[1].sequence, "GGGCCCAA");
  });

  it("strips whitespace inside sequence lines", () => {
    const text = ">seq1\nAT GC\nAT GC";
    const r = call("parse-fasta", ctxA, { text });
    assert.equal(r.result.records[0].sequence, "ATGCATGC");
  });
});

describe("bio — restriction site mapping", () => {
  it("finds EcoRI sites (GAATTC)", () => {
    const r = call("restriction-map", ctxA, { sequence: "AAAGAATTCAAA" });
    assert.equal(r.ok, true);
    assert.ok(r.result.sites.some((s) => s.enzyme === "EcoRI"));
  });

  it("returns sites sorted by position", () => {
    const r = call("restriction-map", ctxA, { sequence: "GGATCCAAAGAATTC" });
    const positions = r.result.sites.map((s) => s.position);
    const sorted = [...positions].sort((a, b) => a - b);
    assert.deepEqual(positions, sorted);
  });

  it("filters by enzyme list when provided", () => {
    const r = call("restriction-map", ctxA, { sequence: "GAATTCGGATCC", enzymes: ["EcoRI"] });
    assert.ok(r.result.sites.every((s) => s.enzyme === "EcoRI"));
  });
});

describe("bio — sequence storage", () => {
  it("INVARIANT: sequences scoped per-user", () => {
    call("sequence-save", ctxA, { name: "a-only", sequence: "ATGC", kind: "dna" });
    const b = call("sequence-list", ctxB);
    assert.equal(b.result.sequences.length, 0);
  });

  it("rejects oversized sequence", () => {
    const r = call("sequence-save", ctxA, {
      name: "huge",
      sequence: "A".repeat(100_001),
      kind: "dna",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /too long/);
  });
});

describe("bio — STATE unavailable path", () => {
  it("returns error shape when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("sequence-list", ctxA);
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
