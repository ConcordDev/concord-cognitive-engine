// Behavioral macro tests for server/domains/understanding.js — the
// Obsidian/RemNote-shape knowledge-notes substrate the /lenses/understanding
// lens (NotesWorkbench + KnowledgeGraph children) drives via lensRun.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150):
// handlers registered via `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention
// (the domain-module path-3 registration). Our harness therefore calls
// `fn(ctx, virtualArtifact, input)`, NOT (ctx, input), so a regression that
// confuses the param positions surfaces here.
//
// DUAL REGISTRATION NOTE: `understanding` is also registered inline in
// server.js (`register("understanding", …)` — the understanding-ENGINE /
// understanding-EVOLVE macros parse/compose/lineage/evolution_*). Those are
// the 2-arg MACROS path and are exercised by understanding-engine.test.js /
// understanding-evolve.test.js. `/api/lens/run` PREFERS LENS_ACTIONS, so the
// lens's notes-substrate calls (list/tags/search/create/get/edit/remove/diff/
// link/unlink/backlinks/graph/overview) resolve HERE, in the domain file.
// This test pins the domain (notes) receiver that the lens actually hits.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL values +
// round-trips, per-user isolation, fail-CLOSED numeric/string guards, and
// degrade-graceful behavior (empty STATE → ok-or-clean-error, never a throw,
// never no_db).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerUnderstandingActions from "../domains/understanding.js";

// ── Harness — mirror the live 3-arg dispatch ───────────────────────────────
const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "understanding", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`understanding.${name} not registered`);
  // virtualArtifact exactly as server.js builds it; input is the 3rd param.
  const virtualArtifact = { id: null, domain: "understanding", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerUnderstandingActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function mk(ctx, title, body = "", tags) {
  const r = call("create", ctx, { title, body, tags });
  assert.equal(r.ok, true, `create ${title} failed: ${r.error}`);
  return r.result.note;
}

// ── Registration — every lens-driven notes macro present ───────────────────
describe("understanding — registration (every notes macro the lens calls)", () => {
  it("registers the 14 notes-substrate macros the NotesWorkbench + KnowledgeGraph drive", () => {
    for (const m of [
      "create", "list", "get", "edit", "remove",
      "search", "link", "unlink", "backlinks",
      "graph", "tags", "diff", "export", "overview",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing understanding.${m}`);
    }
  });
});

// ── create → list → get round-trip (real values) ───────────────────────────
describe("understanding — create / list / get round-trip", () => {
  it("creates a note with derived wordCount + first revision and lists it", () => {
    const r = call("create", ctxA, { title: "Spaced repetition", body: "Recall over time wins.", tags: ["memory", "study"] });
    assert.equal(r.ok, true);
    const n = r.result.note;
    assert.equal(n.title, "Spaced repetition");
    assert.deepEqual(n.tags, ["memory", "study"]);
    assert.equal(n.wordCount, 4, "wordCount counts body words exactly");
    assert.equal(n.revisionCount, 1, "creation stamps one revision");

    const list = call("list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.notes[0].id, n.id);

    const got = call("get", ctxA, { id: n.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.note.body, "Recall over time wins.");
    assert.equal(got.result.revisions.length, 1);
  });

  it("filters list by tag", () => {
    mk(ctxA, "A", "x", ["alpha"]);
    mk(ctxA, "B", "y", ["beta"]);
    assert.equal(call("list", ctxA, { tag: "alpha" }).result.count, 1);
    assert.equal(call("list", ctxA, { tag: "ALPHA" }).result.count, 1, "tag filter is case-insensitive");
    assert.equal(call("list", ctxA, { tag: "zzz" }).result.count, 0);
  });

  it("normalizes + caps tags (lowercased, deduped, #-stripped)", () => {
    const n = mk(ctxA, "Tagged", "x", ["#Focus", "focus", "  STUDY "]);
    assert.deepEqual(n.tags, ["focus", "study"]);
  });
});

// ── edit + revisions ───────────────────────────────────────────────────────
describe("understanding — edit records a revision; no-op when unchanged", () => {
  it("edits the body and pushes a second revision", () => {
    const n = mk(ctxA, "Note", "first body");
    const e = call("edit", ctxA, { id: n.id, body: "second body" });
    assert.equal(e.ok, true);
    assert.equal(e.result.changed, true);
    assert.equal(e.result.note.revisionCount, 2);
    assert.equal(call("get", ctxA, { id: n.id }).result.note.body, "second body");
  });
  it("no-ops when nothing changes (no phantom revision)", () => {
    const n = mk(ctxA, "Note", "body");
    const e = call("edit", ctxA, { id: n.id, body: "body" });
    assert.equal(e.result.changed, false);
    assert.equal(e.result.note.revisionCount, 1);
  });
});

// ── search ─────────────────────────────────────────────────────────────────
describe("understanding — search (full-text, scored)", () => {
  it("matches title/body/tag and ranks title hits above body hits", () => {
    mk(ctxA, "Energy", "about photosynthesis", ["biology"]);   // title hit (10)
    mk(ctxA, "Random", "the word energy appears here", ["misc"]); // body hit
    const r = call("search", ctxA, { query: "energy" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.matches[0].title, "Energy", "title hit ranks first");
    assert.ok(r.result.matches[0].score > r.result.matches[1].score);
  });
  it("blank query returns an empty match set (ok:true, not an error)", () => {
    mk(ctxA, "X", "y");
    const r = call("search", ctxA, { query: "" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
  });
});

// ── link / unlink / backlinks + wiki-links ─────────────────────────────────
describe("understanding — link / unlink / backlinks", () => {
  it("links two notes, surfaces a backlink, and unlinks", () => {
    const a = mk(ctxA, "Cause", "x");
    const b = mk(ctxA, "Effect", "y");
    const l = call("link", ctxA, { from: a.id, to: b.id, relation: "leads-to" });
    assert.equal(l.result.created, true);
    const bl = call("backlinks", ctxA, { id: b.id });
    assert.equal(bl.result.backlinkCount, 1);
    assert.equal(bl.result.backlinks[0].relation, "leads-to");
    assert.equal(bl.result.backlinks[0].noteId, a.id);
    const un = call("unlink", ctxA, { linkId: l.result.link.id });
    assert.equal(un.ok, true);
    assert.equal(call("backlinks", ctxA, { id: b.id }).result.backlinkCount, 0);
  });
  it("rejects self-links and links to missing notes (fail-closed)", () => {
    const a = mk(ctxA, "A", "x");
    assert.equal(call("link", ctxA, { from: a.id, to: a.id }).ok, false);
    assert.equal(call("link", ctxA, { from: a.id, to: "ghost" }).ok, false);
    assert.equal(call("link", ctxA, { from: "", to: "" }).ok, false);
  });
  it("resolves [[wiki-links]] as backlinks (kind=wiki)", () => {
    const target = mk(ctxA, "Topic", "the target");
    mk(ctxA, "Source", "see [[Topic]] for context");
    const bl = call("backlinks", ctxA, { id: target.id });
    assert.ok(bl.result.backlinks.some((b) => b.kind === "wiki" && b.relation === "mentions"));
  });
});

// ── graph ──────────────────────────────────────────────────────────────────
describe("understanding — graph (nodes + manual/wiki edges + orphans)", () => {
  it("builds the graph the KnowledgeGraph renders", () => {
    const a = mk(ctxA, "Alpha", "links to [[Beta]]");
    const b = mk(ctxA, "Beta", "y");
    const c = mk(ctxA, "Gamma", "orphan");
    call("link", ctxA, { from: b.id, to: a.id, relation: "supports" });
    const g = call("graph", ctxA, {});
    assert.equal(g.ok, true);
    assert.equal(g.result.nodeCount, 3);
    assert.equal(g.result.edgeCount, 2, "one wiki edge (Alpha→Beta) + one manual edge (Beta→Alpha)");
    assert.equal(g.result.orphanCount, 1);
    assert.ok(g.result.orphans.includes(c.id));
  });
});

// ── tags / diff / export / overview ────────────────────────────────────────
describe("understanding — tags / diff / export / overview", () => {
  it("tags aggregates with counts, sorted desc", () => {
    mk(ctxA, "A", "x", ["focus", "study"]);
    mk(ctxA, "B", "y", ["focus"]);
    const r = call("tags", ctxA, {});
    assert.equal(r.result.tags[0].tag, "focus");
    assert.equal(r.result.tags[0].count, 2);
  });
  it("diff computes an LCS line diff between revisions", () => {
    const n = mk(ctxA, "Doc", "line one\nline two");
    call("edit", ctxA, { id: n.id, body: "line one\nline two changed\nline three" });
    const d = call("diff", ctxA, { id: n.id });
    assert.equal(d.ok, true);
    assert.ok(d.result.added >= 1);
    assert.ok(d.result.removed >= 1);
    assert.ok(d.result.lines.some((l) => l.type === "same"));
  });
  it("export emits markdown frontmatter and a DTU pack", () => {
    const n = mk(ctxA, "Export me", "the body", ["t1"]);
    const md = call("export", ctxA, { id: n.id, format: "markdown" });
    assert.equal(md.result.format, "markdown");
    assert.ok(md.result.content.includes("title: Export me"));
    assert.ok(md.result.content.includes("# Export me"));
    const dtu = call("export", ctxA, { id: n.id, format: "dtu" });
    assert.equal(dtu.result.format, "dtu-pack");
    assert.equal(dtu.result.content.spec, "concord-understanding/v1");
    assert.equal(dtu.result.content.understanding.human.title, "Export me");
  });
  it("overview reports the stats-strip counts", () => {
    const a = mk(ctxA, "A", "see [[B]]", ["x"]);
    const b = mk(ctxA, "B", "y", ["y"]);
    call("link", ctxA, { from: a.id, to: b.id });
    const r = call("overview", ctxA, {});
    assert.equal(r.result.noteCount, 2);
    assert.equal(r.result.manualLinkCount, 1);
    assert.equal(r.result.wikiLinkCount, 1);
    assert.equal(r.result.tagCount, 2);
  });
});

// ── per-user isolation ─────────────────────────────────────────────────────
describe("understanding — per-user isolation", () => {
  it("one user's notes, links, tags, graph and overview never leak to another", () => {
    const a = mk(ctxA, "A-private", "secret [[A-private]]", ["a"]);
    mk(ctxA, "A-two", "x");
    call("link", ctxA, { from: a.id, to: a.id }); // self-link rejected; no leak either way
    // user_b sees nothing of user_a.
    assert.equal(call("list", ctxB, {}).result.count, 0);
    assert.equal(call("tags", ctxB, {}).result.count, 0);
    assert.equal(call("graph", ctxB, {}).result.nodeCount, 0);
    assert.equal(call("overview", ctxB, {}).result.noteCount, 0);
    assert.equal(call("get", ctxB, { id: a.id }).ok, false, "cannot read another user's note by id");
    assert.equal(call("search", ctxB, { query: "secret" }).result.count, 0);
  });
});

// ── fail-CLOSED guards (string + numeric) ──────────────────────────────────
describe("understanding — fail-CLOSED string/numeric guards", () => {
  it("create rejects an empty/whitespace title", () => {
    assert.equal(call("create", ctxA, { title: "  " }).ok, false);
    assert.equal(call("create", ctxA, {}).ok, false);
  });
  it("edit cannot blank out a title", () => {
    const n = mk(ctxA, "Keep", "x");
    assert.equal(call("edit", ctxA, { id: n.id, title: "   " }).ok, false);
    // title stays intact.
    assert.equal(call("get", ctxA, { id: n.id }).result.note.title, "Keep");
  });
  it("get / edit / remove / backlinks / diff on a missing id fail (never throw)", () => {
    for (const m of ["get", "edit", "remove", "backlinks", "diff"]) {
      const r = call(m, ctxA, { id: "ghost_id" });
      assert.equal(r.ok, false, `${m} on missing id should be ok:false`);
      assert.ok(typeof r.error === "string" && r.error.length > 0);
    }
  });
  it("poisoned diff revision indices are clamped, never crash (NaN/Infinity/1e308/-1)", () => {
    const n = mk(ctxA, "Doc", "a\nb");
    call("edit", ctxA, { id: n.id, body: "a\nb\nc" });
    for (const poison of [NaN, Infinity, -1, 1e308, "9".repeat(40)]) {
      const d = call("diff", ctxA, { id: n.id, from: poison, to: poison });
      assert.equal(d.ok, true, `diff stayed ok for poison=${String(poison)}`);
      assert.ok(Number.isInteger(d.result.fromRevision) && d.result.fromRevision >= 0);
      assert.ok(Number.isInteger(d.result.toRevision) && d.result.toRevision <= n.revisionCount);
    }
  });
  it("poisoned title/body are coerced to strings, never executed or NaN'd", () => {
    // Numbers / objects injected as title|body get String()-coerced; no throw.
    const r = call("create", ctxA, { title: 12345, body: { evil: true }, tags: 999 });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.note.title, "string");
    assert.equal(r.result.note.title, "12345");
    assert.ok(Array.isArray(r.result.note.tags));
  });
  it("a huge tag list is capped (no unbounded growth)", () => {
    const many = Array.from({ length: 200 }, (_, i) => `t${i}`);
    const n = mk(ctxA, "Many tags", "x", many);
    assert.ok(n.tags.length <= 32, `tags capped at 32, got ${n.tags.length}`);
  });
});

// ── degrade-graceful (STATE missing) ───────────────────────────────────────
describe("understanding — degrade-graceful when STATE is unavailable", () => {
  it("every read macro returns a clean error object (never throws, never no_db) with no STATE", () => {
    globalThis._concordSTATE = undefined;
    for (const m of ["list", "tags", "graph", "overview", "search"]) {
      let r;
      assert.doesNotThrow(() => { r = call(m, ctxA, { query: "x" }); }, `${m} threw with no STATE`);
      assert.equal(typeof r, "object");
      assert.equal(r.ok, false);
      assert.notEqual(r.error, "no_db");
      assert.equal(r.error, "STATE unavailable");
    }
  });
  it("read macros on an EMPTY (but present) STATE return ok:true with empty collections", () => {
    globalThis._concordSTATE = { dtus: new Map() };
    assert.equal(call("list", ctxA, {}).result.count, 0);
    assert.equal(call("tags", ctxA, {}).result.count, 0);
    assert.equal(call("graph", ctxA, {}).result.nodeCount, 0);
    assert.equal(call("overview", ctxA, {}).result.noteCount, 0);
    // search with a real query but no notes is still ok:true.
    assert.equal(call("search", ctxA, { query: "anything" }).result.count, 0);
  });
});
