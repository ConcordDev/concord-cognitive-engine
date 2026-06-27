// Contract tests for server/domains/saved.js — the cross-lens
// saved-items substrate (parity vs X Bookmarks + Pocket).
//
// Exercises every macro: add / remove / update / list / stats / tags /
// folderCreate / folderUpdate / folderDelete / folderList / export.
// Each assertion checks the macro returns { ok: true } on the happy
// path and { ok: false } on the rejection path, and that data is
// per-user scoped (nothing leaks across actors).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSavedMacros from "../domains/saved.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`saved.${name}`);
  if (!fn) throw new Error(`saved.${name} not registered`);
  // Canonical (ctx, input) macro convention (register/runMacro path).
  return fn(ctx, input);
}

before(() => { registerSavedMacros(register); });

beforeEach(() => {
  // Fresh per-user state for every test.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const ctxAnon = {};

describe("saved.add", () => {
  it("saves an item and returns it", () => {
    const r = call("add", ctxA, { kind: "link", title: "Concord docs", url: "https://x" });
    assert.equal(r.ok, true);
    assert.equal(r.result.deduped, false);
    assert.equal(r.result.item.title, "Concord docs");
    assert.equal(r.result.item.kind, "link");
    assert.equal(r.result.item.state, "unread");
  });

  it("rejects anonymous callers", () => {
    const r = call("add", ctxAnon, { title: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_user");
  });

  it("rejects when no title / ref / url supplied", () => {
    const r = call("add", ctxA, { kind: "other" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "need_title_or_ref");
  });

  it("dedupes by (kind, refId)", () => {
    call("add", ctxA, { kind: "dtu", refId: "dtu_1", title: "A" });
    const r = call("add", ctxA, { kind: "dtu", refId: "dtu_1", title: "A again" });
    assert.equal(r.ok, true);
    assert.equal(r.result.deduped, true);
  });

  it("coerces an unknown kind to 'other'", () => {
    const r = call("add", ctxA, { kind: "weird", title: "X" });
    assert.equal(r.result.item.kind, "other");
  });

  it("cleans + caps tags", () => {
    const r = call("add", ctxA, { title: "X", tags: ["#Research", "research", "  Todo "] });
    assert.deepEqual(r.result.item.tags.sort(), ["research", "todo"]);
  });
});

describe("saved.list — search / sort / filter", () => {
  beforeEach(() => {
    globalThis._concordSTATE = {};
    call("add", ctxA, { kind: "article", title: "Rust ownership", author: "Steve" });
    call("add", ctxA, { kind: "dtu", title: "Glyph algebra", author: "Ada", tags: ["math"] });
    call("add", ctxA, { kind: "link", title: "Pocket clone", author: "Steve" });
  });

  it("returns all of the caller's items", () => {
    const r = call("list", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 3);
    assert.equal(r.result.matched, 3);
  });

  it("full-text search filters by title / author", () => {
    const r = call("list", ctxA, { query: "steve" });
    assert.equal(r.result.matched, 2);
  });

  it("filters by kind", () => {
    const r = call("list", ctxA, { kind: "dtu" });
    assert.equal(r.result.matched, 1);
    assert.equal(r.result.items[0].title, "Glyph algebra");
  });

  it("filters by tag", () => {
    const r = call("list", ctxA, { tag: "math" });
    assert.equal(r.result.matched, 1);
  });

  it("sorts by title ascending", () => {
    const r = call("list", ctxA, { sortBy: "title", order: "asc" });
    assert.equal(r.result.items[0].title, "Glyph algebra");
  });

  it("does not leak across users", () => {
    const r = call("list", ctxB, {});
    assert.equal(r.result.total, 0);
  });
});

describe("saved.update — folders / tags / note / state", () => {
  it("flips read-later / archive state and stamps readAt", () => {
    const add = call("add", ctxA, { title: "Doc" });
    const r = call("update", ctxA, { id: add.result.item.id, state: "read" });
    assert.equal(r.ok, true);
    assert.equal(r.result.item.state, "read");
    assert.ok(r.result.item.readAt);
  });

  it("patches tags + note", () => {
    const add = call("add", ctxA, { title: "Doc" });
    const r = call("update", ctxA, {
      id: add.result.item.id, tags: ["important"], note: "follow up",
    });
    assert.deepEqual(r.result.item.tags, ["important"]);
    assert.equal(r.result.item.note, "follow up");
  });

  it("rejects an unknown id", () => {
    const r = call("update", ctxA, { id: "nope", note: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_found");
  });
});

describe("saved.remove", () => {
  it("removes a saved item", () => {
    const add = call("add", ctxA, { title: "Doc" });
    const r = call("remove", ctxA, { id: add.result.item.id });
    assert.equal(r.ok, true);
    assert.equal(call("list", ctxA, {}).result.total, 0);
  });

  it("rejects an unknown id", () => {
    const r = call("remove", ctxA, { id: "nope" });
    assert.equal(r.ok, false);
  });
});

describe("saved folders / collections", () => {
  it("creates, lists, renames and deletes a folder", () => {
    const c = call("folderCreate", ctxA, { name: "To Read" });
    assert.equal(c.ok, true);
    const fid = c.result.folder.id;

    const add = call("add", ctxA, { title: "Doc", folderId: fid });
    assert.equal(add.result.item.folderId, fid);

    const list = call("folderList", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.folders.length, 1);
    assert.equal(list.result.folders[0].itemCount, 1);

    const ren = call("folderUpdate", ctxA, { id: fid, name: "Reading List" });
    assert.equal(ren.result.folder.name, "Reading List");

    const del = call("folderDelete", ctxA, { id: fid });
    assert.equal(del.ok, true);
    assert.equal(del.result.unfiled, 1);
    // The item is unfiled, not deleted.
    assert.equal(call("list", ctxA, {}).result.total, 1);
  });

  it("rejects a duplicate folder name", () => {
    call("folderCreate", ctxA, { name: "Dupe" });
    const r = call("folderCreate", ctxA, { name: "dupe" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "duplicate_name");
  });

  it("rejects an empty folder name", () => {
    const r = call("folderCreate", ctxA, { name: "  " });
    assert.equal(r.ok, false);
  });

  it("filters items by folder, including unfiled", () => {
    const fid = call("folderCreate", ctxA, { name: "F" }).result.folder.id;
    call("add", ctxA, { title: "In folder", folderId: fid });
    call("add", ctxA, { title: "Loose" });
    assert.equal(call("list", ctxA, { folderId: fid }).result.matched, 1);
    assert.equal(call("list", ctxA, { folderId: "__none__" }).result.matched, 1);
  });
});

describe("saved.stats + saved.tags", () => {
  it("reports counts by state / kind", () => {
    call("add", ctxA, { kind: "dtu", title: "A" });
    call("add", ctxA, { kind: "link", title: "B" });
    const r = call("stats", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    assert.equal(r.result.byState.unread, 2);
    assert.equal(r.result.byKind.dtu, 1);
  });

  it("reports distinct tags with usage counts", () => {
    call("add", ctxA, { title: "A", tags: ["x", "y"] });
    call("add", ctxA, { title: "B", tags: ["x"] });
    const r = call("tags", ctxA, {});
    assert.equal(r.ok, true);
    const xTag = r.result.tags.find((t) => t.tag === "x");
    assert.equal(xTag.count, 2);
  });
});

describe("saved.export", () => {
  it("exports JSON with items + folders", () => {
    call("folderCreate", ctxA, { name: "F" });
    call("add", ctxA, { title: "Doc" });
    const r = call("export", ctxA, { format: "json" });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "json");
    assert.equal(r.result.count, 1);
    const parsed = JSON.parse(r.result.content);
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.folders.length, 1);
  });

  it("exports CSV with a header row", () => {
    call("add", ctxA, { title: "Doc" });
    const r = call("export", ctxA, { format: "csv" });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "csv");
    assert.ok(r.result.content.startsWith("id,kind,title"));
  });

  it("rejects anonymous callers", () => {
    const r = call("export", ctxAnon, {});
    assert.equal(r.ok, false);
  });
});
