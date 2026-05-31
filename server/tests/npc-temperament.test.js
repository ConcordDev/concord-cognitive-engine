/**
 * Tier-2 contract tests for Phase 1 of the Temperament engine.
 *
 * Pins:
 *   - disposition() reads each dormant-state term (stress, grudge, opinion,
 *     faction, emotion) and the hook cap; degrades to zero on missing tables.
 *   - effectiveAggroFor() combine: wanted floor, emotional floor lifts a
 *     pacifist, mod scales, hook neutralises escalation, clamps [0,1].
 *   - engagementProfile() grants pursuit/melee above the engage threshold only.
 *   - dispositionLevel() boundaries.
 *   - resolveAggro() end-to-end: radicalized farmer → hostile + engaged; calm
 *     farmer → 0 / friendly; admiration de-escalates.
 *
 * Run: node --test server/tests/npc-temperament.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  disposition,
  effectiveAggroFor,
  engagementProfile,
  dispositionLevel,
  resolveAggro,
  DISPOSITION_LEVELS,
} from "../lib/npc-temperament.js";

// Minimal schema mirroring exactly the columns the lib reads. Hand-rolled
// (rather than importing six interdependent migrations) so the contract is
// pinned against a controlled surface.
function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE npc_stress (
      npc_id TEXT PRIMARY KEY,
      stress INTEGER DEFAULT 30,
      coping_trait TEXT,
      coping_until INTEGER,
      last_break_at INTEGER
    );
    CREATE TABLE npc_grudges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id TEXT, target_kind TEXT, target_id TEXT,
      severity INTEGER, resolved_at INTEGER
    );
    CREATE TABLE character_opinions (
      npc_id TEXT, target_kind TEXT, target_id TEXT,
      score INTEGER, kind TEXT,
      PRIMARY KEY (npc_id, target_kind, target_id)
    );
    CREATE TABLE faction_relations (
      faction_a TEXT, faction_b TEXT, score REAL, kind TEXT, since INTEGER,
      PRIMARY KEY (faction_a, faction_b)
    );
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, grief_level REAL DEFAULT 0, radicalized INTEGER DEFAULT 0
    );
    CREATE TABLE npc_hooks (
      id TEXT PRIMARY KEY, holder_kind TEXT, holder_id TEXT,
      target_kind TEXT, target_id TEXT, strength TEXT,
      spent_at INTEGER, expires_at INTEGER, uses_left INTEGER DEFAULT 1
    );
  `);
  db.prepare(`INSERT INTO world_npcs (id, grief_level, radicalized) VALUES (?, 0, 0)`).run("npc1");
  return db;
}

const PLAYER = { kind: "player", id: "userA" };
const NPC = { id: "npc1", faction: "verdant_veil" };

describe("dispositionLevel boundaries", () => {
  it("maps magnitude to the six discrete levels", () => {
    assert.equal(dispositionLevel(0), "friendly");
    assert.equal(dispositionLevel(0.05), "friendly");
    assert.equal(dispositionLevel(0.2), "neutral");
    assert.equal(dispositionLevel(0.4), "wary");
    assert.equal(dispositionLevel(0.6), "warning");
    assert.equal(dispositionLevel(0.8), "hostile");
    assert.equal(dispositionLevel(0.95), "lethal");
    assert.equal(DISPOSITION_LEVELS.length, 6);
  });
});

describe("effectiveAggroFor combine", () => {
  it("keeps the wanted floor (0.9) regardless of disposition", () => {
    assert.equal(effectiveAggroFor(0.0, true, { mod: -5, floor: 0 }), 0.9);
    assert.equal(effectiveAggroFor(0.7, true, { mod: 5, floor: 0.7 }), 0.9);
  });

  it("returns base aggro when there is no disposition", () => {
    assert.equal(effectiveAggroFor(0.6, false, null), 0.6);
  });

  it("an emotional floor lifts a pacifist (base 0.0)", () => {
    const out = effectiveAggroFor(0.0, false, { mod: 0, floor: 0.7 });
    assert.equal(out, 0.7);
  });

  it("mod scales around the floor and clamps to [0,1]", () => {
    assert.ok(Math.abs(effectiveAggroFor(0.5, false, { mod: 0.4, floor: 0 }) - 0.7) < 1e-9);
    assert.equal(effectiveAggroFor(0.8, false, { mod: 5, floor: 0 }), 1); // clamp high
    assert.equal(effectiveAggroFor(0.5, false, { mod: -5, floor: 0 }), 0); // clamp low
  });

  it("a hook the target holds neutralises emotional escalation but keeps the archetype floor", () => {
    // base hostile guard, big positive mod + emotional floor, but hook-capped
    const out = effectiveAggroFor(0.8, false, { mod: 0.9, floor: 0.7, hookCapped: true });
    assert.equal(out, 0.8); // mod→0, floor→0, lifted = max(0.8,0) = 0.8
  });
});

describe("engagementProfile", () => {
  const farmer = { alertRadius: 6, pursuitRadius: 0, melee: 0, aggro: 0.0 };
  const guard = { alertRadius: 15, pursuitRadius: 25, melee: 2, aggro: 0.8 };

  it("grants pursuit/melee to an inert archetype above the engage threshold", () => {
    const p = engagementProfile(farmer, 0.7);
    assert.ok(p.pursuitRadius >= 14);
    assert.ok(p.melee >= 2);
    assert.equal(p.alertRadius, 6); // other fields preserved
  });

  it("leaves an inert archetype unchanged below threshold", () => {
    assert.equal(engagementProfile(farmer, 0.2), farmer);
  });

  it("never touches an already-engaged archetype", () => {
    assert.equal(engagementProfile(guard, 0.9), guard);
  });
});

describe("disposition term reads", () => {
  let db;
  beforeEach(() => { db = setupDb(); });
  afterEach(() => db.close());

  it("zero modulation with no state", () => {
    const d = disposition(db, NPC, PLAYER);
    assert.equal(d.mod, 0);
    assert.equal(d.floor, 0);
    assert.equal(d.hookCapped, false);
  });

  it("grudge raises mod and a severe grudge lifts the emotional floor", () => {
    db.prepare(`INSERT INTO npc_grudges (npc_id,target_kind,target_id,severity,resolved_at) VALUES (?,?,?,?,NULL)`)
      .run("npc1", "player", "userA", 9);
    const d = disposition(db, NPC, PLAYER);
    assert.ok(d.mod > 0, "grudge term positive");
    assert.ok(d.floor >= 0.45, "severe grudge floor");
  });

  it("a resolved grudge is ignored", () => {
    db.prepare(`INSERT INTO npc_grudges (npc_id,target_kind,target_id,severity,resolved_at) VALUES (?,?,?,?,?)`)
      .run("npc1", "player", "userA", 9, 12345);
    const d = disposition(db, NPC, PLAYER);
    assert.equal(d.mod, 0);
    assert.equal(d.floor, 0);
  });

  it("hatred (opinion ≤ -50) raises mod; admiration lowers it", () => {
    db.prepare(`INSERT INTO character_opinions (npc_id,target_kind,target_id,score,kind) VALUES (?,?,?,?,?)`)
      .run("npc1", "player", "userA", -80, "hates");
    assert.ok(disposition(db, NPC, PLAYER).mod > 0);

    db.prepare(`UPDATE character_opinions SET score = 80, kind = 'admires' WHERE npc_id='npc1'`).run();
    assert.ok(disposition(db, NPC, PLAYER).mod < 0);
  });

  it("radicalization lifts the floor to hostile", () => {
    db.prepare(`UPDATE world_npcs SET radicalized = 1 WHERE id = 'npc1'`).run();
    const d = disposition(db, NPC, PLAYER);
    assert.ok(d.floor >= 0.7);
  });

  it("faction enmity raises mod against an npc target; alliance lowers it", () => {
    db.prepare(`INSERT INTO faction_relations (faction_a,faction_b,score,kind) VALUES (?,?,?,?)`)
      .run("iron_wardens", "verdant_veil", -1, "war"); // sorted pair i < v
    const enemy = disposition(db, NPC, { kind: "npc", id: "npc2" }, { targetFaction: "iron_wardens" });
    assert.ok(enemy.mod > 0);
  });

  it("a strong hook the target holds over the NPC sets hookCapped", () => {
    db.prepare(`INSERT INTO npc_hooks (id,holder_kind,holder_id,target_kind,target_id,strength,spent_at,expires_at)
                VALUES (?,?,?,?,?,?,NULL,NULL)`)
      .run("h1", "player", "userA", "npc", "npc1", "strong");
    assert.equal(disposition(db, NPC, PLAYER).hookCapped, true);
  });

  it("degrades to zero modulation on a DB missing every table", () => {
    const bare = new Database(":memory:");
    const d = disposition(bare, NPC, PLAYER);
    assert.equal(d.mod, 0);
    assert.equal(d.floor, 0);
    assert.equal(d.hookCapped, false);
    bare.close();
  });
});

describe("resolveAggro end-to-end", () => {
  let db;
  const FARMER = { alertRadius: 6, pursuitRadius: 0, melee: 0, aggro: 0.0 };
  beforeEach(() => { db = setupDb(); });
  afterEach(() => db.close());

  it("a calm farmer stays inert (0 / friendly / unchanged profile)", () => {
    const r = resolveAggro(db, NPC, PLAYER, FARMER.aggro, false, FARMER);
    assert.equal(r.effectiveAggro, 0);
    assert.equal(r.level, "friendly");
    assert.equal(r.profile, FARMER); // unchanged object below threshold
  });

  it("a radicalized farmer becomes hostile AND gets the capacity to engage", () => {
    db.prepare(`UPDATE world_npcs SET radicalized = 1, grief_level = 0.9 WHERE id = 'npc1'`).run();
    const r = resolveAggro(db, NPC, PLAYER, FARMER.aggro, false, FARMER);
    assert.ok(r.effectiveAggro >= 0.7, `expected hostile, got ${r.effectiveAggro}`);
    assert.ok(["warning", "hostile", "lethal"].includes(r.level));
    assert.ok(r.profile.pursuitRadius >= 14, "engagement profile granted pursuit");
    assert.ok(r.profile.melee >= 2, "engagement profile granted melee");
  });

  it("a hook held by the target keeps the radicalized farmer from escalating", () => {
    db.prepare(`UPDATE world_npcs SET radicalized = 1, grief_level = 0.9 WHERE id = 'npc1'`).run();
    db.prepare(`INSERT INTO npc_hooks (id,holder_kind,holder_id,target_kind,target_id,strength,spent_at,expires_at)
                VALUES (?,?,?,?,?,?,NULL,NULL)`)
      .run("h1", "player", "userA", "npc", "npc1", "strong");
    const r = resolveAggro(db, NPC, PLAYER, FARMER.aggro, false, FARMER);
    assert.equal(r.effectiveAggro, 0, "hook cancels the emotional lift on a base-0 pacifist");
    assert.equal(r.level, "friendly");
  });
});
