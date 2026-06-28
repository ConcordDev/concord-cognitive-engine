// Behavioral macro tests for server/domains/bio.js — the Benchling / SnapGene /
// UniProt / NCBI-shaped bioinformatics substrate the /lenses/bio components
// drive (SequenceAnalyzer, BioActionPanel, BioWorkbench, MolecularWorkbench).
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js): handlers
// registered via `registerLensAction(domain, action, handler)` are invoked as
// `handler(ctx, virtualArtifact, input)` — the 3-ARG convention, with
// `virtualArtifact.data = input`. The components call a local
// `callMacro(action, { input: {...} })` whose {artifact:{data}} wrapper is
// auto-peeled by the dispatch fix, so the handler sees the input object as
// BOTH artifact.data AND params. Our harness reproduces that exactly.
//
// These are NOT shape-only assertions and they DO NOT duplicate the existing
// bio-domain-parity suite. They drive each calculator with the COMPONENT'S
// EXACT input field names and assert the COMPONENT'S EXACT rendered output
// field names carry real computed values (GC%, Tm, reverse-complement primer,
// 6-frame translation, restriction cut sites, CRISPR guides), plus
// validation-rejection, degrade-graceful (STATE unavailable), and a
// fail-CLOSED poisoned-input contract (non-string sequence / non-finite
// scoring weights are REJECTED, never coerced into a fabricated result).
//
// FIELD-ALIGNMENT (caller field → receiver field) pinned here — the two
// dead-surface fixes this sprint landed:
//   • SequenceAnalyzer align tab renders alignA/alignB/alignBars/identity
//     (was alignedA/alignedB/midline/identityPercent → handler emits none →
//     blank align result). Asserted via "render-field contract" cases.
//   • BioActionPanel restrict sends enzymes:[enzyme] (was singular `enzyme`,
//     ignored → all 10 scanned) and sites are {enzyme,position,cutAt,site}
//     objects (was rendered as number[] → "[object Object]"). Asserted below.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBioActions from "../domains/bio.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "bio", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch exactly: handler(ctx, virtualArtifact, input) with
// virtualArtifact.data = input.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`bio.${name} not registered`);
  const virtualArtifact = { id: null, title: null, domain: "bio", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerBioActions(registerLensAction); });

let fetchCalls = 0;
beforeEach(() => {
  // No boot, no network, no LLM. A handler that reaches for the network marks
  // itself via fetchCalls.
  fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error("network disabled in tests"); };
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// ── Registration — every component-driven macro present ──────────────────────

describe("bio — registration (every lens-component macro present)", () => {
  it("registers the macros the four bio components call", () => {
    for (const m of [
      // SequenceAnalyzer + BioActionPanel + BioWorkbench
      "sequence-analyze", "primer-design", "align-pairwise", "restriction-map",
      "parse-fasta", "sequence-save", "sequence-list", "sequence-delete",
      // MolecularWorkbench (7 backlog macros)
      "plasmid-map", "align-multiple", "cloning-simulate", "translate-orf",
      "blast-search", "crispr-design",
      "notebook-create", "notebook-list", "notebook-update", "notebook-delete",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing bio.${m}`);
    }
  });
});

// ── sequence-analyze — the SequenceAnalyzer/BioActionPanel/BioWorkbench shape ─

describe("bio.sequence-analyze — GC% / Tm / ORFs / protein composition", () => {
  it("DNA: real GC% + Wallace-rule Tm + length (component input {sequence,kind})", () => {
    const r = call("sequence-analyze", ctxA, { sequence: "GGCCGGCC", kind: "dna" });
    assert.equal(r.ok, true);
    assert.equal(r.result.length, 8);
    assert.equal(r.result.kind, "dna");
    assert.equal(r.result.gcPercent, 100);     // all G/C
    assert.equal(r.result.tm, 32);             // Wallace 2*AT + 4*GC = 4*8
    assert.ok(Array.isArray(r.result.orfs));
  });

  it("DNA: a clean ATG..TAA ORF (>=90 bp) is detected with frame/start/end/length", () => {
    const seq = "ATG" + "GCT".repeat(30) + "TAA"; // 96 bp ORF
    const r = call("sequence-analyze", ctxA, { sequence: seq, kind: "dna" });
    assert.equal(r.ok, true);
    assert.equal(r.result.orfs.length, 1);
    assert.deepEqual(r.result.orfs[0], { frame: 1, start: 0, end: 96, length: 96 });
  });

  it("protein: composition map + average MW (110 Da/aa), no GC/Tm/ORFs", () => {
    const r = call("sequence-analyze", ctxA, { sequence: "MKVL", kind: "protein" });
    assert.equal(r.ok, true);
    assert.equal(r.result.molecularWeight, 440);  // 4 aa * 110
    assert.deepEqual(r.result.composition, { M: 1, K: 1, V: 1, L: 1 });
    assert.equal(r.result.gcPercent, undefined);
    assert.equal(r.result.orfs, undefined);
  });

  it("validation-rejection: empty sequence + unknown kind are rejected", () => {
    assert.equal(call("sequence-analyze", ctxA, { sequence: "", kind: "dna" }).ok, false);
    const bad = call("sequence-analyze", ctxA, { sequence: "ATGC", kind: "bogus" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /kind must be/);
  });

  it("fail-CLOSED: a non-string sequence is REJECTED, never String()-coerced into a fake GC%", () => {
    const r = call("sequence-analyze", ctxA, { sequence: { x: 1 }, kind: "dna" });
    assert.equal(r.ok, false);
    assert.match(r.error, /sequence must be a string/);
    // and a numeric sequence likewise
    assert.equal(call("sequence-analyze", ctxA, { sequence: 12345, kind: "dna" }).ok, false);
  });
});

// ── primer-design — forward + reverse-complement, the component shape ────────

describe("bio.primer-design — forward + reverse-complement primer pair", () => {
  it("computes a real primer pair the panels render (sequence/length/tm/gcPercent/productSize)", () => {
    const seq = "ATG" + "GCATGCATGC".repeat(15); // 153 bp
    const r = call("primer-design", ctxA, { sequence: seq, targetTm: 60, targetLength: 20 });
    assert.equal(r.ok, true);
    // Forward = first 20 bases.
    assert.equal(r.result.forward.sequence, seq.slice(0, 20));
    assert.equal(r.result.forward.length, 20);
    assert.ok(Number.isFinite(r.result.forward.tm));
    assert.ok(Number.isFinite(r.result.forward.gcPercent));
    // Reverse = reverse-complement of the last 20 bases.
    const comp = { A: "T", T: "A", G: "C", C: "G", N: "N" };
    const expectedRev = seq.slice(-20).split("").reverse().map((b) => comp[b]).join("");
    assert.equal(r.result.reverse.sequence, expectedRev);
    assert.equal(r.result.productSize, seq.length);
  });

  it("validation-rejection: <100 bp and empty input are rejected", () => {
    assert.equal(call("primer-design", ctxA, { sequence: "ATGC" }).ok, false);
    assert.equal(call("primer-design", ctxA, { sequence: "" }).ok, false);
  });
});

// ── align-pairwise — Needleman-Wunsch, render-field contract ─────────────────

describe("bio.align-pairwise — Needleman-Wunsch + render-field contract", () => {
  it("identical sequences → 100% identity, all-bars midline, equal-length rows", () => {
    const r = call("align-pairwise", ctxA, { seqA: "GATTACA", seqB: "GATTACA", match: 2, mismatch: -1, gap: -2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.identity, 100);
    assert.equal(r.result.score, 14);          // 7 matches * 2
    assert.equal(r.result.alignBars, "|||||||");
    // The EXACT field names SequenceAnalyzer/BioActionPanel/BioWorkbench render.
    assert.equal(typeof r.result.alignA, "string");
    assert.equal(typeof r.result.alignB, "string");
    assert.equal(typeof r.result.alignBars, "string");
    assert.equal(r.result.alignA.length, r.result.alignB.length);
    assert.equal(r.result.alignA.length, r.result.alignBars.length);
    assert.equal(typeof r.result.alignmentLength, "number");
    // The dead-surface aliases the OLD SequenceAnalyzer read must NOT exist —
    // if they were ever (re)introduced the component would silently prefer them.
    assert.equal(r.result.alignedA, undefined);
    assert.equal(r.result.alignedB, undefined);
    assert.equal(r.result.midline, undefined);
    assert.equal(r.result.identityPercent, undefined);
  });

  it("fully divergent sequences → 0% identity", () => {
    const r = call("align-pairwise", ctxA, { seqA: "AAAA", seqB: "TTTT" });
    assert.equal(r.ok, true);
    assert.equal(r.result.identity, 0);
    assert.equal(r.result.matches, 0);
  });

  it("validation-rejection: a missing second sequence is rejected", () => {
    assert.equal(call("align-pairwise", ctxA, { seqA: "ATGC" }).ok, false);
  });

  it("fail-CLOSED: a non-finite scoring weight is REJECTED, never leaks Infinity into score", () => {
    const inf = call("align-pairwise", ctxA, { seqA: "ATGC", seqB: "GGGG", match: "Infinity" });
    assert.equal(inf.ok, false);
    assert.match(inf.error, /finite/);
    const nan = call("align-pairwise", ctxA, { seqA: "ATGC", seqB: "GGGG", gap: NaN });
    assert.equal(nan.ok, false);
    // A genuinely huge-but-finite weight stays allowed (1e308 is a valid double).
    const big = call("align-pairwise", ctxA, { seqA: "ATGC", seqB: "ATGC", match: "1e308" });
    assert.equal(big.ok, true);
    assert.ok(Number.isFinite(big.result.score));
  });
});

// ── restriction-map — site OBJECTS, enzymes-array filter (BioActionPanel fix) ─

describe("bio.restriction-map — cut sites + enzyme-array filter", () => {
  it("finds EcoRI + BamHI with object sites {enzyme,position,cutAt,site} + count", () => {
    const r = call("restriction-map", ctxA, { sequence: "GAATTCGGATCC" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, r.result.sites.length);
    const eco = r.result.sites.find((s) => s.enzyme === "EcoRI");
    const bam = r.result.sites.find((s) => s.enzyme === "BamHI");
    assert.deepEqual([eco.position, eco.cutAt, eco.site], [0, 1, "GAATTC"]);
    assert.deepEqual([bam.position, bam.cutAt, bam.site], [6, 7, "GGATCC"]);
    // sites are OBJECTS (not numbers) — pins the BioActionPanel render contract.
    assert.ok(r.result.sites.every((s) => typeof s === "object" && typeof s.enzyme === "string"));
    assert.ok(Array.isArray(r.result.enzymesScanned));
  });

  it("enzymes:[EcoRI] filter (the array shape BioActionPanel now sends) restricts the scan", () => {
    const r = call("restriction-map", ctxA, { sequence: "GAATTCGGATCC", enzymes: ["EcoRI"] });
    assert.equal(r.ok, true);
    assert.ok(r.result.sites.every((s) => s.enzyme === "EcoRI"));
    assert.deepEqual(r.result.enzymesScanned, ["EcoRI"]);
  });

  it("an unknown enzyme name yields zero sites (honest empty, not a crash)", () => {
    const r = call("restriction-map", ctxA, { sequence: "GAATTCGGATCC", enzymes: ["NOPE"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
    assert.deepEqual(r.result.enzymesScanned, []);
  });

  it("validation-rejection: empty sequence is rejected", () => {
    assert.equal(call("restriction-map", ctxA, { sequence: "" }).ok, false);
  });
});

// ── translate-orf — 6-frame translation (MolecularWorkbench OrfTab) ──────────

describe("bio.translate-orf — 6-frame translation + codon detail", () => {
  it("translates ATGAAATTTGGGTAA → MKFG* on frame +1 with a real longest ORF", () => {
    const r = call("translate-orf", ctxA, { sequence: "ATGAAATTTGGGTAA" });
    assert.equal(r.ok, true);
    assert.equal(r.result.frames.length, 6);
    const fwd1 = r.result.frames.find((f) => f.frame === 1);
    assert.equal(fwd1.protein, "MKFG*");
    // codon detail the OrfTab highlights.
    assert.equal(fwd1.codons[0].codon, "ATG");
    assert.equal(fwd1.codons[0].isStart, true);
    assert.equal(fwd1.codons[fwd1.codons.length - 1].isStop, true);
    assert.equal(r.result.longestOrf.frame, 1);
    assert.equal(r.result.longestOrf.peptide, "MKFG*");
  });

  it("validation-rejection: empty + non-ACGTUN input are rejected", () => {
    assert.equal(call("translate-orf", ctxA, { sequence: "" }).ok, false);
    assert.equal(call("translate-orf", ctxA, { sequence: "XYZ123" }).ok, false);
  });
});

// ── crispr-design — guide-RNA scan (MolecularWorkbench CrisprTab) ────────────

describe("bio.crispr-design — SpCas9 NGG guide design", () => {
  it("finds 20 nt protospacers + NGG PAMs with finite on-target/composite scores", () => {
    const target = "ATGGCCATGGCGCCCAGAACTGAGATCAATAGTACCCGTATTAACGGGTGA";
    const r = call("crispr-design", ctxA, { sequence: target });
    assert.equal(r.ok, true);
    assert.ok(r.result.guideCount >= 1);
    for (const g of r.result.guides) {
      assert.equal(g.guide.length, 20);
      assert.equal(g.pam[1], "G");
      assert.equal(g.pam[2], "G");
      assert.ok(Number.isFinite(g.onTargetScore) && g.onTargetScore >= 0 && g.onTargetScore <= 100);
      assert.ok(Number.isFinite(g.compositeScore));
    }
    // sorted best-composite-first (the table renders top-down).
    for (let i = 1; i < r.result.guides.length; i++) {
      assert.ok(r.result.guides[i - 1].compositeScore >= r.result.guides[i].compositeScore);
    }
    assert.equal(r.result.topGuide, r.result.guides[0]);
  });

  it("validation-rejection: too-short + non-DNA input are rejected", () => {
    assert.equal(call("crispr-design", ctxA, { sequence: "ATGC" }).ok, false);
    assert.equal(call("crispr-design", ctxA, { sequence: "###" }).ok, false);
  });
});

// ── per-user storage + degrade-graceful (STATE unavailable) ──────────────────

describe("bio — sequence storage is per-user + degrades gracefully", () => {
  it("a saved sequence is visible to its owner only", () => {
    const saved = call("sequence-save", ctxA, { name: "myGene", sequence: "ATGCATGC", kind: "dna" });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.sequence.name, "myGene");
    assert.equal(call("sequence-list", ctxA, {}).result.sequences.length, 1);
    // a different user sees none of user_a's sequences.
    assert.equal(call("sequence-list", ctxB, {}).result.sequences.length, 0);
  });

  it("state-backed macros fail-soft (ok:false) when STATE is unavailable", () => {
    globalThis._concordSTATE = undefined;
    for (const m of ["sequence-save", "sequence-list", "sequence-delete", "notebook-list", "notebook-create"]) {
      const r = call(m, ctxA, { name: "x", title: "x", id: "x" });
      assert.equal(r.ok, false, `${m} should fail-soft`);
      assert.match(r.error, /STATE unavailable/);
    }
  });

  it("pure-compute macros still work with no STATE (they don't touch it)", () => {
    globalThis._concordSTATE = undefined;
    const r = call("sequence-analyze", ctxA, { sequence: "ATGCATGC", kind: "dna" });
    assert.equal(r.ok, true);
    assert.equal(r.result.gcPercent, 50);
    assert.equal(fetchCalls, 0, "no network touched by pure-compute path");
  });
});
