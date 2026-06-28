/**
 * Tier-2 contract test for the appearance domain.
 *
 * Pins:
 *   - appearance.for_npc reads NPC world_id + faction + archetype
 *   - faction's authored `visual` block surfaces in the result
 *   - the Three Above All get heroMesh:true
 *   - non-canon NPC ids return ok:false reason:not_found
 *   - appearance.for_world bulk-reads all non-creature NPCs
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// Register the macros into a captive registry so we can call them.
const _registry = new Map();
function register(domain, name, handler) {
  _registry.set(`${domain}.${name}`, handler);
}

import("../domains/appearance.js").then((mod) => {
  mod.default(register);
});

function setupDb() {
  const db = new Database(":memory:");
  // Schema mirrors migration 189 (Phase T): world_npcs now carries
  // home_world_id, and npc_residency LEFT JOINs in appearance.for_world.
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      faction TEXT, archetype TEXT, is_dead INTEGER DEFAULT 0,
      home_world_id TEXT
    );
    CREATE TABLE npc_residency (
      npc_id TEXT PRIMARY KEY,
      home_world_id TEXT NOT NULL,
      current_world_id TEXT
    );
  `);
  db.prepare(`INSERT INTO world_npcs (id, world_id, faction, archetype) VALUES (?, ?, ?, ?)`)
    .run("iyatte_sanguire", "tunya", "sandrun_sanguire", "warrior");
  db.prepare(`INSERT INTO world_npcs (id, world_id, faction, archetype) VALUES (?, ?, ?, ?)`)
    .run("sovereign_first_refusal", "concordia-hub", null, "legend");
  db.prepare(`INSERT INTO world_npcs (id, world_id, faction, archetype) VALUES (?, ?, ?, ?)`)
    .run("anon_civ", "tunya", "dinye", "civilian");
  return db;
}

describe("appearance.for_npc", () => {
  let db;
  beforeEach(async () => {
    db = setupDb();
    // Wait for the module to register (the dynamic import above is async)
    for (let i = 0; i < 50; i++) {
      if (_registry.has("appearance.for_npc")) break;
      await new Promise((r) => {
        setTimeout(r, 20);
      });
    }
  });

  it("returns themeId derived from world_id", async () => {
    const handler = _registry.get("appearance.for_npc");
    const r = await handler({ db }, { npcId: "iyatte_sanguire" });
    assert.equal(r.ok, true);
    assert.equal(r.worldId, "tunya");
    assert.equal(r.themeId, "tunya");
    assert.equal(r.factionId, "sandrun_sanguire");
    assert.equal(r.archetype, "warrior");
  });

  it("surfaces the authored faction visual block", async () => {
    const handler = _registry.get("appearance.for_npc");
    const r = await handler({ db }, { npcId: "iyatte_sanguire" });
    assert.ok(r.factionVisual, "expected factionVisual hydrated from content/world/tunya/factions.json");
    assert.match(r.factionVisual.primary_color || "", /^#[0-9a-fA-F]{6}$/);
  });

  it("marks the Three Above All as heroMesh", async () => {
    const handler = _registry.get("appearance.for_npc");
    const r = await handler({ db }, { npcId: "sovereign_first_refusal" });
    assert.equal(r.ok, true);
    assert.equal(r.heroMesh, true);
    assert.equal(r.themeId, "concordia-hub");
  });

  it("returns not_found for unknown ids", async () => {
    const handler = _registry.get("appearance.for_npc");
    const r = await handler({ db }, { npcId: "ghost_xyz" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found");
  });

  it("missing db short-circuits with no_db", async () => {
    const handler = _registry.get("appearance.for_npc");
    const r = await handler({}, { npcId: "x" });
    assert.equal(r.reason, "no_db");
  });
});

describe("appearance.options", () => {
  beforeEach(async () => {
    for (let i = 0; i < 50; i++) {
      if (_registry.has("appearance.options")) break;
      await new Promise((r) => {
        setTimeout(r, 20);
      });
    }
  });

  const REAL_SLOTS = [
    "body", "hair", "face", "top", "bottom", "shoes",
    "hat", "glasses", "back", "hand", "particle",
  ];
  // A spot-check of REAL renderable enum values from character-schema.ts.
  const REAL_VALUES = {
    body: ["slim", "average", "legend"],
    hair: ["bald", "undercut", "mohawk"],
    face: ["round", "soft"],
    top: ["shirt", "synth-jacket", "robe"],
    bottom: ["pants", "cargo"],
    shoes: ["sandal", "boot", "barefoot"],
    hat: ["circlet", "crown", "visor"],
  };

  it("returns a real per-slot catalog with every canonical slot", async () => {
    const handler = _registry.get("appearance.options");
    const r = await handler({});
    assert.equal(r.ok, true);
    assert.ok(r.slots, "expected slots map");
    for (const s of REAL_SLOTS) {
      assert.ok(Array.isArray(r.slots[s]), `slot ${s} should be an array`);
      assert.ok(r.slots[s].length > 0, `slot ${s} should be non-empty`);
    }
  });

  it("every option is a real renderable enum value with a humanized name", async () => {
    const handler = _registry.get("appearance.options");
    const r = await handler({});
    for (const [slot, expected] of Object.entries(REAL_VALUES)) {
      const ids = r.slots[slot].map((o) => o.assetId);
      for (const v of expected) {
        assert.ok(ids.includes(v), `slot ${slot} should include real enum '${v}'`);
      }
      for (const o of r.slots[slot]) {
        assert.equal(typeof o.assetId, "string");
        assert.ok(o.name && typeof o.name === "string", "every option needs a name");
        // NO fabricated price field anywhere.
        assert.equal(o.price, undefined, "options must NOT carry a fabricated price");
      }
    }
  });

  it("returns real skin tones + color swatches (genuine hex)", async () => {
    const handler = _registry.get("appearance.options");
    const r = await handler({});
    assert.ok(Array.isArray(r.skinTones) && r.skinTones.length > 0);
    assert.ok(Array.isArray(r.colors) && r.colors.length > 0);
    for (const t of r.skinTones) assert.match(t.color, /^#[0-9a-fA-F]{6}$/);
    for (const c of r.colors) assert.match(c.color, /^#[0-9a-fA-F]{6}$/);
  });

  it("is deterministic — repeated calls return identical catalogs", async () => {
    const handler = _registry.get("appearance.options");
    const a = await handler({});
    const b = await handler({});
    assert.deepEqual(a.slots, b.slots);
    assert.deepEqual(a.skinTones, b.skinTones);
    assert.deepEqual(a.colors, b.colors);
  });

  it("works without a db/actor (base set), and surfaces saved outfits when present", async () => {
    const handler = _registry.get("appearance.options");
    const base = await handler({});
    assert.deepEqual(base.savedOutfits, []);

    const db = setupDb();
    db.exec(`CREATE TABLE saved_outfits (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );`);
    db.prepare(`INSERT INTO saved_outfits (id, user_id, name) VALUES (?, ?, ?)`)
      .run("of_1", "u1", "Forge Garb");
    const r = await handler({ db, actor: { userId: "u1" } });
    assert.equal(r.ok, true);
    assert.equal(r.savedOutfits.length, 1);
    assert.equal(r.savedOutfits[0].assetId, "of_1");
    assert.equal(r.savedOutfits[0].owned, true);
  });
});

describe("appearance.for_world", () => {
  let db;
  beforeEach(async () => {
    db = setupDb();
    for (let i = 0; i < 50; i++) {
      if (_registry.has("appearance.for_world")) break;
      await new Promise((r) => {
        setTimeout(r, 20);
      });
    }
  });

  it("bulk-lists NPCs in a world", async () => {
    const handler = _registry.get("appearance.for_world");
    const r = await handler({ db }, { worldId: "tunya" });
    assert.equal(r.ok, true);
    assert.equal(r.themeId, "tunya");
    assert.ok(r.npcs.length >= 2);
    const ids = r.npcs.map((n) => n.npcId);
    assert.ok(ids.includes("iyatte_sanguire"));
    assert.ok(ids.includes("anon_civ"));
  });
});
