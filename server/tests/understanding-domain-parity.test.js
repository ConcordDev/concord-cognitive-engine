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
  });
});
