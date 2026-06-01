// Speedster S1 contract — earned foot-speed curve + the agility-derived cap.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { footSpeed, agilityBonus, maxFootSpeedFor, agilityLevelFor, awardSprintXp, BASE_FOOT_SPEED } from "../lib/movement/foot-speed.js";

test("level 1 = base jog speed (no bonus)", () => {
  assert.equal(footSpeed(1), BASE_FOOT_SPEED() + agilityBonus(1));
  assert.ok(footSpeed(1) >= 6.0 && footSpeed(1) < 6.3, `L1 ~base, got ${footSpeed(1)}`);
});

test("the tuned waypoints: ~11 m/s by L25, ~14 by L80", () => {
  assert.ok(Math.abs(footSpeed(25) - 11) < 0.01, `L25 → ${footSpeed(25)} (want ~11)`);
  assert.ok(Math.abs(footSpeed(80) - 14.3) < 0.01, `L80 → ${footSpeed(80)} (want ~14.3)`);
});

test("monotonic increasing — more agility is always at least as fast", () => {
  let prev = -1;
  for (let L = 1; L <= 300; L++) { const s = footSpeed(L); assert.ok(s >= prev, `non-monotonic at L${L}`); prev = s; }
});

test("double soft cap: diminishing returns (early levels worth far more than late)", () => {
  const early = footSpeed(10) - footSpeed(1);   // 9 levels in tier 1
  const late = footSpeed(170) - footSpeed(161); // 9 levels in tier 3
  assert.ok(early > late * 5, `tier-1 gain ${early} should dwarf tier-3 gain ${late}`);
});

test("no runaway: even L500 stays bounded + only slowly exceeds the legacy walk:16", () => {
  const s500 = footSpeed(500);
  assert.ok(s500 < 25, `L500 must not blow up, got ${s500}`);
  // crosses the legacy 16 ceiling only at very high agility (then powers take over)
  assert.ok(footSpeed(80) < 16, "L80 still under the legacy walk ceiling");
  assert.ok(s500 > 16, "extreme agility legitimately exceeds the un-skilled ceiling");
});

test("maxFootSpeedFor applies the tolerance band + rises with level", () => {
  assert.ok(maxFootSpeedFor(1) > footSpeed(1), "cap > raw (tolerance)");
  assert.ok(maxFootSpeedFor(50) > maxFootSpeedFor(25), "cap rises with agility");
  assert.ok(Math.abs(maxFootSpeedFor(25) - footSpeed(25) * 1.15) < 0.01);
});

test("agilityLevelFor reads the movement.sprint skill DTU; degrades to 1", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE dtus (id TEXT PRIMARY KEY, skill_level REAL)");
  const uid = "u_abcdef1234";
  assert.equal(agilityLevelFor(db, uid), 1, "no skill row → level 1 (base)");
  db.prepare("INSERT INTO dtus (id, skill_level) VALUES (?, ?)").run(`skill_${uid.slice(0, 8)}_movement_sprint`, 30);
  assert.equal(agilityLevelFor(db, uid), 30);
  assert.equal(agilityLevelFor(null, uid), 1, "no db → 1");
  assert.equal(footSpeed(agilityLevelFor(db, uid)), footSpeed(30), "feeds the curve");
});

test("awardSprintXp accrues from distance run + the cap rises with it (the full loop)", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE dtus (id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT, data TEXT, skill_level REAL, created_at INTEGER, last_used_at INTEGER)");
  const uid = "u_runner0001";
  const cap0 = maxFootSpeedFor(agilityLevelFor(db, uid));
  // run a long way (10 km of sprinting at 0.02 xp/m = +200 levels of raw accrual)
  for (let i = 0; i < 100; i++) awardSprintXp(db, uid, 100);
  const lvl = agilityLevelFor(db, uid);
  assert.ok(lvl > 1, `agility grew from running, got ${lvl}`);
  assert.ok(maxFootSpeedFor(lvl) > cap0, "the anti-cheat cap rose with earned agility");
  assert.equal(awardSprintXp(db, uid, 0).ok, false, "no distance → no XP (AFK can't farm)");
  assert.equal(awardSprintXp(null, uid, 50).ok, false, "no db → graceful");
});
