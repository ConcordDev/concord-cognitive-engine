// server/tests/wave-f-dungeons.test.js
//
// Wave F — per-world procedural dungeons.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  composeDungeon, getDungeon, listInWorld, enterRoom, claimLoot,
  WORLD_DUNGEON_TEMPLATES, _internal,
} from "../lib/dungeons.js";
import { runDungeonSpawnerCycle } from "../emergent/dungeon-spawner-cycle.js";

let db;

function buildSchema(d) {
  d.exec(`
    CREATE TABLE dungeons (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      template_kind TEXT NOT NULL, seed TEXT NOT NULL, name TEXT NOT NULL,
      anchor_x REAL NOT NULL, anchor_z REAL NOT NULL,
      depth_level INTEGER NOT NULL DEFAULT 1,
      room_count INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'active',
      cleared_at INTEGER,
      generated_at INTEGER NOT NULL DEFAULT (unixepoch())
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
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, is_dead INTEGER DEFAULT 0);
    CREATE TABLE world_visits (id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT, departed_at INTEGER);
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      item_type TEXT, item_id TEXT, item_name TEXT,
      quantity INTEGER DEFAULT 1, quality INTEGER DEFAULT 50,
      world_id TEXT DEFAULT 'concordia-hub',
      weapon_class TEXT, handedness TEXT DEFAULT 'either'
    );
  `);
}

before(() => {
  db = new Database(":memory:");
  buildSchema(db);
});

after(() => { db?.close(); });

describe("WORLD_DUNGEON_TEMPLATES coverage", () => {
  it("every documented sub-world has at least one template", () => {
    const worlds = ["fantasy", "cyber", "crime", "superhero",
      "sovereign-ruins", "lattice-crucible", "concord-link-frontier",
      "tunya", "concordia-hub"];
    for (const w of worlds) {
      const t = WORLD_DUNGEON_TEMPLATES[w];
      assert.ok(Array.isArray(t) && t.length >= 1, `${w} has templates`);
      for (const tpl of t) {
        assert.ok(tpl.kind);
        assert.ok(tpl.displayName);
        assert.ok(tpl.roomKinds?.length >= 2);
        assert.ok(tpl.bossKind);
        assert.ok(tpl.creatureArchetypes?.length >= 1);
        assert.ok(tpl.weaponClassBias?.length >= 1);
        assert.ok(tpl.minRooms <= tpl.maxRooms);
      }
    }
  });

  it("per-world weapon class biases match each world's vibe", () => {
    // Fantasy → melee bias. Cyber → cyberware/firearm. Sovereign-ruins → polearm.
    const fantasy = WORLD_DUNGEON_TEMPLATES.fantasy[0];
    assert.ok(fantasy.weaponClassBias.includes("greatsword"));
    const cyber = WORLD_DUNGEON_TEMPLATES.cyber[0];
    assert.ok(cyber.weaponClassBias.some((c) => /smart_gun|mantis_blades|tech_gun/.test(c)));
    const ruins = WORLD_DUNGEON_TEMPLATES["sovereign-ruins"][0];
    assert.ok(ruins.weaponClassBias.includes("halberd"));
  });
});

describe("composeDungeon", () => {
  it("creates a dungeon + rooms with deterministic layout from seed", () => {
    const r = composeDungeon(db, { worldId: "fantasy", seed: "fixed-seed-1", anchorX: 100, anchorZ: 200 });
    assert.equal(r.ok, true);
    assert.ok(r.dungeonId);
    assert.equal(r.worldId, "fantasy");
    assert.ok(r.roomCount >= 6 && r.roomCount <= 12);

    const d = getDungeon(db, r.dungeonId);
    assert.ok(d);
    assert.equal(d.rooms.length, r.roomCount);
    // Boss is at the last room.
    assert.equal(d.rooms[d.rooms.length - 1].is_boss, 1);
    assert.equal(d.rooms[0].kind, "entrance");
    // Each room has connections (room 0 has none; subsequent have ≥1).
    for (let i = 1; i < d.rooms.length; i++) {
      assert.ok(d.rooms[i].connections.length >= 1, `room ${i} connected`);
    }
  });

  it("same seed produces the same dungeon", () => {
    const a = composeDungeon(db, { worldId: "cyber", seed: "fixed-seed-2", anchorX: 0, anchorZ: 0 });
    const b = composeDungeon(db, { worldId: "cyber", seed: "fixed-seed-2", anchorX: 0, anchorZ: 0 });
    // Same seed → same name + room count (the ids differ because they're crypto-rolled).
    assert.equal(a.name, b.name);
    assert.equal(a.roomCount, b.roomCount);
    assert.equal(a.templateKind, b.templateKind);
  });

  it("falls back to default template for unknown worlds", () => {
    const r = composeDungeon(db, { worldId: "nonsense", seed: "x", anchorX: 0, anchorZ: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.templateKind, "generic_ruin");
  });

  it("listInWorld filters by world + status", () => {
    const ds = listInWorld(db, "fantasy");
    assert.ok(ds.length >= 1);
    for (const d of ds) {
      assert.equal(d.world_id, "fantasy");
      assert.equal(d.status, "active");
    }
  });
});

describe("enterRoom + loot rolling", () => {
  let dungeonId;
  before(() => {
    const r = composeDungeon(db, { worldId: "superhero", seed: "loot-test", depthLevel: 3 });
    dungeonId = r.dungeonId;
  });

  it("first enter rolls loot in non-empty rooms", () => {
    // Find the boss room — it always rolls 3 items.
    const d = getDungeon(db, dungeonId);
    const bossIdx = d.rooms.find((r) => r.is_boss === 1).room_idx;
    const r = enterRoom(db, dungeonId, bossIdx, "U_player");
    assert.equal(r.ok, true);
    assert.equal(r.room.is_boss, 1);
    assert.ok(r.lootRolled.length >= 1, `boss room rolls ≥1 item, got ${r.lootRolled.length}`);
    for (const item of r.lootRolled) {
      assert.ok(item.item.weapon_class);
      assert.ok(item.item.rarity);
      // Superhero template has energy/laser/plasma weapons.
      assert.ok(/energy_rifle|plasma|laser_pistol|tech_gun|blaster/.test(item.item.weapon_class));
    }
  });

  it("second enter doesn't re-roll loot", () => {
    const d = getDungeon(db, dungeonId);
    const bossIdx = d.rooms.find((r) => r.is_boss === 1).room_idx;
    const r = enterRoom(db, dungeonId, bossIdx, "U_player");
    assert.equal(r.ok, true);
    assert.equal(r.lootRolled.length, 0);
    assert.ok(r.loot.length >= 1, "existing loot still surfaces");
  });

  it("claimLoot transfers to player_inventory", () => {
    const d = getDungeon(db, dungeonId);
    const bossIdx = d.rooms.find((r) => r.is_boss === 1).room_idx;
    const r = enterRoom(db, dungeonId, bossIdx, "U_player");
    const unclaimed = r.loot.find((l) => !l.claimedBy);
    if (!unclaimed) return; // already claimed in a previous test ordering
    const c = claimLoot(db, unclaimed.id, "U_player", { worldId: "superhero" });
    assert.equal(c.ok, true);
    const inv = db.prepare(`SELECT * FROM player_inventory WHERE item_id = ?`).get(c.item.item_id);
    assert.ok(inv);
    assert.equal(inv.user_id, "U_player");
    assert.equal(inv.world_id, "superhero");
  });

  it("rejects re-claim of already-claimed loot", () => {
    const d = getDungeon(db, dungeonId);
    const bossIdx = d.rooms.find((r) => r.is_boss === 1).room_idx;
    const r = enterRoom(db, dungeonId, bossIdx, "U_player");
    const claimed = r.loot.find((l) => l.claimedBy);
    if (!claimed) return;
    const c = claimLoot(db, claimed.id, "U_other");
    assert.equal(c.ok, false);
    assert.equal(c.reason, "already_claimed");
  });
});

describe("dungeon-spawner-cycle", () => {
  it("spawns dungeons in active worlds", async () => {
    // Seed an active world.
    db.prepare(`INSERT INTO world_visits (id, user_id, world_id) VALUES ('v_e', 'U_x', 'tunya')`).run();
    let emits = 0;
    globalThis._concordRealtimeEmit = (event) => { if (event === "world:dungeon-spawned") emits++; };
    const r = await runDungeonSpawnerCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.spawned >= 1);
    assert.ok(emits >= 1);
    delete globalThis._concordRealtimeEmit;
  });

  it("respects MAX_ACTIVE_PER_WORLD cap", async () => {
    // Carpet-bomb tunya with dungeons up to the cap.
    for (let i = 0; i < 6; i++) {
      composeDungeon(db, { worldId: "tunya", seed: `cap-${i}` });
    }
    const r = await runDungeonSpawnerCycle({ db });
    // We should see atCap >= 1 because tunya is full.
    assert.ok(r.atCap >= 1, `expected atCap ≥ 1, got ${r.atCap}`);
  });

  it("respects kill switch", async () => {
    process.env.CONCORD_DUNGEON_SPAWNER = "0";
    try {
      const r = await runDungeonSpawnerCycle({ db });
      assert.equal(r.reason, "disabled");
    } finally { delete process.env.CONCORD_DUNGEON_SPAWNER; }
  });
});

describe("RARITY_TIERS export", () => {
  it("has 5 tiers", () => {
    assert.equal(_internal.RARITY_TIERS.length, 5);
    assert.deepEqual(_internal.RARITY_TIERS, ["common", "uncommon", "rare", "epic", "legendary"]);
  });
});
