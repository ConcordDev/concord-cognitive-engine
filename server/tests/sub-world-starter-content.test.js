// server/tests/sub-world-starter-content.test.js
//
// Wave 4 gap-closure — pins that a spawned sub-world's mirrored `worlds`
// row gets real starter content (kind-appropriate physics/rule-modulator
// presets + a small deterministic NPC roster persisted into `world_npcs`
// through the SAME write path real authored worlds use) instead of the
// bare-minimum shell (default-empty modulators, zero NPCs) previously
// shipped. See docs/lens-specs/sub-worlds-capability-map.md
// ("Investigated and honestly deferred" → "the next real increment").
//
// Two layers:
//   1. Unit tests against `seedSubWorldStarterContent` directly (a real
//      better-sqlite3 :memory: DB with the `worlds` + `world_npcs` table
//      shapes migrations 042/060+ produce).
//   2. Integration through the live `sub_worlds.spawn` domain handler
//      (`server/domains/sub-worlds.js`) — proves the wire, not just the
//      helper in isolation.
//
// The legacy singular `sub_world.spawn_from_forge` macro (registered
// inline in server.js) shares the identical fix via the same shared
// helper; it is covered separately in
// tests/sub-world-spawn-from-forge-mirror.test.js (which must boot the
// full server module to reach an inline `register()` call — kept out of
// this file so the fast unit/domain layer here stays cheap).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { seedSubWorldStarterContent, presetForKind } from "../lib/sub-world-starter-content.js";
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
    -- world_npcs shape matching migration 042 + the archetype/faction/xyz/
    -- is_immortal/is_conscious columns added by 060/061/062/185.
    CREATE TABLE world_npcs (
      id                TEXT PRIMARY KEY,
      world_id          TEXT NOT NULL,
      npc_emergent_id   TEXT,
      npc_type          TEXT NOT NULL DEFAULT 'generic',
      archetype         TEXT,
      faction           TEXT,
      universe_type     TEXT,
      spawn_location    TEXT DEFAULT '{}',
      current_location  TEXT DEFAULT '{}',
      state             TEXT DEFAULT '{}',
      x                 REAL,
      y                 REAL DEFAULT 0,
      z                 REAL,
      is_dead           INTEGER NOT NULL DEFAULT 0,
      is_immortal       INTEGER NOT NULL DEFAULT 0,
      is_conscious      INTEGER NOT NULL DEFAULT 1,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      last_tick_at      INTEGER
    );
    CREATE INDEX idx_world_npcs_world ON world_npcs(world_id);
  `);
  return db;
}

describe("presetForKind", () => {
  it("has a distinct, real preset for each declared sub-world kind", () => {
    for (const kind of ["physics_simulator", "research_zone", "concord_substrate"]) {
      const preset = presetForKind(kind);
      assert.equal(typeof preset.theme, "string");
      assert.ok(preset.theme.length > 0);
      assert.ok(preset.physics_modulators && typeof preset.physics_modulators.gravity === "number");
      assert.ok(preset.rule_modulators && typeof preset.rule_modulators.theme === "string");
      assert.ok(Array.isArray(preset.starterNpcs) && preset.starterNpcs.length >= 2);
    }
    // Distinct presets, not one preset copy-pasted three times.
    const themes = new Set(["physics_simulator", "research_zone", "concord_substrate"].map(k => presetForKind(k).theme));
    assert.equal(themes.size, 3);
  });

  it("falls back to the physics_simulator preset for an unknown kind", () => {
    assert.deepEqual(presetForKind("bogus_kind"), presetForKind("physics_simulator"));
  });
});

describe("seedSubWorldStarterContent — unit", () => {
  let db;
  beforeEach(() => {
    db = freshDb();
    db.prepare(`INSERT INTO worlds (id, name, universe_type, status) VALUES (?, ?, ?, 'active')`)
      .run("subw_test1", "Test World", "physics_simulator");
  });

  it("replaces the bare-shell default modulators with the kind's real preset", () => {
    const before = db.prepare(`SELECT physics_modulators, rule_modulators FROM worlds WHERE id = ?`).get("subw_test1");
    assert.equal(before.physics_modulators, "{}");
    assert.equal(before.rule_modulators, "{}");

    const r = seedSubWorldStarterContent(db, { worldId: "subw_test1", kind: "physics_simulator" });
    assert.equal(r.ok, true);
    assert.equal(r.theme, "physics_sandbox");
    assert.equal(r.npcCount, 2);

    const after = db.prepare(`SELECT physics_modulators, rule_modulators FROM worlds WHERE id = ?`).get("subw_test1");
    const physics = JSON.parse(after.physics_modulators);
    const rules = JSON.parse(after.rule_modulators);
    assert.equal(physics.gravity, 9.8);
    assert.ok(physics.friction > 0);
    assert.equal(rules.theme, "physics_sandbox");
    assert.equal(rules.combat_enabled, false);
  });

  it("persists a real, queryable starter NPC roster into world_npcs", () => {
    seedSubWorldStarterContent(db, { worldId: "subw_test1", kind: "research_zone" });
    const rows = db.prepare(`SELECT id, world_id, archetype, state FROM world_npcs WHERE world_id = ? ORDER BY id`).all("subw_test1");
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.world_id, "subw_test1");
      assert.ok(row.archetype, "each starter NPC must carry a real archetype, not a placeholder");
      const state = JSON.parse(row.state);
      assert.ok(state.name && state.name.length > 0, "each starter NPC must carry a real authored name");
    }
    const names = rows.map(r => JSON.parse(r.state).name).sort();
    assert.deepEqual(names, ["Data Analyst", "Field Archivist"]);
  });

  it("gives concord_substrate a combat-enabled preset distinct from the sandbox/research kinds", () => {
    const r = seedSubWorldStarterContent(db, { worldId: "subw_test1", kind: "concord_substrate" });
    assert.equal(r.theme, "concord_substrate");
    const row = db.prepare(`SELECT rule_modulators FROM worlds WHERE id = ?`).get("subw_test1");
    assert.equal(JSON.parse(row.rule_modulators).combat_enabled, true);
  });

  it("is idempotent — calling twice does not duplicate NPC rows (ON CONFLICT upsert)", () => {
    seedSubWorldStarterContent(db, { worldId: "subw_test1", kind: "physics_simulator" });
    seedSubWorldStarterContent(db, { worldId: "subw_test1", kind: "physics_simulator" });
    const count = db.prepare(`SELECT COUNT(*) AS n FROM world_npcs WHERE world_id = ?`).get("subw_test1").n;
    assert.equal(count, 2);
  });

  it("never throws when db or worldId is missing (honest degrade, matches mirror-helper contract)", () => {
    assert.doesNotThrow(() => seedSubWorldStarterContent(null, { worldId: "x", kind: "physics_simulator" }));
    assert.equal(seedSubWorldStarterContent(null, { worldId: "x" }).ok, false);
    assert.doesNotThrow(() => seedSubWorldStarterContent(db, { kind: "physics_simulator" }));
    assert.equal(seedSubWorldStarterContent(db, {}).ok, false);
  });

  it("never throws against a worlds table with no matching row (best-effort UPDATE no-ops)", () => {
    assert.doesNotThrow(() => seedSubWorldStarterContent(db, { worldId: "does_not_exist", kind: "physics_simulator" }));
  });
});

describe("sub_worlds.spawn → real starter content (integration through the live domain handler)", () => {
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

  const ctxA = () => ({ db, actor: { userId: "user_a" }, userId: "user_a" });

  it("a freshly spawned sub-world is NOT a bare shell — real modulators + NPCs land in the same call", () => {
    const r = call("spawn", ctxA(), { name: "Gravity Lab", kind: "physics_simulator", description: "orbits" });
    assert.equal(r.ok, true);
    const worldId = r.result.world.world_id;

    // The row is still travelable via the exact helper the real travel
    // route depends on (regression guard on the pre-existing mirror fix).
    const loaded = loadWorld(db, worldId);
    assert.ok(loaded, "loadWorld must still resolve the spawned sub-world");
    assert.equal(loaded.status, "active");

    // NEW: the mirrored row is no longer the bare '{}''{}' shell.
    const row = db.prepare(`SELECT physics_modulators, rule_modulators FROM worlds WHERE id = ?`).get(worldId);
    assert.notEqual(row.physics_modulators, "{}");
    assert.notEqual(row.rule_modulators, "{}");
    const rules = JSON.parse(row.rule_modulators);
    assert.equal(rules.theme, "physics_sandbox");

    // NEW: a real starter NPC roster exists in world_npcs, findable by any
    // world-lens NPC query (the same table `GET /:worldId/npcs` reads).
    const npcs = db.prepare(`SELECT * FROM world_npcs WHERE world_id = ?`).all(worldId);
    assert.equal(npcs.length, 2);
    assert.ok(npcs.every(n => n.archetype && n.archetype.length > 0));
  });

  it("different kinds get different starter themes/NPCs, not one generic preset for all", () => {
    const w1 = call("spawn", ctxA(), { name: "Sim One", kind: "physics_simulator" }).result.world.world_id;
    const w2 = call("spawn", ctxA(), { name: "Lab Two", kind: "research_zone" }).result.world.world_id;
    const theme1 = JSON.parse(db.prepare(`SELECT rule_modulators FROM worlds WHERE id=?`).get(w1).rule_modulators).theme;
    const theme2 = JSON.parse(db.prepare(`SELECT rule_modulators FROM worlds WHERE id=?`).get(w2).rule_modulators).theme;
    assert.notEqual(theme1, theme2);
    const names1 = db.prepare(`SELECT state FROM world_npcs WHERE world_id=?`).all(w1).map(r => JSON.parse(r.state).name).sort();
    const names2 = db.prepare(`SELECT state FROM world_npcs WHERE world_id=?`).all(w2).map(r => JSON.parse(r.state).name).sort();
    assert.notDeepEqual(names1, names2);
  });

  it("spawning without ctx.db still honestly succeeds at the lens layer (starter content best-effort no-op)", () => {
    const dbless = { actor: { userId: "user_a" }, userId: "user_a" };
    const r = call("spawn", dbless, { name: "No DB World" });
    assert.equal(r.ok, true);
  });
});
