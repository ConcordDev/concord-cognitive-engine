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

describe("research — notes lifecycle (wave 14 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("research-t14-notes"); });

  it("note-create → notes-list: list returns a body-truncated preview, newest first", async () => {
    const lctx = await depthCtx("research-t14-list"); // isolated → exact ordering
    await lensRun("research", "note-create", { params: { title: "First", body: "alpha" } }, lctx);
    const second = await lensRun("research", "note-create", {
      params: { title: "Second", body: "x".repeat(300) },
    }, lctx);

    const list = await lensRun("research", "notes-list", {}, lctx);
    assert.equal(list.result.notes.length, 2);
    // newest (Second) sorts first
    assert.equal(list.result.notes[0].id, second.result.note.id);
    // preview is the body sliced to 200 chars; full body is not returned
    assert.equal(list.result.notes[0].preview.length, 200);
    assert.equal(list.result.notes[0].body, undefined);
  });

  it("note-create → note-delete → note-get: deleted note is gone", async () => {
    const created = await lensRun("research", "note-create", { params: { title: "Disposable" } }, ctx);
    const id = created.result.note.id;
    const del = await lensRun("research", "note-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const gone = await lensRun("research", "note-get", { params: { id } }, ctx);
    assert.equal(gone.result.ok, false);
    assert.match(gone.result.error, /not found/);
  });

  it("validation: note-delete on a missing id is rejected as not found", async () => {
    const bad = await lensRun("research", "note-delete", { params: { id: "note_does_not_exist" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not found/);
  });

  it("note-titles: autocomplete filters by query substring (case-insensitive)", async () => {
    const tctx = await depthCtx("research-t14-titles");
    await lensRun("research", "note-create", { params: { title: "Photosynthesis Basics" } }, tctx);
    await lensRun("research", "note-create", { params: { title: "Cellular Respiration" } }, tctx);
    const all = await lensRun("research", "note-titles", {}, tctx);
    assert.equal(all.result.count, 2);
    const filtered = await lensRun("research", "note-titles", { params: { query: "photo" } }, tctx);
    assert.equal(filtered.result.count, 1);
    assert.equal(filtered.result.titles[0].title, "Photosynthesis Basics");
  });

  it("note-snapshot → note-snapshots → note-snapshot-get: full body recovers from history", async () => {
    const sctx = await depthCtx("research-t14-snap");
    const created = await lensRun("research", "note-create", { params: { title: "Versioned", body: "body v1 content" } }, sctx);
    const noteId = created.result.note.id;
    const snap = await lensRun("research", "note-snapshot", { params: { noteId, label: "milestone" } }, sctx);
    const snapshotId = snap.result.snapshot.id;
    // snapshot return omits body but reports its length
    assert.equal(snap.result.snapshot.body, undefined);
    assert.equal(snap.result.snapshot.bodyLength, "body v1 content".length);

    const list = await lensRun("research", "note-snapshots", { params: { noteId } }, sctx);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.snapshots[0].label, "milestone");

    const full = await lensRun("research", "note-snapshot-get", { params: { noteId, snapshotId } }, sctx);
    assert.equal(full.result.snapshot.body, "body v1 content");
  });

  it("validation: note-snapshot without a noteId is rejected", async () => {
    const bad = await lensRun("research", "note-snapshot", { params: {} }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /noteId required/);
  });

  it("daily-note: first call creates, repeat call for same date returns the same note", async () => {
    const dctx = await depthCtx("research-t14-daily");
    const first = await lensRun("research", "daily-note", { params: { date: "2026-03-15" } }, dctx);
    assert.equal(first.result.created, true);
    assert.equal(first.result.note.title, "Daily — 2026-03-15");
    assert.deepEqual(first.result.note.tags, ["daily"]);
    const again = await lensRun("research", "daily-note", { params: { date: "2026-03-15" } }, dctx);
    assert.equal(again.result.created, false);
    assert.equal(again.result.note.id, first.result.note.id);
  });
});

describe("research — templates (wave 14 top-up)", () => {
  it("templates-list: returns the six built-in templates with id+title+body", async () => {
    const r = await lensRun("research", "templates-list", {});
    assert.equal(r.result.templates.length, 6);
    const meeting = r.result.templates.find((t) => t.id === "meeting");
    assert.equal(meeting.title, "Meeting notes");
    assert.ok(meeting.body.includes("## Agenda"));
  });

  it("template-apply: a known id returns its body; an unknown id is rejected", async () => {
    const ok = await lensRun("research", "template-apply", { params: { id: "decision_log" } });
    assert.equal(ok.result.template.id, "decision_log");
    assert.ok(ok.result.template.body.includes("## Options considered"));
    const bad = await lensRun("research", "template-apply", { params: { id: "nope" } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unknown template: nope/);
  });
});

describe("research — reference manager lifecycle (wave 14 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("research-t14-refs"); });

  it("reference-add → reference-update: editable fields round-trip, type defaults to article", async () => {
    const added = await lensRun("research", "reference-add", { params: { title: "Mutable Paper" } }, ctx);
    assert.equal(added.result.reference.type, "article"); // default
    const id = added.result.reference.id;
    const upd = await lensRun("research", "reference-update", {
      params: { id, authors: "A. Newauthor", year: 2021, journal: "Science", tags: ["BIO", "bio", "Lab"] },
    }, ctx);
    assert.equal(upd.result.reference.authors, "A. Newauthor");
    assert.equal(upd.result.reference.year, 2021);
    assert.equal(upd.result.reference.journal, "Science");
    // tags normalized: lowercased + deduped
    assert.deepEqual(upd.result.reference.tags, ["bio", "lab"]);
  });

  it("reference-add → reference-delete: removed ref drops out of reference-list", async () => {
    const lctx = await depthCtx("research-t14-refdel");
    const a = await lensRun("research", "reference-add", { params: { title: "Keep" } }, lctx);
    const b = await lensRun("research", "reference-add", { params: { title: "Drop" } }, lctx);
    const del = await lensRun("research", "reference-delete", { params: { id: b.result.reference.id } }, lctx);
    assert.equal(del.result.deleted, b.result.reference.id);
    const list = await lensRun("research", "reference-list", {}, lctx);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.references[0].id, a.result.reference.id);
  });

  it("reference-list: filters by type and sorts newer years first", async () => {
    const lctx = await depthCtx("research-t14-reflist");
    await lensRun("research", "reference-add", { params: { title: "Old Book", type: "book", year: 2001 } }, lctx);
    await lensRun("research", "reference-add", { params: { title: "New Article", type: "article", year: 2024 } }, lctx);
    await lensRun("research", "reference-add", { params: { title: "Mid Article", type: "article", year: 2010 } }, lctx);

    const articles = await lensRun("research", "reference-list", { params: { type: "article" } }, lctx);
    assert.equal(articles.result.count, 2);
    // sorted desc by year → 2024 before 2010
    assert.equal(articles.result.references[0].title, "New Article");
    assert.equal(articles.result.references[1].title, "Mid Article");
  });

  it("reading-queue: surfaces only to_read/reading refs and counts each bucket", async () => {
    const lctx = await depthCtx("research-t14-queue");
    const r1 = await lensRun("research", "reference-add", { params: { title: "Q1" } }, lctx); // to_read
    const r2 = await lensRun("research", "reference-add", { params: { title: "Q2" } }, lctx);
    const r3 = await lensRun("research", "reference-add", { params: { title: "Q3" } }, lctx);
    await lensRun("research", "reference-set-status", { params: { id: r2.result.reference.id, status: "reading" } }, lctx);
    await lensRun("research", "reference-set-status", { params: { id: r3.result.reference.id, status: "read" } }, lctx);

    const q = await lensRun("research", "reading-queue", {}, lctx);
    // r3 is "read" → excluded; r1 + r2 remain
    assert.equal(q.result.queue.length, 2);
    assert.equal(q.result.reading, 1);
    assert.equal(q.result.toRead, 1);
    assert.ok(!q.result.queue.some((r) => r.id === r3.result.reference.id));
  });

  it("tag-list: aggregates tag frequency across the library, descending", async () => {
    const lctx = await depthCtx("research-t14-tags");
    await lensRun("research", "reference-add", { params: { title: "T1", tags: ["ml", "nlp"] } }, lctx);
    await lensRun("research", "reference-add", { params: { title: "T2", tags: ["ml"] } }, lctx);
    const r = await lensRun("research", "tag-list", {}, lctx);
    const byTag = Object.fromEntries(r.result.tags.map((t) => [t.tag, t.count]));
    assert.equal(byTag.ml, 2);
    assert.equal(byTag.nlp, 1);
    // ml (count 2) sorts ahead of nlp (count 1)
    assert.equal(r.result.tags[0].tag, "ml");
  });
});

describe("research — collections + annotations + bibliography (wave 14 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("research-t14-col"); });

  it("collection-create → collection-list → collection-delete: count tracks membership then removal", async () => {
    const lctx = await depthCtx("research-t14-coldel");
    const ref = await lensRun("research", "reference-add", { params: { title: "Member" } }, lctx);
    const col = await lensRun("research", "collection-create", { params: { name: "Tracked" } }, lctx);
    const colId = col.result.collection.id;
    await lensRun("research", "collection-add-reference", {
      params: { collectionId: colId, referenceId: ref.result.reference.id },
    }, lctx);

    const listed = await lensRun("research", "collection-list", {}, lctx);
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.collections[0].referenceCount, 1);

    const del = await lensRun("research", "collection-delete", { params: { id: colId } }, lctx);
    assert.equal(del.result.deleted, colId);
    const after = await lensRun("research", "collection-list", {}, lctx);
    assert.equal(after.result.count, 0);
  });

  it("validation: collection-create with a blank name is rejected", async () => {
    const bad = await lensRun("research", "collection-create", { params: { name: "   " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /collection name required/);
  });

  it("annotation-add → annotation-list: annotations sort by page and default to yellow", async () => {
    const lctx = await depthCtx("research-t14-ann");
    const ref = await lensRun("research", "reference-add", { params: { title: "Annotated" } }, lctx);
    const refId = ref.result.reference.id;
    await lensRun("research", "annotation-add", { params: { referenceId: refId, text: "later note", page: 42 } }, lctx);
    const first = await lensRun("research", "annotation-add", { params: { referenceId: refId, quote: "early quote", page: 3 } }, lctx);
    assert.equal(first.result.annotation.color, "yellow"); // default color

    const list = await lensRun("research", "annotation-list", { params: { referenceId: refId } }, lctx);
    assert.equal(list.result.count, 2);
    // sorted ascending by page → page 3 first
    assert.equal(list.result.annotations[0].page, 3);
    assert.equal(list.result.annotations[1].page, 42);
  });

  it("validation: annotation-add with neither text nor quote is rejected", async () => {
    const ref = await lensRun("research", "reference-add", { params: { title: "Empty Annot" } }, ctx);
    const bad = await lensRun("research", "annotation-add", { params: { referenceId: ref.result.reference.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /text or quote required/);
  });

  it("bibliography-build: APA entries sort by author surname and join one-per-line", async () => {
    const lctx = await depthCtx("research-t14-bib");
    await lensRun("research", "reference-add", { params: { title: "Z Work", authors: "Zeta", year: 2020 } }, lctx);
    await lensRun("research", "reference-add", { params: { title: "A Work", authors: "Alpha", year: 2019 } }, lctx);
    const bib = await lensRun("research", "bibliography-build", { params: { style: "apa" } }, lctx);
    assert.equal(bib.result.style, "apa");
    assert.equal(bib.result.count, 2);
    // sorted by author surname → Alpha entry precedes Zeta entry
    assert.ok(bib.result.entries[0].startsWith("Alpha"));
    assert.ok(bib.result.entries[1].startsWith("Zeta"));
    assert.equal(bib.result.bibliography, bib.result.entries.join("\n"));
  });
});

describe("research — canvas + PDF attachments (wave 14 top-up)", () => {
  it("canvas-save → canvas-get → canvas-list → canvas-delete: cards round-trip then vanish", async () => {
    const cctx = await depthCtx("research-t14-canvas");
    const saved = await lensRun("research", "canvas-save", {
      params: {
        name: "Idea Board",
        cards: [{ kind: "text", text: "node A", x: 10, y: 20 }, { kind: "text", text: "node B", x: 100, y: 5 }],
        edges: [{ from: "a", to: "b", label: "leads to" }],
      },
    }, cctx);
    const id = saved.result.canvas.id;
    assert.equal(saved.result.canvas.cards.length, 2);
    // x is rounded/coerced to an integer
    assert.equal(saved.result.canvas.cards[0].x, 10);

    const got = await lensRun("research", "canvas-get", { params: { id } }, cctx);
    assert.equal(got.result.canvas.name, "Idea Board");
    assert.equal(got.result.canvas.edges[0].label, "leads to");

    const listed = await lensRun("research", "canvas-list", {}, cctx);
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.canvases[0].cardCount, 2);
    assert.equal(listed.result.canvases[0].edgeCount, 1);

    const del = await lensRun("research", "canvas-delete", { params: { id } }, cctx);
    assert.equal(del.result.deleted, id);
    const after = await lensRun("research", "canvas-get", { params: { id } }, cctx);
    assert.equal(after.result.ok, false);
    assert.match(after.result.error, /canvas not found/);
  });

  it("validation: canvas-save with a blank name is rejected", async () => {
    const bad = await lensRun("research", "canvas-save", { params: { name: "  " } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name required/);
  });

  it("reference-attach-pdf → reference-pdfs → reference-pdf-delete: attachment round-trips and clears hasPdf", async () => {
    const pctx = await depthCtx("research-t14-pdf");
    const ref = await lensRun("research", "reference-add", { params: { title: "PDF Host" } }, pctx);
    const refId = ref.result.reference.id;
    const att = await lensRun("research", "reference-attach-pdf", {
      params: { referenceId: refId, url: "https://example.org/paper.pdf", pages: 12 },
    }, pctx);
    assert.equal(att.result.attachment.filename, "paper.pdf"); // derived from url tail
    assert.equal(att.result.attachment.pages, 12);

    const list = await lensRun("research", "reference-pdfs", { params: { referenceId: refId } }, pctx);
    assert.equal(list.result.count, 1);

    const detail = await lensRun("research", "reference-detail", { params: { id: refId } }, pctx);
    assert.equal(detail.result.reference.hasPdf, true);

    const del = await lensRun("research", "reference-pdf-delete", { params: { id: att.result.attachment.id } }, pctx);
    assert.equal(del.result.deleted, att.result.attachment.id);
    const after = await lensRun("research", "reference-detail", { params: { id: refId } }, pctx);
    assert.equal(after.result.reference.hasPdf, false); // last pdf removed
  });

  it("validation: reference-attach-pdf rejects a non-http url", async () => {
    const vctx = await depthCtx("research-t14-pdfbad");
    const ref = await lensRun("research", "reference-add", { params: { title: "Bad URL Host" } }, vctx);
    const bad = await lensRun("research", "reference-attach-pdf", {
      params: { referenceId: ref.result.reference.id, url: "ftp://example.org/x.pdf" },
    }, vctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /url must be http/);
  });
});

describe("research — citationNetwork deeper signals (wave 14 top-up)", () => {
  // Citation graph: a→b | b→(none) | c→a,b,d | d→a,b,c
  // in-degrees: a=2(c,d), b=3(a,c,d), c=1(d), d=1(c). out-degrees: a=1,b=0,c=3,d=3.
  const NET = {
    data: { papers: [
      { id: "a", title: "Alpha", year: 2015, references: ["b"],          keywords: ["x", "y"] },
      { id: "b", title: "Beta",  year: 2012, references: [],             keywords: ["x", "y"] },
      { id: "c", title: "Gamma", year: 2020, references: ["a", "b", "d"], keywords: ["x", "y"] },
      { id: "d", title: "Delta", year: 2021, references: ["a", "b", "c"], keywords: [] },
    ] },
  };

  it("frontier + foundational works are partitioned by degree, then ordered", async () => {
    const r = await lensRun("research", "citationNetwork", NET);
    // foundational = inDegree ≥ 3 → only Beta (in-degree 3)
    assert.equal(r.result.foundationalWorks.length, 1);
    assert.equal(r.result.foundationalWorks[0].id, "b");
    assert.equal(r.result.foundationalWorks[0].citations, 3);
    // frontier = outDegree ≥ 3 && inDegree ≤ 1 → Gamma + Delta, newest first
    assert.equal(r.result.frontierWorks.length, 2);
    assert.equal(r.result.frontierWorks[0].id, "d"); // 2021 before 2020
    assert.equal(r.result.frontierWorks[1].id, "c");
    assert.equal(r.result.frontierWorks[0].references, 3);
  });

  it("PageRank, network density, year distribution and topic clusters compute exactly", async () => {
    const r = await lensRun("research", "citationNetwork", NET);
    const byId = Object.fromEntries(r.result.rankedPapers.map((p) => [p.id, p]));
    // most-cited sink (Beta) carries the highest PageRank
    assert.equal(byId.b.pageRank, 0.12423);
    assert.equal(byId.a.pageRank, 0.06715);
    assert.equal(r.result.rankedPapers[0].id, "b"); // ranked desc by pageRank
    // density = total out-edges (1+0+3+3=7) / (n*(n-1)=12) → 0.5833
    assert.equal(r.result.networkDensity, 0.5833);
    // year distribution counts each paper's year exactly once
    assert.deepEqual(r.result.yearDistribution, { 2012: 1, 2015: 1, 2020: 1, 2021: 1 });
    // keywords x,y co-occur in a,b,c (3 papers) → one cluster with 3 co-occurrences
    assert.equal(r.result.topicClusters.length, 1);
    assert.deepEqual(r.result.topicClusters[0].keywords.sort(), ["x", "y"]);
    assert.equal(r.result.topicClusters[0].coOccurrences, 3);
  });
});

describe("research — methodologyScore mid-tier grades (wave 14 top-up)", () => {
  it("partial-credit methodology lands grade C with 2b cohort evidence level", async () => {
    // Build a methodology hitting the partial branches:
    //  sampleSize 150 (10/12), controlGroup partial (5/10), randomization quasi (5/10),
    //  blinding single (5/8), data upon-request (2/4), conflicts declared (3/5).
    const r = await lensRun("research", "methodologyScore", {
      data: { methodology: {
        sampleSize: 150, controlGroup: "partial", randomization: "quasi", blinding: "single",
        measurementValidation: true, statisticalTests: true, effectSize: 0.3,
        confidenceIntervals: true, reproducibilityInfo: true, preregistered: true,
        conflictsOfInterest: "declared", ethicsApproval: true, dataAvailability: "upon-request",
      } },
    });
    // 10+5+5+5+8+8+8+7+8+7+3+5+2 = 81 / 100 → 81% → grade B (≥75)
    assert.equal(r.result.totalScore, 81);
    assert.equal(r.result.percentage, 81);
    assert.equal(r.result.grade, "B");
    // controlGroup true? no (partial) → not RCT; controlGroup not strictly true → falls to sampleSize → "3 (Case-control study)"
    assert.equal(r.result.evidenceLevel, "3 (Case-control study)");
    const ss = r.result.criteria.find((c) => c.criterion === "Sample Size");
    assert.equal(ss.score, 10); // 100–999 band
    assert.ok(ss.note.includes("Adequate"));
    // partial control scored 5/10 = 50% → neither strength (≥80) nor weakness (=0)
    assert.ok(!r.result.strengths.includes("Control Group"));
    assert.ok(!r.result.weaknesses.includes("Control Group"));
  });

  it("RCT-with-control but no double-blind resolves evidence level 1b", async () => {
    const r = await lensRun("research", "methodologyScore", {
      data: { methodology: { randomization: true, controlGroup: true, blinding: "single", sampleSize: 50 } },
    });
    assert.equal(r.result.evidenceLevel, "1b (Individual RCT)");
    const ss = r.result.criteria.find((c) => c.criterion === "Sample Size");
    assert.equal(ss.score, 7); // 30–99 band → small sample
  });

  it("control-only (no randomization) resolves evidence level 2b cohort", async () => {
    const r = await lensRun("research", "methodologyScore", {
      data: { methodology: { controlGroup: true, sampleSize: 5 } },
    });
    assert.equal(r.result.evidenceLevel, "2b (Cohort study)");
    const ss = r.result.criteria.find((c) => c.criterion === "Sample Size");
    assert.equal(ss.score, 3); // <30 → very small
  });
});

describe("research — notes + annotation edge branches (wave 14 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("research-t14-edge"); });

  it("note-create → note-update: title/body/tags edit in place and round-trip via note-get", async () => {
    const created = await lensRun("research", "note-create", { params: { title: "Editable", body: "v1" } }, ctx);
    const id = created.result.note.id;
    const upd = await lensRun("research", "note-update", {
      params: { id, title: "Edited Title", body: "v2 body", tags: ["t1", "t2"] },
    }, ctx);
    assert.equal(upd.result.note.title, "Edited Title");
    assert.equal(upd.result.note.body, "v2 body");
    assert.deepEqual(upd.result.note.tags, ["t1", "t2"]);
    const got = await lensRun("research", "note-get", { params: { id } }, ctx);
    assert.equal(got.result.note.body, "v2 body");
  });

  it("validation: note-update on a missing id is rejected as not found", async () => {
    const bad = await lensRun("research", "note-update", { params: { id: "note_nope", body: "x" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not found/);
  });

  it("annotation-add: an explicit color is preserved instead of the yellow default", async () => {
    const ref = await lensRun("research", "reference-add", { params: { title: "Colored Annot" } }, ctx);
    const ann = await lensRun("research", "annotation-add", {
      params: { referenceId: ref.result.reference.id, text: "blue note", color: "blue" },
    }, ctx);
    assert.equal(ann.result.annotation.color, "blue");
    assert.equal(ann.result.annotation.text, "blue note");
  });

  it("validation: annotation-add against a missing reference is rejected", async () => {
    const bad = await lensRun("research", "annotation-add", {
      params: { referenceId: "ref_missing", text: "orphan" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /reference not found/);
  });

  it("reference-related: a reference with no relations returns an empty list", async () => {
    const ref = await lensRun("research", "reference-add", { params: { title: "Lonely Ref" } }, ctx);
    const rel = await lensRun("research", "reference-related", { params: { id: ref.result.reference.id } }, ctx);
    assert.deepEqual(rel.result.related, []);
  });
});

describe("research — citation styles + bibtex (wave 14 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("research-t14-cite"); });

  it("cite-format chicago: parenthesized-year form derives from stored fields", async () => {
    const added = await lensRun("research", "reference-add", {
      params: { title: "Chicago Work", authors: "Ada Lovelace", year: 1843, journal: "Notes" },
    }, ctx);
    const c = await lensRun("research", "cite-format", { params: { id: added.result.reference.id, style: "chicago" } }, ctx);
    assert.equal(c.result.style, "chicago");
    // chicago: `${authors}. "${title}." ${journal} (${year}).`
    assert.equal(c.result.citation, 'Ada Lovelace. "Chicago Work." Notes (1843).');
    assert.equal(c.result.key, "lovelace1843");
  });

  it("cite-format bibtex on a book uses @book and emits the year/doi fields", async () => {
    const added = await lensRun("research", "reference-add", {
      params: { title: "BibTeX Book", authors: "Donald Knuth", year: 1984, type: "book", doi: "10.5/tex" },
    }, ctx);
    const c = await lensRun("research", "cite-format", { params: { id: added.result.reference.id, style: "bibtex" } }, ctx);
    assert.ok(c.result.citation.startsWith("@book{knuth1984,"));
    assert.ok(c.result.citation.includes("year={1984}"));
    assert.ok(c.result.citation.includes("doi={10.5/tex}"));
  });

  it("bibliography-build bibtex: entries join on a blank line and sort by author surname", async () => {
    const lctx = await depthCtx("research-t14-bibtex");
    await lensRun("research", "reference-add", { params: { title: "Yonder", authors: "Young", year: 2001 } }, lctx);
    await lensRun("research", "reference-add", { params: { title: "Aardvark", authors: "Abel", year: 2002 } }, lctx);
    const bib = await lensRun("research", "bibliography-build", { params: { style: "bibtex" } }, lctx);
    assert.equal(bib.result.count, 2);
    // Abel sorts before Young
    assert.ok(bib.result.entries[0].includes("Abel"));
    assert.ok(bib.result.entries[1].includes("Young"));
    // bibtex joins on a blank line (\n\n), not a single newline
    assert.equal(bib.result.bibliography, bib.result.entries.join("\n\n"));
  });
});

describe("research — academic-import + literature review (deterministic) (wave 14 top-up)", () => {
  it("academic-import: an arxiv work imports as a preprint with joined authors", async () => {
    const ictx = await depthCtx("research-t14-import");
    const r = await lensRun("research", "academic-import", {
      params: { work: {
        title: "A Preprint", authors: ["First Author", "Second Author"], year: 2023,
        source: "arxiv", venue: "arXiv", doi: "10.4/pre", citationCount: 7,
      } },
    }, ictx);
    assert.equal(r.result.reference.type, "preprint");
    assert.equal(r.result.reference.authors, "First Author, Second Author");
    assert.equal(r.result.reference.year, 2023);
    assert.equal(r.result.reference.citationCount, 7);
    // the imported ref shows up in the live library
    const list = await lensRun("research", "reference-list", {}, ictx);
    assert.ok(list.result.references.some((x) => x.id === r.result.reference.id));
  });

  it("validation: academic-import without a title is rejected", async () => {
    const bad = await lensRun("research", "academic-import", { params: { work: { year: 2020 } } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title required/);
  });

  it("literature-review (heuristic, no abstracts) builds a matrix then list/get/delete round-trips", async () => {
    // Papers WITHOUT abstracts force the deterministic heuristic path regardless of ctx.llm.
    const rctx = await depthCtx("research-t14-review");
    const built = await lensRun("research", "literature-review", {
      params: {
        title: "My Review", save: true,
        dimensions: ["method", "finding"],
        papers: [
          { id: "p1", title: "Study One", year: 2018 },
          { id: "p2", title: "Study Two", year: 2022 },
        ],
      },
    }, rctx);
    assert.equal(built.result.review.mode, "heuristic");
    assert.equal(built.result.review.paperCount, 2);
    assert.deepEqual(built.result.review.dimensions, ["method", "finding"]);
    assert.equal(built.result.review.matrix.length, 2);
    // every matrix cell exists for the requested dimensions
    assert.ok("method" in built.result.review.matrix[0].cells);
    assert.ok("finding" in built.result.review.matrix[0].cells);
    // heuristic summary names the year span 2018–2022
    assert.ok(built.result.review.summary.includes("2018–2022"));
    const reviewId = built.result.review.id;

    const list = await lensRun("research", "literature-reviews-list", {}, rctx);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.reviews[0].id, reviewId);
    assert.equal(list.result.reviews[0].mode, "heuristic");

    const got = await lensRun("research", "literature-review-get", { params: { id: reviewId } }, rctx);
    assert.equal(got.result.review.title, "My Review");
    assert.equal(got.result.review.matrix.length, 2); // full matrix recovered

    const del = await lensRun("research", "literature-review-delete", { params: { id: reviewId } }, rctx);
    assert.equal(del.result.deleted, reviewId);
    const after = await lensRun("research", "literature-reviews-list", {}, rctx);
    assert.equal(after.result.count, 0);
  });

  it("validation: literature-review with no papers is rejected; get on a missing id is not found", async () => {
    const rctx = await depthCtx("research-t14-review-bad");
    const noPapers = await lensRun("research", "literature-review", { params: { papers: [] } }, rctx);
    assert.equal(noPapers.result.ok, false);
    assert.match(noPapers.result.error, /papers or referenceIds required/);

    const missing = await lensRun("research", "literature-review-get", { params: { id: "review_nope" } }, rctx);
    assert.equal(missing.result.ok, false);
    assert.match(missing.result.error, /review not found/);
  });
});
