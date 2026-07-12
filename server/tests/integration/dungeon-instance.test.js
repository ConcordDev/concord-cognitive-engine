/**
 * C3 / F5.1 — instanced dungeon/raid.
 *
 * Pins the unified instance: open (party-scoped, HP scales with size+tier),
 * per-member damage, phase advance on hp thresholds, clear at 0 HP with loot by
 * participation + lockout, and the wipe path.
 *
 * Run: node --test tests/integration/dungeon-instance.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up241 } from "../../migrations/241_difficulty_tiers.js";
import { up as up269 } from "../../migrations/269_dungeon_instances.js";
import {
  openInstance, recordHit, downParticipant, getInstance, isLockedOut, DUNGEON_ENCOUNTERS,
  getActiveInstanceForUser, getLockoutsForUser,
} from "../../lib/dungeon-instance.js";
import { resolvedDamageCap } from "../../lib/combat-limits.js";

function freshDb() {
  const db = new Database(":memory:");
  up241(db); up269(db);
  return db;
}

describe("C3 — open instance", () => {
  it("scales boss HP with party size", () => {
    const db = freshDb();
    const solo = openInstance(db, { leaderUserId: "u1", worldId: "w1", encounterId: "hollow_warden" });
    const party = openInstance(db, { leaderUserId: "u2", worldId: "w1", encounterId: "hollow_warden", members: ["u3", "u4"] });
    assert.equal(solo.ok, true);
    assert.ok(party.boss.maxHp > solo.boss.maxHp, "more members → more boss HP");
    assert.equal(party.roster.length, 3);
    db.close();
  });

  it("rejects an unknown encounter", () => {
    const db = freshDb();
    assert.equal(openInstance(db, { leaderUserId: "u1", worldId: "w1", encounterId: "nope" }).reason, "unknown_encounter");
    db.close();
  });
});

describe("C3 — fight + phases + clear", () => {
  it("advances phases on hp thresholds and clears at 0 HP with loot + lockout (capped hits only)", () => {
    const db = freshDb();
    const o = openInstance(db, { leaderUserId: "u1", worldId: "w1", encounterId: "hollow_warden", members: ["u2"] });
    const maxHp = o.boss.maxHp;
    const cap = resolvedDamageCap();

    // Grind it down with capped hits (no single swing can carry the boss
    // straight through multiple phase thresholds) until a phase advance
    // fires past the 0.66 "sundered" boundary.
    let last;
    let advanced = false;
    let hp = maxHp;
    while (hp / maxHp > 0.5) {
      last = recordHit(db, o.instanceId, "u1", cap);
      assert.equal(last.ok, true);
      hp = last.bossHp;
      if (last.phaseAdvanced) advanced = true;
    }
    assert.ok(advanced, "expected a phase advance while grinding past the 0.66 threshold");
    assert.ok(last.phaseIdx >= 1, `expected phase advance, got ${last.phaseIdx}`);
    assert.equal(last.cleared, false);

    // Finish it with repeated capped hits from the second participant.
    while (!last.cleared) {
      last = recordHit(db, o.instanceId, "u2", cap);
      assert.equal(last.ok, true);
    }
    assert.equal(last.bossHp, 0);

    const inst = getInstance(db, o.instanceId);
    assert.equal(inst.status, "cleared");
    // both participants got loot; the bigger-damage one gets more rolls
    const u1 = inst.participants.find((p) => p.user_id === "u1");
    const u2 = inst.participants.find((p) => p.user_id === "u2");
    assert.ok(u1.loot_json && u2.loot_json);
    // lockout applied to participants
    assert.equal(isLockedOut(db, "u1", "hollow_warden", "finder"), true);
    db.close();
  });

  it("a non-participant cannot hit the boss", () => {
    const db = freshDb();
    const o = openInstance(db, { leaderUserId: "u1", worldId: "w1", encounterId: "tide_colossus" });
    assert.equal(recordHit(db, o.instanceId, "stranger", 10).reason, "not_a_participant");
    db.close();
  });

  it("Wave 4 — rejects a damage report above the shared combat cap and leaves boss HP untouched", () => {
    const db = freshDb();
    const o = openInstance(db, { leaderUserId: "u1", worldId: "w1", encounterId: "hollow_warden" });
    const cap = resolvedDamageCap();

    const over = recordHit(db, o.instanceId, "u1", cap + 1);
    assert.equal(over.ok, false);
    assert.equal(over.reason, "damage_cap_exceeded");
    assert.equal(over.cap, cap);

    // The rejected report must not have moved boss HP or credited damage.
    const inst = getInstance(db, o.instanceId);
    assert.equal(inst.boss_hp, o.boss.maxHp);
    const u1 = inst.participants.find((p) => p.user_id === "u1");
    assert.equal(u1.damage_dealt, 0);

    // A report exactly at the cap is accepted.
    const atCap = recordHit(db, o.instanceId, "u1", cap);
    assert.equal(atCap.ok, true);
    assert.equal(atCap.bossHp, o.boss.maxHp - cap);

    // An absurd client-forged report (the pre-fix exploit) is rejected the
    // same way — one hit can no longer one-shot the whole encounter.
    const massive = recordHit(db, o.instanceId, "u1", 999999);
    assert.equal(massive.ok, false);
    assert.equal(massive.reason, "damage_cap_exceeded");
    assert.equal(getInstance(db, o.instanceId).boss_hp, o.boss.maxHp - cap, "still only the one legitimate hit applied");
    db.close();
  });
});

describe("Wave 4 — getActiveInstanceForUser / getLockoutsForUser", () => {
  it("finds a user's live active instance and stops once it clears", () => {
    const db = freshDb();
    const o = openInstance(db, { leaderUserId: "u1", worldId: "w1", encounterId: "tide_colossus", members: ["u2"] });
    const active = getActiveInstanceForUser(db, "u2", "w1");
    assert.equal(active?.id, o.instanceId);
    assert.equal(active.participants.length, 2);

    // World-scoped lookup returns nothing for a different world.
    assert.equal(getActiveInstanceForUser(db, "u2", "not-w1"), null);

    // Clear it, then it should no longer show up as "active".
    const cap = resolvedDamageCap();
    let last;
    do { last = recordHit(db, o.instanceId, "u1", cap); } while (!last.cleared);
    assert.equal(getActiveInstanceForUser(db, "u1", "w1"), null);
    db.close();
  });

  it("a user with no instance gets null, not an error", () => {
    const db = freshDb();
    assert.equal(getActiveInstanceForUser(db, "nobody", "w1"), null);
    db.close();
  });

  it("surfaces active lockouts with their expiry", () => {
    const db = freshDb();
    const o = openInstance(db, { leaderUserId: "u1", worldId: "w1", encounterId: "hollow_warden" });
    const cap = resolvedDamageCap();
    let last;
    do { last = recordHit(db, o.instanceId, "u1", cap); } while (!last.cleared);

    const lockouts = getLockoutsForUser(db, "u1");
    assert.equal(lockouts.length, 1);
    assert.equal(lockouts[0].encounterId, "hollow_warden");
    assert.equal(lockouts[0].tier, "finder");
    assert.ok(lockouts[0].lockedUntil > Math.floor(Date.now() / 1000));

    // A user who never cleared anything has none.
    assert.deepEqual(getLockoutsForUser(db, "u2"), []);
    db.close();
  });
});

describe("C3 — wipe", () => {
  it("all participants downed = wipe", () => {
    const db = freshDb();
    const o = openInstance(db, { leaderUserId: "u1", worldId: "w1", encounterId: "hollow_warden", members: ["u2"] });
    assert.equal(downParticipant(db, o.instanceId, "u1").wiped, false);
    const last = downParticipant(db, o.instanceId, "u2");
    assert.equal(last.wiped, true);
    assert.equal(getInstance(db, o.instanceId).status, "wiped");
    // a hit after a wipe is rejected
    assert.equal(recordHit(db, o.instanceId, "u1", 10).reason, "not_active");
    db.close();
  });
});
