/**
 * Tier-2 contract test for the dtu_surface domain (Phase 7 — cross-lens
 * narrative).
 *
 * Pins:
 *   - 4 macros register
 *   - record validates surface_kind enum + required fields
 *   - record appends one row per call (append-only)
 *   - where_used aggregates by (lens, kind) within the time window
 *   - surfaced_from filters by lensId + window
 *   - provenance_trail walks up citation graph + joins surface counts
 *   - all 3 read macros are safe on missing dtus table (return ok=false
 *     for trail; surfaces alone work without dtus join)
 *
 * Run: node --test server/tests/dtu-surface-domain.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import Database from "better-sqlite3";
import { up as migrate196 } from "../migrations/196_dtu_surface_log.js";
import registerDtuSurfaceMacros from "../domains/dtu-surface.js";

function makeRegistry() {
  const map = new Map();
  const register = (domain, name, handler, meta) => {
    map.set(`${domain}.${name}`, { handler, meta });
  };
  return { register, map };
}

function setup({ withDtus = false } = {}) {
  const db = new Database(":memory:");
  migrate196(db);
  if (withDtus) {
    db.exec(`
      CREATE TABLE dtus (
        id TEXT PRIMARY KEY, title TEXT, source_lens TEXT,
        creator_id TEXT, kind TEXT
      );
      CREATE TABLE dtu_citations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id TEXT NOT NULL,
        child_id TEXT NOT NULL
      );
    `);
  }
  const r = makeRegistry();
  registerDtuSurfaceMacros(r.register);
  const call = (name, ctx, input) => r.map.get(`dtu_surface.${name}`).handler(ctx, input);
  return { db, call, registry: r };
}

const CTX = (db, userId = "alice") => ({ db, actor: { userId } });

describe("dtu_surface registration", () => {
  it("registers all 4 macros", () => {
    const { registry } = setup();
    for (const name of ["record", "where_used", "surfaced_from", "provenance_trail"]) {
      assert.ok(registry.map.has(`dtu_surface.${name}`));
    }
  });
});

describe("dtu_surface.record", () => {
  it("appends a row on valid input", async () => {
    const { db, call } = setup();
    const res = await call("record", CTX(db), {
      dtuId: "dtu-1", lensId: "paper", surfaceKind: "citation_chip",
    });
    assert.equal(res.ok, true);
    const rows = db.prepare("SELECT * FROM dtu_surface_log").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].dtu_id, "dtu-1");
    assert.equal(rows[0].surfaced_in_lens, "paper");
    assert.equal(rows[0].surface_kind, "citation_chip");
    assert.equal(rows[0].user_id, "alice");
  });

  it("rejects missing fields", async () => {
    const { db, call } = setup();
    const res = await call("record", CTX(db), { dtuId: "dtu-1" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_field");
  });

  it("rejects invalid surface_kind", async () => {
    const { db, call } = setup();
    const res = await call("record", CTX(db), { dtuId: "dtu-1", lensId: "paper", surfaceKind: "evil" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_surface_kind");
  });

  it("permits anonymous record (user_id stored as null)", async () => {
    const { db, call } = setup();
    const res = await call("record", { db, actor: {} }, {
      dtuId: "dtu-1", lensId: "paper", surfaceKind: "feed",
    });
    assert.equal(res.ok, true);
    const row = db.prepare("SELECT user_id FROM dtu_surface_log").get();
    assert.equal(row.user_id, null);
  });

  it("rejects oversized meta", async () => {
    const { db, call } = setup();
    const res = await call("record", CTX(db), {
      dtuId: "dtu-1", lensId: "paper", surfaceKind: "feed",
      meta: { big: "x".repeat(10000) },
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "meta_too_large");
  });
});

describe("dtu_surface.where_used", () => {
  it("aggregates by (lens, kind) within window", async () => {
    const { db, call } = setup();
    await call("record", CTX(db), { dtuId: "dtu-X", lensId: "paper", surfaceKind: "citation_chip" });
    await call("record", CTX(db), { dtuId: "dtu-X", lensId: "paper", surfaceKind: "citation_chip" });
    await call("record", CTX(db), { dtuId: "dtu-X", lensId: "chat", surfaceKind: "inline_link" });
    await call("record", CTX(db), { dtuId: "dtu-other", lensId: "paper", surfaceKind: "feed" });

    const res = await call("where_used", CTX(db), { dtuId: "dtu-X" });
    assert.equal(res.ok, true);
    assert.equal(res.totalSurfaces, 3);
    assert.equal(res.surfaces.length, 2);
    const paperRow = res.surfaces.find(s => s.lensId === "paper");
    assert.equal(paperRow.count, 2);
    assert.equal(paperRow.kind, "citation_chip");
  });

  it("respects sinceDays window", async () => {
    const { db, call } = setup();
    // Backdate a row beyond the window.
    await call("record", CTX(db), { dtuId: "dtu-1", lensId: "paper", surfaceKind: "feed" });
    db.prepare("UPDATE dtu_surface_log SET created_at = ? WHERE dtu_id = ?")
      .run(Math.floor(Date.now() / 1000) - 200 * 86400, "dtu-1");
    const res = await call("where_used", CTX(db), { dtuId: "dtu-1", sinceDays: 30 });
    assert.equal(res.ok, true);
    assert.equal(res.totalSurfaces, 0);
  });

  it("rejects missing dtuId", async () => {
    const { db, call } = setup();
    const res = await call("where_used", CTX(db), {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_dtu_id");
  });
});

describe("dtu_surface.surfaced_from", () => {
  it("lists DTUs surfaced into the target lens", async () => {
    const { db, call } = setup({ withDtus: true });
    db.prepare("INSERT INTO dtus (id, title, source_lens, creator_id, kind) VALUES (?, ?, ?, ?, ?)")
      .run("dtu-from-chem", "Caffeine notes", "chem", "alice", "compound");
    db.prepare("INSERT INTO dtus (id, title, source_lens, creator_id, kind) VALUES (?, ?, ?, ?, ?)")
      .run("dtu-from-paper", "Internal draft", "paper", "alice", "note");

    await call("record", CTX(db), { dtuId: "dtu-from-chem", lensId: "paper", surfaceKind: "citation_chip" });
    await call("record", CTX(db), { dtuId: "dtu-from-paper", lensId: "paper", surfaceKind: "feed" });

    const res = await call("surfaced_from", CTX(db), { lensId: "paper" });
    assert.equal(res.ok, true);
    // excludeOwnOrigin defaults to true → paper-origin DTU filtered out.
    assert.equal(res.surfaces.length, 1);
    assert.equal(res.surfaces[0].dtuId, "dtu-from-chem");
    assert.equal(res.surfaces[0].sourceLens, "chem");
  });

  it("includes own-origin when excludeOwnOrigin=false", async () => {
    const { db, call } = setup({ withDtus: true });
    db.prepare("INSERT INTO dtus (id, title, source_lens, creator_id, kind) VALUES (?, ?, ?, ?, ?)")
      .run("dtu-from-paper", "Internal", "paper", "alice", "note");
    await call("record", CTX(db), { dtuId: "dtu-from-paper", lensId: "paper", surfaceKind: "feed" });
    const res = await call("surfaced_from", CTX(db), { lensId: "paper", excludeOwnOrigin: false });
    assert.equal(res.surfaces.length, 1);
  });

  it("works without the dtus table", async () => {
    const { db, call } = setup();
    await call("record", CTX(db), { dtuId: "dtu-X", lensId: "paper", surfaceKind: "feed" });
    const res = await call("surfaced_from", CTX(db), { lensId: "paper" });
    assert.equal(res.ok, true);
    assert.equal(res.surfaces.length, 1);
    assert.equal(res.surfaces[0].dtuId, "dtu-X");
    assert.equal(res.surfaces[0].sourceLens, null);
  });
});

describe("dtu_surface.provenance_trail", () => {
  it("walks up the citation graph and joins surface counts", async () => {
    const { db, call } = setup({ withDtus: true });
    db.prepare("INSERT INTO dtus (id, title, source_lens, creator_id, kind) VALUES (?, ?, ?, ?, ?)")
      .run("ancestor-1", "Foundational paper", "paper", "alice", "claim");
    db.prepare("INSERT INTO dtus (id, title, source_lens, creator_id, kind) VALUES (?, ?, ?, ?, ?)")
      .run("intermediate", "Follow-on synthesis", "paper", "bob", "synthesis");
    db.prepare("INSERT INTO dtus (id, title, source_lens, creator_id, kind) VALUES (?, ?, ?, ?, ?)")
      .run("leaf", "Latest take", "chat", "alice", "note");

    db.prepare("INSERT INTO dtu_citations (parent_id, child_id) VALUES (?, ?)").run("ancestor-1", "intermediate");
    db.prepare("INSERT INTO dtu_citations (parent_id, child_id) VALUES (?, ?)").run("intermediate", "leaf");

    await call("record", CTX(db), { dtuId: "leaf", lensId: "chat", surfaceKind: "feed" });
    await call("record", CTX(db), { dtuId: "ancestor-1", lensId: "paper", surfaceKind: "citation_chip" });

    const res = await call("provenance_trail", CTX(db), { dtuId: "leaf", maxDepth: 5 });
    assert.equal(res.ok, true);
    assert.equal(res.trail.length, 3);
    assert.equal(res.trail[0].dtuId, "leaf");
    assert.equal(res.trail[0].depth, 0);
    assert.equal(res.trail[1].dtuId, "intermediate");
    assert.equal(res.trail[2].dtuId, "ancestor-1");
    assert.equal(res.trail[2].totalSurfaces, 1);
  });

  it("fails cleanly when dtus table missing", async () => {
    const { db, call } = setup();
    const res = await call("provenance_trail", CTX(db), { dtuId: "anything" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "dtus_table_missing");
  });

  it("rejects missing dtuId", async () => {
    const { db, call } = setup({ withDtus: true });
    const res = await call("provenance_trail", CTX(db), {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_dtu_id");
  });
});
