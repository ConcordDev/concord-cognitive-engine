// server/tests/saved-db-persistence.test.js
//
// DB-backed persistence tests for server/domains/saved.js — the "Quote & Clip
// DB" backlog item. The sibling saved-domain-{macros,parity}.test.js files
// drive the domain against the in-memory globalThis._concordSTATE.savedLens
// fallback (no ctx.db). This file pins the DURABLE path: it hands each macro a
// real migrated better-sqlite3 DB via ctx.db and proves:
//   - real persistence (write via one macro call, re-read via a FRESH ctx with a
//     brand-new store facade over the SAME DB → data still there; not a shared
//     in-memory Map)
//   - restart-equivalence (the rows live in saved_items/saved_folders, not a
//     process-global Map — verified by direct SQL + a second db handle to the
//     same file)
//   - the additive clip-timecode validation (valid range accepted, end<=start
//     rejected, poisoned numeric rejected via the fail-CLOSED pattern)
//   - optional provenance pass-through (a caller-supplied stamp round-trips
//     through add → list → export unchanged; the domain never fabricates one)
//
// Also cross-checks that a real provenance-ingest.js#stampIngestedRecord output
// stores + round-trips intact.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerSavedMacros from "../domains/saved.js";
import { stampIngestedRecord } from "../lib/provenance-ingest.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
before(() => { registerSavedMacros(register); });

// A ctx that carries a real DB handle → forces the durable store path.
function ctxFor(db, userId) { return { db, actor: { userId }, userId }; }
function call(db, userId, name, input = {}) {
  const fn = ACTIONS.get(`saved.${name}`);
  if (!fn) throw new Error(`saved.${name} not registered`);
  return fn(ctxFor(db, userId), input);
}

let db;
let dbFile;
beforeEach(async () => {
  // A FILE-backed DB so a second independent handle can prove restart durability.
  dbFile = path.join(os.tmpdir(), `saved-db-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  db = new Database(dbFile);
  await runMigrations(db);
  // Keep the in-memory fallback empty so we can be sure the DB path is exercised.
  globalThis._concordSTATE = {};
});
afterEach(() => { try { db.close(); } catch { /* noop */ } });

describe("saved — DB persistence (durable, restart-equivalent)", () => {
  it("persists an item into saved_items and survives a fresh store / second handle", () => {
    const add = call(db, "u1", "add", {
      kind: "article", title: "Durable doc", url: "https://x", tags: ["keep"],
    });
    assert.equal(add.ok, true);
    const id = add.result.item.id;

    // Re-read through a FRESH macro call (new store facade over the same db) —
    // if this were an in-memory Map keyed to one facade instance it'd be gone.
    const listed = call(db, "u1", "list", {});
    assert.equal(listed.result.total, 1);
    assert.equal(listed.result.items[0].id, id);
    assert.equal(listed.result.items[0].title, "Durable doc");

    // Restart-equivalent: open a brand-new handle to the SAME file and read raw.
    const db2 = new Database(dbFile, { readonly: true });
    try {
      const row = db2.prepare("SELECT * FROM saved_items WHERE id = ?").get(id);
      assert.ok(row, "row is on disk, not in a Map");
      assert.equal(row.user_id, "u1");
      assert.equal(row.title, "Durable doc");
      assert.deepEqual(JSON.parse(row.tags_json), ["keep"]);
    } finally { db2.close(); }
  });

  it("round-trips the full item lifecycle against the DB (folder file/unfile, update, remove)", () => {
    const fid = call(db, "u1", "folderCreate", { name: "Clips" }).result.folder.id;
    const add = call(db, "u1", "add", { kind: "link", title: "A", folderId: fid, tags: ["t"] });
    assert.equal(add.result.item.folderId, fid);
    const id = add.result.item.id;

    // folderList reflects the filed item, read from the DB
    let fl = call(db, "u1", "folderList", {});
    assert.equal(fl.result.folders[0].itemCount, 1);
    assert.equal(fl.result.unfiledCount, 0);

    // update: flip state, patch note+tags — persisted
    const upd = call(db, "u1", "update", { id, state: "archived", note: "later", tags: ["x", "y"] });
    assert.equal(upd.result.item.state, "archived");
    assert.ok(upd.result.item.readAt);
    assert.deepEqual(upd.result.item.tags, ["x", "y"]);
    // confirm the write hit the DB
    const raw = db.prepare("SELECT * FROM saved_items WHERE id = ?").get(id);
    assert.equal(raw.state, "archived");
    assert.equal(raw.note, "later");
    assert.deepEqual(JSON.parse(raw.tags_json), ["x", "y"]);

    // delete the folder → item unfiled, not destroyed (cascade via SQL UPDATE)
    const del = call(db, "u1", "folderDelete", { id: fid });
    assert.equal(del.result.unfiled, 1);
    assert.equal(call(db, "u1", "list", {}).result.items[0].folderId, null);
    assert.equal(db.prepare("SELECT folder_id FROM saved_items WHERE id = ?").get(id).folder_id, null);

    // remove → gone from the table
    call(db, "u1", "remove", { id });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM saved_items").get().n, 0);
  });

  it("dedupes by (kind, refId) against the DB (single row, original retained)", () => {
    const first = call(db, "u1", "add", { kind: "post", refId: "p1", title: "P" });
    assert.equal(first.result.deduped, false);
    const again = call(db, "u1", "add", { kind: "post", refId: "p1", title: "P again" });
    assert.equal(again.result.deduped, true);
    assert.equal(again.result.item.id, first.result.item.id);
    assert.equal(again.result.item.title, "P");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM saved_items").get().n, 1);
  });

  it("scopes per-user in the DB — never leaks across users", () => {
    call(db, "u1", "add", { kind: "link", title: "u1-only", url: "https://a" });
    assert.equal(call(db, "u1", "list", {}).result.total, 1);
    assert.equal(call(db, "u2", "list", {}).result.total, 0);
    assert.equal(call(db, "u2", "stats", {}).result.total, 0);
  });

  it("honours search / filter / sort / pagination read from the DB", () => {
    call(db, "u1", "add", { kind: "article", title: "Rust ownership", author: "Steve" });
    call(db, "u1", "add", { kind: "dtu", title: "Glyph algebra", author: "Ada", tags: ["math"] });
    call(db, "u1", "add", { kind: "link", title: "Pocket clone", author: "Steve" });

    assert.equal(call(db, "u1", "list", { query: "steve" }).result.matched, 2);
    assert.equal(call(db, "u1", "list", { kind: "dtu" }).result.matched, 1);
    assert.equal(call(db, "u1", "list", { tag: "math" }).result.matched, 1);
    const sorted = call(db, "u1", "list", { sortBy: "title", order: "asc" });
    assert.equal(sorted.result.items[0].title, "Glyph algebra");
    const page = call(db, "u1", "list", { limit: 2, offset: 1 });
    assert.equal(page.result.items.length, 2);
    assert.equal(page.result.total, 3);
  });
});

describe("saved — clip timecodes (additive, fail-CLOSED)", () => {
  it("accepts a valid clip range and round-trips it through the DB", () => {
    const add = call(db, "u1", "add", {
      kind: "article", title: "Podcast excerpt", mediaType: "audio",
      clipStartMs: 65000, clipEndMs: 92000,
    });
    assert.equal(add.ok, true);
    assert.equal(add.result.item.clipStartMs, 65000);
    assert.equal(add.result.item.clipEndMs, 92000);
    // persisted as real integer columns
    const raw = db.prepare("SELECT clip_start_ms, clip_end_ms FROM saved_items WHERE id = ?").get(add.result.item.id);
    assert.equal(raw.clip_start_ms, 65000);
    assert.equal(raw.clip_end_ms, 92000);
    // survives a fresh read
    const listed = call(db, "u1", "list", {}).result.items[0];
    assert.equal(listed.clipStartMs, 65000);
    assert.equal(listed.clipEndMs, 92000);
  });

  it("accepts a start-only marker (clipStartMs alone)", () => {
    const add = call(db, "u1", "add", { title: "Starts at", clipStartMs: 12000 });
    assert.equal(add.ok, true);
    assert.equal(add.result.item.clipStartMs, 12000);
    assert.equal(add.result.item.clipEndMs, null);
  });

  it("defaults both timecodes to null for a plain bookmark", () => {
    const add = call(db, "u1", "add", { title: "Plain bookmark" });
    assert.equal(add.result.item.clipStartMs, null);
    assert.equal(add.result.item.clipEndMs, null);
  });

  it("rejects an inverted / empty range (end <= start)", () => {
    assert.equal(call(db, "u1", "add", { title: "X", clipStartMs: 5000, clipEndMs: 5000 }).error, "invalid_clip_range");
    assert.equal(call(db, "u1", "add", { title: "X", clipStartMs: 9000, clipEndMs: 3000 }).error, "invalid_clip_range");
    // nothing was written
    assert.equal(db.prepare("SELECT COUNT(*) n FROM saved_items").get().n, 0);
  });

  it("rejects poisoned clip numerics via the fail-CLOSED pattern", () => {
    for (const bad of [NaN, Infinity, -1, 1e308, 1.5, "abc"]) {
      const r1 = call(db, "u1", "add", { title: "X", clipStartMs: bad });
      assert.equal(r1.ok, false, `clipStartMs=${bad} should fail-closed`);
      assert.equal(r1.error, "invalid_clipStartMs");
      const r2 = call(db, "u1", "add", { title: "X", clipEndMs: bad });
      assert.equal(r2.ok, false, `clipEndMs=${bad} should fail-closed`);
      assert.equal(r2.error, "invalid_clipEndMs");
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM saved_items").get().n, 0);
  });

  it("patches timecodes via update with the same validation + no partial write on error", () => {
    const id = call(db, "u1", "add", { title: "Doc", clipStartMs: 1000, clipEndMs: 2000 }).result.item.id;
    // valid patch
    const ok = call(db, "u1", "update", { id, clipEndMs: 8000 });
    assert.equal(ok.result.item.clipStartMs, 1000);
    assert.equal(ok.result.item.clipEndMs, 8000);
    // inverted patch is rejected AND leaves the prior title untouched (fail-closed before mutation)
    const bad = call(db, "u1", "update", { id, title: "SHOULD NOT STICK", clipStartMs: 9000 });
    assert.equal(bad.error, "invalid_clip_range");
    assert.equal(db.prepare("SELECT title, clip_end_ms FROM saved_items WHERE id = ?").get(id).title, "Doc");
    // clearing a timecode with null is allowed
    const cleared = call(db, "u1", "update", { id, clipStartMs: null, clipEndMs: null });
    assert.equal(cleared.result.item.clipStartMs, null);
    assert.equal(cleared.result.item.clipEndMs, null);
  });
});

describe("saved — provenance pass-through (additive, honest)", () => {
  it("round-trips a caller-supplied provenance object unchanged (add → list → export)", () => {
    const provenance = {
      sourceUrl: "https://example.test/article/42",
      sourceId: "42",
      capturedBy: "clip-tool",
      note: "quoted paragraph 3",
    };
    const add = call(db, "u1", "add", {
      kind: "article", title: "Quoted", excerpt: "the quote text", provenance,
    });
    assert.equal(add.ok, true);
    assert.deepEqual(add.result.item.provenance, provenance);
    // stored as JSON TEXT, round-trips through a fresh list read
    const listed = call(db, "u1", "list", {}).result.items[0];
    assert.deepEqual(listed.provenance, provenance);
    // and through export
    const exp = call(db, "u1", "export", { format: "json" });
    assert.deepEqual(JSON.parse(exp.result.content).items[0].provenance, provenance);
  });

  it("stores a real provenance-ingest stamp intact", () => {
    const stamp = stampIngestedRecord({
      sourceUrl: "https://data.test/rows/7",
      sourceId: "row-7",
      record: { title: "Open row", value: 123 },
      recordName: "Open row",
    });
    const add = call(db, "u1", "add", { kind: "dtu", title: "From ingest", provenance: stamp });
    assert.equal(add.ok, true);
    const listed = call(db, "u1", "list", {}).result.items[0];
    assert.deepEqual(listed.provenance, JSON.parse(JSON.stringify(stamp)));
  });

  it("defaults provenance to null and drops non-object garbage (never fabricated)", () => {
    assert.equal(call(db, "u1", "add", { title: "no prov" }).result.item.provenance, null);
    assert.equal(call(db, "u1", "add", { title: "garbage", provenance: "not-an-object" }).result.item.provenance, null);
    assert.equal(call(db, "u1", "add", { title: "array", provenance: [1, 2] }).result.item.provenance, null);
  });

  it("patches provenance via update", () => {
    const id = call(db, "u1", "add", { title: "Doc" }).result.item.id;
    const prov = { sourceUrl: "https://x", tag: "later" };
    const upd = call(db, "u1", "update", { id, provenance: prov });
    assert.deepEqual(upd.result.item.provenance, prov);
    // clearing to null works
    assert.equal(call(db, "u1", "update", { id, provenance: null }).result.item.provenance, null);
  });
});
