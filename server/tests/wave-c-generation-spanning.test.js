// server/tests/wave-c-generation-spanning.test.js
//
// Wave C / C2 — heir-takeover route.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { foundDynasty } from "../lib/player-dynasty.js";
import createDynastyRouter from "../routes/dynasty.js";

let db, router;

function buildSchema(d) {
  d.exec(`
    CREATE TABLE player_dynasties (
      id TEXT PRIMARY KEY,
      founder_user_id TEXT NOT NULL,
      current_head_user_id TEXT NOT NULL,
      house_name TEXT NOT NULL,
      renown INTEGER NOT NULL DEFAULT 0,
      founded_at INTEGER NOT NULL DEFAULT (unixepoch()),
      generations INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE player_heir_takeovers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dynasty_id TEXT NOT NULL,
      predecessor_user_id TEXT NOT NULL,
      heir_user_id TEXT NOT NULL,
      cause TEXT,
      taken_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      item_id TEXT, item_name TEXT, item_type TEXT,
      quantity INTEGER DEFAULT 1, quality INTEGER DEFAULT 50,
      soulbound INTEGER DEFAULT 0,
      world_id TEXT DEFAULT 'concordia-hub'
    );
    CREATE TABLE player_skill_levels (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      skill_type TEXT NOT NULL, native_world_type TEXT NOT NULL,
      level INTEGER DEFAULT 0, xp INTEGER DEFAULT 0,
      xp_to_next INTEGER DEFAULT 100
    );
    CREATE TABLE player_world_state (
      user_id TEXT PRIMARY KEY, world_id TEXT,
      x REAL, z REAL
    );
    CREATE TABLE world_markers (
      id TEXT PRIMARY KEY, world_id TEXT, kind TEXT,
      x REAL, y REAL, z REAL,
      label TEXT, body TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE world_legends (
      id TEXT PRIMARY KEY, world_id TEXT, subject_kind TEXT, subject_id TEXT,
      title TEXT, body TEXT, sentiment REAL, severity INTEGER,
      composed_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE npc_player_memories (
      npc_id TEXT NOT NULL, player_id TEXT NOT NULL, world_id TEXT NOT NULL,
      summary_json TEXT, sentiment REAL DEFAULT 0,
      sightings INTEGER DEFAULT 0, interactions INTEGER DEFAULT 0,
      first_met_at INTEGER DEFAULT (unixepoch()),
      last_interaction_at INTEGER DEFAULT (unixepoch()),
      last_summary_compiled_at INTEGER,
      PRIMARY KEY (npc_id, player_id)
    );
    CREATE TABLE character_opinions (
      npc_id TEXT, target_kind TEXT, target_id TEXT, score REAL DEFAULT 0,
      kind TEXT DEFAULT 'neutral', top_reason TEXT,
      last_event_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      created_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (npc_id, target_kind, target_id)
    );
  `);
}

let currentUser = "U_father";

before(() => {
  db = new Database(":memory:");
  buildSchema(db);

  // Found a dynasty + seed predecessor state.
  foundDynasty(db, "U_father", "Aelisar");
  // Seed some renown so the heir-takeover halving has something to chew on.
  db.prepare(`UPDATE player_dynasties SET renown = 200 WHERE founder_user_id = 'U_father'`).run();

  // Inventory: 2 normal items + 1 soulbound (should NOT transfer).
  db.prepare(`INSERT INTO player_inventory (id, user_id, item_id, item_name, soulbound) VALUES
    ('inv1', 'U_father', 'sw_a', 'Sword',   0),
    ('inv2', 'U_father', 'pt_a', 'Potion',  0),
    ('inv3', 'U_father', 'rg_a', 'Heirloom', 1)
  `).run();

  // Skills.
  db.prepare(`INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level) VALUES
    ('sk1', 'U_father', 'combat',  'concordia', 12),
    ('sk2', 'U_father', 'magical', 'concordia', 8),
    ('sk3', 'U_father', 'movement','concordia', 1)
  `).run();

  // The heir already has Lv 4 + Lv 6 to make sure they get overridden.
  db.prepare(`INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level) VALUES
    ('skh1', 'U_son', 'combat',  'concordia', 4),
    ('skh2', 'U_son', 'magical', 'concordia', 6)
  `).run();

  // Predecessor last position.
  db.prepare(`INSERT INTO player_world_state (user_id, world_id, x, z) VALUES ('U_father', 'concordia', 150, 250)`).run();

  // Two NPCs who knew U_father well.
  db.prepare(`INSERT INTO npc_player_memories (npc_id, player_id, world_id, sentiment, interactions) VALUES
    ('npc_friend_a', 'U_father', 'concordia', 0.6, 12),
    ('npc_friend_b', 'U_father', 'concordia', 0.4, 5)
  `).run();

  router = createDynastyRouter({
    db,
    requireAuth: (req, _res, next) => { req.user = { id: currentUser }; next(); },
  });
});

after(() => { db?.close(); });

function invoke(method, path, body = {}) {
  return new Promise((resolve) => {
    let status = 200, json = null;
    const params = {};
    const m = path.match(/^\/([^/]+)\/lineage$/);
    if (m) params.dynastyId = m[1];
    const req = {
      method, url: path, headers: {}, params, body,
      app: { locals: { io: { to: () => ({ emit: () => {} }) } } },
    };
    const res = {
      status(c) { status = c; return this; },
      json(b)   { json = b; resolve({ status, body: b }); },
    };
    router.handle(req, res, () => resolve({ status: 404, body: null }));
  });
}

describe("dynasty routes", () => {
  it("GET /me returns the caller's dynasty", async () => {
    currentUser = "U_father";
    const r = await invoke("GET", "/me");
    assert.equal(r.status, 200);
    assert.ok(r.body.dynasty);
    assert.equal(r.body.dynasty.house_name, "Aelisar");
  });

  it("POST /heir-takeover transfers inventory, halves skills, casacdes opinions", async () => {
    currentUser = "U_father";
    const dyn = db.prepare(`SELECT id FROM player_dynasties WHERE founder_user_id = 'U_father'`).get();
    const r = await invoke("POST", "/heir-takeover", {
      dynastyId: dyn.id,
      heirUserId: "U_son",
      cause: "old_age",
    });
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.acceptHeir?.ok);

    // Non-soulbound items transferred (2/3).
    const sonInv = db.prepare(`SELECT * FROM player_inventory WHERE user_id = 'U_son'`).all();
    const fatherInv = db.prepare(`SELECT * FROM player_inventory WHERE user_id = 'U_father'`).all();
    assert.equal(sonInv.length, 2, "son inherits non-soulbound items");
    assert.equal(fatherInv.length, 1, "soulbound stays with father (becomes tomb artifact)");
    assert.equal(fatherInv[0].soulbound, 1);

    // Skills halved with floor=1.
    const sonSkills = db.prepare(`SELECT * FROM player_skill_levels WHERE user_id = 'U_son'`).all();
    const combat = sonSkills.find((s) => s.skill_type === "combat");
    assert.equal(combat.level, 2, "Lv 4 / 2 = 2");
    const magical = sonSkills.find((s) => s.skill_type === "magical");
    assert.equal(magical.level, 3, "Lv 6 / 2 = 3");

    // Gravestone spawned.
    assert.ok(r.body.gravestoneId);
    const grv = db.prepare(`SELECT * FROM world_markers WHERE id = ?`).get(r.body.gravestoneId);
    assert.ok(grv);
    assert.equal(grv.kind, "gravestone");
    assert.equal(grv.x, 150);

    // Legend composed.
    assert.ok(r.body.legendId);
    const lg = db.prepare(`SELECT * FROM world_legends WHERE id = ?`).get(r.body.legendId);
    assert.ok(lg);
    assert.equal(lg.subject_id, "U_father");

    // Opinion cascade — friend NPCs gained sympathy for the heir.
    assert.ok(r.body.opinionCascades >= 1);
    const opn = db.prepare(`SELECT * FROM character_opinions WHERE npc_id = 'npc_friend_a' AND target_id = 'U_son'`).get();
    assert.ok(opn);
    assert.ok(opn.score >= 5);

    // Dynasty bumped a generation, renown attenuated (factor 0.7).
    const dyn2 = db.prepare(`SELECT * FROM player_dynasties WHERE id = ?`).get(dyn.id);
    assert.equal(dyn2.current_head_user_id, "U_son");
    assert.equal(dyn2.generations, 2);
    assert.ok(dyn2.renown < 200, `renown should attenuate from 200 (got ${dyn2.renown})`);
    assert.ok(dyn2.renown >= 140, `renown attenuated by 0.7 = 140 floor (got ${dyn2.renown})`);
  });

  it("rejects non-head caller", async () => {
    currentUser = "U_son";  // U_son is now head
    const dyn = db.prepare(`SELECT id FROM player_dynasties WHERE founder_user_id = 'U_father'`).get();
    // Try as the now-deceased U_father.
    currentUser = "U_father";
    const r = await invoke("POST", "/heir-takeover", {
      dynastyId: dyn.id, heirUserId: "U_outsider", cause: "betrayal",
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "not_current_head");
  });

  it("rejects self-takeover", async () => {
    currentUser = "U_son";
    const dyn = db.prepare(`SELECT id FROM player_dynasties WHERE founder_user_id = 'U_father'`).get();
    const r = await invoke("POST", "/heir-takeover", {
      dynastyId: dyn.id, heirUserId: "U_son",
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "cannot_inherit_self");
  });

  it("GET /:id/lineage returns the takeover ledger", async () => {
    const dyn = db.prepare(`SELECT id FROM player_dynasties WHERE founder_user_id = 'U_father'`).get();
    const r = await invoke("GET", `/${dyn.id}/lineage`);
    assert.equal(r.status, 200);
    assert.ok(r.body.dynasty);
    assert.ok(Array.isArray(r.body.takeovers));
    assert.ok(r.body.takeovers.length >= 1);
  });
});
