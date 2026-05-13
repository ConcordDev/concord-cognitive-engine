/**
 * Tier-2 contract tests for Phase T: NPC equal-agency cross-world.
 *
 * Pins:
 *   - migration 189 creates npc_residency / npc_travel_intents /
 *     npc_skills / npc_active_quests / npc_ambition_log + extends
 *     world_npcs with home_world_id + ambition_score.
 *   - awardNpcXp inserts/updates correctly + crosses level boundary.
 *   - levelFor curve matches user_skills shape (level 1 floor; XP-curve growth).
 *   - chooseTravelGoal returns null for low-ambition NPCs; non-null for ambitious.
 *   - queueIntent + getOpenIntent round-trip.
 *   - tryAcceptQuestForNpc rejects 4th concurrent quest, accepts ≤3.
 *   - advanceNpcQuest completes when reaching step_count.
 *
 * Run: node --test tests/npc-equal-agency.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up189 } from "../migrations/189_npc_equal_agency.js";
import { awardNpcXp, levelFor, xpForLevel, getNpcSkillLevels } from "../lib/npc-skill-progression.js";
import { chooseTravelGoal, queueIntent, getOpenIntent, pickAmbitionMove, recordAmbitionMove } from "../lib/npc-ambition.js";
import { tryAcceptQuestForNpc, advanceNpcQuest, getActiveQuestsForNpc } from "../lib/npc-quest-runner.js";

function freshDb() {
  const db = new Database(":memory:");
  // Minimal world_npcs + worlds shape that 189 can extend.
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      npc_emergent_id TEXT,
      npc_type TEXT NOT NULL DEFAULT 'generic',
      spawn_location TEXT DEFAULT '{}',
      current_location TEXT DEFAULT '{}',
      state TEXT DEFAULT '{}',
      faction TEXT,
      archetype TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_tick_at INTEGER,
      is_dead INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS worlds (
      id TEXT PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS lattice_born_quests (
      id TEXT PRIMARY KEY,
      title TEXT,
      host_npc_id TEXT,
      signature TEXT
    );
  `);
  // Seed 3 NPCs across 2 worlds.
  db.prepare(`INSERT INTO world_npcs (id, world_id, archetype) VALUES (?, ?, ?)`).run('npc_a', 'concordia-hub', 'warrior');
  db.prepare(`INSERT INTO world_npcs (id, world_id, archetype) VALUES (?, ?, ?)`).run('npc_b', 'concordia-hub', 'scholar');
  db.prepare(`INSERT INTO world_npcs (id, world_id, archetype) VALUES (?, ?, ?)`).run('npc_c', 'cyber',         'hunter');
  db.prepare(`INSERT INTO worlds (id, name) VALUES (?, ?)`).run('concordia-hub', 'Concordia');
  db.prepare(`INSERT INTO worlds (id, name) VALUES (?, ?)`).run('cyber',         'Cyber');
  up189(db);
  return db;
}

describe("Phase T migration 189", () => {
  it("creates all five tables + extends world_npcs", () => {
    const db = freshDb();
    for (const t of ['npc_residency', 'npc_travel_intents', 'npc_skills', 'npc_active_quests', 'npc_ambition_log']) {
      const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
      assert.ok(exists, `${t} should exist`);
    }
    const cols = db.prepare(`PRAGMA table_info(world_npcs)`).all().map(c => c.name);
    assert.ok(cols.includes('home_world_id'),  'world_npcs.home_world_id column should exist');
    assert.ok(cols.includes('ambition_score'), 'world_npcs.ambition_score column should exist');
  });

  it("backfills npc_residency for existing NPCs", () => {
    const db = freshDb();
    const rows = db.prepare(`SELECT npc_id, home_world_id, current_world_id FROM npc_residency`).all();
    assert.equal(rows.length, 3, 'all 3 seeded NPCs get residency');
    const a = rows.find(r => r.npc_id === 'npc_a');
    assert.equal(a.home_world_id, 'concordia-hub');
    assert.equal(a.current_world_id, 'concordia-hub');
  });
});

describe("Phase T awardNpcXp + levels", () => {
  it("inserts a fresh row + bumps level when XP crosses boundary", () => {
    const db = freshDb();
    const r1 = awardNpcXp(db, 'npc_a', 'combat', 50);
    assert.equal(r1.xp, 50);
    assert.equal(r1.level, 1);
    assert.equal(r1.leveledUp, false);

    const r2 = awardNpcXp(db, 'npc_a', 'combat', 600); // 650 cumulative
    assert.equal(r2.xp, 650);
    // xpForLevel(2) = floor(100 * 2^1.5) = 282; xpForLevel(3) = floor(100 * 3^1.5) = 519; xpForLevel(4) = 800
    assert.equal(r2.level, 3);
    assert.equal(r2.leveledUp, true);
  });

  it("levelFor matches xpForLevel inverse", () => {
    assert.equal(levelFor(0), 1);
    assert.equal(levelFor(xpForLevel(5)), 5);
    assert.equal(levelFor(xpForLevel(10) - 1), 9);
  });

  it("getNpcSkillLevels aggregates", () => {
    const db = freshDb();
    awardNpcXp(db, 'npc_a', 'combat', 100);
    awardNpcXp(db, 'npc_a', 'gather', 50);
    const lvls = getNpcSkillLevels(db, 'npc_a');
    assert.equal(lvls.combat.xp, 100);
    assert.equal(lvls.gather.xp, 50);
  });
});

describe("Phase T travel intents", () => {
  it("low-ambition NPCs do not generate travel intents", () => {
    const db = freshDb();
    db.prepare(`UPDATE world_npcs SET ambition_score = 0.2 WHERE id = ?`).run('npc_a');
    const npc = db.prepare(`SELECT id, world_id, ambition_score, current_location FROM world_npcs WHERE id = ?`).get('npc_a');
    npc.current_world_id = npc.world_id;
    const intent = chooseTravelGoal(npc, db);
    assert.equal(intent, null);
  });

  it("queueIntent + getOpenIntent round-trip", () => {
    const db = freshDb();
    db.prepare(`UPDATE world_npcs SET ambition_score = 0.9 WHERE id = ?`).run('npc_a');
    queueIntent(db, { npc_id: 'npc_a', destination_world_id: 'cyber', reason: 'skill_grind', executes_at: 0 });
    const open = getOpenIntent(db, 'npc_a');
    assert.equal(open.npc_id, 'npc_a');
    assert.equal(open.destination_world_id, 'cyber');
    assert.equal(open.status, 'pending');
  });
});

describe("Phase T quest runner", () => {
  it("tryAcceptQuestForNpc accepts up to 3 active quests", () => {
    const db = freshDb();
    const npc = { id: 'npc_a', archetype: 'warrior', current_world_id: 'concordia-hub' };
    const id1 = tryAcceptQuestForNpc(db, npc, { id: 'q1', payload: { step_count: 4 } });
    const id2 = tryAcceptQuestForNpc(db, npc, { id: 'q2', payload: { step_count: 4 } });
    const id3 = tryAcceptQuestForNpc(db, npc, { id: 'q3', payload: { step_count: 4 } });
    const id4 = tryAcceptQuestForNpc(db, npc, { id: 'q4', payload: { step_count: 4 } });
    assert.ok(id1 && id2 && id3, 'first 3 accepted');
    assert.equal(id4, null, '4th rejected');
    assert.equal(getActiveQuestsForNpc(db, 'npc_a').length, 3);
  });

  it("advanceNpcQuest completes when reaching step_count", () => {
    const db = freshDb();
    const npc = { id: 'npc_b', archetype: 'scholar', current_world_id: 'concordia-hub' };
    const aqid = tryAcceptQuestForNpc(db, npc, { id: 'qx', payload: { step_count: 3 } });
    let r = advanceNpcQuest(db, aqid); // step → 1
    assert.equal(r.completed, false);
    r = advanceNpcQuest(db, aqid);     // step → 2
    assert.equal(r.completed, false);
    r = advanceNpcQuest(db, aqid);     // step → 3 (== step_count) → completed
    assert.equal(r.completed, true);
  });

  it("rejects archetype mismatch when quest has archetype_hint", () => {
    const db = freshDb();
    const warrior = { id: 'npc_a', archetype: 'warrior', current_world_id: 'concordia-hub' };
    const id = tryAcceptQuestForNpc(db, warrior, { id: 'q_scholar', archetype_hint: 'scholar', payload: {} });
    assert.equal(id, null);
  });
});

describe("Phase T ambition", () => {
  it("pickAmbitionMove returns null for low-ambition NPCs", () => {
    const db = freshDb();
    const npc = { id: 'npc_a', ambition_score: 0.2, current_world_id: 'concordia-hub' };
    assert.equal(pickAmbitionMove(npc, db), null);
  });

  it("pickAmbitionMove returns a move shape for ambitious NPCs", () => {
    const db = freshDb();
    const npc = { id: 'npc_a', ambition_score: 0.8, current_world_id: 'concordia-hub' };
    const move = pickAmbitionMove(npc, db);
    assert.ok(move?.kind);
    assert.ok(['kingdom_bid', 'assassinate', 'learn_skill', 'arbitrage'].includes(move.kind));
  });

  it("recordAmbitionMove appends to npc_ambition_log", () => {
    const db = freshDb();
    recordAmbitionMove(db, { npcId: 'npc_a', moveKind: 'arbitrage', targetKind: 'world', targetId: null, worldId: 'cyber', outcome: 'queued' });
    const log = db.prepare(`SELECT * FROM npc_ambition_log WHERE npc_id = ?`).all('npc_a');
    assert.equal(log.length, 1);
    assert.equal(log[0].move_kind, 'arbitrage');
  });
});
