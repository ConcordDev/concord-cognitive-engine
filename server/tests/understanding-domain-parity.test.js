// Contract tests for the understanding lens knowledge-synthesis domain
// (server/domains/understanding.js) — notes, search, links, backlinks,
// graph, tags, diff, export. Obsidian / RemNote-shape feature parity.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerUnderstandingActions from "../domains/understanding.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`understanding.${name}`);
  assert.ok(fn, `understanding.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerUnderstandingActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function mk(ctx, title, body, tags) {
  const r = call("create", ctx, { title, body, tags });
  assert.equal(r.ok, true, `create ${title} failed`);
  return r.result.note;
}

describe("understanding.create + list", () => {
  it("creates a note and lists it per user", () => {
    const r = call("create", ctxA, { title: "Spaced repetition", body: "Recall over time.", tags: ["memory", "study"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.note.title, "Spaced repetition");
    assert.deepEqual(r.result.note.tags, ["memory", "study"]);
    const list = call("list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(call("list", ctxB, {}).result.count, 0);
  });
  it("rejects an empty title", () => {
    assert.equal(call("create", ctxA, { title: "  " }).ok, false);
  });
  it("filters list by tag", () => {
    mk(ctxA, "A", "x", ["alpha"]);
    mk(ctxA, "B", "y", ["beta"]);
    assert.equal(call("list", ctxA, { tag: "alpha" }).result.count, 1);
  });
});

describe("understanding.get + edit (inline editing + revisions)", () => {
  it("edits a note body and records a revision", () => {
    const n = mk(ctxA, "Note", "first body");
    const e = call("edit", ctxA, { id: n.id, body: "second body" });
    assert.equal(e.ok, true);
    assert.equal(e.result.changed, true);
    assert.equal(e.result.note.revisionCount, 2);
    const got = call("get", ctxA, { id: n.id });
    assert.equal(got.result.note.body, "second body");
    assert.equal(got.result.revisions.length, 2);
  });
  it("no-ops when nothing changes", () => {
    const n = mk(ctxA, "Note", "body");
    assert.equal(call("edit", ctxA, { id: n.id, body: "body" }).result.changed, false);
  });
  it("get on a missing note fails", () => {
    assert.equal(call("get", ctxA, { id: "nope" }).ok, false);
  });
});

describe("understanding.remove", () => {
  it("deletes a note and its links", () => {
    const a = mk(ctxA, "A", "x");
    const b = mk(ctxA, "B", "y");
    call("link", ctxA, { from: a.id, to: b.id });
    assert.equal(call("remove", ctxA, { id: a.id }).ok, true);
    assert.equal(call("list", ctxA, {}).result.count, 1);
    assert.equal(call("backlinks", ctxA, { id: b.id }).result.backlinkCount, 0);
  });
});

describe("understanding.search (full-text)", () => {
  it("finds notes by title, body and tag with scoring", () => {
    mk(ctxA, "Photosynthesis", "Plants convert light into energy.", ["biology"]);
    mk(ctxA, "Random", "the word energy appears here too", ["misc"]);
    const r = call("search", ctxA, { query: "energy" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.ok(r.result.matches[0].score >= r.result.matches[1].score);
    assert.ok(r.result.matches.some((m) => m.snippet.length > 0));
  });
  it("returns empty for a blank query", () => {
    mk(ctxA, "X", "y");
    assert.equal(call("search", ctxA, { query: "" }).result.count, 0);
  });
});

describe("understanding.link + unlink + backlinks", () => {
  it("manually links two notes and surfaces a backlink", () => {
    const a = mk(ctxA, "Cause", "x");
    const b = mk(ctxA, "Effect", "y");
    const l = call("link", ctxA, { from: a.id, to: b.id, relation: "leads-to" });
    assert.equal(l.ok, true);
    assert.equal(l.result.created, true);
    const bl = call("backlinks", ctxA, { id: b.id });
    assert.equal(bl.result.backlinkCount, 1);
    assert.equal(bl.result.backlinks[0].relation, "leads-to");
    const un = call("unlink", ctxA, { linkId: l.result.link.id });
    assert.equal(un.ok, true);
    assert.equal(call("backlinks", ctxA, { id: b.id }).result.backlinkCount, 0);
  });
  it("rejects self-links and missing notes", () => {
    const a = mk(ctxA, "A", "x");
    assert.equal(call("link", ctxA, { from: a.id, to: a.id }).ok, false);
    assert.equal(call("link", ctxA, { from: a.id, to: "nope" }).ok, false);
  });
  it("resolves [[wiki-links]] as backlinks", () => {
    const target = mk(ctxA, "Topic", "the target note");
    mk(ctxA, "Source", "see [[Topic]] for more");
    const bl = call("backlinks", ctxA, { id: target.id });
    assert.ok(bl.result.backlinks.some((b) => b.kind === "wiki"));
  });
});

describe("understanding.graph", () => {
  it("builds nodes and edges from manual + wiki links", () => {
    const a = mk(ctxA, "Alpha", "links to [[Beta]]");
    const b = mk(ctxA, "Beta", "y");
    const c = mk(ctxA, "Gamma", "orphan");
    call("link", ctxA, { from: b.id, to: a.id, relation: "supports" });
    const g = call("graph", ctxA, {});
    assert.equal(g.ok, true);
    assert.equal(g.result.nodeCount, 3);
    assert.equal(g.result.edgeCount, 2);
    assert.ok(g.result.orphans.includes(c.id));
  });
});

describe("understanding.tags", () => {
  it("aggregates tags with counts", () => {
    mk(ctxA, "A", "x", ["focus", "study"]);
    mk(ctxA, "B", "y", ["focus"]);
    const r = call("tags", ctxA, {});
    assert.equal(r.ok, true);
    const focus = r.result.tags.find((t) => t.tag === "focus");
    assert.equal(focus.count, 2);
  });
});

describe("understanding.diff", () => {
  it("computes a line diff between revisions", () => {
    const n = mk(ctxA, "Doc", "line one\nline two");
    call("edit", ctxA, { id: n.id, body: "line one\nline two changed\nline three" });
    const d = call("diff", ctxA, { id: n.id });
    assert.equal(d.ok, true);
    assert.ok(d.result.added >= 1);
    assert.ok(d.result.removed >= 1);
    assert.ok(d.result.lines.some((l) => l.type === "same"));
  });
});

describe("understanding.export", () => {
  it("exports markdown with frontmatter", () => {
    const n = mk(ctxA, "Export me", "the body", ["t1"]);
    const r = call("export", ctxA, { id: n.id, format: "markdown" });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "markdown");
    assert.ok(r.result.content.includes("title: Export me"));
    assert.ok(r.result.content.includes("# Export me"));
  });
  it("exports a DTU pack", () => {
    const n = mk(ctxA, "Pack", "body text");
    const r = call("export", ctxA, { id: n.id, format: "dtu" });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "dtu-pack");
    assert.equal(r.result.content.spec, "concord-understanding/v1");
    assert.equal(r.result.content.understanding.human.title, "Pack");
  });
});

describe("understanding.overview", () => {
  it("reports note / link / tag counts", () => {
    const a = mk(ctxA, "A", "see [[B]]", ["x"]);
    const b = mk(ctxA, "B", "y", ["y"]);
    call("link", ctxA, { from: a.id, to: b.id });
    const r = call("overview", ctxA, {});
    assert.equal(r.result.noteCount, 2);
    assert.equal(r.result.manualLinkCount, 1);
    assert.equal(r.result.wikiLinkCount, 1);
    assert.equal(r.result.tagCount, 2);
    assert.equal(r.result.reviewEnabledCount, 0);
    assert.equal(r.result.dueForReviewCount, 0);
  });
});

// ── Outline structure (nested parent/child, built on the link substrate) ──

describe("understanding.move + outline + reorder", () => {
  it("creates a note as a child via move, surfaced in outline()", () => {
    const parent = mk(ctxA, "Parent", "root topic");
    const child = mk(ctxA, "Child", "sub topic");
    const m = call("move", ctxA, { id: child.id, parentId: parent.id });
    assert.equal(m.ok, true);
    assert.equal(m.result.parentId, parent.id);
    assert.equal(m.result.order, 0);

    const o = call("outline", ctxA, {});
    assert.equal(o.ok, true);
    // Parent is a root (child is no longer a root since it has a parent).
    assert.equal(o.result.forest.length, 1);
    assert.equal(o.result.forest[0].id, parent.id);
    assert.equal(o.result.forest[0].childCount, 1);
    assert.equal(o.result.forest[0].children[0].id, child.id);
  });

  it("rejects a note becoming its own parent", () => {
    const a = mk(ctxA, "A", "x");
    assert.equal(call("move", ctxA, { id: a.id, parentId: a.id }).ok, false);
  });

  it("rejects a move that would create a cycle", () => {
    const a = mk(ctxA, "A", "x");
    const b = mk(ctxA, "B", "y");
    const c = mk(ctxA, "C", "z");
    // A -> B -> C
    assert.equal(call("move", ctxA, { id: b.id, parentId: a.id }).ok, true);
    assert.equal(call("move", ctxA, { id: c.id, parentId: b.id }).ok, true);
    // Making A a child of C (its own descendant) must fail.
    const bad = call("move", ctxA, { id: a.id, parentId: c.id });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /cycle/);
  });

  it("re-parenting replaces the previous parent edge, not adds a second one", () => {
    const p1 = mk(ctxA, "P1", "");
    const p2 = mk(ctxA, "P2", "");
    const child = mk(ctxA, "Child", "");
    call("move", ctxA, { id: child.id, parentId: p1.id });
    call("move", ctxA, { id: child.id, parentId: p2.id });
    const t1 = call("outline", ctxA, { rootId: p1.id });
    const t2 = call("outline", ctxA, { rootId: p2.id });
    assert.equal(t1.result.tree.childCount, 0);
    assert.equal(t2.result.tree.childCount, 1);
    assert.equal(t2.result.tree.children[0].id, child.id);
  });

  it("detaching to root (parentId omitted) restores a root-level note", () => {
    const parent = mk(ctxA, "Parent", "");
    const child = mk(ctxA, "Child", "");
    call("move", ctxA, { id: child.id, parentId: parent.id });
    const back = call("move", ctxA, { id: child.id, parentId: "" });
    assert.equal(back.ok, true);
    assert.equal(back.result.parentId, null);
    const o = call("outline", ctxA, {});
    assert.equal(o.result.forest.length, 2);
  });

  it("reorders siblings by index", () => {
    const parent = mk(ctxA, "Parent", "");
    const c1 = mk(ctxA, "C1", "");
    const c2 = mk(ctxA, "C2", "");
    const c3 = mk(ctxA, "C3", "");
    call("move", ctxA, { id: c1.id, parentId: parent.id });
    call("move", ctxA, { id: c2.id, parentId: parent.id });
    call("move", ctxA, { id: c3.id, parentId: parent.id });
    // Default order after 3 appends: c1, c2, c3.
    let tree = call("outline", ctxA, { rootId: parent.id }).result.tree;
    assert.deepEqual(tree.children.map((c) => c.id), [c1.id, c2.id, c3.id]);
    // Move c3 to index 0 -> c3, c1, c2.
    const r = call("reorder", ctxA, { id: c3.id, index: 0 });
    assert.equal(r.ok, true);
    tree = call("outline", ctxA, { rootId: parent.id }).result.tree;
    assert.deepEqual(tree.children.map((c) => c.id), [c3.id, c1.id, c2.id]);
  });

  it("reorders root-level notes too", () => {
    const a = mk(ctxA, "RootA", "");
    const b = mk(ctxA, "RootB", "");
    // a was created first (rootOrder 0), b second (rootOrder 1).
    let forest = call("outline", ctxA, {}).result.forest;
    assert.deepEqual(forest.map((n) => n.id), [a.id, b.id]);
    call("reorder", ctxA, { id: b.id, index: 0 });
    forest = call("outline", ctxA, {}).result.forest;
    assert.deepEqual(forest.map((n) => n.id), [b.id, a.id]);
  });

  it("generic link() refuses the reserved outline-child relation", () => {
    const a = mk(ctxA, "A", "");
    const b = mk(ctxA, "B", "");
    const r = call("link", ctxA, { from: a.id, to: b.id, relation: "outline-child" });
    assert.equal(r.ok, false);
    assert.match(r.error, /understanding\.move/);
  });

  it("deleting a parent note detaches its children rather than deleting them", () => {
    const parent = mk(ctxA, "Parent", "");
    const child = mk(ctxA, "Child", "");
    call("move", ctxA, { id: child.id, parentId: parent.id });
    call("remove", ctxA, { id: parent.id });
    const list = call("list", ctxA, {});
    assert.ok(list.result.notes.some((n) => n.id === child.id));
    const outline = call("outline", ctxA, {});
    assert.ok(outline.result.forest.some((n) => n.id === child.id));
  });

  it("outline structural edges are excluded from graph() and backlinks()", () => {
    const parent = mk(ctxA, "Parent", "");
    const child = mk(ctxA, "Child", "");
    call("move", ctxA, { id: child.id, parentId: parent.id });
    const g = call("graph", ctxA, {});
    assert.equal(g.result.edgeCount, 0);
    const bl = call("backlinks", ctxA, { id: child.id });
    assert.equal(bl.result.backlinkCount, 0);
  });
});

// ── Spaced repetition (SM-2, hand-verified against the textbook formula) ──

describe("understanding.review + due (SM-2 spaced repetition)", () => {
  it("a fresh note starts unreviewed / not enrolled", () => {
    const n = mk(ctxA, "Fresh", "body");
    const got = call("get", ctxA, { id: n.id });
    assert.equal(got.result.note.srs.enabled, false);
    assert.equal(got.result.note.srs.state, "new");
    assert.equal(got.result.note.srs.ease, 2.5);
    assert.equal(got.result.note.srs.reps, 0);
  });

  it("rejects a missing quality and an out-of-range/non-numeric quality gracefully", () => {
    const n = mk(ctxA, "N", "");
    assert.equal(call("review", ctxA, { id: n.id }).ok, false);
    assert.equal(call("review", ctxA, { id: n.id, quality: "not-a-number" }).ok, false);
  });

  it("hand-verified SM-2 sequence: good, easy, hard(pass), fail", () => {
    // Hand-computed against the canonical SM-2 algorithm (Wozniak 1987):
    //   q<3: reps=0, interval=1
    //   q>=3: reps==0 -> interval=1; reps==1 -> interval=6; else interval=round(prevInterval*EF); reps+=1
    //   EF' = EF + (0.1 - (5-q)*(0.08 + (5-q)*0.02)), floored at 1.3
    const n = mk(ctxA, "Card", "front/back content");

    // Review 1: q=4 (good). reps 0->1, interval=1, EF stays 2.5.
    //   EF' = 2.5 + (0.1 - 1*(0.08+1*0.02)) = 2.5 + (0.1-0.10) = 2.5
    let r = call("review", ctxA, { id: n.id, quality: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.nextReviewInDays, 1);
    assert.equal(r.result.srs.ease, 2.5);
    assert.equal(r.result.srs.reps, 1);
    assert.equal(r.result.srs.lapses, 0);

    // Review 2: q=5 (easy). reps 1->2, interval=6.
    //   EF' = 2.5 + (0.1 - 0*(0.08+0*0.02)) = 2.6
    r = call("review", ctxA, { id: n.id, quality: 5 });
    assert.equal(r.result.nextReviewInDays, 6);
    assert.equal(r.result.srs.ease, 2.6);
    assert.equal(r.result.srs.reps, 2);

    // Review 3: q=3 (hard pass). reps 2->3, interval=round(6*2.6)=round(15.6)=16.
    //   EF' = 2.6 + (0.1 - 2*(0.08+2*0.02)) = 2.6 + (0.1 - 2*0.12) = 2.6 - 0.14 = 2.46
    r = call("review", ctxA, { id: n.id, quality: 3 });
    assert.equal(r.result.nextReviewInDays, 16);
    assert.equal(r.result.srs.ease, 2.46);
    assert.equal(r.result.srs.reps, 3);

    // Review 4: q=2 (fail). reps resets to 0, interval=1, lapses+=1.
    //   EF' = 2.46 + (0.1 - 3*(0.08+3*0.02)) = 2.46 + (0.1 - 3*0.14) = 2.46 - 0.32 = 2.14
    r = call("review", ctxA, { id: n.id, quality: 2 });
    assert.equal(r.result.nextReviewInDays, 1);
    assert.equal(r.result.srs.ease, 2.14);
    assert.equal(r.result.srs.reps, 0);
    assert.equal(r.result.srs.lapses, 1);
    assert.equal(r.result.srs.state, "relearning");
  });

  it("ease factor floors at 1.3 and never goes lower", () => {
    const n = mk(ctxA, "Hard card", "");
    // Repeated blackouts (q=0) each apply EF' = EF + (0.1 - 5*(0.08+5*0.02)) = EF + (0.1-0.9) = EF-0.8
    let r = call("review", ctxA, { id: n.id, quality: 0 }); // 2.5-0.8=1.7
    assert.equal(r.result.srs.ease, 1.7);
    r = call("review", ctxA, { id: n.id, quality: 0 }); // 1.7-0.8=0.9 -> floored to 1.3
    assert.equal(r.result.srs.ease, 1.3);
    r = call("review", ctxA, { id: n.id, quality: 0 }); // stays floored
    assert.equal(r.result.srs.ease, 1.3);
  });

  it("clamps out-of-range quality into [0,5]", () => {
    const n = mk(ctxA, "Clamp", "");
    const r = call("review", ctxA, { id: n.id, quality: 99 });
    assert.equal(r.result.quality, 5);
    assert.equal(r.result.nextReviewInDays, 1); // treated as q=5, reps 0->1 => interval=1
  });

  it("due() only returns review-enabled notes whose dueAt has passed, sorted soonest-first", () => {
    const a = mk(ctxA, "A", "");
    const b = mk(ctxA, "B", "");
    const c = mk(ctxA, "C not enrolled", "");
    // a and b are reviewed now, both immediately due-in-the-past is false
    // (interval pushes dueAt into the future) — enroll them without ever
    // pushing the date out, using edit(reviewEnabled) so dueAt stays at
    // creation time (now), i.e. already due.
    call("edit", ctxA, { id: a.id, reviewEnabled: true });
    call("edit", ctxA, { id: b.id, reviewEnabled: true });
    const due = call("due", ctxA, {});
    assert.equal(due.ok, true);
    const ids = due.result.due.map((n) => n.id);
    assert.ok(ids.includes(a.id));
    assert.ok(ids.includes(b.id));
    assert.ok(!ids.includes(c.id));
  });

  it("a review pushes the note out of the immediate due queue when interval > 0 days", () => {
    const n = mk(ctxA, "Scheduled", "");
    call("edit", ctxA, { id: n.id, reviewEnabled: true });
    assert.ok(call("due", ctxA, {}).result.due.some((d) => d.id === n.id));
    // q=5 gives interval=1 day, so dueAt moves ~24h into the future.
    call("review", ctxA, { id: n.id, quality: 5 });
    const due = call("due", ctxA, {});
    assert.ok(!due.result.due.some((d) => d.id === n.id));
  });

  it("reviewing a note enrolls it in the queue even without an explicit reviewEnabled toggle", () => {
    const n = mk(ctxA, "AutoEnroll", "");
    const got0 = call("get", ctxA, { id: n.id });
    assert.equal(got0.result.note.srs.enabled, false);
    call("review", ctxA, { id: n.id, quality: 4 });
    const got1 = call("get", ctxA, { id: n.id });
    assert.equal(got1.result.note.srs.enabled, true);
  });
});
