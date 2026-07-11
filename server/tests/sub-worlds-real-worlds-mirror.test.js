// server/tests/sub-worlds-real-worlds-mirror.test.js
//
// Proves the sub-worlds lens's "Enter" hand-off is REAL, not fabricated
// success. Before this fix, `sub_worlds.spawn` only wrote an in-memory
// STATE record (globalThis._concordSTATE.subWorldsLens) — it never
// touched the `worlds` SQL table that the actual cross-world travel path
// (`POST /api/worlds/travel` → `travelToWorld` → `lib/world-loader.js
// #loadWorld`, `SELECT * FROM worlds WHERE id = ? AND status = 'active'`)
// reads from. So the `visit` macro's own `{ travel: { destination_
// world_id } }` hand-off contract could never resolve: even if the
// frontend had wired up the real travel hook, the destination would 404
// with "Destination world not found" on every single spawned world.
//
// This test drives the REAL domain handlers against a REAL better-
// sqlite3 `:memory:` DB (the same `worlds` table shape as migration
// 042_concordia_worlds.js) and asserts the mirror via the REAL
// `loadWorld` helper the travel path actually calls — not a re-
// implementation of the read.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerSubWorldsActions from "../domains/sub-worlds.js";
import { loadWorld } from "../lib/world-loader.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      universe_type        TEXT NOT NULL,
      description          TEXT,
      substrate_dtu_ids    TEXT DEFAULT '[]',
      physics_modulators   TEXT DEFAULT '{}',
      rule_modulators      TEXT DEFAULT '{}',
      created_by           TEXT,
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      population           INTEGER NOT NULL DEFAULT 0,
      total_visits         INTEGER NOT NULL DEFAULT 0,
      npc_count            INTEGER NOT NULL DEFAULT 0,
      user_creation_count  INTEGER NOT NULL DEFAULT 0,
      status               TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE world_substrate_dtus (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, dtu_id TEXT NOT NULL,
      substrate_role TEXT NOT NULL DEFAULT 'element', added_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  return db;
}

const LENS = new Map();
function registerLensAction(domain, name, handler) {
  assert.equal(domain, "sub_worlds");
  LENS.set(name, handler);
}
registerSubWorldsActions(registerLensAction);

function call(name, ctx, params = {}) {
  const fn = LENS.get(name);
  if (!fn) throw new Error(`sub_worlds.${name} not registered`);
  return fn(ctx, { id: null, domain: "sub_worlds", type: "domain_action", data: params, meta: {} }, params);
}

let db;
beforeEach(() => {
  db = freshDb();
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = (extraDb = db) => ({ db: extraDb, actor: { userId: "user_a" }, userId: "user_a" });
const ctxB = (extraDb = db) => ({ db: extraDb, actor: { userId: "user_b" }, userId: "user_b" });

describe("sub_worlds → worlds mirror — the real travel chokepoint can find a spawned world", () => {
  it("spawn mirrors a real, travelable row (proven via the actual loadWorld helper)", () => {
    const r = call("spawn", ctxA(), { name: "Gravity Lab", kind: "physics_simulator", description: "orbits" });
    assert.equal(r.ok, true);
    const worldId = r.result.world.world_id;

    // This is the EXACT read the /api/worlds/travel route depends on
    // (server/lib/transit.js#travelToWorld calls loadWorld first and
    // 404s "Destination world not found" if it comes back null).
    const loaded = loadWorld(db, worldId);
    assert.ok(loaded, "loadWorld must resolve the spawned sub-world — this is what makes Enter real, not fabricated");
    assert.equal(loaded.name, "Gravity Lab");
    assert.equal(loaded.universe_type, "physics_simulator");
    assert.equal(loaded.status, "active");
  });

  it("update_settings keeps the mirrored row's name/description in sync", () => {
    const worldId = call("spawn", ctxA(), { name: "Old Name" }).result.world.world_id;
    call("update_settings", ctxA(), { worldId, name: "New Name", description: "updated desc" });
    const loaded = loadWorld(db, worldId);
    assert.equal(loaded.name, "New Name");
    assert.equal(loaded.description, "updated desc");
  });

  it("soft archive flips the mirrored row inactive — loadWorld can no longer find it", () => {
    const worldId = call("spawn", ctxA(), { name: "Doomed World" }).result.world.world_id;
    assert.ok(loadWorld(db, worldId), "sanity: travelable before archive");
    const arch = call("archive", ctxA(), { worldId });
    assert.equal(arch.ok, true);
    assert.equal(loadWorld(db, worldId), null, "archived sub-world must not be travelable (loadWorld filters status='active')");
    // the row still exists (archived, not gone) — confirms an UPDATE not a stray DELETE
    const raw = db.prepare(`SELECT status FROM worlds WHERE id = ?`).get(worldId);
    assert.equal(raw.status, "archived");
  });

  it("hard delete removes the mirrored row entirely", () => {
    const worldId = call("spawn", ctxA(), { name: "Erased World" }).result.world.world_id;
    assert.ok(loadWorld(db, worldId), "sanity: travelable before delete");
    call("archive", ctxA(), { worldId, hardDelete: true });
    const raw = db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(worldId);
    assert.equal(raw, undefined, "hard-deleted sub-world must not linger in the worlds table");
  });

  it("the mirror is best-effort — a caller with no ctx.db still gets the honest in-memory lens behavior", () => {
    const dbless = { actor: { userId: "user_a" }, userId: "user_a" }; // no .db
    const r = call("spawn", dbless, { name: "No DB World" });
    assert.equal(r.ok, true, "spawn must not throw or fail just because ctx.db is absent");
    assert.equal(r.result.world.name, "No DB World");
  });

  it("privacy/ownership rules are unaffected by the mirror (regression guard)", () => {
    const worldId = call("spawn", ctxA(), { name: "Private Realm", privacy: "private" }).result.world.world_id;
    // still governed by the domain's own STATE-side privacy rule
    assert.equal(call("discover", ctxB(), {}).result.worlds.length, 0);
    // the worlds-table mirror doesn't leak privacy semantics — the real
    // gate for who can even reach travel stays the lens's own `visit`
    // check (privacy === 'private' && !canEdit), unaffected by the mirror.
    const visit = call("visit", ctxB(), { worldId });
    assert.equal(visit.ok, false);
    assert.equal(visit.error, "world is private");
  });
});
