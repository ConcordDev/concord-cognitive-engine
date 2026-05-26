// server/tests/wave4-mount-toggle.test.js
//
// Wave 4 / T2.1 — server-side mount-state toggle contract. The full
// camera + physics integration is a follow-up; this commit ships the
// authoritative server state so the frontend can render "Ride" /
// "Dismount" actions and so emit consumers can react.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import createCompanionsBreedingRouter from "../routes/companions-breeding.js";

let db, router;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_companions (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, creature_id TEXT NOT NULL,
      name TEXT NOT NULL, tame_bond REAL DEFAULT 100, loyalty REAL DEFAULT 50,
      level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0,
      caught_at INTEGER DEFAULT (unixepoch()),
      world_id TEXT DEFAULT 'concordia-hub',
      deployed INTEGER DEFAULT 0, last_action_at INTEGER,
      blueprint_json TEXT, source_kind TEXT DEFAULT 'world_npc',
      source_ref TEXT,
      mounted INTEGER NOT NULL DEFAULT 0,
      mount_eligible INTEGER NOT NULL DEFAULT 1,
      UNIQUE(owner_id, creature_id)
    );
    -- Stub tables to satisfy taming.js imports without errors.
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, is_dead INTEGER DEFAULT 0);
    CREATE TABLE creature_bonds (a_id TEXT, b_id TEXT, bond REAL DEFAULT 0, PRIMARY KEY (a_id, b_id));
    CREATE TABLE player_skill_levels (id TEXT PRIMARY KEY, user_id TEXT, skill_type TEXT, native_world_type TEXT, level INTEGER DEFAULT 0);
    CREATE TABLE world_hybrid_creatures (id TEXT PRIMARY KEY, world_id TEXT, x REAL, y REAL, z REAL, blueprint_json TEXT, parent_a TEXT, parent_b TEXT, generation INTEGER DEFAULT 1, stability REAL DEFAULT 0.5, cross_world INTEGER DEFAULT 0, alive INTEGER DEFAULT 1, created_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE player_creature_discoveries (id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT, kind TEXT, species_ref TEXT, first_seen_at INTEGER DEFAULT (unixepoch()), last_seen_at INTEGER DEFAULT (unixepoch()), sightings INTEGER DEFAULT 1, meta_json TEXT, UNIQUE(user_id, world_id, kind, species_ref));
  `);

  db.prepare(`INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, blueprint_json, source_kind, mount_eligible) VALUES
    ('c_dragon',  'U1', 'h_dragon',  'Drogon',  'concordia', '{"topology":"winged_quadruped"}', 'bred', 1),
    ('c_wolf',    'U1', 'h_wolf',    'Fang',    'concordia', '{"topology":"quadruped"}',        'world_npc', 1),
    ('c_no_ride', 'U1', 'h_blob',    'Goo',     'concordia', '{"topology":"amorphous"}',        'world_npc', 0)
  `).run();

  router = createCompanionsBreedingRouter({
    db,
    requireAuth: (req, _res, next) => { req.user = { id: "U1" }; next(); },
  });
});

after(() => { db?.close(); });

function invoke(method, path) {
  return new Promise((resolve) => {
    let status = 200, body = null;
    const params = {};
    // Naive param extraction for /:companionId/...
    const m = path.match(/^\/([^/]+)\/(mount|dismount)$/);
    if (m) params.companionId = m[1];
    const req = {
      method, url: path, headers: {}, params, body: {},
      app: { locals: { io: { to: () => ({ emit: () => {} }) } } },
    };
    const res = {
      status(c) { status = c; return this; },
      json(b)   { body = b; resolve({ status, body }); },
    };
    router.handle(req, res, () => resolve({ status: 404, body: null }));
  });
}

describe("Wave 4 — mount toggle", () => {
  it("mount sets mounted=1 + deployed=1", async () => {
    const r = await invoke("POST", "/c_dragon/mount");
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    const row = db.prepare(`SELECT mounted, deployed FROM player_companions WHERE id = 'c_dragon'`).get();
    assert.equal(row.mounted, 1);
    assert.equal(row.deployed, 1);
  });

  it("mounting a different companion auto-dismounts the previous", async () => {
    const r = await invoke("POST", "/c_wolf/mount");
    assert.equal(r.body.ok, true);
    const drogon = db.prepare(`SELECT mounted FROM player_companions WHERE id = 'c_dragon'`).get();
    const fang   = db.prepare(`SELECT mounted FROM player_companions WHERE id = 'c_wolf'`).get();
    assert.equal(drogon.mounted, 0, "previous auto-dismounted");
    assert.equal(fang.mounted, 1, "new one mounted");
  });

  it("dismount clears the mounted flag", async () => {
    const r = await invoke("POST", "/dismount");
    assert.equal(r.body.ok, true);
    const any = db.prepare(`SELECT COUNT(*) AS n FROM player_companions WHERE owner_id = 'U1' AND mounted = 1`).get();
    assert.equal(any.n, 0);
  });

  it("rejects mount on non-mount-eligible companion", async () => {
    const r = await invoke("POST", "/c_no_ride/mount");
    assert.equal(r.status, 400);
    assert.equal(r.body.reason, "not_mount_eligible");
  });

  it("rejects mount on unknown companion", async () => {
    const r = await invoke("POST", "/nonexistent/mount");
    assert.equal(r.status, 400);
    assert.equal(r.body.reason, "companion_not_found");
  });
});
