/**
 * Wave 4 gap-closure — horde/roguelite draft-pick + meta-unlock modifiers
 * actually apply to gameplay.
 *
 * Gap A: horde's wave-upgrade offering was 9 cosmetic strings with zero
 *        mechanical effect. Covered in server/tests/horde-mode.test.js
 *        (pickUpgrade now delegates to the real structured draft engine).
 * Gap B: run-draft.js (structured boons + synergies) had zero callers.
 *        Covered here for roguelite's NEW advanceRun/pickDraftBoon draft
 *        moment, and in horde-mode.test.js for horde's wave-clear moment.
 * Gap C: roguelite's runMetaModifiers() computed a correct bundle from
 *        owned meta-unlocks with zero callers applying it to a run. Covered
 *        here: starting-HP bonus applied/removed symmetrically, currency
 *        payout multiplier, extra draft picks, and the revive-on-death path.
 *
 * Every numeric assertion below is hand-computed from the documented
 * formula, not just "changed" — per this repo's depth-test methodology.
 *
 * Run: node --test tests/integration/run-mode-gap-closure.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up245 } from "../../migrations/245_roguelite_runs.js";
import { up as up246 } from "../../migrations/246_horde_mode.js";
import { up as up267 } from "../../migrations/267_run_draft.js";
import { up as up359 } from "../../migrations/359_run_mode_modifiers.js";
import { up as up066 } from "../../migrations/066_resource_bars_and_combat.js";

import {
  startRun, endRun, advanceRun, pickDraftBoon, maybeReviveRoguelitePlayer,
  purchaseUnlock, runMetaModifiers,
} from "../../lib/roguelite.js";
import { startHorde, pickUpgrade } from "../../lib/horde-mode.js";
import { recordPick } from "../../lib/run-draft.js";
import { getActiveRunModifiers, invalidateRunModifierCache } from "../../lib/run-modifiers.js";
import {
  configurePresence, updateUserPosition, spawnNpc, applyAttack, removeUser,
} from "../../lib/city-presence.js";

function freshDb() {
  const db = new Database(":memory:");
  up245(db); up246(db); up267(db); up359(db); up066(db);
  return db;
}

function seedBalance(db, userId, amount) {
  db.prepare(`
    INSERT INTO roguelite_meta_currency (user_id, balance, lifetime) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET balance = excluded.balance, lifetime = excluded.lifetime
  `).run(userId, amount, amount);
}

describe("Wave 4 Gap C — starting HP bonus applied/removed symmetrically", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("veteran_vigor (+25) bumps hp/max_hp at startRun and removes exactly 25 at endRun", () => {
    seedBalance(db, "u1", 1000);
    purchaseUnlock(db, "u1", "veteran_vigor"); // costs 150, effect startingHpBonus:25

    const r = startRun(db, "u1", { worldId: "w1", regionId: "reg-1" });
    assert.equal(r.ok, true);
    assert.equal(r.hpBonusApplied, 25);

    // getOrInitPlayerBars seeds hp=max_hp=100, then +25 each => 125/125.
    const bars = db.prepare(`SELECT hp, max_hp FROM player_resource_bars WHERE user_id='u1' AND world_id='w1'`).get();
    assert.equal(bars.hp, 125);
    assert.equal(bars.max_hp, 125);

    const e = endRun(db, r.runId, { reason: "manual_exit", depthReached: 1 });
    assert.equal(e.ok, true);

    // Symmetric removal: newMax = 125-25 = 100; newHp = min(100, 125) = 100.
    const barsAfter = db.prepare(`SELECT hp, max_hp FROM player_resource_bars WHERE user_id='u1' AND world_id='w1'`).get();
    assert.equal(barsAfter.max_hp, 100);
    assert.equal(barsAfter.hp, 100);
  });

  it("switching regions mid-run removes the prior run's HP bonus before starting the new one", () => {
    seedBalance(db, "u1", 1000);
    purchaseUnlock(db, "u1", "veteran_vigor");

    startRun(db, "u1", { worldId: "w1", regionId: "reg-1" });
    let bars = db.prepare(`SELECT hp, max_hp FROM player_resource_bars WHERE user_id='u1' AND world_id='w1'`).get();
    assert.equal(bars.max_hp, 125);

    // Different region in the SAME world closes the prior run as timeout —
    // the bonus must come off, then a fresh +25 gets applied for the new run.
    startRun(db, "u1", { worldId: "w1", regionId: "reg-2" });
    bars = db.prepare(`SELECT hp, max_hp FROM player_resource_bars WHERE user_id='u1' AND world_id='w1'`).get();
    assert.equal(bars.max_hp, 125, "should be 100 (removed) + 25 (re-applied) = 125, not 150 (stacked)");
  });

  it("a player with no meta-unlocks gets hpBonusApplied 0 and never touches player_resource_bars", () => {
    const r = startRun(db, "u1", { worldId: "w1", regionId: "reg-1" });
    assert.equal(r.hpBonusApplied, 0);
    const bars = db.prepare(`SELECT * FROM player_resource_bars WHERE user_id='u1' AND world_id='w1'`).get();
    assert.equal(bars, undefined);
  });
});

describe("Wave 4 Gap C — metaCurrencyMult multiplies the cash-out (hand-verified)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("fortune_finder (+0.25) raises an extract payout from 25 to 31 (floor(25*1.25))", () => {
    seedBalance(db, "u1", 1000);
    purchaseUnlock(db, "u1", "fortune_finder"); // costs 250, effect metaCurrencyMult:0.25
    const balanceAfterPurchase = db.prepare(`SELECT balance FROM roguelite_meta_currency WHERE user_id='u1'`).get().balance;
    assert.equal(balanceAfterPurchase, 750);

    const r = startRun(db, "u1", { worldId: "w1", regionId: "reg-1" });
    // depth 4, extract: base = 4*5 = 20; EXTRACT_BONUS_MULT 1.25 => floor(20*1.25) = 25.
    // lootMult at finder tier defaults to 1.0. metaCurrencyMult 0.25 =>
    // floor(25 * 1.0 * 1.25) = floor(31.25) = 31.
    const e = endRun(db, r.runId, { reason: "extract", depthReached: 4 });
    assert.equal(e.ok, true);
    assert.equal(e.earned, 31);

    const balanceAfter = db.prepare(`SELECT balance FROM roguelite_meta_currency WHERE user_id='u1'`).get().balance;
    assert.equal(balanceAfter, 750 + 31);
  });

  it("with no fortune_finder, the payout is the unmultiplied 25 (regression guard)", () => {
    const r = startRun(db, "u1", { worldId: "w1", regionId: "reg-1" });
    const e = endRun(db, r.runId, { reason: "extract", depthReached: 4 });
    assert.equal(e.earned, 25);
  });
});

describe("Wave 4 Gap C — revives_remaining seeded + consumed (hand-verified)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("second_chance (+1) is consumed by maybeReviveRoguelitePlayer, restoring exactly 50% of max_hp", () => {
    seedBalance(db, "u1", 1000);
    purchaseUnlock(db, "u1", "second_chance"); // costs 500, effect revives:1

    const r = startRun(db, "u1", { worldId: "w1", regionId: "reg-1" });
    assert.equal(r.revivesRemaining, 1);

    // Simulate the player's max_hp having grown to 140 (e.g. from levelling)
    // and their current hp being at 0 (the lethal hit already landed). No
    // startingHpBonus was purchased in this test, so startRun() never
    // touched player_resource_bars — the row doesn't exist yet; create it.
    db.prepare(`
      INSERT INTO player_resource_bars (id, user_id, world_id, hp, max_hp)
      VALUES ('bars-revive-test', 'u1', 'w1', 0, 140)
    `).run();

    const rev = maybeReviveRoguelitePlayer(db, "u1", "w1");
    assert.equal(rev.revived, true);
    assert.equal(rev.reviveHp, 70); // round(140 * 0.5)
    assert.equal(rev.revivesRemaining, 0);

    const bars = db.prepare(`SELECT hp FROM player_resource_bars WHERE user_id='u1' AND world_id='w1'`).get();
    assert.equal(bars.hp, 70);

    // A second death has no charge left — real death now.
    db.prepare(`UPDATE player_resource_bars SET hp = 0 WHERE user_id='u1' AND world_id='w1'`).run();
    const rev2 = maybeReviveRoguelitePlayer(db, "u1", "w1");
    assert.equal(rev2.revived, false);
  });

  it("a revive only fires for the run's OWN world (world-scoped)", () => {
    seedBalance(db, "u1", 1000);
    purchaseUnlock(db, "u1", "second_chance");
    startRun(db, "u1", { worldId: "w1", regionId: "reg-1" });
    const rev = maybeReviveRoguelitePlayer(db, "u1", "some-other-world");
    assert.equal(rev.revived, false);
  });

  it("no revive without an active run", () => {
    const rev = maybeReviveRoguelitePlayer(db, "u-nobody", "w1");
    assert.equal(rev.revived, false);
  });
});

describe("Wave 4 Gap B — roguelite draft moment (advanceRun / pickDraftBoon)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("advanceRun grants exactly 1 pick with no extra_pick unlock", () => {
    const r = startRun(db, "u1", { worldId: "w1", regionId: "reg-1" });
    const adv = advanceRun(db, r.runId, {});
    assert.equal(adv.ok, true);
    assert.equal(adv.depthReached, 2);
    assert.equal(adv.picksGrantedThisAdvance, 1);
    assert.equal(adv.picksAvailable, 1);
    assert.ok(adv.draftOffering.length >= 3);
  });

  it("extra_pick (+1) banks 2 picks per advance (hand-verified)", () => {
    seedBalance(db, "u1", 1000);
    purchaseUnlock(db, "u1", "extra_pick"); // costs 300, effect extraDraftPicks:1
    const r = startRun(db, "u1", { worldId: "w1", regionId: "reg-1" });
    const adv = advanceRun(db, r.runId, {});
    assert.equal(adv.picksGrantedThisAdvance, 2);
    assert.equal(adv.picksAvailable, 2);

    // Both picks are genuinely spendable this round.
    const boonIds = adv.draftOffering.map((b) => b.id);
    const p1 = pickDraftBoon(db, r.runId, "u1", boonIds[0]);
    assert.equal(p1.ok, true);
    assert.equal(p1.picksAvailable, 1);
    const p2 = pickDraftBoon(db, r.runId, "u1", boonIds[1]);
    assert.equal(p2.ok, true);
    assert.equal(p2.picksAvailable, 0);

    // A third pick this round is rejected — picks are banked, not unlimited.
    const p3 = pickDraftBoon(db, r.runId, "u1", boonIds[2]);
    assert.equal(p3.ok, false);
    assert.equal(p3.error, "no_picks_available");
  });

  it("picks accumulate the SAME merged bundle getRunModifiers reports for horde (shared engine)", () => {
    const r = startRun(db, "u1", { worldId: "w1", regionId: "reg-1" });
    const adv = advanceRun(db, r.runId, {});
    const target = adv.draftOffering.find((b) => b.id === "blade_storm") ? "blade_storm" : adv.draftOffering[0].id;
    const p = pickDraftBoon(db, r.runId, "u1", target);
    assert.equal(p.ok, true);
    assert.ok(p.modifiers[p.boon.effect.stat] >= p.boon.effect.value);
  });

  it("pickDraftBoon rejects when the run has zero banked picks", () => {
    const r = startRun(db, "u1", { worldId: "w1", regionId: "reg-1" });
    const p = pickDraftBoon(db, r.runId, "u1", "blade_storm");
    assert.equal(p.ok, false);
    assert.equal(p.error, "no_picks_available");
  });

  it("pickDraftBoon rejects a different user's run id", () => {
    const r = startRun(db, "u1", { worldId: "w1", regionId: "reg-1" });
    advanceRun(db, r.runId, {});
    const p = pickDraftBoon(db, r.runId, "u2", "blade_storm");
    assert.equal(p.ok, false);
    assert.equal(p.error, "not_your_run");
  });
});

describe("Wave 4 — run-modifiers.js merges horde (draft-only) vs roguelite (draft+meta, additive)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { invalidateRunModifierCache(); });

  it("horde bundle is draft-picks only — no meta-unlock system exists for horde", () => {
    const h = startHorde(db, "u1", { worldId: "w1" });
    pickUpgrade(db, h.runId, "blade_storm"); // damageMult +0.25
    const bundle = getActiveRunModifiers(db, "u1");
    assert.equal(bundle.runKind, "horde");
    assert.equal(bundle.modifiers.damageMult, 0.25);
  });

  it("roguelite bundle SUMS a drafted boon's damageMult with a purchased meta-unlock's damageMult (hand-verified additive stacking)", () => {
    seedBalance(db, "u1", 1000);
    purchaseUnlock(db, "u1", "sharp_start"); // damageMult +0.10
    const r = startRun(db, "u1", { worldId: "w1", regionId: "reg-1" });
    advanceRun(db, r.runId, {});
    pickDraftBoon(db, r.runId, "u1", "blade_storm"); // damageMult +0.25

    const bundle = getActiveRunModifiers(db, "u1");
    assert.equal(bundle.runKind, "roguelite");
    // 0.25 (draft) + 0.10 (meta-unlock) = 0.35 — additive, not multiplicative
    // (multiplicative would give a different, undocumented number here).
    assert.equal(bundle.modifiers.damageMult, 0.35);
  });

  it("no active run of either kind returns an empty bundle", () => {
    const bundle = getActiveRunModifiers(db, "u-idle");
    assert.equal(bundle.runKind, null);
    assert.deepEqual(bundle.modifiers, {});
  });

  it("the cache serves a stale bundle until invalidated, then reflects the new pick", () => {
    const h = startHorde(db, "u1", { worldId: "w1" });
    const first = getActiveRunModifiers(db, "u1"); // populates cache: {} (no picks yet)
    assert.deepEqual(first.modifiers, {});

    // Mutate the underlying picks WITHOUT going through invalidate — this
    // simulates a caller that forgot to invalidate (or a race).
    recordPick(db, { runKind: "horde", runId: h.runId, userId: "u1", pickId: "blade_storm" });
    const stillCached = getActiveRunModifiers(db, "u1");
    assert.deepEqual(stillCached.modifiers, {}, "cache should still serve the pre-pick bundle");

    invalidateRunModifierCache("u1");
    const fresh = getActiveRunModifiers(db, "u1");
    assert.equal(fresh.modifiers.damageMult, 0.25, "post-invalidate read must reflect the real pick");
  });
});

describe("Wave 4 Gap A/C — critChanceBonus genuinely shifts applyAttack's crit roll (hand-verified, real function)", () => {
  afterEach(() => {
    removeUser("attacker-crit-test");
  });

  it("the SAME random roll is 'not crit' at bonus 0 but 'crit' at bonus 0.30", () => {
    configurePresence({});
    updateUserPosition("attacker-crit-test", { cityId: "test-city", x: 0, y: 0, z: 0 });
    spawnNpc({ cityId: "test-city", id: "npc-crit-target", x: 0, y: 0, z: 0, health: 10000 });

    const origRandom = Math.random;
    try {
      // 0.85 is the base crit threshold (isCrit = random > threshold).
      // A roll of 0.80 fails that (not crit) but clears 0.85-0.30=0.55.
      Math.random = () => 0.80;

      const noBonus = applyAttack({
        attackerId: "attacker-crit-test", targetId: "npc-crit-target",
        baseDamage: 1, critChanceBonus: 0,
      });
      assert.equal(noBonus.ok, true);
      assert.equal(noBonus.isCrit, false);

      const withBonus = applyAttack({
        attackerId: "attacker-crit-test", targetId: "npc-crit-target",
        baseDamage: 1, critChanceBonus: 0.30,
      });
      assert.equal(withBonus.ok, true);
      assert.equal(withBonus.isCrit, true);
    } finally {
      Math.random = origRandom;
    }
  });

  it("critChanceBonus is clamped so the threshold never drops below 0.05", () => {
    configurePresence({});
    updateUserPosition("attacker-crit-test", { cityId: "test-city", x: 0, y: 0, z: 0 });
    spawnNpc({ cityId: "test-city", id: "npc-crit-target-2", x: 0, y: 0, z: 0, health: 10000 });

    const origRandom = Math.random;
    try {
      Math.random = () => 0.03; // below even the 0.05 floor
      const r = applyAttack({
        attackerId: "attacker-crit-test", targetId: "npc-crit-target-2",
        baseDamage: 1, critChanceBonus: 5, // absurd bonus — must still clamp
      });
      assert.equal(r.isCrit, false, "0.03 must still fail a 0.05 floor threshold");
    } finally {
      Math.random = origRandom;
    }
  });
});
