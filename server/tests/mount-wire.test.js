/**
 * Wave 7a contract tests — the mount glue points that are verifiable headlessly.
 *
 * Pinned:
 *   #1 — mounts.list_for_player IS registered and returns {ok, active:[]} for a
 *        player with no active mount (the macro the world-scene spawn path calls,
 *        which previously 404'd and silently never spawned a mount).
 *   #6 — isTopologyRideable rule; generateHybrid stamps blueprint.mountEligible;
 *        markCompanionMountableForHybrid flips mount_eligible for a tamed hybrid.
 *
 * Run: node --test tests/mount-wire.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig104 from "../migrations/104_player_companions.js";
import * as mig142 from "../migrations/142_mount_substrate.js";
import {
  isTopologyRideable,
  RIDEABLE_TOPOLOGIES,
  markCompanionMountableForHybrid,
} from "../lib/ecosystem/mount-eligibility.js";
import { ensureCrossbreedingTables } from "../lib/creature-crossbreeding.js";
import registerMountMacros from "../domains/mounts.js";

let db;
beforeEach(() => {
  db = new Database(":memory:");
  mig104.up(db);
  mig142.up(db);
  ensureCrossbreedingTables(db);
});
afterEach(() => { try { db.close(); } catch { /* noop */ } });

/** Minimal register harness mirroring the runMacro registry. */
function buildRegistry() {
  const map = new Map();
  const register = (domain, name, fn) => { map.set(`${domain}.${name}`, fn); };
  registerMountMacros(register);
  return map;
}

describe("Wave 7a #6 — topology rideability", () => {
  it("quadruped / winged_quadruped of adequate mass are rideable; others are not", () => {
    assert.equal(isTopologyRideable("quadruped", 400), true);
    assert.equal(isTopologyRideable("winged_quadruped", 300), true);
    assert.equal(isTopologyRideable("quadruped", 40), false);      // too light
    assert.equal(isTopologyRideable("serpentine", 400), false);    // wrong body plan
    assert.equal(isTopologyRideable("polyped", 400), false);
    assert.equal(isTopologyRideable("humanoid", 400), false);
    assert.equal(isTopologyRideable(undefined, 400), false);
    assert.ok(RIDEABLE_TOPOLOGIES.has("quadruped"));
  });
});

describe("Wave 7a #6 — hybrid → mount_eligible", () => {
  it("flips mount_eligible for a tamed hybrid with a rideable blueprint; idempotent", () => {
    // A bred-hybrid lineage row whose blueprint is a rideable quadruped.
    db.prepare(`
      INSERT INTO creature_lineage (child_id, parent_a, parent_b, generation, stability, cross_world, blueprint, created_at)
      VALUES (?, ?, ?, 1, 0.8, 0, ?, unixepoch())
    `).run("hyb_1", "p_a", "p_b", JSON.stringify({ id: "hyb_1", topology: "quadruped", massKg: 380, mountEligible: true }));
    db.prepare(`
      INSERT INTO player_companions (id, owner_id, creature_id, name, world_id)
      VALUES ('cmp_1', 'usr_1', 'hyb_1', 'Steedling', 'concordia-hub')
    `).run();

    const r = markCompanionMountableForHybrid(db, "cmp_1", "hyb_1");
    assert.equal(r.ok, true);
    assert.equal(r.changed, 1);
    const flag = db.prepare(`SELECT mount_eligible FROM player_companions WHERE id = 'cmp_1'`).get();
    assert.equal(flag.mount_eligible, 1);

    // Idempotent — second run changes nothing.
    const r2 = markCompanionMountableForHybrid(db, "cmp_1", "hyb_1");
    assert.equal(r2.changed, 0);
  });

  it("does NOT flip for a non-rideable hybrid (wrong topology)", () => {
    db.prepare(`
      INSERT INTO creature_lineage (child_id, parent_a, parent_b, generation, stability, cross_world, blueprint, created_at)
      VALUES ('hyb_2','p_a','p_b',1,0.8,0,?,unixepoch())
    `).run(JSON.stringify({ id: "hyb_2", topology: "serpentine", massKg: 400 }));
    db.prepare(`
      INSERT INTO player_companions (id, owner_id, creature_id, name, world_id)
      VALUES ('cmp_2','usr_1','hyb_2','Slither','concordia-hub')
    `).run();
    const r = markCompanionMountableForHybrid(db, "cmp_2", "hyb_2");
    assert.equal(r.ok, false);
    assert.equal(db.prepare(`SELECT mount_eligible FROM player_companions WHERE id='cmp_2'`).get().mount_eligible, 0);
  });

  it("is a no-op for a non-hybrid creature (no lineage row)", () => {
    db.prepare(`
      INSERT INTO player_companions (id, owner_id, creature_id, name, world_id)
      VALUES ('cmp_3','usr_1','wild_wolf','Wolf','concordia-hub')
    `).run();
    const r = markCompanionMountableForHybrid(db, "cmp_3", "wild_wolf");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_a_hybrid");
  });
});

describe("Wave 7a #1 — mounts.list_for_player is registered", () => {
  it("returns {ok:true, active:[]} for a player with no active mount", async () => {
    const reg = buildRegistry();
    const fn = reg.get("mounts.list_for_player");
    assert.ok(typeof fn === "function", "list_for_player must be registered");
    const out = await fn({ db, userId: "usr_1" }, { worldId: "concordia-hub" });
    assert.equal(out.ok, true);
    assert.deepEqual(out.active, []);
  });

  it("rejects cleanly without a user", async () => {
    const reg = buildRegistry();
    const out = await reg.get("mounts.list_for_player")({ db }, {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_user");
  });
});

describe("Wave 7a #5 — mounts.craft_gear mints a saddle DTU", () => {
  beforeEach(() => {
    // Minimal dtus table matching the post-drift canonical shape the mint writes
    // + equipGear reads (type/data columns).
    db.exec(`CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, creator_id TEXT,
      data TEXT, skill_level INTEGER, total_experience INTEGER, created_at INTEGER
    )`);
  });

  const goodSaddle = {
    slot: "saddle",
    species_compat: [],
    weight_kg: 12,
    weight_rating_kg: 140,
    stat_mods: { speed: 0.1, comfort: 4 },
    material_list: [{ material_id: "leather", qty: 3 }],
    style_tags: ["worn"],
  };

  it("validates + mints a real mount_gear DTU the equip path can read", async () => {
    const reg = buildRegistry();
    const out = await reg.get("mounts.craft_gear")({ db, userId: "usr_1" }, { meta: goodSaddle, name: "Trail Saddle" });
    assert.equal(out.ok, true);
    assert.equal(out.slot, "saddle");
    assert.ok(out.dtuId);
    const row = db.prepare(`SELECT type, creator_id, title, data FROM dtus WHERE id = ?`).get(out.dtuId);
    assert.equal(row.type, "mount_gear");
    assert.equal(row.creator_id, "usr_1");
    assert.equal(row.title, "Trail Saddle");
    assert.equal(JSON.parse(row.data).slot, "saddle"); // equipGear reads data AS meta_json
  });

  it("rejects an invalid recipe (bad slot) without minting", async () => {
    const reg = buildRegistry();
    const out = await reg.get("mounts.craft_gear")({ db, userId: "usr_1" }, { meta: { ...goodSaddle, slot: "hat" } });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "invalid_slot");
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM dtus`).get().c, 0);
  });

  it("requires a user", async () => {
    const reg = buildRegistry();
    const out = await reg.get("mounts.craft_gear")({ db }, { meta: goodSaddle });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_user");
  });
});
