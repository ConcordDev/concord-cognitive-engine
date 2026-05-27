// server/tests/wave-f-dungeon-interior-contract.test.js
//
// Wave F follow-up — pins the dungeon-interior renderer's contract by
// verifying GET /api/dungeons/:id returns the fields the frontend
// buildDungeonInterior needs: rooms with x/z/width/depth, connections
// array, is_boss flag, hazards array, creature_count. Without these
// the procedural mesh assembly degrades silently — a regression here
// would break the 3D interior.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { composeDungeon } from "../lib/dungeons.js";
import createDungeonsRouter from "../routes/dungeons.js";

let db, router;

function buildSchema(d) {
  d.exec(`
    CREATE TABLE dungeons (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      template_kind TEXT NOT NULL, seed TEXT NOT NULL, name TEXT NOT NULL,
      anchor_x REAL NOT NULL, anchor_z REAL NOT NULL,
      depth_level INTEGER NOT NULL DEFAULT 1,
      room_count INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'active',
      cleared_at INTEGER, generated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE dungeon_rooms (
      dungeon_id TEXT NOT NULL, room_idx INTEGER NOT NULL,
      kind TEXT NOT NULL, x REAL NOT NULL, z REAL NOT NULL,
      width REAL DEFAULT 12, depth REAL DEFAULT 12,
      connections_json TEXT, cleared INTEGER DEFAULT 0,
      is_boss INTEGER DEFAULT 0, hazards_json TEXT,
      creature_count INTEGER DEFAULT 0,
      PRIMARY KEY (dungeon_id, room_idx)
    );
    CREATE TABLE dungeon_loot_instances (
      id TEXT PRIMARY KEY, dungeon_id TEXT NOT NULL, room_idx INTEGER NOT NULL,
      item_json TEXT NOT NULL, claimed_by TEXT, claimed_at INTEGER,
      generated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE dungeon_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT, dungeon_id TEXT, user_id TEXT,
      room_idx INTEGER, entered_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      item_type TEXT, item_id TEXT, item_name TEXT,
      quantity INTEGER DEFAULT 1, quality INTEGER DEFAULT 50,
      world_id TEXT, weapon_class TEXT, handedness TEXT
    );
  `);
}

before(() => {
  db = new Database(":memory:");
  buildSchema(db);
  router = createDungeonsRouter({
    db,
    requireAuth: (req, _res, next) => { req.user = { id: "U1" }; next(); },
  });
});

after(() => { db?.close(); });

function invoke(method, path) {
  return new Promise((resolve) => {
    let status = 200, json = null;
    const params = {};
    const m = path.match(/^\/([^/]+)$/);
    if (m) params.dungeonId = m[1];
    const req = {
      method, url: path, headers: {}, params, body: {}, query: {},
      app: { locals: { io: { to: () => ({ emit: () => {} }) } } },
    };
    const res = {
      status(c) { status = c; return this; },
      json(b)   { json = b; resolve({ status, body: b }); },
    };
    router.handle(req, res, () => resolve({ status: 404, body: null }));
  });
}

describe("GET /api/dungeons/:id — interior renderer contract", () => {
  let dungeonId;

  it("composeDungeon produces a renderable shape", () => {
    const r = composeDungeon(db, { worldId: "fantasy", seed: "interior-fixture", anchorX: 100, anchorZ: 200 });
    assert.equal(r.ok, true);
    dungeonId = r.dungeonId;
  });

  it("GET /:id returns every field the interior renderer needs", async () => {
    const r = await invoke("GET", `/${dungeonId}`);
    assert.equal(r.status, 200);
    const d = r.body.dungeon;
    assert.ok(d);
    // Header fields needed for mesh positioning.
    assert.equal(typeof d.anchor_x, "number");
    assert.equal(typeof d.anchor_z, "number");
    assert.equal(typeof d.template_kind, "string");
    assert.equal(typeof d.depth_level, "number");
    // Rooms array shape.
    assert.ok(Array.isArray(d.rooms));
    assert.ok(d.rooms.length >= 6, "fantasy dungeon has ≥6 rooms");
    for (const room of d.rooms) {
      assert.equal(typeof room.x, "number");
      assert.equal(typeof room.z, "number");
      assert.equal(typeof room.width, "number");
      assert.equal(typeof room.depth, "number");
      assert.ok(typeof room.kind === "string" && room.kind.length > 0);
      assert.ok([0, 1].includes(room.is_boss));
      assert.ok(Array.isArray(room.connections));
      assert.ok(Array.isArray(room.hazards));
      assert.equal(typeof room.creature_count, "number");
    }
    // Exactly one boss.
    const bosses = d.rooms.filter((r) => r.is_boss === 1);
    assert.equal(bosses.length, 1);
  });

  it("connections list room indices that exist in the dungeon", async () => {
    const r = await invoke("GET", `/${dungeonId}`);
    const d = r.body.dungeon;
    const idxSet = new Set(d.rooms.map((r) => r.room_idx));
    for (const room of d.rooms) {
      for (const ci of room.connections) {
        assert.ok(idxSet.has(ci), `connection ${ci} from room ${room.room_idx} must exist`);
      }
    }
  });

  it("template_kind matches a known frontend theme key", async () => {
    const r = await invoke("GET", `/${dungeonId}`);
    const known = [
      "crypts_of_the_old_order", "data_vault", "kingpin_compound",
      "villain_lair", "buried_throne", "crucible_core", "outpost_complex",
      "ancestor_grove", "council_undercity", "generic_ruin",
    ];
    assert.ok(known.includes(r.body.dungeon.template_kind));
  });
});
