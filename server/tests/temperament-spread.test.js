// Temperament P7 contract — assistance-gate + depth-cap + zone/child weld.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  isProtectedNonCombatant, zoneSuppresses, shouldAssist, filterResponders, cascadeDepthOk,
} from "../lib/temperament-spread.js";

function withTemp(on, fn) {
  const prev = process.env.CONCORD_TEMPERAMENT;
  process.env.CONCORD_TEMPERAMENT = on ? "1" : "0";
  try { return fn(); } finally { if (prev === undefined) delete process.env.CONCORD_TEMPERAMENT; else process.env.CONCORD_TEMPERAMENT = prev; }
}
function db0() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, archetype TEXT, age INTEGER, faction TEXT, x REAL, z REAL);`);
  db.exec(`CREATE TABLE character_opinions (npc_id TEXT, target_kind TEXT, target_id TEXT, score INTEGER);`);
  return db;
}

test("children + non-combatants are protected", () => {
  assert.equal(isProtectedNonCombatant({ archetype: "child" }), true);
  assert.equal(isProtectedNonCombatant({ archetype: "guard", age: 8 }), true); // young
  assert.equal(isProtectedNonCombatant({ archetype: "guard", age: 30 }), false);
  assert.equal(isProtectedNonCombatant({ archetype: "soldier" }), false);
});

test("zoneSuppresses is a pure predicate over the zone rule", () => {
  assert.equal(zoneSuppresses({ noAggro: true }), true);
  assert.equal(zoneSuppresses({ combat: false }), true);
  assert.equal(zoneSuppresses({ combat: true }), false);
  assert.equal(zoneSuppresses(null), false);
});

test("off → everyone assists (legacy indiscriminate alert preserved)", () => {
  withTemp(false, () => {
    assert.equal(shouldAssist(db0(), { callerId: "a", responderId: "b" }).assist, true);
  });
});

test("on → only an ally (positive opinion) assists", () => {
  withTemp(true, () => {
    const db = db0();
    db.prepare(`INSERT INTO world_npcs (id, archetype, age) VALUES ('caller','soldier',30),('friend','soldier',30),('stranger','merchant',40)`).run();
    db.prepare(`INSERT INTO character_opinions VALUES ('friend','npc','caller',60)`).run();
    assert.equal(shouldAssist(db, { callerId: "caller", responderId: "friend" }).reason, "ally_opinion");
    assert.equal(shouldAssist(db, { callerId: "caller", responderId: "stranger" }).assist, false);
  });
});

test("on → same faction assists even without an opinion row", () => {
  withTemp(true, () => {
    const db = db0();
    db.prepare(`INSERT INTO world_npcs (id, archetype, age, faction) VALUES ('caller','soldier',30,'reds'),('mate','soldier',30,'reds')`).run();
    assert.equal(shouldAssist(db, { callerId: "caller", responderId: "mate" }).reason, "same_faction");
  });
});

test("on → a child ally is STILL not recruited (protection overrides allegiance)", () => {
  withTemp(true, () => {
    const db = db0();
    db.prepare(`INSERT INTO world_npcs (id, archetype, age, faction) VALUES ('caller','soldier',30,'reds'),('kid','child',9,'reds')`).run();
    db.prepare(`INSERT INTO character_opinions VALUES ('kid','npc','caller',100)`).run();
    assert.equal(shouldAssist(db, { callerId: "caller", responderId: "kid" }).reason, "protected_noncombatant");
  });
});

test("on → sanctuary suppresses the cry via injected combatRuleFor", () => {
  withTemp(true, () => {
    const db = db0();
    db.prepare(`INSERT INTO world_npcs (id, archetype, age, faction, x, z) VALUES ('caller','soldier',30,'reds',0,0),('mate','soldier',30,'reds',5,5)`).run();
    const combatRuleFor = () => ({ noAggro: true });
    assert.equal(shouldAssist(db, { callerId: "caller", responderId: "mate", worldId: "w1", responderLoc: { x: 5, z: 5 }, combatRuleFor }).reason, "sanctuary");
  });
});

test("filterResponders caps at the fan-out and excludes non-allies", () => {
  withTemp(true, () => {
    const db = db0();
    db.prepare(`INSERT INTO world_npcs (id, archetype, age, faction) VALUES ('caller','soldier',30,'reds')`).run();
    const cands = [];
    for (let i = 0; i < 10; i++) {
      db.prepare(`INSERT INTO world_npcs (id, archetype, age, faction) VALUES (?, 'soldier', 30, 'reds')`).run(`ally${i}`);
      cands.push(`ally${i}`);
    }
    cands.push("stranger");
    db.prepare(`INSERT INTO world_npcs (id, archetype, age, faction) VALUES ('stranger','merchant',40,'blues')`).run();
    const got = filterResponders(db, { callerId: "caller", candidates: cands });
    assert.ok(got.length <= 5, "fan-out cap");
    assert.ok(!got.includes("stranger"), "non-ally excluded");
  });
});

test("cascade depth cap bounds the spread", () => {
  assert.equal(cascadeDepthOk(0), true);
  assert.equal(cascadeDepthOk(2), true);
  assert.equal(cascadeDepthOk(3), false);
});
