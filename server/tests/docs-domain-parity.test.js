// Contract tests for the docs lens — Notion-shape page/block document
// substrate in server/domains/docs.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDocsActions from "../domains/docs.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`docs.${name}`);
  assert.ok(fn, `docs.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerDocsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newPage(ctx = ctxA, over = {}) {
  return call("page-create", ctx, { title: "Project notes", ...over }).result.page;
}

describe("docs.page CRUD", () => {
  it("creates a page scoped per user", () => {
    newPage();
    assert.equal(call("page-list", ctxA, {}).result.count, 1);
    assert.equal(call("page-list", ctxB, {}).result.count, 0);
  });
  it("nests pages and cascades delete to descendants", () => {
    const parent = newPage();
    const child = newPage(ctxA, { title: "Sub", parentId: parent.id });
    assert.equal(call("page-list", ctxA, {}).result.count, 2);
    const del = call("page-delete", ctxA, { id: parent.id });
    assert.equal(del.result.deleted.length, 2);
    assert.ok(del.result.deleted.includes(child.id));
    assert.equal(call("page-list", ctxA, {}).result.count, 0);
  });
  it("page-move rejects self-parenting", () => {
    const p = newPage();
    assert.equal(call("page-move", ctxA, { id: p.id, parentId: p.id }).ok, false);
  });
  it("page-update changes title and icon", () => {
    const p = newPage();
    call("page-update", ctxA, { id: p.id, title: "Renamed", icon: "🚀" });
    assert.equal(call("page-detail", ctxA, { id: p.id }).result.page.title, "Renamed");
  });
});

describe("docs.block editing", () => {
  it("adds typed blocks and lists them on the page", () => {
    const p = newPage();
    call("block-add", ctxA, { pageId: p.id, type: "heading1", text: "Overview" });
    call("block-add", ctxA, { pageId: p.id, type: "todo", text: "Ship it" });
    const page = call("page-detail", ctxA, { id: p.id }).result.page;
    assert.equal(page.blocks.length, 2);
    assert.equal(page.blocks[0].type, "heading1");
    assert.equal(page.blocks[1].type, "todo");
  });
  it("unknown block type falls back to paragraph", () => {
    const p = newPage();
    const b = call("block-add", ctxA, { pageId: p.id, type: "nonsense", text: "x" });
    assert.equal(b.result.block.type, "paragraph");
  });
  it("block-add afterId inserts in place", () => {
    const p = newPage();
    const first = call("block-add", ctxA, { pageId: p.id, text: "first" }).result.block;
    const last = call("block-add", ctxA, { pageId: p.id, text: "last" }).result.block;
    call("block-add", ctxA, { pageId: p.id, text: "middle", afterId: first.id });
    const ids = call("page-detail", ctxA, { id: p.id }).result.page.blocks.map(b => b.text);
    assert.deepEqual(ids, ["first", "middle", "last"]);
    assert.ok(last);
  });
  it("toggles a todo, reorders and deletes blocks", () => {
    const p = newPage();
    const a = call("block-add", ctxA, { pageId: p.id, type: "todo", text: "A" }).result.block;
    const b = call("block-add", ctxA, { pageId: p.id, text: "B" }).result.block;
    call("block-update", ctxA, { pageId: p.id, blockId: a.id, checked: true });
    assert.equal(call("page-detail", ctxA, { id: p.id }).result.page.blocks[0].checked, true);
    call("block-reorder", ctxA, { pageId: p.id, blockId: b.id, direction: "up" });
    assert.equal(call("page-detail", ctxA, { id: p.id }).result.page.blocks[0].id, b.id);
    call("block-delete", ctxA, { pageId: p.id, blockId: a.id });
    assert.equal(call("page-detail", ctxA, { id: p.id }).result.page.blocks.length, 1);
  });
});

describe("docs.search / dashboard", () => {
  it("docs-search matches titles and block content", () => {
    const p = newPage(ctxA, { title: "Roadmap" });
    call("block-add", ctxA, { pageId: p.id, text: "launch the rocket" });
    assert.equal(call("docs-search", ctxA, { query: "roadmap" }).result.count, 1);
    assert.equal(call("docs-search", ctxA, { query: "rocket" }).result.results[0].matchedIn, "content");
  });
  it("docs-dashboard aggregates pages, blocks, todos, words", () => {
    const p = newPage();
    call("block-add", ctxA, { pageId: p.id, type: "todo", text: "one two" });
    call("block-add", ctxA, { pageId: p.id, text: "three four five" });
    const d = call("docs-dashboard", ctxA, {});
    assert.equal(d.result.pages, 1);
    assert.equal(d.result.totalBlocks, 2);
    assert.equal(d.result.openTodos, 1);
    assert.equal(d.result.words, 5);
  });
});

describe("docs — analysis macros still intact", () => {
  it("readabilityScore handles empty text", () => {
    const r = call("readabilityScore", ctxA, {});
    assert.equal(r.ok, true);
  });
});

describe("docs — rich block types", () => {
  it("code block carries a normalised language in data", () => {
    const p = newPage();
    const b = call("block-add", ctxA, { pageId: p.id, type: "code", text: "x=1", data: { language: "python" } });
    assert.equal(b.ok, true);
    assert.equal(b.result.block.type, "code");
    assert.equal(b.result.block.data.language, "python");
  });
  it("callout block defaults tone + emoji and tables carry rows", () => {
    const p = newPage();
    const c = call("block-add", ctxA, { pageId: p.id, type: "callout", text: "heads up" });
    assert.equal(c.result.block.data.tone, "info");
    assert.ok(c.result.block.data.emoji);
    const t = call("block-add", ctxA, { pageId: p.id, type: "table", text: "", data: { rows: [["A", "B"], ["1", "2"]] } });
    assert.equal(t.result.block.data.rows.length, 2);
    assert.equal(t.result.block.data.rows[1][1], "2");
  });
  it("toggle + embed blocks normalise their structured data", () => {
    const p = newPage();
    const tg = call("block-add", ctxA, { pageId: p.id, type: "toggle", text: "more", data: { open: true } });
    assert.equal(tg.result.block.data.open, true);
    const em = call("block-add", ctxA, { pageId: p.id, type: "embed", text: "v", data: { kind: "video", url: "https://x" } });
    assert.equal(em.result.block.data.kind, "video");
    assert.equal(em.result.block.data.url, "https://x");
  });
});

describe("docs — version history + restore", () => {
  it("snapshots, lists and restores a page", () => {
    const p = newPage();
    call("block-add", ctxA, { pageId: p.id, text: "original" });
    const snap = call("version-snapshot", ctxA, { pageId: p.id, label: "v1" });
    assert.equal(snap.ok, true);
    assert.equal(call("version-list", ctxA, { pageId: p.id }).result.count, 1);
    // mutate, then restore
    call("block-add", ctxA, { pageId: p.id, text: "new content" });
    const r = call("version-restore", ctxA, { pageId: p.id, snapshotId: snap.result.snapshotId });
    assert.equal(r.ok, true);
    assert.equal(r.result.page.blocks.length, 1);
    assert.equal(r.result.page.blocks[0].text, "original");
    // restore auto-snapshots the prior state
    assert.ok(call("version-list", ctxA, { pageId: p.id }).result.count >= 2);
  });
});

describe("docs — inline comments + suggestions", () => {
  it("adds, lists, resolves and deletes a comment", () => {
    const p = newPage();
    const c = call("comment-add", ctxA, { pageId: p.id, text: "needs work" });
    assert.equal(c.ok, true);
    assert.equal(call("comment-list", ctxA, { pageId: p.id }).result.count, 1);
    call("comment-resolve", ctxA, { pageId: p.id, commentId: c.result.comment.id });
    assert.equal(call("comment-list", ctxA, { pageId: p.id, openOnly: true }).result.count, 0);
    call("comment-delete", ctxA, { pageId: p.id, commentId: c.result.comment.id });
    assert.equal(call("comment-list", ctxA, { pageId: p.id }).result.count, 0);
  });
  it("accepting a suggestion overwrites its target block", () => {
    const p = newPage();
    const blk = call("block-add", ctxA, { pageId: p.id, text: "old text" }).result.block;
    const sg = call("comment-add", ctxA, {
      pageId: p.id, blockId: blk.id, kind: "suggestion",
      text: "rewrite", suggestedText: "new text",
    });
    assert.equal(sg.result.comment.kind, "suggestion");
    const acc = call("suggestion-accept", ctxA, { pageId: p.id, commentId: sg.result.comment.id });
    assert.equal(acc.ok, true);
    assert.equal(acc.result.block.text, "new text");
    assert.equal(call("page-detail", ctxA, { id: p.id }).result.page.blocks[0].text, "new text");
  });
});

describe("docs — multi-cursor presence", () => {
  it("ping registers a session and list excludes self", () => {
    const p = newPage();
    const ping = call("presence-ping", ctxA, { pageId: p.id, sessionId: "s1", name: "A", blockId: null });
    assert.equal(ping.ok, true);
    assert.ok(ping.result.color);
    // another session
    call("presence-ping", ctxA, { pageId: p.id, sessionId: "s2", name: "B" });
    const list = call("presence-list", ctxA, { pageId: p.id, sessionId: "s1" });
    assert.equal(list.result.activeCount, 2);
    assert.equal(list.result.cursors.length, 1);
    assert.equal(list.result.cursors[0].sessionId, "s2");
    const left = call("presence-leave", ctxA, { pageId: p.id, sessionId: "s2" });
    assert.equal(left.ok, true);
  });
});

describe("docs — database / table views", () => {
  it("creates a database, adds columns and rows", () => {
    const db = call("db-create", ctxA, { name: "Tasks" }).result.database;
    assert.equal(call("db-list", ctxA, {}).result.count, 1);
    const col = call("db-column-add", ctxA, { id: db.id, name: "Priority", type: "number" });
    assert.equal(col.ok, true);
    const detail = call("db-detail", ctxA, { id: db.id }).result.database;
    const numCol = detail.columns.find((c) => c.type === "number");
    const row = call("db-row-add", ctxA, { id: db.id, cells: { [numCol.id]: 7 } });
    assert.equal(row.result.row.cells[numCol.id], 7);
    call("db-row-update", ctxA, { id: db.id, rowId: row.result.row.id, cells: { [numCol.id]: 9 } });
    assert.equal(call("db-detail", ctxA, { id: db.id }).result.database.rows[0].cells[numCol.id], 9);
    call("db-row-delete", ctxA, { id: db.id, rowId: row.result.row.id });
    assert.equal(call("db-detail", ctxA, { id: db.id }).result.database.rows.length, 0);
    call("db-delete", ctxA, { id: db.id });
    assert.equal(call("db-list", ctxA, {}).result.count, 0);
  });
});

describe("docs — templates gallery", () => {
  it("lists templates and applies one as a new page", () => {
    const list = call("template-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.ok(list.result.count > 0);
    const tplId = list.result.templates.find((t) => t.id === "meeting-notes").id;
    const ap = call("template-apply", ctxA, { templateId: tplId });
    assert.equal(ap.ok, true);
    assert.ok(ap.result.page.blocks.length > 0);
    assert.equal(call("page-list", ctxA, {}).result.count, 1);
  });
  it("rejects an unknown template id", () => {
    assert.equal(call("template-apply", ctxA, { templateId: "nope" }).ok, false);
  });
});

describe("docs — backlinks / mentions graph", () => {
  it("resolves [[Title]] mentions into backlinks and a graph", () => {
    const target = newPage(ctxA, { title: "Glossary" });
    const src = newPage(ctxA, { title: "Notes" });
    call("block-add", ctxA, { pageId: src.id, text: "see [[Glossary]] for terms" });
    const bl = call("backlinks", ctxA, { pageId: target.id });
    assert.equal(bl.ok, true);
    assert.equal(bl.result.backlinkCount, 1);
    assert.equal(bl.result.backlinks[0].id, src.id);
    const g = call("mentions-graph", ctxA, {});
    assert.equal(g.result.edgeCount, 1);
    assert.equal(g.result.edges[0].from, src.id);
    assert.equal(g.result.edges[0].to, target.id);
  });
});

describe("docs — share / permission controls", () => {
  it("sets visibility, generates a share url and manages invites", () => {
    const p = newPage();
    const def = call("share-get", ctxA, { pageId: p.id });
    assert.equal(def.result.share.visibility, "private");
    assert.equal(def.result.shareUrl, null);
    const set = call("share-set", ctxA, { pageId: p.id, visibility: "link", role: "edit" });
    assert.equal(set.result.share.visibility, "link");
    assert.ok(set.result.shareUrl);
    const inv = call("share-invite", ctxA, { pageId: p.id, invitee: "teammate", role: "view" });
    assert.equal(inv.result.invites.length, 1);
    const rev = call("share-revoke", ctxA, { pageId: p.id, inviteId: inv.result.invites[0].id });
    assert.equal(rev.result.invites.length, 0);
  });
});
