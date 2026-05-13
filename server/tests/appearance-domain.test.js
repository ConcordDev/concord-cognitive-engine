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
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      faction TEXT, archetype TEXT, is_dead INTEGER DEFAULT 0
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
      await new Promise((r) => setTimeout(r, 20));
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

describe("appearance.for_world", () => {
  let db;
  beforeEach(async () => {
    db = setupDb();
    for (let i = 0; i < 50; i++) {
      if (_registry.has("appearance.for_world")) break;
      await new Promise((r) => setTimeout(r, 20));
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
