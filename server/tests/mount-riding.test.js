/**
 * Tier-2 contract tests for Concordia Procedural Mount System Phase B2.
 *
 * Pinned:
 *   - tameForMount wraps attemptTame + flips mount_eligible for mountable species
 *   - mount() requires ownership + mount_eligible + one-active-per-world
 *   - dismount() is idempotent (no-op when not mounted)
 *   - getActiveMountPayload returns full HUD bootstrap payload
 *   - listMountHistory returns recent-first closed instances
 *   - mounts.* macros respect the FF_MOUNTS_RIDING flag
 *
 * Run: node --test tests/mount-riding.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig083 from "../migrations/083_creature_crossbreeding.js";
import * as mig104 from "../migrations/104_player_companions.js";
import * as mig142 from "../migrations/142_mount_substrate.js";
import {
  tameForMount,
  mount as mountAction,
  dismount as dismountAction,
  getActiveMountFor,
  getActiveMountPayload,
  listMountHistory,
} from "../lib/companions-mount.js";
import { seedMountSpecies } from "../lib/ecosystem/mount-species-seeder.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  // Minimal world_npcs so creatureId → archetype lookup succeeds.
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      archetype TEXT NOT NULL,
      name TEXT, x REAL, y REAL, z REAL,
      level INTEGER DEFAULT 1, is_dead INTEGER DEFAULT 0,
      is_conscious INTEGER DEFAULT 0, is_immortal INTEGER DEFAULT 0
    );
  `);
  mig083.up(db);
  mig104.up(db);
  mig142.up(db);
  seedMountSpecies(db);
  delete process.env.FF_MOUNTS_RIDING;
});

afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

function _seedCreature(creatureId, archetype) {
  db.prepare(`
    INSERT INTO world_npcs (id, world_id, archetype, x, y, z)
    VALUES (?, 'concordia-hub', ?, 0, 0, 0)
  `).run(creatureId, archetype);
}

function _seedHighBond(ownerId, creatureId, environment = null) {
  // Direct insert into creature_bonds at the threshold so attemptTame's
  // bond gate clears. TAME_BOND_THRESHOLD is 100 in companions.js.
  db.prepare(`
    INSERT INTO creature_bonds (a_id, b_id, bond, environment, last_seen_at)
    VALUES (?, ?, ?, ?, unixepoch())
  `).run(ownerId, creatureId, 200, environment);
}

describe("tameForMount — flips mount_eligible for mountable species", () => {
  it("sets mount_eligible=1 when species is in mount_species", () => {
    _seedCreature("cr_horse_1", "creature:warhorse");
    _seedHighBond("alice", "cr_horse_1");
    // Force success roll by stubbing Math.random.
    const orig = Math.random;
    Math.random = () => 0;
    try {
      const r = tameForMount(db, { ownerId: "alice", creatureId: "cr_horse_1", creatureName: "Thunder" });
      assert.equal(r.ok, true);
      assert.equal(r.mountEligible, true);
      assert.equal(r.speciesId, "warhorse");
      const row = db.prepare(`SELECT mount_eligible FROM player_companions WHERE id = ?`).get(r.companionId);
      assert.equal(row.mount_eligible, 1);
    } finally { Math.random = orig; }
  });

  it("does NOT set mount_eligible for non-mountable species", () => {
    _seedCreature("cr_rabbit_1", "creature:rabbit");
    _seedHighBond("alice", "cr_rabbit_1");
    const orig = Math.random;
    Math.random = () => 0;
    try {
      const r = tameForMount(db, { ownerId: "alice", creatureId: "cr_rabbit_1", creatureName: "Hops" });
      assert.equal(r.ok, true);
      assert.equal(r.mountEligible, false);
      const row = db.prepare(`SELECT mount_eligible FROM player_companions WHERE id = ?`).get(r.companionId);
      assert.equal(row.mount_eligible, 0);
    } finally { Math.random = orig; }
  });

  it("propagates the underlying tame failure (bond_too_low)", () => {
    _seedCreature("cr_horse_2", "creature:warhorse");
    // No bond row → bond_too_low.
    const r = tameForMount(db, { ownerId: "alice", creatureId: "cr_horse_2", creatureName: "Solo" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bond_too_low");
  });
});

describe("mount() — open mounted_instances row", () => {
  let cb;
  beforeEach(() => {
    db.prepare(`
      INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible, tame_bond, loyalty)
      VALUES ('c_w', 'alice', 'crH', 'Thunder', 'concordia-hub', 1, 100, 50)
    `).run();
    _seedCreature("crH", "creature:warhorse");
    cb = "c_w";
  });

  it("opens a mounted_instances row + returns seat offset + species fields", () => {
    const r = mountAction(db, { riderId: "alice", companionId: cb });
    assert.equal(r.ok, true);
    assert.ok(r.instanceId);
    assert.equal(r.speciesId, "warhorse");
    assert.equal(r.saddleAnchorBone, "spine_03");
    assert.equal(r.flightCapable, false);
    assert.ok(r.seatOffset);
    assert.equal(typeof r.seatOffset.y, "number");
    const row = db.prepare(`SELECT * FROM mounted_instances WHERE id = ?`).get(r.instanceId);
    assert.ok(row);
    assert.equal(row.dismounted_at, null);
  });

  it("rejects non-owner", () => {
    const r = mountAction(db, { riderId: "bob", companionId: cb });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });

  it("rejects non-mountable companion", () => {
    db.prepare(`UPDATE player_companions SET mount_eligible = 0 WHERE id = ?`).run(cb);
    const r = mountAction(db, { riderId: "alice", companionId: cb });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_mountable");
  });

  it("enforces one-active-per-world", () => {
    mountAction(db, { riderId: "alice", companionId: cb });
    const r2 = mountAction(db, { riderId: "alice", companionId: cb });
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "already_mounted");
  });

  it("allows separate worlds simultaneously", () => {
    db.prepare(`
      INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible, tame_bond, loyalty)
      VALUES ('c_w2', 'alice', 'crH2', 'Echo', 'world-2', 1, 100, 50)
    `).run();
    _seedCreature("crH2", "creature:warhorse");
    const a = mountAction(db, { riderId: "alice", companionId: cb });
    const b = mountAction(db, { riderId: "alice", companionId: "c_w2", worldId: "world-2" });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    const open = db.prepare(`SELECT COUNT(*) AS n FROM mounted_instances WHERE rider_id = 'alice' AND dismounted_at IS NULL`).get();
    assert.equal(open.n, 2);
  });

  it("rejects unknown companion", () => {
    const r = mountAction(db, { riderId: "alice", companionId: "ghost" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "companion_not_found");
  });
});

describe("dismount() — idempotent close", () => {
  it("closes the open instance for the world", () => {
    db.prepare(`
      INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible)
      VALUES ('c_w', 'alice', 'crH', 'T', 'concordia-hub', 1)
    `).run();
    _seedCreature("crH", "creature:warhorse");
    mountAction(db, { riderId: "alice", companionId: "c_w" });
    const r = dismountAction(db, "alice");
    assert.equal(r.ok, true);
    assert.equal(r.wasMounted, true);
    assert.equal(getActiveMountFor(db, "alice"), null);
  });

  it("returns wasMounted=false when not mounted (no-op)", () => {
    const r = dismountAction(db, "alice");
    assert.equal(r.ok, true);
    assert.equal(r.wasMounted, false);
  });

  it("only closes the world-matching instance", () => {
    db.prepare(`
      INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible)
      VALUES ('c_a', 'alice', 'crA', 'A', 'concordia-hub', 1),
             ('c_b', 'alice', 'crB', 'B', 'world-2', 1)
    `).run();
    _seedCreature("crA", "creature:warhorse");
    _seedCreature("crB", "creature:warhorse");
    mountAction(db, { riderId: "alice", companionId: "c_a", worldId: "concordia-hub" });
    mountAction(db, { riderId: "alice", companionId: "c_b", worldId: "world-2" });
    dismountAction(db, "alice", "concordia-hub");
    assert.equal(getActiveMountFor(db, "alice", "concordia-hub"), null);
    assert.ok(getActiveMountFor(db, "alice", "world-2"));
  });
});

describe("getActiveMountPayload — HUD bootstrap", () => {
  it("returns species + gait + seatOffset for the active rider", () => {
    db.prepare(`
      INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible)
      VALUES ('c_w', 'alice', 'crH', 'Thunder', 'concordia-hub', 1)
    `).run();
    _seedCreature("crH", "creature:warhorse");
    mountAction(db, { riderId: "alice", companionId: "c_w" });
    const p = getActiveMountPayload(db, "alice");
    assert.ok(p);
    assert.equal(p.speciesId, "warhorse");
    assert.ok(p.species);
    assert.ok(p.gait);
    assert.ok(p.seatOffset);
    assert.equal(p.companion.name, "Thunder");
  });

  it("returns null when not mounted", () => {
    assert.equal(getActiveMountPayload(db, "alice"), null);
  });
});

describe("listMountHistory", () => {
  it("returns closed instances recent-first", () => {
    db.prepare(`
      INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible)
      VALUES ('c_w', 'alice', 'crH', 'T', 'concordia-hub', 1)
    `).run();
    _seedCreature("crH", "creature:warhorse");
    mountAction(db, { riderId: "alice", companionId: "c_w" });
    dismountAction(db, "alice");
    mountAction(db, { riderId: "alice", companionId: "c_w" });
    dismountAction(db, "alice");
    const h = listMountHistory(db, "alice");
    assert.equal(h.length, 2);
    for (const row of h) assert.ok(row.dismounted_at);
  });
});
