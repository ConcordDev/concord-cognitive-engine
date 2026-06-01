// Temperament P4 contract — proportionality + the surrender/arrest FSM.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  legitimateCeiling, assessForce, updateMorale, shouldSurrender, canBetray,
  nextCombatState, getCombatState, setCombatState, applyCombatHit, COMBAT_STATES,
} from "../lib/combat-restraint.js";

function withTemp(on, fn) {
  const prev = process.env.CONCORD_TEMPERAMENT;
  process.env.CONCORD_TEMPERAMENT = on ? "1" : "0";
  try { return fn(); } finally { if (prev === undefined) delete process.env.CONCORD_TEMPERAMENT; else process.env.CONCORD_TEMPERAMENT = prev; }
}
function db0() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, combat_state TEXT NOT NULL DEFAULT 'active', morale REAL NOT NULL DEFAULT 1.0, surrendered_at INTEGER);`);
  return db;
}

test("proportionality: lethal force is only legitimate on a warned/threatening+ target", () => {
  assert.equal(legitimateCeiling("neutral"), "none");
  assert.equal(legitimateCeiling("wary"), "nonlethal");
  assert.equal(legitimateCeiling("threatening"), "lethal");
  assert.equal(legitimateCeiling("hostile"), "lethal");
  // surrendered/downed → nothing legitimate beyond capture
  assert.equal(legitimateCeiling("hostile", "surrendered"), "none");
  assert.equal(legitimateCeiling("hostile", "downed"), "none");
});

test("assessForce flags excessive force + lethal-without-warning", () => {
  // lethal on a hostile target WITH a prior warning = legitimate
  assert.equal(assessForce({ targetRung: "hostile", lethal: true, warned: true }).legitimate, true);
  // lethal on a hostile target with NO warning = excessive
  const noWarn = assessForce({ targetRung: "hostile", lethal: true, warned: false });
  assert.equal(noWarn.excessive, true);
  assert.ok(noWarn.reasons.includes("lethal_without_warning"));
  // lethal on a neutral target = excessive (exceeds ceiling)
  assert.equal(assessForce({ targetRung: "neutral", lethal: true, warned: true }).excessive, true);
  // lethal on a surrendered target = war crime tier
  const onSurr = assessForce({ targetRung: "hostile", targetState: "surrendered", lethal: true, warned: true });
  assert.equal(onSurr.excessive, true);
  assert.ok(onSurr.reasons.includes("force_on_hors_de_combat"));
  // nonlethal on a wary target = fine
  assert.equal(assessForce({ targetRung: "wary", lethal: false }).legitimate, true);
});

test("morale: non-lethal + flash deplete faster than lethal", () => {
  const afterLethal = updateMorale(1.0, { damage: 50, nonLethal: false });
  const afterNonLethal = updateMorale(1.0, { damage: 50, nonLethal: true });
  assert.ok(afterNonLethal < afterLethal, "non-lethal breaks will faster");
  const afterFlash = updateMorale(0.6, { damage: 0, flashed: true });
  assert.ok(afterFlash <= 0.1, "a flash is a big morale hit");
  assert.ok(updateMorale(0, { damage: 999 }) >= 0, "clamps at 0");
});

test("shouldSurrender triggers at/under the threshold", () => {
  assert.equal(shouldSurrender(0.2), true);
  assert.equal(shouldSurrender(0.5), false);
  assert.equal(shouldSurrender(0.5, { threshold: 0.6 }), true);
});

test("FSM legal transitions only", () => {
  assert.equal(nextCombatState("active", "morale_break"), "surrendering");
  assert.equal(nextCombatState("surrendering", "surrender_complete"), "surrendered");
  assert.equal(nextCombatState("surrendered", "arrest"), "arrested");
  assert.equal(nextCombatState("active", "arrest"), "active", "can't arrest a fighting NPC");
  assert.equal(nextCombatState("active", "flee"), "fleeing");
  assert.equal(nextCombatState("active", "down"), "downed");
  assert.equal(nextCombatState("downed", "revive"), "active");
});

test("betray window: surrendered NPC can resume only inside the window", () => {
  const now = 1_000_000_000_000;
  const justNow = Math.floor(now / 1000);
  assert.equal(canBetray(justNow, now), true);
  assert.equal(canBetray(justNow - 60, now), false, "60s later the surrender is locked");
  assert.equal(nextCombatState("surrendered", "betray", { surrenderedAt: justNow, nowMs: now }), "active");
  assert.equal(nextCombatState("surrendered", "betray", { surrenderedAt: justNow - 60, nowMs: now }), "surrendered");
});

test("persistence round-trips combat state", () => {
  const db = db0();
  db.prepare(`INSERT INTO world_npcs (id) VALUES ('n1')`).run();
  assert.deepEqual(getCombatState(db, "n1"), { combatState: "active", morale: 1, surrenderedAt: null });
  setCombatState(db, "n1", { combatState: "surrendered", morale: 0.1, surrenderedAt: 12345 });
  assert.deepEqual(getCombatState(db, "n1"), { combatState: "surrendered", morale: 0.1, surrenderedAt: 12345 });
});

test("getCombatState degrades gracefully without the columns/table", () => {
  const bare = new Database(":memory:");
  assert.deepEqual(getCombatState(bare, "x"), { combatState: "active", morale: 1, surrenderedAt: null });
});

test("applyCombatHit: off → null (binary combat preserved)", () => {
  withTemp(false, () => {
    assert.equal(applyCombatHit(db0(), { id: "n1" }, { damage: 50 }), null);
  });
});

test("applyCombatHit: a non-lethal beatdown forces surrender + persists", () => {
  withTemp(true, () => {
    const db = db0();
    db.prepare(`INSERT INTO world_npcs (id) VALUES ('n1')`).run();
    let r;
    for (let i = 0; i < 5; i++) r = applyCombatHit(db, { id: "n1" }, { damage: 40, nonLethal: true, targetRung: "hostile", warned: true });
    assert.equal(r.surrendered, true);
    assert.equal(r.combatState, "surrendered");
    assert.equal(getCombatState(db, "n1").combatState, "surrendered");
  });
});

test("applyCombatHit: lethal blow on an already-surrendered NPC is flagged excessive (no further morale change)", () => {
  withTemp(true, () => {
    const db = db0();
    db.prepare(`INSERT INTO world_npcs (id, combat_state, morale) VALUES ('n1','surrendered',0.1)`).run();
    const r = applyCombatHit(db, { id: "n1" }, { damage: 80, nonLethal: false, targetRung: "hostile", warned: true });
    assert.equal(r.combatState, "surrendered");
    assert.equal(r.force.excessive, true);
    assert.ok(r.force.reasons.includes("force_on_hors_de_combat"));
  });
});

test("COMBAT_STATES includes the P5 downed band", () => {
  assert.ok(COMBAT_STATES.includes("downed"));
});
