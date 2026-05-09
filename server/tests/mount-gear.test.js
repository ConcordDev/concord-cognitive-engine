/**
 * Tier-2 contract tests for Concordia Mount System Phase B3.
 *
 * Pinned:
 *   - migration 144: ALTER adds saddle/bridle/barding columns; idempotent re-run.
 *   - validateMountGear: slot enum, stat_mod bounds, weight_kg > 0, material_list shape.
 *   - equipGear: ownership + eligibility + slot match + species_compat + idempotent same-DTU
 *     + replacing previous slot + invalid slot rejection.
 *   - unequipGear: idempotent on empty slot.
 *   - computeMountStats: folds base + gear, clamps multipliers to [0.4, 1.8],
 *     clamps comfort to [0, 30].
 *   - getEquippedGear: shape per slot.
 *
 * Run: node --test tests/mount-gear.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig104 from "../migrations/104_player_companions.js";
import * as mig142 from "../migrations/142_mount_substrate.js";
import * as mig144 from "../migrations/144_mount_gear.js";
import {
  validateMountGear,
  MOUNT_GEAR_SLOTS,
} from "../lib/dtu-validators/mount-gear-validators.js";
import {
  equipGear,
  unequipGear,
  computeMountStats,
  getEquippedGear,
} from "../lib/mount-gear.js";
import { seedMountSpecies } from "../lib/ecosystem/mount-species-seeder.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  // Minimal world_npcs for species_id lookup.
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      archetype TEXT NOT NULL,
      x REAL, y REAL, z REAL,
      is_dead INTEGER DEFAULT 0
    );
  `);
  // Minimal `dtus` table for the gear DTU lookup path.
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      creator_id TEXT,
      meta_json TEXT
    );
  `);
  mig104.up(db);
  mig142.up(db);
  mig144.up(db);
  seedMountSpecies(db);
});

afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

function _seedCreature(id, speciesId) {
  db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, x, y, z) VALUES (?, 'concordia-hub', ?, 0, 0, 0)`)
    .run(id, `creature:${speciesId}`);
}

function _seedCompanion(id, ownerId, creatureId, mountEligible = 1) {
  db.prepare(`
    INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible, tame_bond, loyalty)
    VALUES (?, ?, ?, ?, 'concordia-hub', ?, 100, 50)
  `).run(id, ownerId, creatureId, "Pet", mountEligible);
}

function _seedGearDtu(id, meta, kind = "mount_gear") {
  db.prepare(`INSERT INTO dtus (id, kind, creator_id, meta_json) VALUES (?, ?, 'alice', ?)`)
    .run(id, kind, JSON.stringify(meta));
}

describe("migration 144 — ALTER", () => {
  it("adds saddle/bridle/barding columns idempotently", () => {
    const cols = db.prepare("PRAGMA table_info(player_companions)").all().map(c => c.name);
    for (const k of ["saddle_dtu_id", "bridle_dtu_id", "barding_dtu_id"]) {
      assert.ok(cols.includes(k), `missing ${k}`);
    }
    let threw = false;
    try { mig144.up(db); } catch { threw = true; }
    assert.equal(threw, false);
  });
});

describe("validateMountGear", () => {
  const goodMeta = {
    slot: "saddle",
    species_compat: ["warhorse"],
    weight_kg: 8,
    weight_rating_kg: 200,
    stat_mods: { speed: 0.1, stamina: 0.05, comfort: 5 },
    material_list: [{ material_id: "leather", qty: 4 }, { material_id: "iron", qty: 1 }],
    style_tags: ["tooled", "studded"],
  };

  it("accepts a well-formed recipe", () => {
    const r = validateMountGear({ kind: "mount_gear", meta: goodMeta });
    assert.equal(r.ok, true);
  });

  it("rejects unknown slot", () => {
    const r = validateMountGear({ kind: "mount_gear", meta: { ...goodMeta, slot: "hat" } });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(";"), /slot must be one of/);
  });

  it("rejects out-of-bounds stat_mods", () => {
    const r = validateMountGear({ kind: "mount_gear", meta: { ...goodMeta, stat_mods: { speed: 0.9 } } });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(";"), /out of bounds/);
  });

  it("rejects non-positive weights", () => {
    const r = validateMountGear({ kind: "mount_gear", meta: { ...goodMeta, weight_kg: 0 } });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(";"), /weight_kg/);
  });

  it("rejects malformed material_list", () => {
    const r = validateMountGear({ kind: "mount_gear", meta: { ...goodMeta, material_list: [{ qty: 1 }] } });
    assert.equal(r.ok, false);
  });

  it("rejects wrong DTU kind", () => {
    const r = validateMountGear({ kind: "blueprint", meta: goodMeta });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "wrong_kind");
  });

  it("MOUNT_GEAR_SLOTS exposes the canonical set", () => {
    assert.equal(MOUNT_GEAR_SLOTS.size, 3);
    for (const s of ["saddle", "bridle", "barding"]) assert.ok(MOUNT_GEAR_SLOTS.has(s));
  });
});

describe("equipGear", () => {
  beforeEach(() => {
    _seedCreature("crH", "warhorse");
    _seedCompanion("c1", "alice", "crH", 1);
    _seedGearDtu("g_saddle", {
      slot: "saddle", species_compat: [],
      weight_kg: 8, weight_rating_kg: 200,
      stat_mods: { speed: 0.1, stamina: 0.05, comfort: 6 },
      material_list: [{ material_id: "leather", qty: 4 }],
      style_tags: ["tooled"],
    });
  });

  it("equips a saddle into the saddle slot", () => {
    const r = equipGear(db, { mountId: "c1", gearDtuId: "g_saddle", slot: "saddle", ownerId: "alice" });
    assert.equal(r.ok, true);
    assert.equal(r.replaced, null);
    const row = db.prepare(`SELECT saddle_dtu_id FROM player_companions WHERE id = 'c1'`).get();
    assert.equal(row.saddle_dtu_id, "g_saddle");
  });

  it("rejects non-owner", () => {
    const r = equipGear(db, { mountId: "c1", gearDtuId: "g_saddle", slot: "saddle", ownerId: "bob" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });

  it("rejects unknown DTU id", () => {
    const r = equipGear(db, { mountId: "c1", gearDtuId: "ghost", slot: "saddle", ownerId: "alice" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "gear_dtu_not_found");
  });

  it("rejects DTU with wrong kind", () => {
    _seedGearDtu("g_blueprint", { slot: "saddle", weight_kg: 1, weight_rating_kg: 1, material_list: [], species_compat: [] }, "blueprint");
    const r = equipGear(db, { mountId: "c1", gearDtuId: "g_blueprint", slot: "saddle", ownerId: "alice" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "wrong_kind");
  });

  it("rejects slot mismatch", () => {
    const r = equipGear(db, { mountId: "c1", gearDtuId: "g_saddle", slot: "bridle", ownerId: "alice" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "slot_mismatch");
  });

  it("rejects when species_compat excludes the mount's species", () => {
    _seedGearDtu("g_chimera_saddle", {
      slot: "saddle", species_compat: ["chimera"],
      weight_kg: 12, weight_rating_kg: 250,
      stat_mods: {}, material_list: [{ material_id: "obsidian", qty: 3 }],
      style_tags: [],
    });
    const r = equipGear(db, { mountId: "c1", gearDtuId: "g_chimera_saddle", slot: "saddle", ownerId: "alice" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "species_incompatible");
  });

  it("replaces existing gear in the same slot", () => {
    equipGear(db, { mountId: "c1", gearDtuId: "g_saddle", slot: "saddle", ownerId: "alice" });
    _seedGearDtu("g_saddle_2", {
      slot: "saddle", species_compat: [],
      weight_kg: 5, weight_rating_kg: 150, stat_mods: {},
      material_list: [{ material_id: "leather", qty: 2 }], style_tags: [],
    });
    const r = equipGear(db, { mountId: "c1", gearDtuId: "g_saddle_2", slot: "saddle", ownerId: "alice" });
    assert.equal(r.ok, true);
    assert.equal(r.replaced, "g_saddle");
  });

  it("idempotent on equipping the same DTU twice (replaced=null on no-op)", () => {
    equipGear(db, { mountId: "c1", gearDtuId: "g_saddle", slot: "saddle", ownerId: "alice" });
    const r2 = equipGear(db, { mountId: "c1", gearDtuId: "g_saddle", slot: "saddle", ownerId: "alice" });
    assert.equal(r2.ok, true);
    assert.equal(r2.replaced, null);
  });

  it("rejects invalid slot string", () => {
    const r = equipGear(db, { mountId: "c1", gearDtuId: "g_saddle", slot: "wing", ownerId: "alice" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_slot");
  });
});

describe("unequipGear", () => {
  beforeEach(() => {
    _seedCreature("crH", "warhorse");
    _seedCompanion("c1", "alice", "crH", 1);
    _seedGearDtu("g_saddle", {
      slot: "saddle", species_compat: [],
      weight_kg: 8, weight_rating_kg: 200, stat_mods: {},
      material_list: [{ material_id: "leather", qty: 1 }], style_tags: [],
    });
    equipGear(db, { mountId: "c1", gearDtuId: "g_saddle", slot: "saddle", ownerId: "alice" });
  });

  it("clears the slot", () => {
    const r = unequipGear(db, { mountId: "c1", slot: "saddle", ownerId: "alice" });
    assert.equal(r.ok, true);
    assert.equal(r.had, true);
    const row = db.prepare(`SELECT saddle_dtu_id FROM player_companions WHERE id = 'c1'`).get();
    assert.equal(row.saddle_dtu_id, null);
  });

  it("idempotent on empty slot", () => {
    const r = unequipGear(db, { mountId: "c1", slot: "bridle", ownerId: "alice" });
    assert.equal(r.ok, true);
    assert.equal(r.had, false);
  });

  it("rejects non-owner", () => {
    const r = unequipGear(db, { mountId: "c1", slot: "saddle", ownerId: "bob" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });
});

describe("computeMountStats", () => {
  beforeEach(() => {
    _seedCreature("crH", "warhorse");
    _seedCompanion("c1", "alice", "crH", 1);
  });

  it("returns base stats with no gear", () => {
    const s = computeMountStats(db, "c1");
    assert.ok(s);
    assert.equal(s.speciesId, "warhorse");
    assert.equal(s.modifiers.speed, 0);
    assert.equal(s.equipped.length, 0);
    assert.equal(s.effective.speedMps, s.base.speedMps);
  });

  it("folds saddle speed bonus into effective speed", () => {
    _seedGearDtu("g_speedy", {
      slot: "saddle", species_compat: [],
      weight_kg: 5, weight_rating_kg: 150,
      stat_mods: { speed: 0.2 },
      material_list: [{ material_id: "leather", qty: 1 }], style_tags: [],
    });
    equipGear(db, { mountId: "c1", gearDtuId: "g_speedy", slot: "saddle", ownerId: "alice" });
    const s = computeMountStats(db, "c1");
    assert.ok(s.effective.speedMps > s.base.speedMps * 1.15);
    assert.ok(s.effective.speedMps < s.base.speedMps * 1.25);
  });

  it("clamps multipliers to [0.4, 1.8]", () => {
    // Three slots × +0.5 each = +1.5, clamped to ×1.8.
    for (const slot of ["saddle", "bridle", "barding"]) {
      _seedGearDtu(`g_max_${slot}`, {
        slot, species_compat: [],
        weight_kg: 3, weight_rating_kg: 100,
        stat_mods: { speed: 0.5 },
        material_list: [{ material_id: "x", qty: 1 }], style_tags: [],
      });
      equipGear(db, { mountId: "c1", gearDtuId: `g_max_${slot}`, slot, ownerId: "alice" });
    }
    const s = computeMountStats(db, "c1");
    assert.equal(s.modifiers.speed, 1.5);
    assert.ok(Math.abs(s.effective.speedMps / s.base.speedMps - 1.8) < 1e-9);
  });

  it("clamps comfort to [0, 30]", () => {
    for (const slot of ["saddle", "bridle", "barding"]) {
      _seedGearDtu(`g_cf_${slot}`, {
        slot, species_compat: [],
        weight_kg: 3, weight_rating_kg: 100,
        stat_mods: { comfort: 10 },
        material_list: [{ material_id: "x", qty: 1 }], style_tags: [],
      });
      equipGear(db, { mountId: "c1", gearDtuId: `g_cf_${slot}`, slot, ownerId: "alice" });
    }
    const s = computeMountStats(db, "c1");
    assert.equal(s.effective.comfort, 30);
  });
});

describe("getEquippedGear", () => {
  it("returns null per slot when nothing equipped", () => {
    _seedCreature("crH", "warhorse");
    _seedCompanion("c1", "alice", "crH", 1);
    const g = getEquippedGear(db, "c1");
    assert.equal(g.saddle, null);
    assert.equal(g.bridle, null);
    assert.equal(g.barding, null);
  });

  it("returns the metadata block for equipped slots", () => {
    _seedCreature("crH", "warhorse");
    _seedCompanion("c1", "alice", "crH", 1);
    _seedGearDtu("g", {
      slot: "saddle", species_compat: [],
      weight_kg: 4, weight_rating_kg: 100,
      stat_mods: { speed: 0.05 },
      material_list: [{ material_id: "leather", qty: 1 }], style_tags: ["tooled"],
    });
    equipGear(db, { mountId: "c1", gearDtuId: "g", slot: "saddle", ownerId: "alice" });
    const out = getEquippedGear(db, "c1");
    assert.equal(out.saddle.dtuId, "g");
    assert.equal(out.saddle.weight_kg, 4);
    assert.deepEqual(out.saddle.style_tags, ["tooled"]);
  });
});
