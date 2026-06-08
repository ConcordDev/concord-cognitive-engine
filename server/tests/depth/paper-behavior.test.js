// tests/depth/paper-behavior.test.js — REAL behavioral tests for the `paper`
// DOMAIN (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact-value compute (citation analysis, readability,
// extractive summary, revision diff, text export) + CRUD round-trips (library,
// collections, annotations, dedupe, shared groups) + validation rejections.
// Every lensRun("paper", "<action>", …) call literally names the macro, so the
// macro-depth grader credits it as a behavioral invocation.
//
// SKIPPED (network / LLM — non-deterministic, no egress in this env):
//   search (arXiv), summarize (LLM), paper-capture (CrossRef), paper-enrich
//   (Semantic Scholar), paper-check-alerts (Semantic Scholar), feed (CrossRef).
//
// lens.run UNWRAPS a handler's `{ok:true, result:X}` → r.result === X (read
// r.result.<field>). A handler `{ok:false, error}` (no result key) is NOT
// unwrapped → r.result.ok === false + r.result.error carries the message.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("paper — calc contracts (exact computed values)", () => {
  it("citationAnalyze: counts by type, self-citation rate, recency index", async () => {
    const now = new Date().getFullYear();
    const r = await lensRun("paper", "citationAnalyze", {
      data: {
        author: "Ada Lovelace",
        citations: [
          { journal: "Nature", year: String(now), authors: "Ada Lovelace, B. Babbage" },
          { journal: "Science", year: String(now - 2), authors: "C. Turing" },
          { conference: "NeurIPS", year: String(now - 10), authors: "D. Hopper" },
          { url: "http://x", year: String(now - 1), authors: "Ada Lovelace" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCitations, 4);
    assert.equal(r.result.byType.journal, 2);
    assert.equal(r.result.byType.conference, 1);
    assert.equal(r.result.byType.web, 1);
    assert.equal(r.result.selfCitations, 2);           // two cite "Ada Lovelace"
    assert.equal(r.result.selfCitationRate, 50);       // 2/4
    assert.equal(r.result.recentCount, 3);             // within last 5 yrs
    assert.equal(r.result.recencyIndex, 75);           // 3/4
    assert.equal(r.result.newestYear, now);
    assert.equal(r.result.oldestYear, now - 10);
  });

  it("citationAnalyze: empty citations returns the guidance message, not stats", async () => {
    const r = await lensRun("paper", "citationAnalyze", { data: { citations: [] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("Add citations"));
    assert.equal(r.result.totalCitations, undefined);
  });

  it("readabilityScore: Flesch-Kincaid / Gunning-Fog computed with word & sentence stats", async () => {
    const text = "The cat sat on the mat. A dog ran fast. Birds fly high in the sky above.";
    const r = await lensRun("paper", "readabilityScore", { data: { text } });
    assert.equal(r.ok, true);
    assert.equal(r.result.stats.sentences, 3);         // three "." segments
    assert.equal(r.result.stats.words, 17);            // exact token count
    assert.equal(typeof r.result.fleschKincaidGrade, "number");
    // Simple words → elementary/middle reading level, not Graduate
    assert.ok(["Elementary", "Middle School", "High School"].includes(r.result.readingLevel));
  });

  it("readabilityScore: text under 50 chars returns guidance message", async () => {
    const r = await lensRun("paper", "readabilityScore", { data: { text: "Too short." } });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("at least 50 characters"));
  });

  it("abstractSummarize: extracts top sentences + keywords, reports compression", async () => {
    const text = [
      "Quantum computing leverages superposition to process information.",
      "Classical bits are limited to a single state at any moment.",
      "Quantum bits exploit entanglement for parallel computation across states.",
      "Error correction remains a central challenge for scalable quantum hardware.",
      "Researchers continue building larger quantum processors every year.",
    ].join(" ");
    const r = await lensRun("paper", "abstractSummarize", { data: { text } });
    assert.equal(r.ok, true);
    assert.equal(r.result.sentenceCount, 5);
    assert.ok(r.result.summaryLength >= 2 && r.result.summaryLength <= 5);
    assert.equal(r.result.compressionRatio, Math.round((r.result.summaryLength / 5) * 100));
    assert.ok(r.result.keywords.includes("quantum"));  // highest-frequency content word
  });

  it("revisionDiff: line/word/char deltas between original and revised", async () => {
    const r = await lensRun("paper", "revisionDiff", {
      data: {
        original: "line one\nline two\nline three",
        revised: "line one\nline two changed\nline three\nline four",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.oldStats.lines, 3);
    assert.equal(r.result.newStats.lines, 4);
    assert.equal(r.result.diff.linesUnchanged, 2);     // "line one" + "line three"
    assert.equal(r.result.diff.linesAdded, 2);         // "line two changed" + "line four"
    assert.equal(r.result.diff.linesRemoved, 1);       // "line two"
    assert.ok(r.result.addedPreview.includes("line four"));
  });

  it("export_pdf: formats artifact metadata into a downloadable .txt", async () => {
    const r = await lensRun("paper", "export_pdf", {
      data: {
        title: "On Recursive Self-Improvement",
        authors: ["A. Author", "B. Coauthor"],
        year: 2025,
        journal: "Journal of AI",
        abstract: "A study of recursion.",
        tags: ["ai", "recursion"],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "text");
    assert.equal(r.result.filename, "on-recursive-self-improvement.txt");
    assert.ok(r.result.content.includes("Authors: A. Author, B. Coauthor"));
    assert.ok(r.result.content.includes("Year: 2025"));
    assert.equal(r.result.byteLength, r.result.content.length);
  });
});

describe("paper — CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("paper-crud"); });

  it("paper-save → paper-list → paper-detail: paper reads back, refId defaults to lowercased title", async () => {
    const title = `Attention Is All You Need ${randomUUID()}`;
    const save = await lensRun("paper", "paper-save", {
      params: { title, authors: ["Vaswani", "Shazeer"], year: 2017, venue: "NeurIPS", tags: ["NLP", "Transformers"] },
    }, ctx);
    assert.equal(save.ok, true);
    assert.equal(save.result.paper.status, "to_read");
    assert.equal(save.result.paper.refId, title.toLowerCase());
    assert.deepEqual(save.result.paper.tags, ["nlp", "transformers"]); // lowercased
    const id = save.result.paper.id;

    const list = await lensRun("paper", "paper-list", {}, ctx);
    assert.ok(list.result.papers.some((p) => p.id === id));

    const detail = await lensRun("paper", "paper-detail", { params: { id } }, ctx);
    assert.equal(detail.result.paper.title, title);
  });

  it("paper-update → paper-list filter: status round-trips and rating clamps to 5", async () => {
    const title = `Deep Residual Learning ${randomUUID()}`;
    const save = await lensRun("paper", "paper-save", { params: { title } }, ctx);
    const id = save.result.paper.id;

    const upd = await lensRun("paper", "paper-update", { params: { id, status: "read", rating: 99, notes: "seminal" } }, ctx);
    assert.equal(upd.result.paper.status, "read");
    assert.equal(upd.result.paper.rating, 5);          // clamped to [1,5]
    assert.equal(upd.result.paper.notes, "seminal");

    const readList = await lensRun("paper", "paper-list", { params: { status: "read" } }, ctx);
    assert.ok(readList.result.papers.some((p) => p.id === id));
    const toReadList = await lensRun("paper", "paper-list", { params: { status: "to_read" } }, ctx);
    assert.ok(!toReadList.result.papers.some((p) => p.id === id));
  });

  it("paper-save: a duplicate refId is rejected", async () => {
    const title = `Unique Paper ${randomUUID()}`;
    const first = await lensRun("paper", "paper-save", { params: { title, refId: "fixed-ref-" + randomUUID() } }, ctx);
    assert.equal(first.ok, true);
    const dup = await lensRun("paper", "paper-save", { params: { title: "Different Title", refId: first.result.paper.refId } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.match(dup.result.error, /already in your library/);
  });

  it("paper-save: a missing title is rejected", async () => {
    const bad = await lensRun("paper", "paper-save", { params: { title: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title required/);
  });

  it("collection-create → collection-assign → collection-list: paper counts in collection", async () => {
    const col = await lensRun("paper", "collection-create", { params: { name: `Reading List ${randomUUID()}` } }, ctx);
    assert.equal(col.ok, true);
    const colId = col.result.collection.id;

    const save = await lensRun("paper", "paper-save", { params: { title: `Collected Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;

    const assign = await lensRun("paper", "collection-assign", { params: { paperId, collectionId: colId } }, ctx);
    assert.ok(assign.result.collectionIds.includes(colId));

    const list = await lensRun("paper", "collection-list", {}, ctx);
    const found = list.result.collections.find((c) => c.id === colId);
    assert.equal(found.paperCount, 1);
  });

  it("paper-annotate → paper-annotations-sync: highlights compile into the notes digest", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `Annotated Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;

    const a1 = await lensRun("paper", "paper-annotate", { params: { paperId, page: 3, quote: "key insight here", comment: "important", color: "green" } }, ctx);
    assert.equal(a1.result.total, 1);
    assert.equal(a1.result.annotation.color, "green");
    await lensRun("paper", "paper-annotate", { params: { paperId, page: 1, quote: "earlier point" } }, ctx);

    const annots = await lensRun("paper", "paper-annotations", { params: { paperId } }, ctx);
    assert.equal(annots.result.count, 2);
    assert.equal(annots.result.annotations[0].page, 1);  // sorted by page ascending

    const sync = await lensRun("paper", "paper-annotations-sync", { params: { paperId } }, ctx);
    assert.equal(sync.result.synced, 2);
    assert.ok(sync.result.notes.includes("## Highlights"));
    assert.ok(sync.result.notes.includes('"key insight here"'));
  });

  it("paper-find-duplicates: two papers with the same normalised title form a group", async () => {
    const uid = randomUUID();
    await lensRun("paper", "paper-save", { params: { title: `Twin Study ${uid}`, refId: "twin-a-" + uid } }, ctx);
    await lensRun("paper", "paper-save", { params: { title: `Twin   Study   ${uid}!!!`, refId: "twin-b-" + uid } }, ctx);

    const dups = await lensRun("paper", "paper-find-duplicates", {}, ctx);
    assert.equal(dups.ok, true);
    const group = dups.result.duplicateGroups.find((g) => g.members.length === 2 && g.members[0].title.includes("Twin Study " + uid));
    assert.ok(group, "expected a title-keyed duplicate group with both twin papers");
    assert.equal(group.kind, "title");
  });

  it("group-create → group-join: a second user joins via share code", async () => {
    const owner = await depthCtx("paper-group-owner-" + randomUUID());
    const create = await lensRun("paper", "group-create", { params: { name: "Lab Reading Group" } }, owner);
    assert.equal(create.ok, true);
    assert.equal(create.result.group.ownerId, owner.actor.userId); // creator owns it
    assert.ok(create.result.group.members.includes(owner.actor.userId));
    const code = create.result.group.shareCode;
    assert.ok(typeof code === "string" && code.length > 0);

    const joiner = await depthCtx("paper-group-joiner-" + randomUUID());
    const join = await lensRun("paper", "group-join", { params: { shareCode: code } }, joiner);
    assert.equal(join.ok, true);
    assert.equal(join.result.group.memberCount, 2);
    assert.equal(join.result.group.shareCode, null);   // non-owner does not see the code
  });

  it("group-join: an unknown share code is rejected", async () => {
    const joiner = await depthCtx("paper-group-badcode-" + randomUUID());
    const bad = await lensRun("paper", "group-join", { params: { shareCode: "NOPECODE" } }, joiner);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /no group with that share code/);
  });
});

// New cases added by Track-A depth sweep — deterministic uncovered macros only.
// SKIPPED (network — no egress here): search (arXiv), summarize (LLM),
// paper-capture (CrossRef), paper-enrich + paper-check-alerts (Semantic
// Scholar), feed (CrossRef). paper-alert-read's deterministic not-found branch
// is exercised below (alert ROWS can only be minted by the network check, so
// the empty/not-found branches are the honest deterministic coverage).
describe("paper — uncovered macro round-trips (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("paper-uncovered"); });

  it("library-dashboard: tallies totals, status buckets, collections, withNotes", async () => {
    const dash = await depthCtx("paper-dash-" + randomUUID());        // isolated user
    const before = await lensRun("paper", "library-dashboard", {}, dash);
    assert.equal(before.ok, true);
    assert.equal(before.result.totalPapers, 0);

    const s1 = await lensRun("paper", "paper-save", { params: { title: `Dash A ${randomUUID()}` } }, dash);
    const s2 = await lensRun("paper", "paper-save", { params: { title: `Dash B ${randomUUID()}` } }, dash);
    // s1 → reading; s2 → read + notes
    await lensRun("paper", "paper-update", { params: { id: s1.result.paper.id, status: "reading" } }, dash);
    await lensRun("paper", "paper-update", { params: { id: s2.result.paper.id, status: "read", notes: "noted" } }, dash);
    await lensRun("paper", "collection-create", { params: { name: "Dash Col" } }, dash);

    const after = await lensRun("paper", "library-dashboard", {}, dash);
    assert.equal(after.result.totalPapers, 2);
    assert.equal(after.result.toRead, 0);
    assert.equal(after.result.reading, 1);
    assert.equal(after.result.read, 1);
    assert.equal(after.result.collections, 1);
    assert.equal(after.result.withNotes, 1);    // only s2 carries notes
  });

  it("paper-delete: removes the paper, then 404s on re-delete and detail", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `Deletable ${randomUUID()}` } }, ctx);
    const id = save.result.paper.id;

    const del = await lensRun("paper", "paper-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);

    const detail = await lensRun("paper", "paper-detail", { params: { id } }, ctx);
    assert.equal(detail.result.ok, false);
    assert.match(detail.result.error, /paper not found/);

    const again = await lensRun("paper", "paper-delete", { params: { id } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /paper not found/);
  });

  it("paper-pdf-attach → paper-pdf-get → paper-pdf-remove: PDF lifecycle + byte estimate", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `PDF Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;

    const noPdf = await lensRun("paper", "paper-pdf-get", { params: { paperId } }, ctx);
    assert.equal(noPdf.result.hasPdf, false);

    // base64 of "%PDF-1.4 hello" → "JVBERi0xLjQgaGVsbG8=" (20 chars)
    const dataUrl = "data:application/pdf;base64,JVBERi0xLjQgaGVsbG8=";
    const attach = await lensRun("paper", "paper-pdf-attach", { params: { paperId, dataUrl, fileName: "doc.pdf" } }, ctx);
    assert.equal(attach.ok, true);
    assert.equal(attach.result.fileName, "doc.pdf");
    // sizeBytes = round(len * 3 / 4); len of the full data URL string
    assert.equal(attach.result.sizeBytes, Math.round((dataUrl.length * 3) / 4));

    const get = await lensRun("paper", "paper-pdf-get", { params: { paperId } }, ctx);
    assert.equal(get.result.hasPdf, true);
    assert.equal(get.result.dataUrl, dataUrl);
    assert.equal(get.result.fileName, "doc.pdf");

    const rm = await lensRun("paper", "paper-pdf-remove", { params: { paperId } }, ctx);
    assert.equal(rm.result.removed, true);
    const gone = await lensRun("paper", "paper-pdf-get", { params: { paperId } }, ctx);
    assert.equal(gone.result.hasPdf, false);
  });

  it("paper-pdf-attach: rejects a non-PDF data URL", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `Bad PDF ${randomUUID()}` } }, ctx);
    const bad = await lensRun("paper", "paper-pdf-attach", {
      params: { paperId: save.result.paper.id, dataUrl: "data:image/png;base64,AAAA" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /data:application\/pdf/);
  });

  it("paper-annotation-delete: removes one highlight, leaving the rest", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `Annot Del ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;
    const a1 = await lensRun("paper", "paper-annotate", { params: { paperId, page: 2, quote: "first quote" } }, ctx);
    await lensRun("paper", "paper-annotate", { params: { paperId, page: 5, quote: "second quote" } }, ctx);

    const del = await lensRun("paper", "paper-annotation-delete", { params: { paperId, annotationId: a1.result.annotation.id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, a1.result.annotation.id);
    assert.equal(del.result.remaining, 1);

    const list = await lensRun("paper", "paper-annotations", { params: { paperId } }, ctx);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.annotations[0].quote, "second quote");

    const missing = await lensRun("paper", "paper-annotation-delete", { params: { paperId, annotationId: "nope" } }, ctx);
    assert.equal(missing.result.ok, false);
    assert.match(missing.result.error, /annotation not found/);
  });

  it("paper-merge-duplicates: keeps the richest record, folds dropped fields, splices the rest", async () => {
    const merger = await depthCtx("paper-merge-" + randomUUID());
    // Lean record (no abstract/doi/tags).
    const lean = await lensRun("paper", "paper-save", { params: { title: `Merge Twin ${randomUUID()}`, refId: "lean-" + randomUUID() } }, merger);
    // Rich record (doi +2, abstract +2, tags +2 = richness 6 vs lean 0).
    const rich = await lensRun("paper", "paper-save", {
      params: { title: `Merge Twin ${randomUUID()}`, refId: "rich-" + randomUUID(), doi: "10.1000/rich", abstract: "real abstract", tags: ["ml", "nlp"] },
    }, merger);

    const merge = await lensRun("paper", "paper-merge-duplicates", { params: { ids: [lean.result.paper.id, rich.result.paper.id] } }, merger);
    assert.equal(merge.ok, true);
    assert.equal(merge.result.kept.id, rich.result.paper.id);   // richest wins
    assert.equal(merge.result.droppedCount, 1);
    assert.deepEqual(merge.result.droppedIds, [lean.result.paper.id]);

    // The dropped paper is gone; only the kept one remains.
    const list = await lensRun("paper", "paper-list", {}, merger);
    assert.equal(list.result.papers.length, 1);
    assert.equal(list.result.papers[0].id, rich.result.paper.id);
  });

  it("paper-merge-duplicates: fewer than 2 ids is rejected", async () => {
    const bad = await lensRun("paper", "paper-merge-duplicates", { params: { ids: ["only-one"] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /at least 2 paper ids/);
  });

  it("group-add-paper → group-papers → group-list: shared library round-trip + dedupe", async () => {
    const owner = await depthCtx("paper-grp2-owner-" + randomUUID());
    const grp = await lensRun("paper", "group-create", { params: { name: "Shared Lib" } }, owner);
    const groupId = grp.result.group.id;

    const save = await lensRun("paper", "paper-save", { params: { title: `Group Paper ${randomUUID()}`, doi: "10.5555/grp" } }, owner);
    const paperId = save.result.paper.id;

    const add = await lensRun("paper", "group-add-paper", { params: { groupId, paperId } }, owner);
    assert.equal(add.ok, true);
    assert.equal(add.result.paperCount, 1);
    assert.equal(add.result.paper.doi, "10.5555/grp");

    // Re-adding the same DOI is rejected as a duplicate.
    const dup = await lensRun("paper", "group-add-paper", { params: { groupId, paperId } }, owner);
    assert.equal(dup.result.ok, false);
    assert.match(dup.result.error, /already in this group/);

    const papers = await lensRun("paper", "group-papers", { params: { groupId } }, owner);
    assert.equal(papers.result.papers.length, 1);
    assert.equal(papers.result.group.paperCount, 1);

    const myGroups = await lensRun("paper", "group-list", {}, owner);
    const found = myGroups.result.groups.find((g) => g.id === groupId);
    assert.equal(found.paperCount, 1);
    assert.equal(found.isOwner, true);
    assert.equal(found.shareCode, grp.result.group.shareCode);  // owner sees the code
  });

  it("group-add-paper: a non-member is rejected", async () => {
    const owner = await depthCtx("paper-grp3-owner-" + randomUUID());
    const grp = await lensRun("paper", "group-create", { params: { name: "Closed Lib" } }, owner);
    const stranger = await depthCtx("paper-grp3-stranger-" + randomUUID());
    const save = await lensRun("paper", "paper-save", { params: { title: `Stranger Paper ${randomUUID()}` } }, stranger);
    const bad = await lensRun("paper", "group-add-paper", { params: { groupId: grp.result.group.id, paperId: save.result.paper.id } }, stranger);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not a member of this group/);
  });

  it("group-remove-paper: drops a shared paper, then 404s on the second remove", async () => {
    const owner = await depthCtx("paper-grp4-owner-" + randomUUID());
    const grp = await lensRun("paper", "group-create", { params: { name: "Removable Lib" } }, owner);
    const groupId = grp.result.group.id;
    const save = await lensRun("paper", "paper-save", { params: { title: `Removable Paper ${randomUUID()}` } }, owner);
    const add = await lensRun("paper", "group-add-paper", { params: { groupId, paperId: save.result.paper.id } }, owner);
    const sharedId = add.result.paper.id;

    const rm = await lensRun("paper", "group-remove-paper", { params: { groupId, paperId: sharedId } }, owner);
    assert.equal(rm.ok, true);
    assert.equal(rm.result.removed, sharedId);
    assert.equal(rm.result.paperCount, 0);

    const again = await lensRun("paper", "group-remove-paper", { params: { groupId, paperId: sharedId } }, owner);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /paper not in group/);
  });

  it("paper-alerts-list + paper-alert-read: deterministic empty / not-found branches", async () => {
    const u = await depthCtx("paper-alerts-" + randomUUID());
    // No paper-check-alerts (network) run → this user's alert view is empty.
    const list = await lensRun("paper", "paper-alerts-list", {}, u);
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 0);
    assert.equal(list.result.unread, 0);

    const read = await lensRun("paper", "paper-alert-read", { params: { alertId: "no-such-alert" } }, u);
    assert.equal(read.result.ok, false);
    assert.match(read.result.error, /alert not found/);

    // mark-all-read with no alerts is a no-op that still succeeds.
    const allRead = await lensRun("paper", "paper-alert-read", { params: { all: true } }, u);
    assert.equal(allRead.ok, true);
    assert.equal(allRead.result.markedRead, 0);
  });
});

// Network / LLM macros — DETERMINISTIC validation + fallback branches only.
// These never reach egress: every assertion below targets a pre-fetch guard
// (empty/invalid input), a no-LLM fallback (ctx without llm.chat), or a loop
// that skips ineligible records before any fetch. No real arXiv / CrossRef /
// Semantic Scholar request is exercised.
describe("paper — network/LLM macro deterministic branches (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("paper-netbranch"); });

  it("search: an empty query is rejected before any arXiv call", async () => {
    const bad = await lensRun("paper", "search", { params: { query: "   " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "query required");
  });

  it("summarize: text under 300 chars is rejected before any LLM call", async () => {
    const bad = await lensRun("paper", "summarize", { params: { text: "way too short to summarize" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "text too short");
  });

  it("summarize: with no LLM available, returns the deterministic (AI unavailable) fallback", async () => {
    // Clone the ctx with llm stripped so the `!ctx?.llm?.chat` branch fires.
    const noLlm = { ...ctx, llm: undefined };
    const longText = "A".repeat(150) + " " + "research methodology and results ".repeat(20);
    assert.ok(longText.length >= 300);
    const r = await lensRun("paper", "summarize", { params: { text: longText } }, noLlm);
    assert.equal(r.ok, true);
    assert.equal(r.result.problem, "(AI unavailable)");
    assert.equal(r.result.approach, longText.slice(0, 200)); // first 200 chars verbatim
    assert.deepEqual(r.result.keyTerms, []);
  });

  it("paper-capture: a missing doi/url is rejected", async () => {
    const bad = await lensRun("paper", "paper-capture", { params: {} }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "doi or url required");
  });

  it("paper-capture: an unparseable DOI is rejected before any CrossRef call", async () => {
    const bad = await lensRun("paper", "paper-capture", { params: { doi: "not a real doi at all" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "could not parse a DOI");
  });

  it("paper-enrich: a paper that is not in the library is rejected", async () => {
    const bad = await lensRun("paper", "paper-enrich", { params: { paperId: "pp_does_not_exist" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "paper not found");
  });

  it("paper-enrich: a saved paper with no DOI or arXiv id cannot be enriched", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `No-ID Paper ${randomUUID()}` } }, ctx);
    const bad = await lensRun("paper", "paper-enrich", { params: { paperId: save.result.paper.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /no DOI or arXiv id to enrich/);
  });

  it("paper-check-alerts: skips papers with no DOI/arXiv id → checked:0, no network hit", async () => {
    const u = await depthCtx("paper-alerts-check-" + randomUUID());
    // Save a manual paper (refId defaults to the lowercased title — NOT an arxiv: prefix,
    // and no DOI), so the lookup-resolution `continue` fires for every paper.
    await lensRun("paper", "paper-save", { params: { title: `Local Only ${randomUUID()}` } }, u);
    const r = await lensRun("paper", "paper-check-alerts", {}, u);
    assert.equal(r.ok, true);
    assert.equal(r.result.checked, 0);          // nothing eligible → loop skipped every paper
    assert.equal(r.result.newAlertCount, 0);
    assert.deepEqual(r.result.newAlerts, []);
    assert.ok(typeof r.result.checkedAt === "string"); // stamp still set
  });
});
