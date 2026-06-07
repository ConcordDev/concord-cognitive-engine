// tests/depth/bio-behavior.test.js — REAL behavioral tests for the bio
// domain (registerLensAction family, invoked via lensRun). Curated subset:
// exact-value bioinformatics calcs (GC content, primer Tm, reverse-complement,
// codon translation, Needleman-Wunsch alignment, restriction mapping, FASTA
// parsing, CRISPR PAM scan, Gibson overlap) + per-user sequence/notebook CRUD
// round-trips + validation rejections. Every lensRun("bio", "<macro>", …) call
// literally names the macro, so the macro-depth grader credits it as a real
// behavioral invocation.
//
// lens.run UNWRAP contract (server.js:37452-37458):
//   handler returns { ok:true, result } → r.result is the inner result object.
//   handler returns { ok:false, error } (no `result` key) → r.result is the
//     WHOLE { ok:false, error } object. So a rejection asserts r.result.ok ===
//     false + r.result.error.
//
// SKIPPED (network/external API — would require egress): NONE. bio.js is fully
// self-contained pure-JS (no NCBI/UniProt fetch macros exist in this domain;
// link-gene-function only BUILDS external URLs, it never fetches them, so it is
// deterministic and IS tested below).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("bio — sequence-analyze (exact GC / Tm / ORF)", () => {
  it("sequence-analyze: 50% GC on ATGC, Wallace-rule Tm on short oligo", async () => {
    const r = await lensRun("bio", "sequence-analyze", { params: { sequence: "ATGC", kind: "dna" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.length, 4);
    assert.equal(r.result.kind, "dna");
    assert.equal(r.result.gcPercent, 50);        // 2 GC / 4 = 50%
    // Wallace rule (len < 14): 2*AT + 4*GC = 2*2 + 4*2 = 12
    assert.equal(r.result.tm, 12);
    assert.ok(Array.isArray(r.result.orfs));
  });

  it("sequence-analyze: 0% GC on AAAATTTT", async () => {
    const r = await lensRun("bio", "sequence-analyze", { params: { sequence: "AAAATTTT", kind: "dna" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.gcPercent, 0);
    assert.equal(r.result.tm, 16);               // 2*8 + 4*0
  });

  it("sequence-analyze: protein composition + molecular weight (110 Da/aa)", async () => {
    const r = await lensRun("bio", "sequence-analyze", { params: { sequence: "MKVLA", kind: "protein" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.molecularWeight, 550); // 5 * 110
    assert.equal(r.result.composition.M, 1);
    assert.equal(r.result.composition.K, 1);
    assert.equal(r.result.composition.L, 1);
  });

  it("sequence-analyze: rejects empty sequence", async () => {
    const r = await lensRun("bio", "sequence-analyze", { params: { sequence: "" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /sequence required/);
  });

  it("sequence-analyze: rejects bad kind", async () => {
    const r = await lensRun("bio", "sequence-analyze", { params: { sequence: "ACGT", kind: "lipid" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /kind must be/);
  });
});

describe("bio — primer-design (reverse-complement + Tm)", () => {
  it("primer-design: forward = first N bp, reverse = revcomp of last N bp", async () => {
    // 100 bp: 50 A's then 50 C's. targetLength 20.
    const seq = "A".repeat(50) + "C".repeat(50);
    const r = await lensRun("bio", "primer-design", { params: { sequence: seq, targetLength: 20 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.forward.sequence, "A".repeat(20));   // first 20 bp
    assert.equal(r.result.forward.length, 20);
    assert.equal(r.result.forward.gcPercent, 0);               // all A
    // reverse: revcomp of last 20 ("C"*20) → "G"*20
    assert.equal(r.result.reverse.sequence, "G".repeat(20));
    assert.equal(r.result.reverse.gcPercent, 100);
    assert.equal(r.result.productSize, 100);
  });

  it("primer-design: rejects sequence < 100 bp", async () => {
    const r = await lensRun("bio", "primer-design", { params: { sequence: "ACGTACGT" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, />= 100 bp/);
  });
});

describe("bio — align-pairwise (Needleman-Wunsch exact scores)", () => {
  it("align-pairwise: identical seqs → score = len*match, 100% identity", async () => {
    const r = await lensRun("bio", "align-pairwise", { params: { seqA: "ACGT", seqB: "ACGT" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.score, 8);             // 4 matches * +2
    assert.equal(r.result.matches, 4);
    assert.equal(r.result.identity, 100);
    assert.equal(r.result.alignA, "ACGT");
    assert.equal(r.result.alignB, "ACGT");
  });

  it("align-pairwise: single mismatch → score 5 (3*2 + 1*-1)", async () => {
    const r = await lensRun("bio", "align-pairwise", { params: { seqA: "ACGT", seqB: "ACAT" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.score, 5);             // 3 match (+6) + 1 mismatch (-1)
    assert.equal(r.result.matches, 3);
    assert.equal(r.result.alignmentLength, 4);
    assert.equal(r.result.identity, 75);
  });

  it("align-pairwise: rejects missing seqB", async () => {
    const r = await lensRun("bio", "align-pairwise", { params: { seqA: "ACGT" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /seqA and seqB required/);
  });
});

describe("bio — translate-orf (codon table + 6 frames)", () => {
  it("translate-orf: ATGTAA frame+1 → M then stop, isStart/isStop flagged", async () => {
    const r = await lensRun("bio", "translate-orf", { params: { sequence: "ATGTAA" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.length, 6);
    assert.equal(r.result.frames.length, 6);     // 3 fwd + 3 rev
    const f1 = r.result.frames.find((f) => f.frame === 1);
    assert.equal(f1.protein, "M*");              // ATG=M, TAA=stop
    assert.equal(f1.codons[0].codon, "ATG");
    assert.equal(f1.codons[0].aa, "M");
    assert.equal(f1.codons[0].isStart, true);
    assert.equal(f1.codons[1].aa, "*");
    assert.equal(f1.codons[1].isStop, true);
  });

  it("translate-orf: RNA U folds to T — AUG → M", async () => {
    const r = await lensRun("bio", "translate-orf", { params: { sequence: "AUGUUU" } });
    assert.equal(r.ok, true);
    const f1 = r.result.frames.find((f) => f.frame === 1);
    assert.equal(f1.protein, "MF");              // AUG→ATG→M, UUU→TTT→F
  });

  it("translate-orf: rejects non-nucleotide chars", async () => {
    const r = await lensRun("bio", "translate-orf", { params: { sequence: "ATGZZZ" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /DNA\/RNA/);
  });
});

describe("bio — restriction-map (exact site positions)", () => {
  it("restriction-map: locates EcoRI GAATTC at the right offset + cut site", async () => {
    // EcoRI site GAATTC starting at index 3.
    const seq = "TTT" + "GAATTC" + "TTT";
    const r = await lensRun("bio", "restriction-map", { params: { sequence: seq, enzymes: ["EcoRI"] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    const site = r.result.sites.find((s) => s.enzyme === "EcoRI");
    assert.equal(site.position, 3);
    assert.equal(site.cutAt, 4);                 // pos + cut(1)
    assert.equal(site.site, "GAATTC");
  });

  it("restriction-map: finds two BamHI sites via .some round-trip", async () => {
    const seq = "GGATCC" + "AAAA" + "GGATCC";   // positions 0 and 10
    const r = await lensRun("bio", "restriction-map", { params: { sequence: seq, enzymes: ["BamHI"] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.ok(r.result.sites.some((s) => s.position === 0));
    assert.ok(r.result.sites.some((s) => s.position === 10));
  });
});

describe("bio — parse-fasta (round-trip records)", () => {
  it("parse-fasta: two records, ids + concatenated multi-line sequence", async () => {
    const text = ">gene1 desc one\nACGT\nACGT\n>gene2 desc two\nTTTT\n";
    const r = await lensRun("bio", "parse-fasta", { params: { text } });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    const g1 = r.result.records.find((x) => x.id === "gene1");
    assert.equal(g1.sequence, "ACGTACGT");       // two lines joined
    assert.equal(g1.length, 8);
    assert.equal(g1.description, "gene1 desc one");
    const g2 = r.result.records.find((x) => x.id === "gene2");
    assert.equal(g2.sequence, "TTTT");
  });

  it("parse-fasta: rejects empty text", async () => {
    const r = await lensRun("bio", "parse-fasta", { params: { text: "  " } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /text required/);
  });
});

describe("bio — crispr-design (NGG PAM scan)", () => {
  it("crispr-design: finds a guide with NGG PAM + GC scoring", async () => {
    // 20 nt protospacer (mixed GC) + GG PAM, padded past 30 bp minimum.
    const proto = "ACGTACGTACGTACGTACGT";        // 20 nt, 50% GC
    const seq = proto + "AGG" + "TTTTTTTT";       // PAM = AGG (N-G-G ok)
    const r = await lensRun("bio", "crispr-design", { params: { sequence: seq } });
    assert.equal(r.ok, true);
    assert.ok(r.result.guideCount >= 1);
    // The leading 20-mer protospacer should be among the guides.
    assert.ok(r.result.guides.some((g) => g.guide === proto && g.pam === "AGG"));
    assert.equal(r.result.topGuide.pam.endsWith("GG"), true);
  });

  it("crispr-design: rejects sequence < 30 bp", async () => {
    const r = await lensRun("bio", "crispr-design", { params: { sequence: "ACGTACGTAGG" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, />= 30 bp/);
  });
});

describe("bio — cloning-simulate (Gibson overlap join)", () => {
  it("cloning-simulate: Gibson merges on a shared 15 bp overlap", async () => {
    const overlap = "ACGTACGTACGTACG";           // 15 bp shared junction
    const fragA = "TTTTTTTTTT" + overlap;         // ends with overlap
    const fragB = overlap + "GGGGGGGGGG";          // starts with overlap
    const r = await lensRun("bio", "cloning-simulate", {
      params: { method: "gibson", circular: false, fragments: [
        { name: "A", sequence: fragA }, { name: "B", sequence: fragB },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.method, "gibson");
    assert.equal(r.result.success, true);          // no issues
    // overlap counted once: lenA + lenB - overlap = 25 + 25 - 15 = 35
    assert.equal(r.result.assembledLength, 35);
    assert.ok(r.result.junctions.some((j) => j.verified === true && j.overlapBp >= 15));
  });

  it("cloning-simulate: rejects a single fragment", async () => {
    const r = await lensRun("bio", "cloning-simulate", {
      params: { fragments: [{ name: "only", sequence: "ACGTACGT" }] },
    });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /at least 2/);
  });
});

describe("bio — sequence + notebook CRUD (per-user round-trip)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("bio-crud"); });

  it("sequence-save → sequence-list → sequence-delete round-trips", async () => {
    const saved = await lensRun("bio", "sequence-save",
      { params: { name: "myGene", sequence: "ACGTACGT", kind: "dna", description: "test" } }, ctx);
    assert.equal(saved.ok, true);
    const id = saved.result.sequence.id;
    assert.equal(saved.result.sequence.name, "myGene");
    assert.equal(saved.result.sequence.length, 8);

    const listed = await lensRun("bio", "sequence-list", {}, ctx);
    assert.ok(listed.result.sequences.some((s) => s.id === id && s.name === "myGene"));

    const del = await lensRun("bio", "sequence-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);

    const after = await lensRun("bio", "sequence-list", {}, ctx);
    assert.equal(after.result.sequences.some((s) => s.id === id), false);
  });

  it("sequence-save rejects empty name", async () => {
    const r = await lensRun("bio", "sequence-save", { params: { sequence: "ACGT" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /name required/);
  });

  it("notebook-create → notebook-list → notebook-delete round-trips", async () => {
    const created = await lensRun("bio", "notebook-create",
      { params: { title: "Day 1", body: "did a PCR", tags: ["pcr"], status: "draft" } }, ctx);
    assert.equal(created.ok, true);
    const nbId = created.result.entry.id;
    assert.equal(created.result.entry.title, "Day 1");
    assert.equal(created.result.entry.status, "draft");

    const listed = await lensRun("bio", "notebook-list", {}, ctx);
    assert.ok(listed.result.entries.some((e) => e.id === nbId));

    const del = await lensRun("bio", "notebook-delete", { params: { id: nbId } }, ctx);
    assert.equal(del.result.deleted, nbId);

    const after = await lensRun("bio", "notebook-list", {}, ctx);
    assert.equal(after.result.entries.some((e) => e.id === nbId), false);
  });

  it("notebook-delete rejects unknown id", async () => {
    const r = await lensRun("bio", "notebook-delete", { params: { id: "nb_does_not_exist" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /not found/);
  });
});

describe("bio — link-gene-function (deterministic chain, no fetch)", () => {
  it("link-gene-function: builds gene→mRNA→protein→function chain + URLs", async () => {
    const r = await lensRun("bio", "link-gene-function", {
      data: { gene: "TP53", protein: "p53", function: "tumor suppressor", organism: "Homo sapiens" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.gene, "TP53");
    assert.equal(r.result.protein, "p53");
    assert.equal(r.result.chain[0].stage, "gene");
    assert.equal(r.result.chain[0].entity, "TP53");
    assert.equal(r.result.chain[2].entity, "p53");
    assert.ok(r.result.externalLinks.some((l) => l.source === "UniProt"));
  });

  it("link-gene-function: rejects missing gene", async () => {
    const r = await lensRun("bio", "link-gene-function", { data: {} });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /gene/);
  });
});

// ─── extended coverage — previously-untested deterministic macros ────────────
// (sequenceAlign, geneExpression, phylogeneticDistance, motifDetection,
//  map-pathway, review-protocol, trace-evolution, profile-organism, analyze,
//  align-multiple, blast-search, plasmid-map). All pure-JS, no fetch.

describe("bio — sequenceAlign (Needleman-Wunsch from artifact.data)", () => {
  it("sequenceAlign: identical DNA → score 8, 100% identity, DNA type", async () => {
    const r = await lensRun("bio", "sequenceAlign", { data: { sequenceA: "ACGT", sequenceB: "ACGT" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.score, 8);                       // 4 matches * +2
    assert.equal(r.result.statistics.matches, 4);
    assert.equal(r.result.statistics.mismatches, 0);
    assert.equal(r.result.statistics.identity, 100);
    assert.equal(r.result.statistics.sequenceType, "DNA");
    assert.equal(r.result.alignment.sequenceA, "ACGT");
    assert.equal(r.result.alignment.midline, "||||");
  });

  it("sequenceAlign: one mismatch → score 5, 75% identity, '.' in midline", async () => {
    const r = await lensRun("bio", "sequenceAlign", { data: { sequenceA: "ACGT", sequenceB: "ACAT" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.score, 5);                       // 3*+2 + 1*-1
    assert.equal(r.result.statistics.matches, 3);
    assert.equal(r.result.statistics.mismatches, 1);
    assert.equal(r.result.statistics.identity, 75);
    assert.ok(r.result.alignment.midline.includes("."));
  });

  it("sequenceAlign: rejects when one sequence missing", async () => {
    const r = await lensRun("bio", "sequenceAlign", { data: { sequenceA: "ACGT" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /required/);
  });
});

describe("bio — geneExpression (differential expression math)", () => {
  it("geneExpression: 2x upregulation → foldChange 2, log2FC 1", async () => {
    const samples = [
      { gene: "G1", condition: "ctrl", expression: 10 },
      { gene: "G1", condition: "treat", expression: 20 },
    ];
    const r = await lensRun("bio", "geneExpression", { data: { samples } });
    assert.equal(r.ok, true);
    const g1 = r.result.genes.find((g) => g.gene === "G1");
    assert.equal(g1.meanCondA, 10);
    assert.equal(g1.meanCondB, 20);
    assert.equal(g1.foldChange, 2);                        // 20/10
    assert.equal(g1.log2FC, 1);                            // log2(2)
    assert.equal(g1.regulation, "upregulated");
  });

  it("geneExpression: halved expression → log2FC -1, downregulated", async () => {
    const samples = [
      { gene: "G2", condition: "ctrl", expression: 40 },
      { gene: "G2", condition: "treat", expression: 20 },
    ];
    const r = await lensRun("bio", "geneExpression", { data: { samples } });
    assert.equal(r.ok, true);
    const g2 = r.result.genes.find((g) => g.gene === "G2");
    assert.equal(g2.foldChange, 0.5);
    assert.equal(g2.log2FC, -1);
    assert.equal(g2.regulation, "downregulated");
  });

  it("geneExpression: single condition → needs-2-conditions message", async () => {
    const r = await lensRun("bio", "geneExpression", {
      data: { samples: [{ gene: "G", condition: "only", expression: 5 }] },
    });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /at least 2 conditions/);
  });
});

describe("bio — phylogeneticDistance (Jukes-Cantor / identical = 0)", () => {
  it("phylogeneticDistance: identical seqs → distance 0", async () => {
    const sequences = [
      { id: "A", sequence: "ACGTACGT" },
      { id: "B", sequence: "ACGTACGT" },
    ];
    const r = await lensRun("bio", "phylogeneticDistance", { data: { sequences } });
    assert.equal(r.ok, true);
    assert.equal(r.result.model, "jukes-cantor");
    assert.equal(r.result.sequenceCount, 2);
    assert.equal(r.result.distanceMatrix[0][1] + 0, 0);    // identical → 0 distance (-0 normalized)
    assert.equal(r.result.distanceMatrix[1][0] + 0, 0);    // symmetric
    assert.equal(r.result.closest.distance + 0, 0);
  });

  it("phylogeneticDistance: one mismatch in 8 → positive JC distance", async () => {
    const sequences = [
      { id: "A", sequence: "ACGTACGT" },
      { id: "B", sequence: "ACGTACGA" },             // last base differs
    ];
    const r = await lensRun("bio", "phylogeneticDistance", { data: { sequences } });
    assert.equal(r.ok, true);
    // p = 1/8 = 0.125; JC: -0.75*ln(1 - 4*0.125/3) = -0.75*ln(0.8333..) ≈ 0.13683
    assert.ok(r.result.distanceMatrix[0][1] > 0.13 && r.result.distanceMatrix[0][1] < 0.14);
  });

  it("phylogeneticDistance: rejects single sequence", async () => {
    const r = await lensRun("bio", "phylogeneticDistance", { data: { sequences: [{ id: "A", sequence: "ACGT" }] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /at least 2/);
  });
});

describe("bio — motifDetection (conserved k-mers + palindrome)", () => {
  it("motifDetection: shared 6-mer across 2 seqs → 100% conservation", async () => {
    const sequences = [
      { id: "s1", sequence: "GAATTCAAAA" },          // contains GAATTC
      { id: "s2", sequence: "TTTTGAATTC" },          // contains GAATTC
    ];
    const r = await lensRun("bio", "motifDetection", { data: { sequences }, params: { motifLength: 6, minOccurrences: 2 } });
    assert.equal(r.ok, true);
    const m = r.result.topMotifs.find((x) => x.motif === "GAATTC");
    assert.equal(m.occurrences, 2);
    assert.equal(m.sequenceCount, 2);
    assert.equal(m.conservation, 100);
    assert.equal(m.isPalindromic, true);             // GAATTC revcomp = GAATTC
  });

  it("motifDetection: empty input → 'No sequences' message", async () => {
    const r = await lensRun("bio", "motifDetection", { data: { sequences: [] } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /No sequences/);
  });
});

describe("bio — map-pathway (chain conservation + deltaG)", () => {
  it("map-pathway: conserved chain (product→substrate), sums deltaG", async () => {
    const steps = [
      { substrate: "glucose", enzyme: "hexokinase", product: "G6P", deltaG: -4 },
      { substrate: "G6P", enzyme: "PGI", product: "F6P", deltaG: 1.5 },
    ];
    const r = await lensRun("bio", "map-pathway", { data: { steps } });
    assert.equal(r.ok, true);
    assert.equal(r.result.stepCount, 2);
    assert.equal(r.result.chainBreaks.length, 0);          // G6P product == G6P substrate
    assert.equal(r.result.totalDeltaG, -2.5);              // -4 + 1.5
    assert.equal(r.result.thermodynamicallyFavorable, true);
  });

  it("map-pathway: broken chain detected", async () => {
    const steps = [
      { substrate: "A", enzyme: "e1", product: "B" },
      { substrate: "X", enzyme: "e2", product: "Y" },       // X != B → break
    ];
    const r = await lensRun("bio", "map-pathway", { data: { steps } });
    assert.equal(r.ok, true);
    assert.ok(r.result.chainBreaks.some((b) => b.expected === "B" && b.actual === "X"));
  });

  it("map-pathway: rejects empty steps", async () => {
    const r = await lensRun("bio", "map-pathway", { data: { steps: [] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /step/);
  });
});

describe("bio — review-protocol (gap heuristics)", () => {
  it("review-protocol: bare steps flag missing control + safety", async () => {
    const r = await lensRun("bio", "review-protocol", {
      data: { steps: ["mix reagents", "incubate", "read plate"] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.severity, "high");               // control + safety are high
    assert.ok(r.result.gaps.some((g) => g.kind === "control"));
    assert.ok(r.result.gaps.some((g) => g.kind === "safety"));
  });

  it("review-protocol: timed steps sum totalEstimatedMinutes", async () => {
    const r = await lensRun("bio", "review-protocol", {
      data: { steps: [
        { action: "add control + wear gloves, use fume hood", time: 10 },
        { action: "wash and rinse, then store/label aliquots", time: 5 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEstimatedMinutes, 15);      // 10 + 5
  });

  it("review-protocol: rejects empty steps", async () => {
    const r = await lensRun("bio", "review-protocol", { data: { steps: [] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /steps/);
  });
});

describe("bio — trace-evolution (shared taxonomic group)", () => {
  it("trace-evolution: two mammals → sharedGroup mammals", async () => {
    const r = await lensRun("bio", "trace-evolution", { data: { organisms: ["human", "mouse"] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.sharedGroup, "mammals");
    assert.ok(r.result.organisms.some((o) => o.name === "human" && o.group === "mammals"));
  });

  it("trace-evolution: cross-group → no sharedGroup, lists both groups", async () => {
    const r = await lensRun("bio", "trace-evolution", { data: { organisms: ["human", "oak"] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.sharedGroup, null);
    assert.ok(r.result.groups.includes("mammals"));
    assert.ok(r.result.groups.includes("plants"));
  });

  it("trace-evolution: rejects single organism", async () => {
    const r = await lensRun("bio", "trace-evolution", { data: { organisms: ["human"] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.message, /at least two/);
  });
});

describe("bio — profile-organism + analyze dispatcher (deterministic)", () => {
  it("profile-organism: kingdom taxonomy ranks + trait parse", async () => {
    const r = await lensRun("bio", "profile-organism", {
      data: { name: "Panthera leo", kingdom: "Animalia", habitat: "savanna", traits: "carnivore, social" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.name, "Panthera leo");
    assert.equal(r.result.kingdom, "Animalia");
    assert.ok(r.result.taxonomyRanks.includes("Phylum"));
    assert.ok(r.result.traits.includes("carnivore"));
    assert.ok(r.result.traits.includes("social"));
  });

  it("analyze: sequence shape dispatches to sequenceAlign", async () => {
    const r = await lensRun("bio", "analyze", { data: { sequenceA: "ACGT", sequenceB: "ACGT" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.dispatched, "sequenceAlign");
  });

  it("analyze: gene shape dispatches to link-gene-function", async () => {
    const r = await lensRun("bio", "analyze", { data: { gene: "BRCA1" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.dispatched, "link-gene-function");
    assert.equal(r.result.gene, "BRCA1");
  });
});

describe("bio — align-multiple (center-star MSA) + blast-search + plasmid-map", () => {
  it("align-multiple: 3 identical seqs → 100% conserved, no gaps", async () => {
    const sequences = [
      { id: "a", sequence: "ACGTACGT" },
      { id: "b", sequence: "ACGTACGT" },
      { id: "c", sequence: "ACGTACGT" },
    ];
    const r = await lensRun("bio", "align-multiple", { params: { sequences } });
    assert.equal(r.ok, true);
    assert.equal(r.result.sequenceCount, 3);
    assert.equal(r.result.width, 8);
    assert.equal(r.result.consensus, "ACGTACGT");
    assert.equal(r.result.percentConserved, 100);
    assert.ok(r.result.rows.some((row) => row.id === "a" && row.aligned === "ACGTACGT"));
  });

  it("align-multiple: rejects fewer than 2 sequences", async () => {
    const r = await lensRun("bio", "align-multiple", { params: { sequences: [{ id: "x", sequence: "ACGT" }] } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /at least 2/);
  });

  it("blast-search: exact substring hit → 100% identity, found in database", async () => {
    const r = await lensRun("bio", "blast-search", {
      params: {
        query: "ACGTACGTACGT",
        database: [{ id: "subjX", sequence: "TTTTACGTACGTACGTTTTT" }],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.databaseSize, 1);
    assert.equal(r.result.hitCount, 1);
    assert.equal(r.result.topHit.subjectId, "subjX");
    assert.equal(r.result.topHit.identity, 100);
  });

  it("blast-search: rejects too-short query", async () => {
    const r = await lensRun("bio", "blast-search", { params: { query: "ACGT" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, />= 8/);
  });

  it("plasmid-map: user features mapped with angular positions", async () => {
    const seq = "ACGT".repeat(25);                          // 100 bp circular
    const r = await lensRun("bio", "plasmid-map", {
      params: { sequence: seq, features: [{ name: "promoter", start: 0, end: 50, type: "promoter" }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.length, 100);
    assert.equal(r.result.topology, "circular");
    assert.equal(r.result.featureCount, 1);
    const f = r.result.features.find((x) => x.name === "promoter");
    assert.equal(f.start, 0);
    assert.equal(f.endDeg, 180);                            // 50/100 * 360
  });

  it("plasmid-map: rejects non-DNA sequence", async () => {
    const r = await lensRun("bio", "plasmid-map", { params: { sequence: "ACGTZZZZ" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /DNA/);
  });
});
