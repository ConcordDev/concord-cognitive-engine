/**
 * Living Society — Phase 6: uprising → faction-strategy + quest handoff.
 *
 *   - a movement reaching `acting` erupts: a DECLARE_REBELLION faction-strategy
 *     move + a world event + an idempotent uprising row;
 *   - a faction target gets its strategy stance flipped to war vs the movement;
 *   - a player-reached recruitment plants a rebellion quest row (handoff);
 *   - both are idempotent.
 *
 * Run: node --test tests/uprising.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up284 } from "../migrations/284_movements.js";
import { up as up285 } from "../migrations/285_uprising.js";
import { seedMovementFromGrievance, recruit, getMovement } from "../lib/movements.js";
import { eruptUprising, recruitPlayer, spawnMovementRecruitmentQuest, listPlayerMovementQuests } from "../lib/uprising.js";

const W = "w1";
function mkDb() {
  const db = new Database(":memory:");
  up284(db); up285(db);
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, is_dead INTEGER DEFAULT 0);
    CREATE TABLE npc_grudges (id TEXT PRIMARY KEY, npc_id TEXT, target_kind TEXT, target_id TEXT, narrative TEXT, severity INTEGER, event_at INTEGER DEFAULT (unixepoch()), resolved_at INTEGER);
    CREATE TABLE faction_strategy_log (id TEXT PRIMARY KEY, faction_id TEXT, move TEXT, target_id TEXT, summary TEXT, payload_json TEXT DEFAULT '{}', occurred_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE faction_strategy_state (faction_id TEXT PRIMARY KEY, stance TEXT DEFAULT 'consolidate', target_id TEXT, momentum REAL DEFAULT 0, updated_at INTEGER);
    CREATE TABLE world_events (id TEXT PRIMARY KEY, world_id TEXT, event_type TEXT, title TEXT, description TEXT, created_at INTEGER);
  `);
  return db;
}
let _g = 0;
function seedActingMovement(db, target = "house_voss") {
  db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES ('f', ?), ('a', ?), ('b', ?)`).run(W, W, W);
  for (const n of ["f", "a", "b"]) db.prepare(`INSERT INTO npc_grudges (id, npc_id, target_kind, target_id, narrative, severity) VALUES (?, ?, 'faction', ?, 'x', 8)`).run(`g${_g++}`, n, target);
  const mid = seedMovementFromGrievance(db, W).seeded[0];
  db.prepare(`INSERT INTO faction_strategy_state (faction_id, stance) VALUES (?, 'consolidate')`).run(target);
  recruit(db, mid, "npc", "a"); recruit(db, mid, "npc", "b");
  return mid;
}

describe("Phase 6 — uprising eruption", () => {
  it("erupts a movement: rebellion move + world event + idempotent uprising row", () => {
    const db = mkDb();
    const mid = seedActingMovement(db);
    const r = eruptUprising(db, getMovement(db, mid));
    assert.equal(r.ok, true);
    const log = db.prepare(`SELECT move, faction_id, target_id FROM faction_strategy_log WHERE id=?`).get(r.strategyLogId);
    assert.equal(log.move, "DECLARE_REBELLION");
    assert.equal(log.faction_id, "house_voss");
    assert.equal(log.target_id, mid);
    assert.ok(db.prepare(`SELECT id FROM world_events WHERE event_type='uprising'`).get(), "world event fired");
    // target faction flipped to war vs the movement
    const st = db.prepare(`SELECT stance, target_id FROM faction_strategy_state WHERE faction_id='house_voss'`).get();
    assert.equal(st.stance, "war");
    assert.equal(st.target_id, mid);
    // idempotent
    const r2 = eruptUprising(db, getMovement(db, mid));
    assert.equal(r2.alreadyErupted, true);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM movement_uprisings`).get().n, 1);
  });
});

describe("Phase 6 — player quest handoff", () => {
  it("a player-reached recruitment plants a rebellion quest", () => {
    const db = mkDb();
    const mid = seedActingMovement(db);
    const r = recruitPlayer(db, mid, "user_7", { playerWorldId: "fantasy" });
    assert.equal(r.ok, true);
    assert.ok(r.quest.ok);
    const quests = listPlayerMovementQuests(db, "user_7");
    assert.equal(quests.length, 1);
    assert.equal(quests[0].target_id, "house_voss");
    assert.equal(quests[0].status, "offered");
    // cross-world membership recorded
    assert.equal(db.prepare(`SELECT member_world_id FROM movement_members WHERE movement_id=? AND member_id='user_7'`).get(mid).member_world_id, "fantasy");
  });

  it("quest handoff is idempotent per (movement, player)", () => {
    const db = mkDb();
    const mid = seedActingMovement(db);
    spawnMovementRecruitmentQuest(db, mid, "user_7");
    const again = spawnMovementRecruitmentQuest(db, mid, "user_7");
    assert.equal(again.alreadyOffered, true);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM movement_quests WHERE movement_id=? AND player_id='user_7'`).get(mid).n, 1);
  });
});
