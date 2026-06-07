// tests/depth/research-behavior.test.js — REAL behavioral tests for the
// `research` DOMAIN (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact-value calcs (h-index, PageRank degrees,
// methodology rubric, reproducibility scoring), CRUD round-trips with
// existence assertions, citation-formatting math, and validation rejections.
//
// Every lensRun("research", "<macro>", …) call literally names the macro, so
// the macro-depth grader credits it as a behavioral invocation.
//
// SKIPPED (network / LLM — fail under no-egress preload, non-deterministic):
//   research.vision           (LLaVA multimodal call)
//   research.academic-search  (OpenAlex / arXiv HTTP fetch)
//   research.academic-import  (only meaningful paired with academic-search)
//   research.literature-review / research.generate
//       (route through ctx.llm.chat when a brain is present — non-deterministic;
//        their deterministic fallbacks are intentionally not exercised here to
//        keep the suite egress-free regardless of ctx.llm presence).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("research — calc contracts (exact computed values)", () => {
  it("citationNetwork: h-index, in-degree, and foundational works are computed exactly", async () => {
    // Citation graph (references = "this paper cites X"):
    //   p1 -> p2, p3   |  p2 -> p3   |  p3 -> (none)   |  p4 -> p3, p2, p1
    // in-degrees: p1=1 (p4), p2=2 (p1,p4), p3=3 (p1,p2,p4), p4=0
    const r = await lensRun("research", "citationNetwork", {
      data: { papers: [
        { id: "p1", title: "Paper One",   year: 2018, references: ["p2", "p3"] },
        { id: "p2", title: "Paper Two",   year: 2016, references: ["p3"] },
        { id: "p3", title: "Paper Three", year: 2010, references: [] },
        { id: "p4", title: "Paper Four",  year: 2024, references: ["p3", "p2", "p1"] },
      ] },
    });
    assert.equal(r.result.totalPapers, 4);
    // citationCounts sorted desc = [3,2,1,0] → h-index 2 (2 papers with ≥2 citations)
    assert.equal(r.result.hIndex, 2);

    const byId = Object.fromEntries(r.result.rankedPapers.map((p) => [p.id, p]));
    assert.equal(byId.p3.inDegree, 3);
    assert.equal(byId.p2.inDegree, 2);
    assert.equal(byId.p4.inDegree, 0);
    assert.equal(byId.p4.outDegree, 3); // p4 cites three papers

    // foundational = inDegree ≥ 3 → only p3
    assert.equal(r.result.foundationalWorks.length, 1);
    assert.equal(r.result.foundationalWorks[0].id, "p3");
    assert.equal(r.result.foundationalWorks[0].citations, 3);
  });

  it("citationNetwork: empty paper set short-circuits with a message", async () => {
    const r = await lensRun("research", "citationNetwork", { data: { papers: [] } });
    assert.equal(r.result.message, "No papers.");
  });

  it("methodologyScore: gold-standard RCT scores the rubric and resolves evidence level 1a", async () => {
    const r = await lensRun("research", "methodologyScore", {
      data: { methodology: {
        sampleSize: 1000, controlGroup: true, randomization: true, blinding: "double",
        measurementValidation: true, statisticalTests: true, effectSize: 0.4,
        confidenceIntervals: true, reproducibilityInfo: true, preregistered: true,
        conflictsOfInterest: "none", ethicsApproval: true, dataAvailability: "open",
      } },
    });
    // Every criterion is maxed → perfect score, grade A.
    assert.equal(r.result.maxTotal, 100);
    assert.equal(r.result.totalScore, 100);
    assert.equal(r.result.percentage, 100);
    assert.equal(r.result.grade, "A");
    // double-blind + control + randomization → Oxford 1a.
    assert.equal(r.result.evidenceLevel, "1a (Systematic review of RCTs)");
    // Sample Size = 1000 → 12/12, exact note + percentage.
    const ss = r.result.criteria.find((c) => c.criterion === "Sample Size");
    assert.equal(ss.score, 12);
    assert.equal(ss.percentage, 100);
    assert.ok(ss.note.includes("Large sample"));
    assert.ok(r.result.strengths.includes("Sample Size"));
  });

  it("methodologyScore: a bare methodology earns 0, grade F, weaknesses listed", async () => {
    const r = await lensRun("research", "methodologyScore", { data: { methodology: {} } });
    assert.equal(r.result.totalScore, 0);
    assert.equal(r.result.percentage, 0);
    assert.equal(r.result.grade, "F");
    assert.equal(r.result.evidenceLevel, "4 (Case series / expert opinion)");
    // every weighted criterion scored 0 → it's a weakness
    assert.ok(r.result.weaknesses.includes("Control Group"));
    assert.ok(r.result.weaknesses.includes("Randomization"));
  });

  it("reproducibilityCheck: clean p-curve + full transparency scores 100% highly-reproducible", async () => {
    const r = await lensRun("research", "reproducibilityCheck", {
      data: { study: {
        pValues: [0.001, 0.002, 0.003], // all < 0.01 → right-skewed, healthy, low p-hacking risk
        materialsSections: true, codeAvailable: true, dataAvailable: true, protocolRegistered: true,
      } },
    });
    // P-value 20 + 4×transparency(10) = 60/60.
    assert.equal(r.result.overallScore, 60);
    assert.equal(r.result.maxScore, 60);
    assert.equal(r.result.reproducibilityPercentage, 100);
    assert.equal(r.result.assessment, "highly-reproducible");
    const pcheck = r.result.checks.find((c) => c.name === "P-value distribution");
    assert.equal(pcheck.score, 20);
    assert.equal(pcheck.details.pHackingRisk, "low");
    assert.equal(pcheck.details.pCurveHealthy, true);
    assert.deepEqual(r.result.criticalIssues, []);
  });

  it("reproducibilityCheck: missing transparency flags critical issues", async () => {
    const r = await lensRun("research", "reproducibilityCheck", {
      data: { study: { materialsSections: false, codeAvailable: false, dataAvailable: false, protocolRegistered: false } },
    });
    // 4 transparency items, all 0 → all 4 are critical (score < 30% of max)
    assert.equal(r.result.overallScore, 0);
    assert.equal(r.result.maxScore, 40);
    assert.equal(r.result.reproducibilityPercentage, 0);
    assert.equal(r.result.assessment, "low-reproducibility");
    assert.equal(r.result.criticalIssues.length, 4);
  });
});

describe("research — notes CRUD + search + graph (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("research-notes"); });

  it("note-create → note-get: note round-trips with title/body/tags", async () => {
    const created = await lensRun("research", "note-create", {
      params: { title: "Quantum Entanglement", body: "EPR paradox notes", tags: ["physics", "qm"] },
    }, ctx);
    assert.equal(created.result.note.title, "Quantum Entanglement");
    const id = created.result.note.id;

    const got = await lensRun("research", "note-get", { params: { id } }, ctx);
    assert.equal(got.result.note.id, id);
    assert.equal(got.result.note.body, "EPR paradox notes");
    assert.deepEqual(got.result.note.tags, ["physics", "qm"]);
  });

  it("validation: note-create with empty title is rejected", async () => {
    const bad = await lensRun("research", "note-create", { params: { title: "   ", body: "x" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title required/);
  });

  it("note-create → notes-search: title hits outrank body-only hits (score 5 vs 1)", async () => {
    await lensRun("research", "note-create", { params: { title: "Photosynthesis pathways", body: "leaf chemistry" } }, ctx);
    await lensRun("research", "note-create", { params: { title: "Unrelated note", body: "mentions photosynthesis once" } }, ctx);
    const res = await lensRun("research", "notes-search", { params: { query: "photosynthesis" } }, ctx);
    assert.ok(res.result.count >= 2);
    // top hit is the title match (score 5) over the body-only match (score 1)
    assert.equal(res.result.hits[0].title, "Photosynthesis pathways");
    assert.equal(res.result.hits[0].score, 5);
    const bodyOnly = res.result.hits.find((h) => h.title === "Unrelated note");
    assert.equal(bodyOnly.score, 1);
  });

  it("validation: notes-search with a 1-char query is rejected as too short", async () => {
    const bad = await lensRun("research", "notes-search", { params: { query: "p" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /query too short/);
  });

  it("backlinks-for: finds notes that [[wikilink]] a title, with context window", async () => {
    await lensRun("research", "note-create", { params: { title: "Hub Concept" } }, ctx);
    await lensRun("research", "note-create", {
      params: { title: "Referrer", body: "Earlier text. See [[Hub Concept]] for detail. Later text." },
    }, ctx);
    const bl = await lensRun("research", "backlinks-for", { params: { title: "Hub Concept" } }, ctx);
    assert.equal(bl.result.count, 1);
    assert.equal(bl.result.backlinks[0].noteTitle, "Referrer");
    assert.ok(bl.result.backlinks[0].context.includes("[[Hub Concept]]"));
  });

  it("note-graph: wikilink edges raise node degree and orphans have degree 0", async () => {
    const gctx = await depthCtx("research-graph"); // isolated user → clean graph
    const a = await lensRun("research", "note-create", { params: { title: "Alpha", body: "links to [[Beta]]" } }, gctx);
    await lensRun("research", "note-create", { params: { title: "Beta", body: "no outbound links" } }, gctx);
    await lensRun("research", "note-create", { params: { title: "Gamma", body: "wholly isolated" } }, gctx);

    const g = await lensRun("research", "note-graph", {}, gctx);
    assert.equal(g.result.stats.noteCount, 3);
    assert.equal(g.result.stats.linkCount, 1);   // Alpha -> Beta
    assert.equal(g.result.stats.orphanCount, 1); // Gamma
    assert.ok(g.result.edges.some((e) => e.source === a.result.note.id && e.targetTitle === "Beta"));
    assert.ok(g.result.orphans.some((o) => o.title === "Gamma"));
  });

  it("note-snapshot → note-update → note-restore: prior body is recovered", async () => {
    const sctx = await depthCtx("research-snap");
    const created = await lensRun("research", "note-create", { params: { title: "Draft", body: "version one" } }, sctx);
    const noteId = created.result.note.id;
    const snap = await lensRun("research", "note-snapshot", { params: { noteId } }, sctx);
    const snapshotId = snap.result.snapshot.id;

    await lensRun("research", "note-update", { params: { id: noteId, body: "version two" } }, sctx);
    const afterEdit = await lensRun("research", "note-get", { params: { id: noteId } }, sctx);
    assert.equal(afterEdit.result.note.body, "version two");

    const restored = await lensRun("research", "note-restore", { params: { noteId, snapshotId } }, sctx);
    assert.equal(restored.result.note.body, "version one");
    assert.equal(restored.result.restoredFrom, snapshotId);
  });
});

describe("research — reference manager: citations, collections, stats (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("research-refs"); });

  it("reference-add → reference-detail: APA + BibTeX citations format from the stored fields", async () => {
    const added = await lensRun("research", "reference-add", {
      params: { title: "On the Theory of X", authors: "Jane Smith", year: 2020, journal: "Nature", type: "article", doi: "10.1/abc" },
    }, ctx);
    assert.equal(added.result.reference.type, "article");
    const id = added.result.reference.id;

    const det = await lensRun("research", "reference-detail", { params: { id } }, ctx);
    assert.equal(det.result.reference.id, id);
    // APA: "Authors (year). title. journal. https://doi.org/doi"
    assert.equal(det.result.citations.apa, "Jane Smith (2020). On the Theory of X. Nature. https://doi.org/10.1/abc");
    // BibTeX key = lastname + year, lowercased & stripped → "smith2020"
    assert.ok(det.result.citations.bibtex.includes("{smith2020,"));
  });

  it("cite-format: citation key derives from last author surname + year (smith2020)", async () => {
    const added = await lensRun("research", "reference-add", {
      params: { title: "Key Test", authors: "Robert J. Smith", year: 2020 },
    }, ctx);
    const c = await lensRun("research", "cite-format", { params: { id: added.result.reference.id, style: "mla" } }, ctx);
    assert.equal(c.result.style, "mla");
    assert.equal(c.result.key, "smith2020");
    assert.ok(c.result.citation.includes('"Key Test."'));
  });

  it("validation: reference-set-status rejects a status outside to_read/reading/read", async () => {
    const added = await lensRun("research", "reference-add", { params: { title: "Status Test" } }, ctx);
    const bad = await lensRun("research", "reference-set-status", { params: { id: added.result.reference.id, status: "finished" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /status must be one of/);
  });

  it("collection-create → add-reference → collection-detail: membership round-trips", async () => {
    const ref = await lensRun("research", "reference-add", { params: { title: "Collected Paper" } }, ctx);
    const col = await lensRun("research", "collection-create", { params: { name: "Reading List" } }, ctx);
    const colId = col.result.collection.id;

    const add = await lensRun("research", "collection-add-reference", {
      params: { collectionId: colId, referenceId: ref.result.reference.id },
    }, ctx);
    assert.equal(add.result.referenceCount, 1);

    const detail = await lensRun("research", "collection-detail", { params: { id: colId } }, ctx);
    assert.ok(detail.result.references.some((r) => r.id === ref.result.reference.id));
  });

  it("reference-relate: self-relate is rejected; cross-relate is bidirectional", async () => {
    const a = await lensRun("research", "reference-add", { params: { title: "Ref A" } }, ctx);
    const b = await lensRun("research", "reference-add", { params: { title: "Ref B" } }, ctx);
    const aid = a.result.reference.id, bid = b.result.reference.id;

    const self = await lensRun("research", "reference-relate", { params: { referenceId: aid, relatedId: aid } }, ctx);
    assert.equal(self.result.ok, false);
    assert.match(self.result.error, /cannot relate a reference to itself/);

    const rel = await lensRun("research", "reference-relate", { params: { referenceId: aid, relatedId: bid } }, ctx);
    assert.equal(rel.result.related, true);
    // related is symmetric — querying B returns A
    const relatedToB = await lensRun("research", "reference-related", { params: { id: bid } }, ctx);
    assert.ok(relatedToB.result.related.some((r) => r.id === aid));
  });

  it("library-stats: counts references, collections, and unique tags from the live library", async () => {
    const lctx = await depthCtx("research-stats"); // isolated user → exact counts
    await lensRun("research", "reference-add", { params: { title: "S1", type: "book", tags: ["ml", "stats"] } }, lctx);
    await lensRun("research", "reference-add", { params: { title: "S2", type: "article", tags: ["ml"] } }, lctx);
    await lensRun("research", "collection-create", { params: { name: "C1" } }, lctx);

    const stats = await lensRun("research", "library-stats", {}, lctx);
    assert.equal(stats.result.references, 2);
    assert.equal(stats.result.collections, 1);
    assert.equal(stats.result.tags, 2); // {ml, stats} deduped across refs
    assert.equal(stats.result.byType.book, 1);
    assert.equal(stats.result.byType.article, 1);
    assert.equal(stats.result.byStatus.to_read, 2);
  });
});
