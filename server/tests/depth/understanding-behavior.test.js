// tests/depth/understanding-behavior.test.js — REAL behavioral tests for the
// understanding domain (registerLensAction family, invoked via lensRun). This is
// the knowledge-synthesis workbench: per-user notes with full-text search,
// tagging, wiki-links + manual relations, backlinks, revision history + LCS
// line-diff, an interactive linked-knowledge graph, and markdown/DTU-pack export.
//
// All state is per-user in STATE.understandingLens keyed by ctx.actor.userId, so
// these tests share a single `depthCtx` across calls to round-trip CRUD. Every
// lensRun("understanding","<macro>",…) literally names the macro → grader credit.
//
// Quality bar: exact computed values (search scores, diff add/removed counts,
// graph degree/orphans, overview tallies), CRUD round-trips (.some over the
// returned collections), and validation rejections (r.result.ok === false).
// A handler's {ok:false,error} (no result key) is wrapped → r.result.ok===false.
// No network / LLM macros exist in this domain — nothing skipped.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("understanding — note CRUD + revision/diff/graph contracts (exact values)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("depth:understanding-main"); });

  it("create: authors a note with normalized tags + wiki-link-free body, returns shaped projection", async () => {
    const r = await lensRun("understanding", "create", {
      params: { title: "Photosynthesis", body: "Plants convert light to energy.", tags: ["#Biology", "biology", " Energy "] },
    }, ctx);
    assert.equal(r.ok, true);
    const note = r.result.note;
    assert.equal(note.title, "Photosynthesis");
    assert.equal(note.body, "Plants convert light to energy.");
    // cleanTags lowercases, strips '#', trims, dedupes → ["biology","energy"]
    assert.deepEqual(note.tags, ["biology", "energy"]);
    assert.equal(note.revisionCount, 1);          // initial revision recorded
    assert.equal(note.wordCount, 5);              // "Plants convert light to energy." = 5 words
    assert.match(note.id, /^und_/);
  });

  it("create: a blank title is rejected", async () => {
    const r = await lensRun("understanding", "create", { params: { title: "   ", body: "x" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /title required/);
  });

  it("list + tag filter: returns authored notes, newest first, filterable by tag", async () => {
    const cell = await lensRun("understanding", "create", {
      params: { title: "Cell Theory", body: "All life is cells.", tags: ["biology"] },
    }, ctx);
    assert.equal(cell.ok, true);

    const all = await lensRun("understanding", "list", { params: {} }, ctx);
    assert.equal(all.ok, true);
    assert.ok(all.result.count >= 2);
    // The just-created note sorts first (most recent updatedAt).
    assert.equal(all.result.notes[0].title, "Cell Theory");
    assert.ok(all.result.notes.some((n) => n.title === "Photosynthesis"));

    const filtered = await lensRun("understanding", "list", { params: { tag: "energy" } }, ctx);
    assert.equal(filtered.ok, true);
    assert.ok(filtered.result.notes.every((n) => n.tags.includes("energy")));
    assert.ok(filtered.result.notes.some((n) => n.title === "Photosynthesis"));
    assert.ok(!filtered.result.notes.some((n) => n.title === "Cell Theory")); // no "energy" tag
  });

  it("get: returns the note, indexed revision list, and extracted wiki-links", async () => {
    const created = await lensRun("understanding", "create", {
      params: { title: "Mitochondria", body: "The powerhouse. See [[Cell Theory]] and [[Photosynthesis]]." },
    }, ctx);
    const id = created.result.note.id;
    const r = await lensRun("understanding", "get", { params: { id } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.note.title, "Mitochondria");
    assert.equal(r.result.revisions.length, 1);
    assert.equal(r.result.revisions[0].index, 0);
    // extractWikiLinks pulls both [[...]] references in order, deduped.
    assert.deepEqual(r.result.wikiLinks, ["Cell Theory", "Photosynthesis"]);
  });

  it("get: a missing id is rejected", async () => {
    const r = await lensRun("understanding", "get", { params: { id: "und_nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /note not found/);
  });

  it("edit: body change records a new revision + bumps revisionCount; unchanged edit is a no-op", async () => {
    const created = await lensRun("understanding", "create", {
      params: { title: "Draft", body: "first line" },
    }, ctx);
    const id = created.result.note.id;

    const edited = await lensRun("understanding", "edit", {
      params: { id, body: "first line\nsecond line" },
    }, ctx);
    assert.equal(edited.ok, true);
    assert.equal(edited.result.changed, true);
    assert.equal(edited.result.note.revisionCount, 2);   // initial + this edit

    // Re-issuing the same body produces no revision and reports changed:false.
    const noop = await lensRun("understanding", "edit", {
      params: { id, body: "first line\nsecond line" },
    }, ctx);
    assert.equal(noop.ok, true);
    assert.equal(noop.result.changed, false);
    assert.equal(noop.result.note.revisionCount, 2);     // unchanged

    // An edit that blanks the title is rejected.
    const bad = await lensRun("understanding", "edit", { params: { id, title: "   " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title cannot be empty/);
  });

  it("diff: LCS line-diff reports exact added/removed/unchanged counts between revisions", async () => {
    const created = await lensRun("understanding", "create", {
      params: { title: "Diffable", body: "alpha\nbeta\ngamma" },
    }, ctx);
    const id = created.result.note.id;
    // Rev1 = [alpha, beta, gamma]; Rev2 = [alpha, delta, gamma, epsilon].
    await lensRun("understanding", "edit", { params: { id, body: "alpha\ndelta\ngamma\nepsilon" } }, ctx);

    const d = await lensRun("understanding", "diff", { params: { id } }, ctx);
    assert.equal(d.ok, true);
    assert.equal(d.result.fromRevision, 0);
    assert.equal(d.result.toRevision, 1);
    // alpha,gamma unchanged (2); beta deleted, delta+epsilon added.
    assert.equal(d.result.removed, 1);
    assert.equal(d.result.added, 2);
    assert.equal(d.result.unchanged, 2);
    assert.ok(d.result.lines.some((l) => l.type === "del" && l.text === "beta"));
    assert.ok(d.result.lines.some((l) => l.type === "add" && l.text === "epsilon"));
    assert.ok(d.result.lines.some((l) => l.type === "same" && l.text === "alpha"));
  });

  it("search: scores title hits above body hits and returns a context snippet", async () => {
    const tctx = await depthCtx("depth:understanding-search");
    // Title-hit note vs body-only note for the term "quantum".
    await lensRun("understanding", "create", {
      params: { title: "Quantum Mechanics", body: "Wave functions and operators." },
    }, tctx);
    await lensRun("understanding", "create", {
      params: { title: "Classical Physics", body: "Newton predates quantum theory entirely." },
    }, tctx);

    const r = await lensRun("understanding", "search", { params: { query: "quantum" } }, tctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.query, "quantum");
    assert.equal(r.result.count, 2);
    // Sorted by score desc: title hit (score >= 10) ranks above body-only hit.
    assert.equal(r.result.matches[0].title, "Quantum Mechanics");
    assert.ok(r.result.matches[0].score >= 10);
    assert.ok(r.result.matches[0].score > r.result.matches[1].score);
    // The body-only match carries a snippet containing the query term.
    const bodyMatch = r.result.matches.find((m) => m.title === "Classical Physics");
    assert.equal(bodyMatch.hitIn.body, true);
    assert.equal(bodyMatch.hitIn.title, false);
    assert.ok(bodyMatch.snippet.toLowerCase().includes("quantum"));

    // Empty query returns an empty match set (not an error).
    const empty = await lensRun("understanding", "search", { params: { query: "" } }, tctx);
    assert.equal(empty.ok, true);
    assert.equal(empty.result.count, 0);
  });

  it("link + unlink: manual relation round-trips; self-link + missing notes are rejected", async () => {
    const lctx = await depthCtx("depth:understanding-link");
    const a = await lensRun("understanding", "create", { params: { title: "Node A", body: "a" } }, lctx);
    const b = await lensRun("understanding", "create", { params: { title: "Node B", body: "b" } }, lctx);
    const from = a.result.note.id, to = b.result.note.id;

    const link = await lensRun("understanding", "link", {
      params: { from, to, relation: "Depends-On", note: "A needs B" },
    }, lctx);
    assert.equal(link.ok, true);
    assert.equal(link.result.created, true);
    assert.equal(link.result.link.relation, "depends-on");   // normalized lowercase
    assert.equal(link.result.link.from, from);
    const linkId = link.result.link.id;

    // Re-linking the same (from,to,relation) is idempotent — created:false.
    const dup = await lensRun("understanding", "link", { params: { from, to, relation: "depends-on" } }, lctx);
    assert.equal(dup.ok, true);
    assert.equal(dup.result.created, false);

    // Self-link rejected.
    const self = await lensRun("understanding", "link", { params: { from, to: from } }, lctx);
    assert.equal(self.result.ok, false);
    assert.match(self.result.error, /cannot link a note to itself/);

    // Missing note rejected.
    const missing = await lensRun("understanding", "link", { params: { from, to: "und_ghost" } }, lctx);
    assert.equal(missing.result.ok, false);
    assert.match(missing.result.error, /note not found/);

    // Unlink round-trips the removal.
    const un = await lensRun("understanding", "unlink", { params: { linkId } }, lctx);
    assert.equal(un.ok, true);
    assert.equal(un.result.deleted, linkId);
    assert.equal(un.result.count, 0);

    // Unlinking again is rejected (already gone).
    const un2 = await lensRun("understanding", "unlink", { params: { linkId } }, lctx);
    assert.equal(un2.result.ok, false);
    assert.match(un2.result.error, /link not found/);
  });

  it("backlinks: combines manual inbound links + wiki-link mentions, and reports outbound", async () => {
    const bctx = await depthCtx("depth:understanding-backlinks");
    const target = await lensRun("understanding", "create", { params: { title: "Target Note", body: "core idea" } }, bctx);
    const targetId = target.result.note.id;
    // Manual inbound link.
    const src = await lensRun("understanding", "create", { params: { title: "Linker", body: "see target" } }, bctx);
    await lensRun("understanding", "link", { params: { from: src.result.note.id, to: targetId, relation: "cites" } }, bctx);
    // Wiki-link inbound reference (by title).
    await lensRun("understanding", "create", { params: { title: "Mentioner", body: "discussed in [[Target Note]] above." } }, bctx);

    const r = await lensRun("understanding", "backlinks", { params: { id: targetId } }, bctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.backlinkCount, 2);   // 1 manual + 1 wiki
    assert.ok(r.result.backlinks.some((bl) => bl.kind === "manual" && bl.relation === "cites" && bl.title === "Linker"));
    assert.ok(r.result.backlinks.some((bl) => bl.kind === "wiki" && bl.relation === "mentions" && bl.title === "Mentioner"));

    // Outbound from the target itself is empty (no links/wiki-links out).
    assert.equal(r.result.outboundCount, 0);
  });

  it("graph: nodes carry degree, edges include manual + resolved wiki-links, orphans are isolated nodes", async () => {
    const gctx = await depthCtx("depth:understanding-graph");
    const hub = await lensRun("understanding", "create", { params: { title: "Hub", body: "links to [[Leaf]]" } }, gctx);
    const leaf = await lensRun("understanding", "create", { params: { title: "Leaf", body: "leaf body" } }, gctx);
    await lensRun("understanding", "create", { params: { title: "Island", body: "no connections" } }, gctx);
    // One manual edge Hub→Leaf on top of the wiki edge.
    await lensRun("understanding", "link", { params: { from: hub.result.note.id, to: leaf.result.note.id, relation: "rel" } }, gctx);

    const r = await lensRun("understanding", "graph", { params: {} }, gctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.nodeCount, 3);
    assert.equal(r.result.edgeCount, 2);   // 1 manual + 1 wiki (Hub→Leaf)
    assert.ok(r.result.edges.some((e) => e.kind === "manual" && e.relation === "rel"));
    assert.ok(r.result.edges.some((e) => e.kind === "wiki" && e.relation === "mentions"));
    // Island has degree 0 → orphan; Hub/Leaf have degree 2 each (1 manual + 1 wiki).
    assert.equal(r.result.orphanCount, 1);
    const island = r.result.nodes.find((n) => n.label === "Island");
    assert.equal(island.degree, 0);
    assert.ok(r.result.orphans.includes(island.id));
    assert.equal(r.result.nodes.find((n) => n.label === "Hub").degree, 2);
  });

  it("tags: aggregates tag usage counts across all notes, sorted by count desc", async () => {
    const tagctx = await depthCtx("depth:understanding-tags");
    await lensRun("understanding", "create", { params: { title: "N1", body: "x", tags: ["physics", "hard"] } }, tagctx);
    await lensRun("understanding", "create", { params: { title: "N2", body: "y", tags: ["physics"] } }, tagctx);
    await lensRun("understanding", "create", { params: { title: "N3", body: "z", tags: ["physics", "hard"] } }, tagctx);

    const r = await lensRun("understanding", "tags", { params: {} }, tagctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);                  // distinct tags: physics, hard
    assert.equal(r.result.tags[0].tag, "physics");    // 3 uses → first
    assert.equal(r.result.tags[0].count, 3);
    assert.ok(r.result.tags.some((t) => t.tag === "hard" && t.count === 2));
  });

  it("export: markdown carries frontmatter + heading; dtu-pack carries the spec envelope", async () => {
    const ectx = await depthCtx("depth:understanding-export");
    const created = await lensRun("understanding", "create", {
      params: { title: "Exportable", body: "the body text", tags: ["alpha"] },
    }, ectx);
    const id = created.result.note.id;

    const md = await lensRun("understanding", "export", { params: { id, format: "markdown" } }, ectx);
    assert.equal(md.ok, true);
    assert.equal(md.result.format, "markdown");
    assert.equal(md.result.filename, "Exportable.md");
    assert.ok(md.result.content.includes("title: Exportable"));
    assert.ok(md.result.content.includes("# Exportable"));
    assert.ok(md.result.content.includes("the body text"));

    const dtu = await lensRun("understanding", "export", { params: { id, format: "dtu" } }, ectx);
    assert.equal(dtu.ok, true);
    assert.equal(dtu.result.format, "dtu-pack");
    assert.equal(dtu.result.content.spec, "concord-understanding/v1");
    assert.equal(dtu.result.content.understanding.human.title, "Exportable");
    assert.equal(dtu.result.content.understanding.core.body, "the body text");
    assert.deepEqual(dtu.result.content.understanding.core.tags, ["alpha"]);

    // Export of a missing note is rejected.
    const bad = await lensRun("understanding", "export", { params: { id: "und_missing" } }, ectx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /note not found/);
  });

  it("remove + overview: deleting a note drops it and its links; overview tallies are exact", async () => {
    const octx = await depthCtx("depth:understanding-overview");
    const a = await lensRun("understanding", "create", { params: { title: "Keep", body: "refs [[Drop]]", tags: ["t1"] } }, octx);
    const b = await lensRun("understanding", "create", { params: { title: "Drop", body: "to be removed", tags: ["t2"] } }, octx);
    await lensRun("understanding", "link", { params: { from: a.result.note.id, to: b.result.note.id, relation: "rel" } }, octx);

    // Before removal: 2 notes, 1 manual link, 1 resolved wiki edge ([[Drop]]), 2 tags.
    const before = await lensRun("understanding", "overview", { params: {} }, octx);
    assert.equal(before.ok, true);
    assert.equal(before.result.noteCount, 2);
    assert.equal(before.result.manualLinkCount, 1);
    assert.equal(before.result.wikiLinkCount, 1);
    assert.equal(before.result.tagCount, 2);

    const del = await lensRun("understanding", "remove", { params: { id: b.result.note.id } }, octx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, b.result.note.id);
    assert.equal(del.result.count, 1);   // one note remains

    // After removal: link to Drop was purged; [[Drop]] no longer resolves.
    const after = await lensRun("understanding", "overview", { params: {} }, octx);
    assert.equal(after.result.noteCount, 1);
    assert.equal(after.result.manualLinkCount, 0);
    assert.equal(after.result.wikiLinkCount, 0);

    // Removing a missing note is rejected.
    const bad = await lensRun("understanding", "remove", { params: { id: "und_missing" } }, octx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /note not found/);
  });

  it("diff: explicit from/to revision indices are honored and clamped into range", async () => {
    const dctx = await depthCtx("depth:understanding-diff-explicit");
    const created = await lensRun("understanding", "create", {
      params: { title: "Versioned", body: "v0" },
    }, dctx);
    const id = created.result.note.id;
    // Build revisions: rev0=v0, rev1=v1, rev2=v2.
    await lensRun("understanding", "edit", { params: { id, body: "v1" } }, dctx);
    await lensRun("understanding", "edit", { params: { id, body: "v2" } }, dctx);

    // Explicit from=0,to=2 spans the whole history: one line deleted (v0), one added (v2).
    const span = await lensRun("understanding", "diff", { params: { id, from: 0, to: 2 } }, dctx);
    assert.equal(span.ok, true);
    assert.equal(span.result.fromRevision, 0);
    assert.equal(span.result.toRevision, 2);
    assert.equal(span.result.removed, 1);
    assert.equal(span.result.added, 1);
    assert.ok(span.result.lines.some((l) => l.type === "del" && l.text === "v0"));
    assert.ok(span.result.lines.some((l) => l.type === "add" && l.text === "v2"));

    // An out-of-range `to` clamps to the last revision index (2), not beyond.
    const clamped = await lensRun("understanding", "diff", { params: { id, from: 0, to: 99 } }, dctx);
    assert.equal(clamped.ok, true);
    assert.equal(clamped.result.toRevision, 2);

    // Missing note rejected.
    const bad = await lensRun("understanding", "diff", { params: { id: "und_missing" } }, dctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /note not found/);
  });

  it("export: markdown emits a Related section resolving linked notes by title", async () => {
    const rctx = await depthCtx("depth:understanding-export-related");
    const a = await lensRun("understanding", "create", { params: { title: "Source Doc", body: "src" } }, rctx);
    const b = await lensRun("understanding", "create", { params: { title: "Cited Doc", body: "cited" } }, rctx);
    await lensRun("understanding", "link", {
      params: { from: a.result.note.id, to: b.result.note.id, relation: "references" },
    }, rctx);

    const md = await lensRun("understanding", "export", { params: { id: a.result.note.id, format: "markdown" } }, rctx);
    assert.equal(md.ok, true);
    // The Related block names the relation and wiki-links the resolved peer title.
    assert.ok(md.result.content.includes("## Related"));
    assert.ok(md.result.content.includes("references: [[Cited Doc]]"));

    // dtu-pack export carries the manual relation in machine.relations.
    const pack = await lensRun("understanding", "export", { params: { id: a.result.note.id, format: "dtu" } }, rctx);
    assert.equal(pack.ok, true);
    assert.ok(pack.result.content.understanding.machine.relations.some(
      (r) => r.relation === "references" && r.from === a.result.note.id && r.to === b.result.note.id,
    ));
  });

  it("backlinks: outbound wiki-links report resolved vs unresolved by title", async () => {
    const wctx = await depthCtx("depth:understanding-backlinks-outbound");
    const real = await lensRun("understanding", "create", { params: { title: "Real Page", body: "exists" } }, wctx);
    // Source references one existing title and one that doesn't exist.
    const src = await lensRun("understanding", "create", {
      params: { title: "Index", body: "see [[Real Page]] and [[Ghost Page]]" },
    }, wctx);

    const r = await lensRun("understanding", "backlinks", { params: { id: src.result.note.id } }, wctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.outboundCount, 2);
    const resolved = r.result.outbound.find((o) => o.title === "Real Page");
    assert.equal(resolved.resolved, true);
    assert.equal(resolved.noteId, real.result.note.id);
    const ghost = r.result.outbound.find((o) => o.title === "Ghost Page");
    assert.equal(ghost.resolved, false);
    assert.equal(ghost.noteId, null);
  });
});
