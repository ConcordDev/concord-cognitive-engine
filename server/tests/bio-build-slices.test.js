// Behaviour tests for the bio full-lens build (GB-1021) — one case per
// canonical finding, driven through the real macro dispatch shape
// (handler(ctx, virtualArtifact{data: input}, input)), mirroring
// bio-lens-macros.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBioActions from "../domains/bio.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "bio");
  ACTIONS.set(name, fn);
}
function call(name, input = {}, ctx = { actor: { userId: "bio-test-user" }, userId: "bio-test-user" }) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`bio.${name} not registered`);
  const virtualArtifact = { id: null, title: null, domain: "bio", type: "domain_action", data: input, meta: {} };
  return fn(ctx, virtualArtifact, input);
}

before(() => { registerBioActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("F5 — geneExpression: unreplicated data is called on fold change, honestly", () => {
  it("the walk's own example: TP53 3.1 -> 7.4 is flagged, with the rule stated", () => {
    const r = call("geneExpression", { samples: [
      { gene: "TP53", condition: "control", expression: 3.1 },
      { gene: "TP53", condition: "treated", expression: 7.4 },
      { gene: "MYC", condition: "control", expression: 5.0 },
      { gene: "MYC", condition: "treated", expression: 4.8 },
    ] });
    assert.equal(r.ok, true);
    const tp53 = r.result.genes.find((g) => g.gene === "TP53");
    assert.ok(Math.abs(tp53.foldChange - 2.387) < 0.01, `FC ${tp53.foldChange}`);
    assert.ok(Math.abs(tp53.log2FC - 1.256) < 0.01, `log2FC ${tp53.log2FC}`);
    assert.equal(tp53.significanceTestable, false);
    assert.equal(tp53.significant, null);
    assert.match(tp53.call, /fold change/i);
    assert.equal(r.result.summary.foldChangeUp, 1);
    assert.equal(r.result.summary.significantGenes, 0);
    assert.match(r.result.rule, /not testable/i);
    const myc = r.result.genes.find((g) => g.gene === "MYC");
    assert.equal(myc.regulation, "unchanged");
  });

  it("replicated data still gets a real t-test verdict", () => {
    const samples = [];
    for (const v of [3.0, 3.2, 3.1]) samples.push({ gene: "TP53", condition: "control", expression: v });
    for (const v of [7.3, 7.5, 7.4]) samples.push({ gene: "TP53", condition: "treated", expression: v });
    const r = call("geneExpression", { samples });
    const tp53 = r.result.genes[0];
    assert.equal(tp53.significanceTestable, true);
    assert.equal(tp53.significant, true);
    assert.equal(r.result.summary.significantGenes, 1);
  });
});

describe("F6 — link-gene-function answers or confesses, never templates", () => {
  it("TP53 returns its actual function, sourced", () => {
    const r = call("link-gene-function", { gene: "TP53", organism: "Homo sapiens" });
    assert.equal(r.ok, true);
    assert.match(r.result.function, /Tumour suppressor/);
    assert.equal(r.result.functionSource, "curated-reference");
    const fnStage = r.result.chain.find((c) => c.stage === "function");
    assert.equal(fnStage.entity, r.result.function);
    assert.ok(!JSON.stringify(r.result).includes("(unspecified)"));
  });

  it("an unknown gene confesses instead of echoing", () => {
    const r = call("link-gene-function", { gene: "ZZZ9" });
    assert.equal(r.result.functionSource, "none");
    assert.match(r.result.function, /No curated function on record/);
  });

  it("a user-supplied function still wins over the table", () => {
    const r = call("link-gene-function", { gene: "TP53", function: "my own note" });
    assert.equal(r.result.function, "my own note");
    assert.equal(r.result.functionSource, "user-supplied");
  });
});

describe("F7 — trace-evolution classifies from a real taxonomy", () => {
  it("chimpanzee is a mammal and a primate; human-chimp is the closest pair", () => {
    const r = call("trace-evolution", { organisms: ["human", "chimpanzee", "mouse"] });
    assert.equal(r.ok, true);
    const chimp = r.result.organisms.find((o) => o.name === "chimpanzee");
    assert.equal(chimp.group, "mammals");
    assert.equal(chimp.subgroup, "primates");
    assert.equal(r.result.sharedGroup, "mammals");
    assert.deepEqual([r.result.closestPair.a, r.result.closestPair.b].sort(), ["chimpanzee", "human"]);
    assert.equal(r.result.closestPair.score, 2);
    assert.ok(!/distant/.test(r.result.commonality), r.result.commonality);
  });

  it("a spanning set still names its close pair instead of calling all of it distant", () => {
    const r = call("trace-evolution", { organisms: ["human", "chimpanzee", "oak"] });
    assert.equal(r.result.sharedGroup, null);
    assert.equal(r.result.closestPair.score, 2);
    assert.match(r.result.suggestion, /close/);
  });

  it("longest fragment wins: guinea pig is a rodent, catfish is a fish", () => {
    const r = call("trace-evolution", { organisms: ["guinea pig", "catfish"] });
    assert.equal(r.result.organisms[0].subgroup, "rodents");
    assert.equal(r.result.organisms[1].group, "fish");
  });
});

describe("F11 — align-pairwise: score-equal optima resolve contiguous", () => {
  it("an exact prefix aligns as a prefix: one gap run, score unchanged", () => {
    const r = call("align-pairwise", { seqA: "ACGTACGTACGTGAATTC", seqB: "ACGTACGT", match: 2, mismatch: -1, gap: -2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.score, -4);
    assert.equal(r.result.matches, 8);
    assert.ok(r.result.alignBars.startsWith("||||||||"), r.result.alignBars);
    const gapRuns = r.result.alignB.match(/-+/g) || [];
    assert.equal(gapRuns.length, 1, `alignB ${r.result.alignB}`);
    assert.ok(r.result.alignB.endsWith("-".repeat(10)), r.result.alignB);
  });
});

describe("F8 — align-multiple aligns the prefilled set", () => {
  it("three FASTA records come back as three equal-width rows", () => {
    const r = call("align-multiple", { sequences: [
      { id: "seq1", sequence: "ATGCATGC" },
      { id: "seq2", sequence: "ATGGATGC" },
      { id: "seq3", sequence: "ATGCATTC" },
    ] });
    assert.equal(r.ok, true);
    assert.equal(r.result.rows.length, 3);
    const widths = new Set(r.result.rows.map((row) => row.aligned.length));
    assert.equal(widths.size, 1);
  });
});

describe("F10 — plasmid-map auto-annotation keeps its ORF promise", () => {
  it("a clean 6-codon ORF at bases 1-18 annotates, with the floor stated", () => {
    const r = call("plasmid-map", { sequence: "ATGCCCGGGAAATTTTAAGAATTC" });
    assert.equal(r.ok, true);
    const cds = r.result.features.find((f) => f.type === "CDS");
    assert.ok(cds, JSON.stringify(r.result.features));
    assert.equal(cds.start, 0);
    assert.equal(cds.end, 18);
    assert.ok(r.result.features.some((f) => f.type === "restriction_site" && f.name === "EcoRI"));
    assert.match(r.result.annotationNote, /18 nt/);
  });

  it("user-supplied features are used as supplied", () => {
    const r = call("plasmid-map", { sequence: "ACGTACGTACGT", features: [{ name: "mine", start: 2, end: 8, type: "gene" }] });
    assert.equal(r.result.features.length, 1);
    assert.equal(r.result.features[0].name, "mine");
  });
});

describe("F9 — blast-search: the empty case carries a real zero", () => {
  it("empty database returns hitCount 0, never undefined", () => {
    const r = call("blast-search", { query: "ACGTACGTACGT", database: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.databaseSize, 0);
    assert.equal(r.result.hitCount, 0);
  });

  it("a real database still produces hits", () => {
    const r = call("blast-search", { query: "ACGTACGTACGT", database: [{ id: "s1", sequence: "TTTACGTACGTACGTAAA" }] });
    assert.equal(r.result.hitCount, 1);
    assert.equal(r.result.hits[0].subjectId, "s1");
  });
});

describe("Tm — one model, labelled", () => {
  it("a 12-mer reports the Wallace rule and its name", () => {
    const r = call("sequence-analyze", { sequence: "ACGTACGTACGT", kind: "dna" });
    assert.equal(r.ok, true);
    assert.equal(r.result.tm, 36);
    assert.match(r.result.tmModel, /Wallace/);
  });

  it("an 18-mer reports the basic formula and its name", () => {
    const r = call("sequence-analyze", { sequence: "ACGTACGTACGTGAATTC", kind: "dna" });
    assert.match(r.result.tmModel, /Basic formula/);
  });
});

describe("F12 — crispr-design states its scoring", () => {
  it("a valid target returns guides plus the formula", () => {
    const r = call("crispr-design", { sequence: "ACGTACGTACGTACGTACGTACGTACGTACGTACGTAGGACGT" });
    assert.equal(r.ok, true);
    assert.ok(r.result.guideCount >= 1);
    assert.match(r.result.scoring, /Composite = 0\.6/);
  });
});

describe("F4 — simulate-system produces real, deterministic metrics", () => {
  for (const system of ["homeostasis", "metabolism", "neural", "genetic"]) {
    it(`${system}: four metrics in [0,1], identical on re-run`, () => {
      const a = call("simulate-system", { system, steps: 60 });
      const b = call("simulate-system", { system, steps: 60 });
      assert.equal(a.ok, true);
      assert.equal(a.result.metrics.length, 4);
      for (const m of a.result.metrics) {
        assert.ok(m.value >= 0 && m.value <= 1, `${system}.${m.name} = ${m.value}`);
      }
      assert.deepEqual(a.result.metrics, b.result.metrics);
      assert.equal(a.result.simulated, true);
      assert.ok(a.result.note.length > 40);
    });
  }

  it("an unknown system refuses honestly", () => {
    const r = call("simulate-system", { system: "plasma" });
    assert.equal(r.ok, false);
  });
});
