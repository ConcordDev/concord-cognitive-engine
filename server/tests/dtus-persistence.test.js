// server/tests/dtus-persistence.test.js
//
// DB-backed persistence tests for server/domains/dtus.js's saved-views and
// 4-layer-editor overlay features (migration 361 — dtu_saved_views +
// dtu_layer_overlays). The sibling dtus-domain-parity.test.js file drives
// the domain against the legacy in-memory globalThis._concordSTATE.dtusLens
// fallback (no ctx.db). This file pins the DURABLE path: it hands each
// macro a real migrated better-sqlite3 DB via ctx.db and proves:
//   - real persistence — the row lands in the `dtu_saved_views` /
//     `dtu_layer_overlays` SQL tables themselves (checked via a raw
//     `db.prepare(...).get(...)` query, NOT just the macro's own reader —
//     a shallow test could pass even if the macro secretly still read from
//     a leftover in-memory cache)
//   - restart-equivalence — a SECOND, independent better-sqlite3 handle
//     opened against the same file sees the same rows (not a process
//     global Map)
//   - per-user scoping in the DB (no cross-user leakage)
//   - the 50-saved-view cap enforces against the real DB-backed count, not
//     a stale in-memory counter
//   - the 4-layer overlay round-trips (seed → edit → re-read as "overlay")
//     through the DB exactly like the in-memory path does
//   - none of dtus.js's other macros (compare/merge, citation graph, etc.)
//     are affected — this file only exercises saveView/listViews/
//     deleteView/getLayers/updateLayers

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerDtusActions from "../domains/dtus.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
// Mirror the real LENS_ACTIONS 3-arg dispatch: handler(ctx, artifact, params).
function call(db, userId, name, params = {}) {
  const fn = ACTIONS.get(`dtus.${name}`);
  if (!fn) throw new Error(`dtus.${name} not registered`);
  const ctx = { db, actor: { userId }, userId };
  return fn(ctx, { id: null, data: {}, meta: {} }, params || {});
}

let db;
let dbFile;
beforeEach(async () => {
  ACTIONS.clear();
  registerDtusActions(register);
  // A FILE-backed DB so a second independent handle can prove restart durability.
  dbFile = path.join(os.tmpdir(), `dtus-lens-db-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  db = new Database(dbFile);
  await runMigrations(db);
  // Keep the in-memory fallback empty so we can be sure the DB path is exercised.
  globalThis._concordSTATE = {};
});
afterEach(() => { try { db.close(); } catch { /* noop */ } });

describe("dtus saved views — DB persistence (durable, restart-equivalent)", () => {
  it("persists a saved view into dtu_saved_views, not a process Map", () => {
    const saved = call(db, "user_a", "saveView", { name: "High quality", filter: { minQuality: 80 } });
    assert.equal(saved.ok, true, saved.error);
    const id = saved.result.view.id;

    // Load-bearing proof: query the RAW SQL table directly, not through the
    // macro's own `listViews` handler (which could theoretically still be
    // backed by a leftover in-memory cache and pass a shallower test).
    const row = db.prepare("SELECT * FROM dtu_saved_views WHERE id = ?").get(id);
    assert.ok(row, "saved view row must exist on disk in dtu_saved_views");
    assert.equal(row.user_id, "user_a");
    assert.equal(row.name, "High quality");
    assert.deepEqual(JSON.parse(row.filter_json), { minQuality: 80 });
    assert.ok(row.created_at);

    // The process-global in-memory fallback must be untouched — proves the
    // DB path, not the Map fallback, actually handled this write.
    assert.equal(globalThis._concordSTATE.dtusLens, undefined);
  });

  it("survives a brand-new independent DB handle to the same file (restart-equivalence)", () => {
    call(db, "user_a", "saveView", { name: "Restart View", filter: { tiers: ["mega"] } });
    call(db, "user_a", "saveView", { name: "Second View", filter: {} });

    const db2 = new Database(dbFile, { readonly: true });
    try {
      const rows = db2.prepare("SELECT * FROM dtu_saved_views WHERE user_id = ? ORDER BY rowid ASC").all("user_a");
      assert.equal(rows.length, 2, "both rows must be visible from a second, independent handle");
      assert.equal(rows[0].name, "Restart View");
      assert.equal(rows[1].name, "Second View");
      assert.deepEqual(JSON.parse(rows[0].filter_json), { tiers: ["mega"] });
    } finally { db2.close(); }
  });

  it("re-reads through a FRESH macro call (new store facade over the same db)", () => {
    const saved = call(db, "user_a", "saveView", { name: "Fresh Read View", filter: {} });
    const id = saved.result.view.id;
    const listed = call(db, "user_a", "listViews", {});
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.views[0].id, id);
    assert.equal(listed.result.views[0].name, "Fresh Read View");
  });

  it("deletes a saved view from the DB (not just the in-process reader)", () => {
    const saved = call(db, "user_a", "saveView", { name: "To Delete", filter: {} });
    const id = saved.result.view.id;
    const del = call(db, "user_a", "deleteView", { viewId: id });
    assert.equal(del.ok, true, del.error);
    assert.equal(del.result.remaining, 0);

    const row = db.prepare("SELECT * FROM dtu_saved_views WHERE id = ?").get(id);
    assert.equal(row, undefined, "row must be gone from the raw table, not just hidden from the reader");

    const missing = call(db, "user_a", "deleteView", { viewId: id });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "view not found");
  });

  it("scopes saved views per-user in the DB — never leaks across users", () => {
    call(db, "user_a", "saveView", { name: "A's view", filter: {} });
    assert.equal(call(db, "user_a", "listViews", {}).result.count, 1);
    assert.equal(call(db, "user_b", "listViews", {}).result.count, 0);

    // Cross-user delete must not succeed.
    const aView = call(db, "user_a", "listViews", {}).result.views[0];
    const crossDelete = call(db, "user_b", "deleteView", { viewId: aView.id });
    assert.equal(crossDelete.ok, false);
    assert.equal(crossDelete.error, "view not found");
    // still present for user_a
    assert.equal(call(db, "user_a", "listViews", {}).result.count, 1);
  });

  it("enforces the 50-saved-view cap against the real DB-backed count", () => {
    for (let i = 0; i < 50; i++) {
      const r = call(db, "user_a", "saveView", { name: `View ${i}`, filter: {} });
      assert.equal(r.ok, true, `save #${i} should succeed: ${r.error}`);
    }
    const countRow = db.prepare("SELECT COUNT(*) n FROM dtu_saved_views WHERE user_id = ?").get("user_a");
    assert.equal(countRow.n, 50);

    const over = call(db, "user_a", "saveView", { name: "One too many", filter: {} });
    assert.equal(over.ok, false);
    assert.equal(over.error, "saved-view limit reached (50)");
    // the rejected save must not have landed in the table
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtu_saved_views WHERE user_id = ?").get("user_a").n, 50);

    // a DIFFERENT user is unaffected by user_a's cap
    const other = call(db, "user_b", "saveView", { name: "First for B", filter: {} });
    assert.equal(other.ok, true, other.error);
  });
});

describe("dtus 4-layer editor — DB persistence (durable, restart-equivalent)", () => {
  it("seeds from a source DTU (no overlay row yet), then persists an edit into dtu_layer_overlays", () => {
    const seeded = call(db, "user_a", "getLayers", {
      dtuId: "d1",
      dtu: { id: "d1", summary: "Layer text", tags: ["mind"], tier: "regular" },
    });
    assert.equal(seeded.ok, true, seeded.error);
    assert.equal(seeded.result.source, "seed");
    assert.equal(seeded.result.layers.human, "Layer text");
    // no row yet — this was a pure seed, not a persisted overlay
    assert.equal(db.prepare("SELECT * FROM dtu_layer_overlays WHERE user_id = ? AND dtu_id = ?").get("user_a", "d1"), undefined);

    const upd = call(db, "user_a", "updateLayers", {
      dtuId: "d1",
      layers: { human: "Edited", machine: '{"tags":["mind"]}' },
    });
    assert.equal(upd.ok, true, upd.error);
    assert.equal(upd.result.layers.human, "Edited");
    assert.equal(upd.result.warnings.length, 0);

    // Load-bearing proof: raw SQL row, not the macro's own reader.
    const row = db.prepare("SELECT * FROM dtu_layer_overlays WHERE user_id = ? AND dtu_id = ?").get("user_a", "d1");
    assert.ok(row, "overlay row must exist on disk in dtu_layer_overlays");
    assert.equal(row.human, "Edited");
    assert.equal(row.machine, '{"tags":["mind"]}');
    assert.ok(row.updated_at);

    const reread = call(db, "user_a", "getLayers", { dtuId: "d1" });
    assert.equal(reread.result.source, "overlay");
    assert.equal(reread.result.layers.human, "Edited");

    assert.equal(globalThis._concordSTATE.dtusLens, undefined);
  });

  it("survives a brand-new independent DB handle to the same file (restart-equivalence)", () => {
    call(db, "user_a", "updateLayers", { dtuId: "d2", layers: { human: "Persisted across restart", core: "core text" } });

    const db2 = new Database(dbFile, { readonly: true });
    try {
      const row = db2.prepare("SELECT * FROM dtu_layer_overlays WHERE user_id = ? AND dtu_id = ?").get("user_a", "d2");
      assert.ok(row, "overlay row must be visible from a second, independent handle");
      assert.equal(row.human, "Persisted across restart");
      assert.equal(row.core, "core text");
    } finally { db2.close(); }
  });

  it("partial updates preserve prior fields (upsert reads back through the DB, not a stale in-memory value)", () => {
    call(db, "user_a", "updateLayers", { dtuId: "d3", layers: { human: "First", core: "core-1", machine: "", artifact: "" } });
    const second = call(db, "user_a", "updateLayers", { dtuId: "d3", layers: { human: "Second" } });
    assert.equal(second.ok, true, second.error);
    assert.equal(second.result.layers.human, "Second");
    assert.equal(second.result.layers.core, "core-1", "unspecified fields must carry forward from the DB row, not reset");

    const row = db.prepare("SELECT * FROM dtu_layer_overlays WHERE user_id = ? AND dtu_id = ?").get("user_a", "d3");
    assert.equal(row.human, "Second");
    assert.equal(row.core, "core-1");
  });

  it("warns on invalid JSON in the machine layer (validation unchanged by storage swap)", () => {
    const r = call(db, "user_a", "updateLayers", { dtuId: "d4", layers: { machine: "not json" } });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.result.warnings.includes("machine layer is not valid JSON"));
    const row = db.prepare("SELECT machine FROM dtu_layer_overlays WHERE user_id = ? AND dtu_id = ?").get("user_a", "d4");
    assert.equal(row.machine, "not json");
  });

  it("scopes layer overlays per-user in the DB — never leaks across users", () => {
    call(db, "user_a", "updateLayers", { dtuId: "shared_dtu", layers: { human: "A's private edit" } });
    const bView = call(db, "user_b", "getLayers", { dtuId: "shared_dtu", dtu: { id: "shared_dtu", summary: "original summary" } });
    assert.equal(bView.result.source, "seed", "user_b must not see user_a's overlay");
    assert.equal(bView.result.layers.human, "original summary");

    const rows = db.prepare("SELECT user_id FROM dtu_layer_overlays WHERE dtu_id = ?").all("shared_dtu");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, "user_a");
  });

  it("rejects missing dtuId / missing layers object (validation unchanged)", () => {
    assert.equal(call(db, "user_a", "getLayers", {}).ok, false);
    assert.equal(call(db, "user_a", "updateLayers", { layers: {} }).ok, false);
    assert.equal(call(db, "user_a", "updateLayers", { dtuId: "d5" }).ok, false);
  });
});
