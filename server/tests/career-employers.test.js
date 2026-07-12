// WAVE JOBS — employer discovery (server/lib/career-employers.js).
//
// Pins that findEmployers derives "is this NPC hiring" ONLY from a real,
// already-seeded world_npcs.archetype value via the fixed
// ARCHETYPE_HIRES_FOR table — never fabricates a track for an archetype
// that isn't mapped (the honesty requirement from
// docs/lens-specs/careers-capability-map.md checklist item 6) — and that the
// offered tier is derived from the NPC's own real `level` column, not
// invented.
//
// Run: node --test tests/career-employers.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { findEmployers, tracksForArchetype, ARCHETYPE_HIRES_FOR } from "../lib/career-employers.js";

function seedNpc(db, { id, worldId = "w1", archetype = "generic", level = 1, isDead = 0, name = null, faction = null }) {
  db.prepare(`
    INSERT INTO world_npcs (id, world_id, archetype, level, is_dead, faction, state)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, worldId, archetype, level, isDead, faction, name ? JSON.stringify({ name }) : "{}");
}

describe("tracksForArchetype — the honesty table", () => {
  it("maps well-known archetypes to real professions.js track ids", () => {
    assert.deepEqual(tracksForArchetype("trader"), ["trader"]);
    assert.deepEqual(tracksForArchetype("healer"), ["medic"]);
    assert.deepEqual(tracksForArchetype("TRADER"), ["trader"], "case-insensitive");
  });

  it("an unmapped/flavor archetype is honestly excluded, not guessed", () => {
    assert.deepEqual(tracksForArchetype("vampire_noble"), []);
    assert.deepEqual(tracksForArchetype("syndicate_matriarch"), []);
    assert.deepEqual(tracksForArchetype(undefined), []);
    assert.deepEqual(tracksForArchetype(""), []);
  });

  it("every mapped track id is a real professions.js track", async () => {
    const { isTrack } = await import("../lib/professions.js");
    for (const tracks of Object.values(ARCHETYPE_HIRES_FOR)) {
      for (const t of tracks) assert.ok(isTrack(t), `${t} must be a real track`);
    }
  });
});

describe("findEmployers — read-only NPC employer directory", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("returns [] with no db and [] for an unknown trackId (fail-closed)", () => {
    assert.deepEqual(findEmployers(null, { worldId: "w1" }), []);
    seedNpc(db, { id: "n1", archetype: "trader" });
    assert.deepEqual(findEmployers(db, { worldId: "w1", trackId: "not_a_real_track" }), []);
  });

  it("includes NPCs whose archetype maps to a track, excludes unmapped archetypes (no fabrication)", () => {
    seedNpc(db, { id: "trader1", archetype: "trader", level: 5, name: "Old Mira" });
    seedNpc(db, { id: "flavor1", archetype: "vampire_noble", level: 5 }); // not in ARCHETYPE_HIRES_FOR
    seedNpc(db, { id: "dead1", archetype: "trader", level: 5, isDead: 1 }); // dead — excluded regardless

    const employers = findEmployers(db, { worldId: "w1" });
    const ids = employers.map((e) => e.npcId);
    assert.ok(ids.includes("trader1"), "mapped, living NPC included");
    assert.ok(!ids.includes("flavor1"), "unmapped archetype must NOT appear — no invented track");
    assert.ok(!ids.includes("dead1"), "dead NPCs never appear as employers");

    const traderEntry = employers.find((e) => e.npcId === "trader1");
    assert.equal(traderEntry.trackId, "trader");
    assert.equal(traderEntry.name, "Old Mira", "name derives from the real state JSON, not fabricated");
    assert.equal(traderEntry.category, "Mercantile");
  });

  it("filters to the requested trackId only", () => {
    seedNpc(db, { id: "scholar1", archetype: "scholar", level: 4 }); // maps to ["mage","detective"]
    const forMage = findEmployers(db, { worldId: "w1", trackId: "mage" });
    const forDetective = findEmployers(db, { worldId: "w1", trackId: "detective" });
    const forChef = findEmployers(db, { worldId: "w1", trackId: "chef" });
    assert.equal(forMage.length, 1);
    assert.equal(forMage[0].trackId, "mage");
    assert.equal(forDetective.length, 1);
    assert.equal(forDetective[0].trackId, "detective");
    assert.equal(forChef.length, 0, "scholar doesn't hire for chef");
  });

  it("scopes to the requested world only", () => {
    seedNpc(db, { id: "w1trader", worldId: "w1", archetype: "trader", level: 3 });
    seedNpc(db, { id: "w2trader", worldId: "w2", archetype: "trader", level: 3 });
    const inW1 = findEmployers(db, { worldId: "w1" }).map((e) => e.npcId);
    assert.ok(inW1.includes("w1trader"));
    assert.ok(!inW1.includes("w2trader"));
  });

  it("derives offered tier from the NPC's real level column (clamp(ceil(level/3), 1, 10))", () => {
    seedNpc(db, { id: "lo", archetype: "guard", level: 1 });
    seedNpc(db, { id: "mid", archetype: "guard", level: 15 });
    seedNpc(db, { id: "hi", archetype: "guard", level: 999 });
    const byId = Object.fromEntries(findEmployers(db, { worldId: "w1", trackId: "guard" }).map((e) => [e.npcId, e]));
    assert.equal(byId.lo.tier, 1);
    assert.equal(byId.mid.tier, 5); // ceil(15/3) = 5
    assert.equal(byId.hi.tier, 10); // clamped at MAX_TIER
    assert.ok(byId.hi.suggestedWage > byId.lo.suggestedWage, "higher tier suggests a higher wage (professions.js tierInfo, not invented)");
  });

  it("respects the limit cap", () => {
    for (let i = 0; i < 10; i++) seedNpc(db, { id: `t${i}`, archetype: "trader", level: 2 });
    const capped = findEmployers(db, { worldId: "w1", limit: 3 });
    assert.equal(capped.length, 3);
  });

  it("an archetype mapping to two tracks yields one entry per track when unfiltered", () => {
    seedNpc(db, { id: "eng1", archetype: "engineer", level: 3 }); // ["smith","hacker"]
    const all = findEmployers(db, { worldId: "w1" });
    const tracks = all.filter((e) => e.npcId === "eng1").map((e) => e.trackId).sort();
    assert.deepEqual(tracks, ["hacker", "smith"]);
  });
});
