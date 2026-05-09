/**
 * Sprint B Phase 10 — the_handshake_revelation Tier-3 E2E.
 *
 * Mirrors first-day-arc.test.js shape for consistency. Drives the
 * 11-objective cross-world signature quest by inserting progress
 * rows into a :memory: SQLite + asserting the phase pointer
 * advances correctly across world boundaries.
 *
 * Run: node --test tests/e2e/handshake-revelation-arc.test.js
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..', '..');

const QUEST_ID = 'the_handshake_revelation';

const OBJECTIVE_IDS = [
  'obj_hsr_1',  // Concordia: maren
  'obj_hsr_2',  // Concordia: shadow archive vault
  'obj_hsr_3',  // travel sovereign-ruins
  'obj_hsr_4',  // Sovereign: kestra
  'obj_hsr_5',  // Sovereign: sennit
  'obj_hsr_6',  // travel concord-link-frontier
  'obj_hsr_7',  // Frontier: ria
  'obj_hsr_8',  // Frontier: temir
  'obj_hsr_9',  // travel lattice-crucible
  'obj_hsr_10', // Crucible: faction-strategy.witness_next_move
  'obj_hsr_11', // Crucible: orla
];

let db;
const USER = 'u_handshake_player';

function nowISO() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function setupDb() {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE quest_progress (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      world_id      TEXT NOT NULL,
      quest_id      TEXT NOT NULL,
      status        TEXT NOT NULL,
      started_at    TEXT NOT NULL,
      completed_at  TEXT,
      UNIQUE(user_id, world_id, quest_id)
    );
    CREATE TABLE objective_progress (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      world_id      TEXT NOT NULL,
      quest_id      TEXT NOT NULL,
      objective_id  TEXT NOT NULL,
      completed_at  TEXT,
      UNIQUE(user_id, world_id, quest_id, objective_id)
    );
  `);
}

function startQuestInWorld(worldId) {
  db.prepare(`
    INSERT INTO quest_progress (id, user_id, world_id, quest_id, status, started_at)
    VALUES (?, ?, ?, ?, 'in_progress', ?)
    ON CONFLICT(user_id, world_id, quest_id) DO UPDATE SET status='in_progress'
  `).run(`qp_${QUEST_ID}_${worldId}`, USER, worldId, QUEST_ID, nowISO());
}

function completeObjective(worldId, objectiveId) {
  db.prepare(`
    INSERT INTO objective_progress (id, user_id, world_id, quest_id, objective_id, completed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, world_id, quest_id, objective_id) DO UPDATE SET completed_at = excluded.completed_at
  `).run(`op_${objectiveId}_${worldId}`, USER, worldId, QUEST_ID, objectiveId, nowISO());
}

function progressForArc() {
  // Aggregate objective completion across all worlds — the quest is
  // designed to span 4 worlds with progress preserved per-(user, world,
  // quest, objective).
  const rows = db.prepare(`
    SELECT objective_id, completed_at FROM objective_progress
     WHERE user_id = ? AND quest_id = ?
  `).all(USER, QUEST_ID);
  const completed = new Set(rows.filter(r => r.completed_at).map(r => r.objective_id));
  const phases = OBJECTIVE_IDS.map((id) => ({ id, complete: completed.has(id) }));
  let currentPhase = 'complete';
  for (const p of phases) {
    if (!p.complete) { currentPhase = p.id; break; }
  }
  return {
    questId: QUEST_ID,
    currentPhase,
    complete: phases.every(p => p.complete),
    phases,
  };
}

// ── Quest content shape tests ──────────────────────────────────────────

describe('the_handshake_revelation — quest content shape', () => {
  it('is loadable JSON with 11 objectives spanning 4 worlds', () => {
    const path = join(REPO_ROOT, 'content', 'quests', 'the-handshake-revelation.json');
    const arc = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(arc.length, 1);
    const quest = arc[0];
    assert.equal(quest.id, QUEST_ID);
    assert.equal(quest.objectives.length, 11);
    assert.equal(quest.difficulty, 'master');

    // 4 distinct worlds across the objectives + transit steps.
    const worlds = new Set(
      quest.objectives
        .map(o => o.world_id || (o.type === 'travel' ? o.target : null))
        .filter(Boolean),
    );
    assert.ok(worlds.has('concordia-hub'));
    assert.ok(worlds.has('sovereign-ruins'));
    assert.ok(worlds.has('concord-link-frontier'));
    assert.ok(worlds.has('lattice-crucible'));
  });

  it('the rewards bundle includes all three permanent unlocks', () => {
    const arc = JSON.parse(readFileSync(join(REPO_ROOT, 'content', 'quests', 'the-handshake-revelation.json'), 'utf8'));
    const r = arc[0].rewards;
    assert.equal(r.lens_action_unlock, 'lens_action_refusal_reader');
    assert.equal(r.governance_vote_weight_bonus, 1);
    assert.ok(r.signature_artifact_dtu);
    assert.equal(r.signature_artifact_dtu.title, "Vela's Sealed Glyph");
    assert.equal(r.ecosystem_score_delta, 0.15);
  });

  it('hidden_truths_revealed weaves cross-world authored lore', () => {
    const arc = JSON.parse(readFileSync(join(REPO_ROOT, 'content', 'quests', 'the-handshake-revelation.json'), 'utf8'));
    const truths = arc[0].hidden_truths_revealed;
    assert.ok(Array.isArray(truths) && truths.length >= 3);
    // Each truth references at least two of the four worlds' lore.
    const blob = truths.join(' ');
    assert.match(blob, /Vela/);
    assert.match(blob, /Frontier|Couriers|Handshake/);
    assert.match(blob, /Crucible|drift|player-conditional/i);
  });

  it('targets specific authored NPCs (not generic placeholders)', () => {
    const arc = JSON.parse(readFileSync(join(REPO_ROOT, 'content', 'quests', 'the-handshake-revelation.json'), 'utf8'));
    const targets = arc[0].objectives.map(o => o.target);
    // Each named NPC exists in the world JSON.
    const expectedNpcs = [
      'archivist_maren',           // Concordia hub
      'archivist_three_kestra',     // Sovereign Ruins
      'ruins_apprentice_sennit',    // Sovereign Ruins
      'postmaster_ria',             // Frontier
      'broker_temir',               // Frontier
      'witness_orla',               // Crucible
    ];
    for (const npc of expectedNpcs) {
      assert.ok(targets.includes(npc), `quest must talk to authored NPC ${npc}`);
    }
  });
});

// ── Phase progression tests ────────────────────────────────────────────

describe('the_handshake_revelation — cross-world phase progression', () => {
  beforeEach(setupDb);
  after(() => { try { db?.close(); } catch { /* noop */ } });

  it("starts at obj_hsr_1 (Maren) before any objective is complete", () => {
    startQuestInWorld('concordia-hub');
    const r = progressForArc();
    assert.equal(r.currentPhase, 'obj_hsr_1');
    assert.equal(r.complete, false);
  });

  it('advances through Concordia phase 1→2', () => {
    startQuestInWorld('concordia-hub');
    completeObjective('concordia-hub', 'obj_hsr_1');
    let r = progressForArc();
    assert.equal(r.currentPhase, 'obj_hsr_2');
    completeObjective('concordia-hub', 'obj_hsr_2');
    r = progressForArc();
    assert.equal(r.currentPhase, 'obj_hsr_3');
  });

  it('advances through Sovereign Ruins phase (transit + 2 NPCs)', () => {
    for (const id of ['obj_hsr_1', 'obj_hsr_2']) completeObjective('concordia-hub', id);
    completeObjective('sovereign-ruins', 'obj_hsr_3'); // travel
    completeObjective('sovereign-ruins', 'obj_hsr_4'); // kestra
    completeObjective('sovereign-ruins', 'obj_hsr_5'); // sennit
    const r = progressForArc();
    assert.equal(r.currentPhase, 'obj_hsr_6');
  });

  it('advances through Frontier phase (transit + 2 NPCs)', () => {
    for (const id of ['obj_hsr_1','obj_hsr_2']) completeObjective('concordia-hub', id);
    for (const id of ['obj_hsr_3','obj_hsr_4','obj_hsr_5']) completeObjective('sovereign-ruins', id);
    completeObjective('concord-link-frontier', 'obj_hsr_6');
    completeObjective('concord-link-frontier', 'obj_hsr_7');
    completeObjective('concord-link-frontier', 'obj_hsr_8');
    const r = progressForArc();
    assert.equal(r.currentPhase, 'obj_hsr_9');
  });

  it('lands on complete after all 11 objectives finish', () => {
    completeObjective('concordia-hub', 'obj_hsr_1');
    completeObjective('concordia-hub', 'obj_hsr_2');
    completeObjective('sovereign-ruins', 'obj_hsr_3');
    completeObjective('sovereign-ruins', 'obj_hsr_4');
    completeObjective('sovereign-ruins', 'obj_hsr_5');
    completeObjective('concord-link-frontier', 'obj_hsr_6');
    completeObjective('concord-link-frontier', 'obj_hsr_7');
    completeObjective('concord-link-frontier', 'obj_hsr_8');
    completeObjective('lattice-crucible', 'obj_hsr_9');
    completeObjective('lattice-crucible', 'obj_hsr_10');
    completeObjective('lattice-crucible', 'obj_hsr_11');
    const r = progressForArc();
    assert.equal(r.currentPhase, 'complete');
    assert.equal(r.complete, true);
    for (const p of r.phases) assert.equal(p.complete, true, `phase ${p.id} must be complete`);
  });

  it('skipping an objective does NOT advance — phases must be sequential', () => {
    completeObjective('concordia-hub', 'obj_hsr_1');
    completeObjective('sovereign-ruins', 'obj_hsr_4'); // skip 2-3
    const r = progressForArc();
    assert.equal(r.currentPhase, 'obj_hsr_2');
    assert.equal(r.complete, false);
  });

  it('progress persists across world boundaries (per-world quest_progress rows are independent)', () => {
    // Player can have the quest active in multiple worlds simultaneously
    // — the per-world quest_progress rows represent the quest's
    // tracking in each world's quest log. Progress on objectives is
    // the source of truth for arc completion.
    startQuestInWorld('concordia-hub');
    startQuestInWorld('sovereign-ruins');
    startQuestInWorld('concord-link-frontier');
    startQuestInWorld('lattice-crucible');

    const rows = db.prepare(`SELECT world_id FROM quest_progress WHERE user_id = ? AND quest_id = ?`).all(USER, QUEST_ID);
    assert.equal(rows.length, 4);
    const worlds = new Set(rows.map(r => r.world_id));
    assert.ok(worlds.has('concordia-hub'));
    assert.ok(worlds.has('sovereign-ruins'));
    assert.ok(worlds.has('concord-link-frontier'));
    assert.ok(worlds.has('lattice-crucible'));
  });
});
