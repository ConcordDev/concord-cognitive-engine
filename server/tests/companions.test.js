/**
 * Companions (pet/tame) test suite.
 *
 * Verifies:
 *   - Bond gate rejects tame attempt below threshold
 *   - Above-threshold attempts roll probabilistically (deterministic via
 *     Math.random stub)
 *   - Lure rarity bumps probability
 *   - Deploy/dismiss roundtrip
 *   - Rename
 *   - Assist XP grants level up at curve thresholds
 *   - Already-owned guard prevents double-tame
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up083 } from "../migrations/083_creature_crossbreeding.js";
import { up as up104 } from "../migrations/104_player_companions.js";
import {
  attemptTame,
  recordTameInteraction,
  deployCompanion,
  dismissCompanion,
  renameCompanion,
  listCompanions,
  awardAssistXP,
  levelUpCompanion,
  TAME_BOND_THRESHOLD,
} from "../lib/companions.js";

function setupDb() {
  const db = new Database(":memory:");
  up083(db);
  up104(db);
  return db;
}

function setBond(db, ownerId, creatureId, bondValue) {
  // creature_bonds uses an ordered pair (a_id < b_id) under the hood —
  // mirror that here so getBond() can find the row.
  const [a, b] = ownerId < creatureId ? [ownerId, creatureId] : [creatureId, ownerId];
  db.prepare(`
    INSERT OR REPLACE INTO creature_bonds (a_id, b_id, bond, environment, last_seen_at, world_a, world_b)
    VALUES (?, ?, ?, NULL, unixepoch(), 'concordia-hub', 'concordia-hub')
  `).run(a, b, bondValue);
}

describe("companions: bond gate", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("rejects tame attempt with bond=0", () => {
    const r = attemptTame(db, { ownerId: "u1", creatureId: "c1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bond_too_low");
  });

  it("rejects tame attempt below threshold", () => {
    setBond(db, "u1", "c1", 50);
    const r = attemptTame(db, { ownerId: "u1", creatureId: "c1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bond_too_low");
    assert.equal(r.required, TAME_BOND_THRESHOLD);
  });

  it("proceeds to roll when bond is at or above threshold", () => {
    setBond(db, "u1", "c1", 200); // well above threshold
    // Monkey-patch Math.random to force success
    const origRandom = Math.random;
    Math.random = () => 0.01; // very low roll → success
    try {
      const r = attemptTame(db, { ownerId: "u1", creatureId: "c1", creatureName: "Spike" });
      assert.equal(r.ok, true, `should succeed: ${JSON.stringify(r)}`);
      assert.ok(r.companionId);
    } finally {
      Math.random = origRandom;
    }
  });

  it("rolls fail when probability is low and roll is high", () => {
    setBond(db, "u1", "c1", TAME_BOND_THRESHOLD); // exactly at threshold = lowest probability
    const origRandom = Math.random;
    Math.random = () => 0.99; // very high roll → fail
    try {
      const r = attemptTame(db, { ownerId: "u1", creatureId: "c1" });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "creature_resisted");
    } finally {
      Math.random = origRandom;
    }
  });
});

describe("companions: lure rarity", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("legendary lure bumps probability vs no lure", () => {
    setBond(db, "u1", "c1", 100); // exactly at threshold
    setBond(db, "u1", "c2", 100); // also at threshold for legendary test
    const origRandom = Math.random;
    // Compute probability with no lure
    let bareProb = null;
    Math.random = () => 0.99; // fail roll, but capture probability
    try {
      const r = attemptTame(db, { ownerId: "u1", creatureId: "c1" });
      bareProb = r.successProbability;
    } finally { Math.random = origRandom; }

    // With legendary lure, probability should be higher
    let legProb = null;
    Math.random = () => 0.99;
    try {
      const r = attemptTame(db, {
        ownerId: "u1", creatureId: "c2",
        lureItem: { rarity: "legendary" },
      });
      legProb = r.successProbability;
    } finally { Math.random = origRandom; }
    assert.ok(legProb > bareProb, `legendary (${legProb}) should be > bare (${bareProb})`);
  });
});

describe("companions: deploy / dismiss / rename / list", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("can tame, deploy, dismiss, rename, list", () => {
    setBond(db, "u1", "c1", 200);
    const origRandom = Math.random;
    Math.random = () => 0.01;
    try {
      const r = attemptTame(db, { ownerId: "u1", creatureId: "c1", creatureName: "Spike" });
      assert.equal(r.ok, true);
      const cid = r.companionId;

      const dep = deployCompanion(db, "u1", cid, "concordia-hub");
      assert.equal(dep.ok, true);

      const list = listCompanions(db, "u1", { worldId: "concordia-hub", deployedOnly: true });
      assert.equal(list.length, 1);
      assert.equal(list[0].deployed, 1);

      const dis = dismissCompanion(db, "u1", cid);
      assert.equal(dis.ok, true);

      const dep2 = listCompanions(db, "u1", { deployedOnly: true });
      assert.equal(dep2.length, 0);

      const rn = renameCompanion(db, "u1", cid, "Spike The Bold");
      assert.equal(rn.ok, true);

      const all = listCompanions(db, "u1");
      assert.equal(all[0].name, "Spike The Bold");
    } finally { Math.random = origRandom; }
  });

  it("only one deployed per (owner, world) at a time", () => {
    setBond(db, "u1", "c1", 200);
    setBond(db, "u1", "c2", 200);
    const origRandom = Math.random;
    Math.random = () => 0.01;
    try {
      const a = attemptTame(db, { ownerId: "u1", creatureId: "c1", creatureName: "A" });
      const b = attemptTame(db, { ownerId: "u1", creatureId: "c2", creatureName: "B" });
      assert.equal(a.ok, true);
      assert.equal(b.ok, true);
      deployCompanion(db, "u1", a.companionId);
      deployCompanion(db, "u1", b.companionId); // should auto-dismiss A
      const list = listCompanions(db, "u1", { deployedOnly: true });
      assert.equal(list.length, 1);
      assert.equal(list[0].id, b.companionId);
    } finally { Math.random = origRandom; }
  });

  it("blocks already-owned tame attempts", () => {
    setBond(db, "u1", "c1", 200);
    const origRandom = Math.random;
    Math.random = () => 0.01;
    try {
      const a = attemptTame(db, { ownerId: "u1", creatureId: "c1" });
      assert.equal(a.ok, true);
      const b = attemptTame(db, { ownerId: "u1", creatureId: "c1" });
      assert.equal(b.ok, false);
      assert.equal(b.reason, "already_owned");
    } finally { Math.random = origRandom; }
  });
});

describe("companions: XP curve", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("levelUpCompanion bumps level when XP crosses curve threshold", () => {
    setBond(db, "u1", "c1", 200);
    const origRandom = Math.random;
    Math.random = () => 0.01;
    try {
      const r = attemptTame(db, { ownerId: "u1", creatureId: "c1" });
      const cid = r.companionId;
      // Curve at L2 = 100*2*2 = 400 XP
      const l = levelUpCompanion(db, cid, 410);
      assert.equal(l.ok, true);
      assert.equal(l.leveledUp, true);
      assert.ok(l.newLevel >= 2);
    } finally { Math.random = origRandom; }
  });

  it("awardAssistXP grants XP to deployed companions", () => {
    setBond(db, "u1", "c1", 200);
    const origRandom = Math.random;
    Math.random = () => 0.01;
    try {
      const r = attemptTame(db, { ownerId: "u1", creatureId: "c1" });
      deployCompanion(db, "u1", r.companionId);
      const grants = awardAssistXP(db, "u1", { kill: true, assist: true });
      assert.equal(grants.length, 1);
    } finally { Math.random = origRandom; }
  });

  it("awardAssistXP no-ops when no deployed companions", () => {
    const grants = awardAssistXP(db, "u1", { kill: true });
    assert.equal(grants.length, 0);
  });
});

describe("companions: bond accumulation via recordTameInteraction", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("recordTameInteraction increments bond using crossbreeding ledger", () => {
    const r1 = recordTameInteraction(db, "u1", "c1", { sameEnvironment: true, sharedThreat: false });
    void r1;
    // creature_bonds uses ordered (a_id < b_id) — query both orders to
    // be safe regardless of the ordering implementation in
    // creature-crossbreeding._orderedPair.
    const ownerId = "u1", creatureId = "c1";
    const ordered = ownerId < creatureId ? [ownerId, creatureId] : [creatureId, ownerId];
    const row = db.prepare(`SELECT bond FROM creature_bonds WHERE a_id = ? AND b_id = ?`).get(ordered[0], ordered[1]);
    assert.ok(row, "bond row should exist");
    assert.ok(row.bond > 0, `bond should be > 0, got ${row?.bond}`);
  });
});
