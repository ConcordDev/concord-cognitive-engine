// Behavioral macro tests for server/domains/saved.js — the cross-lens
// saved-items substrate (parity vs X Bookmarks + Pocket).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against the REAL in-memory globalThis._concordSTATE.savedLens store the
// domain uses for persistence. These are NOT shape-only assertions: every
// test asserts ACTUAL values + multi-step round-trips (create folder → list →
// file an item → update → remove; save artifact → list → export → remove),
// per-user isolation, dedupe, the folder-delete unfile cascade, and the
// fail-CLOSED numeric guard the macro-assassin's V2 vector probes.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSavedMacros from "../domains/saved.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "saved", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`saved.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerSavedMacros(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("saved — registration", () => {
  it("registers every macro the lens calls", () => {
    for (const m of [
      "add", "remove", "update", "list", "stats", "tags",
      "folderCreate", "folderUpdate", "folderDelete", "folderList", "export",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing saved.${m}`);
    }
  });
});

describe("saved — folder lifecycle round-trip (create → list → update → file → delete)", () => {
  it("creates a folder, lists it, renames it, files an item, then deletes + unfiles", () => {
    // create
    const created = call("folderCreate", ctxA, { name: "Reading list", color: "indigo" });
    assert.equal(created.ok, true);
    const folderId = created.result.folder.id;
    assert.equal(created.result.folder.name, "Reading list");
    assert.equal(created.result.folder.color, "indigo");

    // duplicate name is rejected (case-insensitive)
    const dup = call("folderCreate", ctxA, { name: "reading LIST" });
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "duplicate_name");

    // list shows it with an itemCount of 0
    let listed = call("folderList", ctxA, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.folders.length, 1);
    assert.equal(listed.result.folders[0].itemCount, 0);

    // rename
    const renamed = call("folderUpdate", ctxA, { id: folderId, name: "To read" });
    assert.equal(renamed.ok, true);
    assert.equal(renamed.result.folder.name, "To read");

    // save an item directly into the folder
    const saved = call("add", ctxA, {
      kind: "article", title: "Concord paper", folderId,
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.item.folderId, folderId);

    // folderList now reflects the filed item; unfiledCount is 0
    listed = call("folderList", ctxA, {});
    assert.equal(listed.result.folders[0].itemCount, 1);
    assert.equal(listed.result.unfiledCount, 0);

    // delete the folder → it disappears AND the item is unfiled, not destroyed
    const deleted = call("folderDelete", ctxA, { id: folderId });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.result.deleted, folderId);
    assert.equal(deleted.result.unfiled, 1);

    listed = call("folderList", ctxA, {});
    assert.equal(listed.result.folders.length, 0);
    assert.equal(listed.result.unfiledCount, 1);

    // the item survives, now folderId:null
    const items = call("list", ctxA, {});
    assert.equal(items.result.total, 1);
    assert.equal(items.result.items[0].folderId, null);
  });

  it("rejects updating/deleting an unknown folder", () => {
    assert.equal(call("folderUpdate", ctxA, { id: "nope" }).error, "not_found");
    assert.equal(call("folderDelete", ctxA, { id: "nope" }).error, "not_found");
    assert.equal(call("folderCreate", ctxA, {}).error, "need_name");
  });
});

describe("saved — item lifecycle round-trip (save → list/search/filter → update → remove)", () => {
  it("saves items and round-trips through list, search, tag filter, state filter, sort", () => {
    const a = call("add", ctxA, {
      kind: "link", title: "Alpha", url: "https://a", tags: ["#Read", "tech", "read"],
    });
    assert.equal(a.ok, true);
    // tags are normalised: lowercased, deduped, '#' stripped
    assert.deepEqual(a.result.item.tags, ["read", "tech"]);

    call("add", ctxA, { kind: "dtu", title: "Beta", tags: ["tech"], state: "read" });
    call("add", ctxA, { kind: "post", title: "Gamma quintessence", tags: ["misc"] });

    // full list
    let r = call("list", ctxA, {});
    assert.equal(r.result.total, 3);
    assert.equal(r.result.matched, 3);
    assert.equal(r.result.items.length, 3);

    // free-text search hits title substrings
    r = call("list", ctxA, { query: "quintess" });
    assert.equal(r.result.matched, 1);
    assert.equal(r.result.items[0].title, "Gamma quintessence");
    assert.equal(r.result.total, 3, "total is the unfiltered count");

    // kind filter
    r = call("list", ctxA, { kind: "dtu" });
    assert.equal(r.result.matched, 1);
    assert.equal(r.result.items[0].title, "Beta");

    // tag filter
    r = call("list", ctxA, { tag: "tech" });
    assert.equal(r.result.matched, 2);

    // state filter
    r = call("list", ctxA, { state: "read" });
    assert.equal(r.result.matched, 1);
    assert.equal(r.result.items[0].title, "Beta");

    // sort by title ascending
    r = call("list", ctxA, { sortBy: "title", order: "asc" });
    assert.deepEqual(r.result.items.map((it) => it.title), ["Alpha", "Beta", "Gamma quintessence"]);

    // update: flip Alpha to archived → readAt stamped, state changes
    const alphaId = a.result.item.id;
    const upd = call("update", ctxA, { id: alphaId, state: "archived", note: "later" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.item.state, "archived");
    assert.equal(upd.result.item.note, "later");
    assert.ok(upd.result.item.readAt, "archived stamps readAt");

    // remove Alpha → total drops to 2, removed id echoed
    const rm = call("remove", ctxA, { id: alphaId });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.removed, alphaId);
    assert.equal(call("list", ctxA, {}).result.total, 2);

    // removing again is not_found
    assert.equal(call("remove", ctxA, { id: alphaId }).error, "not_found");
  });

  it("dedupes by (kind, refId)", () => {
    const first = call("add", ctxA, { kind: "post", refId: "p1", title: "P" });
    assert.equal(first.result.deduped, false);
    const again = call("add", ctxA, { kind: "post", refId: "p1", title: "P again" });
    assert.equal(again.result.deduped, true);
    // same underlying id, original title retained
    assert.equal(again.result.item.id, first.result.item.id);
    assert.equal(again.result.item.title, "P");
    assert.equal(call("list", ctxA, {}).result.total, 1);
  });

  it("rejects a save with no title, refId, or url", () => {
    assert.equal(call("add", ctxA, {}).error, "need_title_or_ref");
  });
});

describe("saved — stats + tags aggregation", () => {
  it("computes real counts by state/kind and tag usage", () => {
    call("add", ctxA, { kind: "link", title: "L1", tags: ["a", "b"] });
    call("add", ctxA, { kind: "link", title: "L2", tags: ["a"], state: "read" });
    call("add", ctxA, { kind: "dtu", title: "D1", tags: ["b", "c"] });

    const s = call("stats", ctxA, {});
    assert.equal(s.result.total, 3);
    assert.equal(s.result.byState.unread, 2);
    assert.equal(s.result.byState.read, 1);
    assert.equal(s.result.byKind.link, 2);
    assert.equal(s.result.byKind.dtu, 1);

    const t = call("tags", ctxA, {});
    // "a" and "b" used twice, "c" once — sorted by count desc
    const byTag = Object.fromEntries(t.result.tags.map((x) => [x.tag, x.count]));
    assert.equal(byTag.a, 2);
    assert.equal(byTag.b, 2);
    assert.equal(byTag.c, 1);
    assert.equal(t.result.tags[0].count, 2);
  });
});

describe("saved — export round-trips real content", () => {
  it("exports JSON and CSV with the saved rows", () => {
    call("add", ctxA, { kind: "article", title: "Export me", tags: ["x"] });

    const json = call("export", ctxA, { format: "json" });
    assert.equal(json.ok, true);
    assert.equal(json.result.format, "json");
    assert.equal(json.result.count, 1);
    const parsed = JSON.parse(json.result.content);
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].title, "Export me");

    const csv = call("export", ctxA, { format: "csv" });
    assert.equal(csv.result.format, "csv");
    assert.match(csv.result.content, /Export me/);
    assert.match(csv.result.filename, /\.csv$/);
  });
});

describe("saved — per-user isolation + anonymous guard", () => {
  it("never leaks one user's items to another", () => {
    call("add", ctxA, { kind: "link", title: "A-only", url: "https://a" });
    assert.equal(call("list", ctxA, {}).result.total, 1);
    assert.equal(call("list", ctxB, {}).result.total, 0);
    assert.equal(call("stats", ctxB, {}).result.total, 0);
  });

  it("rejects anonymous callers on every macro", () => {
    const anon = {};
    for (const m of ["add", "remove", "update", "list", "stats", "tags",
      "folderCreate", "folderUpdate", "folderDelete", "folderList", "export"]) {
      assert.equal(call(m, anon, {}).error, "no_user", `saved.${m} leaked to anon`);
    }
  });
});

describe("saved — fail-CLOSED numeric guard (assassin V2)", () => {
  it("rejects poisoned limit/offset instead of clamping to ok:true", () => {
    for (const bad of [NaN, Infinity, -1, 1e308, "abc"]) {
      const r1 = call("list", ctxA, { limit: bad });
      assert.equal(r1.ok, false, `limit=${bad} should fail-closed`);
      assert.equal(r1.error, "invalid_limit");
      const r2 = call("list", ctxA, { offset: bad });
      assert.equal(r2.ok, false, `offset=${bad} should fail-closed`);
      assert.equal(r2.error, "invalid_offset");
    }
  });

  it("still honours a valid limit/offset", () => {
    for (let i = 0; i < 5; i++) call("add", ctxA, { kind: "link", title: `T${i}`, url: `https://${i}` });
    const r = call("list", ctxA, { limit: 2, offset: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.items.length, 2);
    assert.equal(r.result.limit, 2);
    assert.equal(r.result.offset, 1);
    assert.equal(r.result.total, 5);
  });
});
