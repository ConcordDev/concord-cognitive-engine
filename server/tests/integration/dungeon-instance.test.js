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
} from "../../lib/dungeon-instance.js";

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
  it("advances phases on hp thresholds and clears at 0 HP with loot + lockout", () => {
    const db = freshDb();
    const o = openInstance(db, { leaderUserId: "u1", worldId: "w1", encounterId: "hollow_warden", members: ["u2"] });
    const maxHp = o.boss.maxHp;
    // Knock it to ~50% → should be past phase 0 (sundered at 0.66).
    const half = recordHit(db, o.instanceId, "u1", maxHp * 0.5);
    assert.equal(half.cleared, false);
    assert.ok(half.phaseIdx >= 1, `expected phase advance, got ${half.phaseIdx}`);
    assert.equal(half.phaseAdvanced, true);
    // Finish it.
    const kill = recordHit(db, o.instanceId, "u2", maxHp); // overkill
    assert.equal(kill.cleared, true);
    assert.equal(kill.bossHp, 0);

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
