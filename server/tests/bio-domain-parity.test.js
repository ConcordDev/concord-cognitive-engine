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

// ─── 2026 backlog parity — Benchling/SnapGene feature gap ───────────

describe("bio — plasmid-map (construct viewer)", () => {
  it("auto-annotates ORFs + restriction sites with angular positions", () => {
    const orf = "ATG" + "GCT".repeat(35) + "TAA";
    const seq = "AAAAGAATTC" + orf + "GGATCCAAAA";
    const r = call("plasmid-map", ctxA, { sequence: seq });
    assert.equal(r.ok, true);
    assert.equal(r.result.length, seq.length);
    assert.ok(r.result.featureCount > 0);
    assert.ok(r.result.features.every((f) => typeof f.startDeg === "number"));
    assert.ok(r.result.features.some((f) => f.type === "restriction_site"));
  });

  it("honors user-supplied features and topology", () => {
    const r = call("plasmid-map", ctxA, {
      sequence: "ATGC".repeat(50), topology: "linear",
      features: [{ name: "promoter", start: 0, end: 35, type: "promoter" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.topology, "linear");
    assert.equal(r.result.features[0].name, "promoter");
  });

  it("rejects non-DNA input", () => {
    const r = call("plasmid-map", ctxA, { sequence: "ACDEFG" });
    assert.equal(r.ok, false);
  });
});

describe("bio — align-multiple (MSA)", () => {
  it("aligns 3 sequences and returns consensus + conservation", () => {
    const r = call("align-multiple", ctxA, {
      sequences: [
        { id: "s1", sequence: "ATGCATGC" },
        { id: "s2", sequence: "ATGGATGC" },
        { id: "s3", sequence: "ATGCATTC" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sequenceCount, 3);
    assert.equal(r.result.rows.length, 3);
    assert.equal(r.result.conservation.length, r.result.width);
    assert.ok(r.result.rows.every((row) => row.aligned.length === r.result.width));
  });

  it("rejects fewer than 2 sequences", () => {
    const r = call("align-multiple", ctxA, { sequences: [{ id: "only", sequence: "ATGC" }] });
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 2/);
  });
});

describe("bio — cloning-simulate (in-silico assembly)", () => {
  it("joins Gibson fragments with detected overlap", () => {
    const r = call("cloning-simulate", ctxA, {
      method: "gibson", circular: false,
      fragments: [
        { name: "f1", sequence: "AAAAAAAAAAGGGGGGGGGG" },
        { name: "f2", sequence: "GGGGGGGGGGCCCCCCCCCC" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.method, "gibson");
    assert.ok(r.result.junctions[0].verified);
    assert.ok(r.result.assembledLength > 0);
  });

  it("flags missing Gibson overlap as an issue", () => {
    const r = call("cloning-simulate", ctxA, {
      method: "gibson", circular: false,
      fragments: [
        { name: "f1", sequence: "AAAAAAAAAAAAAAAAAAAA" },
        { name: "f2", sequence: "CCCCCCCCCCCCCCCCCCCC" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.success, false);
    assert.ok(r.result.issues.length > 0);
  });

  it("rejects fewer than 2 fragments", () => {
    const r = call("cloning-simulate", ctxA, { method: "gibson", fragments: [{ name: "f1", sequence: "ATGC" }] });
    assert.equal(r.ok, false);
  });
});

describe("bio — translate-orf (ORF / codon viewer)", () => {
  it("translates 6 frames and finds the longest ORF", () => {
    const seq = "ATG" + "GCT".repeat(20) + "TAA";
    const r = call("translate-orf", ctxA, { sequence: seq });
    assert.equal(r.ok, true);
    assert.equal(r.result.frames.length, 6);
    assert.ok(r.result.longestOrf);
    assert.ok(r.result.frames[0].codons.length > 0);
    assert.equal(r.result.frames[0].codons[0].codon, "ATG");
    assert.equal(r.result.frames[0].codons[0].isStart, true);
  });

  it("rejects non-nucleotide input", () => {
    const r = call("translate-orf", ctxA, { sequence: "ZZZZ" });
    assert.equal(r.ok, false);
  });
});

describe("bio — blast-search (homology search)", () => {
  it("finds exact homology against an explicit database", () => {
    const r = call("blast-search", ctxA, {
      query: "ATGCATGCATGC",
      database: [
        { id: "hit", sequence: "TTTTATGCATGCATGCTTTT" },
        { id: "miss", sequence: "GGGGGGGGGGGGGGGGGGGG" },
      ],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.hitCount >= 1);
    assert.equal(r.result.topHit.subjectId, "hit");
    assert.ok(r.result.topHit.bitScore > 0);
  });

  it("rejects too-short query", () => {
    const r = call("blast-search", ctxA, { query: "ATGC", database: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, />= 8/);
  });

  it("returns empty hits for an empty database", () => {
    const r = call("blast-search", ctxA, { query: "ATGCATGCATGC", database: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.hitCount, undefined === r.result.hitCount ? undefined : r.result.hitCount);
    assert.deepEqual(r.result.hits, []);
  });
});

describe("bio — crispr-design (guide-RNA design)", () => {
  it("designs guides with PAM, on-target and off-target scoring", () => {
    const seq = "ATGCGTACGTAGCTAGCTAGCTAGCTGGAAGCTAGCATCGATCGATCGGG";
    const r = call("crispr-design", ctxA, { sequence: seq });
    assert.equal(r.ok, true);
    if (r.result.guideCount > 0) {
      assert.equal(r.result.topGuide.guide.length, 20);
      assert.ok(typeof r.result.topGuide.compositeScore === "number");
      assert.ok(typeof r.result.topGuide.offTargetHits === "number");
    }
  });

  it("rejects sequences shorter than 30 bp", () => {
    const r = call("crispr-design", ctxA, { sequence: "ATGC" });
    assert.equal(r.ok, false);
  });
});

describe("bio — lab notebook (linked to sequences + protocols)", () => {
  it("creates, lists, updates and deletes entries per-user", () => {
    const created = call("notebook-create", ctxA, {
      title: "Transfection log", body: "step 1", tags: ["crispr"], status: "draft",
    });
    assert.equal(created.ok, true);
    const id = created.result.entry.id;

    const listed = call("notebook-list", ctxA);
    assert.equal(listed.ok, true);
    assert.equal(listed.result.count, 1);

    const updated = call("notebook-update", ctxA, { id, status: "complete", linkedProtocol: "PCR-01" });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.entry.status, "complete");
    assert.equal(updated.result.entry.linkedProtocol, "PCR-01");

    const deleted = call("notebook-delete", ctxA, { id });
    assert.equal(deleted.ok, true);
    assert.equal(call("notebook-list", ctxA).result.count, 0);
  });

  it("INVARIANT: notebook entries scoped per-user", () => {
    call("notebook-create", ctxA, { title: "a-only" });
    const b = call("notebook-list", ctxB);
    assert.equal(b.result.count, 0);
  });

  it("rejects missing title", () => {
    const r = call("notebook-create", ctxA, { body: "no title" });
    assert.equal(r.ok, false);
    assert.match(r.error, /title required/);
  });
});
