/**
 * Tier-3 end-to-end first-day arc test:
 *   first_day_claim_land → first_day_invite_friend →
 *   first_day_attend_event → first_day_witness_faction_move
 *
 * Picks up where first_cycle_commune leaves off. Drives each authored
 * quest in content/quests/first-day-arc.json by inserting progress
 * rows into a :memory: SQLite database, then asserts the arc's
 * progression through the four phases.
 *
 * Run: node --test tests/e2e/first-day-arc.test.js
 */

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const FIRST_DAY_QUEST_IDS = [
  "first_day_claim_land",
  "first_day_invite_friend",
  "first_day_attend_event",
  "first_day_witness_faction_move",
];

const PHASE_BY_QUEST = {
  first_day_claim_land:          "claim_land",
  first_day_invite_friend:       "invite_friend",
  first_day_attend_event:        "attend_event",
  first_day_witness_faction_move: "witness_faction_move",
};

let db;
const USER = "u_first_day_player";
const WORLD = "concordia-hub";

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function setupDb() {
  db = new Database(":memory:");
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
  `);
}

function startQuest(questId) {
  db.prepare(`
    INSERT INTO quest_progress (id, user_id, world_id, quest_id, status, started_at)
    VALUES (?, ?, ?, ?, 'in_progress', ?)
    ON CONFLICT(user_id, world_id, quest_id) DO UPDATE SET status='in_progress', completed_at=NULL
  `).run(`qp_${questId}`, USER, WORLD, questId, nowISO());
}

function completeQuest(questId) {
  db.prepare(`
    INSERT INTO quest_progress (id, user_id, world_id, quest_id, status, started_at, completed_at)
    VALUES (?, ?, ?, ?, 'complete', ?, ?)
    ON CONFLICT(user_id, world_id, quest_id) DO UPDATE SET status='complete', completed_at=excluded.completed_at
  `).run(`qp_${questId}`, USER, WORLD, questId, nowISO(), nowISO());
}

/** Mirror of deriveFirstCycleProgress — kept inline since the first-day
 *  arc is brand-new and doesn't have a dedicated lib helper yet. The
 *  shape mimics the first-cycle helper for consistency. */
function deriveFirstDayProgress(db, userId, worldId) {
  const rows = db.prepare(`
    SELECT quest_id, status FROM quest_progress
     WHERE user_id = ? AND world_id = ?
  `).all(userId, worldId);
  const byId = new Map(rows.map(r => [r.quest_id, r]));
  const phases = FIRST_DAY_QUEST_IDS.map(qid => {
    const row = byId.get(qid);
    return {
      questId: qid,
      phase: PHASE_BY_QUEST[qid],
      status: row?.status ?? "not_started",
      complete: row?.status === "complete",
    };
  });
  let currentPhase = "complete";
  for (const p of phases) {
    if (!p.complete) { currentPhase = p.phase; break; }
  }
  return {
    ok: true,
    tutorial: "first_day_arc",
    currentPhase,
    complete: phases.every(p => p.complete),
    phases,
  };
}

describe("First Day Arc — quest content shape", () => {
  it("is loadable JSON with 4 quests + canonical chain", () => {
    const path = join(REPO_ROOT, "content", "quests", "first-day-arc.json");
    const raw = readFileSync(path, "utf8");
    const arc = JSON.parse(raw);
    assert.equal(arc.length, 4);
    assert.deepEqual(arc.map(q => q.id), FIRST_DAY_QUEST_IDS);
    // Each quest references the next via next_quest_id (terminal one is null).
    for (let i = 0; i < arc.length - 1; i++) {
      assert.equal(arc[i].next_quest_id, arc[i + 1].id, `${arc[i].id} must point to ${arc[i + 1].id}`);
    }
    assert.equal(arc[arc.length - 1].next_quest_id, null, "last quest must terminate the chain");
    // First-day prereq is first_cycle_commune (the journey before this one).
    assert.deepEqual(arc[0].prerequisites, ["first_cycle_commune"]);
  });

  it("each quest carries reward shape (concord_coin + skill_xp)", () => {
    const path = join(REPO_ROOT, "content", "quests", "first-day-arc.json");
    const arc = JSON.parse(readFileSync(path, "utf8"));
    for (const q of arc) {
      assert.ok(typeof q.rewards.concord_coin === "number" && q.rewards.concord_coin > 0,
        `${q.id} must have concord_coin reward`);
      assert.ok(typeof q.rewards.skill_xp === "object" && q.rewards.skill_xp !== null,
        `${q.id} must have skill_xp object`);
    }
  });

  it("each quest exercises a different system (claim/invite/event/witness)", () => {
    const path = join(REPO_ROOT, "content", "quests", "first-day-arc.json");
    const arc = JSON.parse(readFileSync(path, "utf8"));
    const objectiveTypes = new Set(
      arc.flatMap(q => (q.objectives || []).map(o => o.type))
    );
    // Should hit at least four different objective types across the arc:
    // reach_location + macro + rsvp_event + attend_event + talk_to_npc.
    assert.ok(objectiveTypes.size >= 4,
      `arc must touch ≥4 different objective types; got ${[...objectiveTypes]}`);

    // Specific load-bearing systems wired in:
    const macroTargets = arc.flatMap(q =>
      (q.objectives || []).filter(o => o.type === "macro").map(o => o.target),
    );
    assert.ok(macroTargets.includes("land-claims.claim"));
    assert.ok(macroTargets.includes("land-claims.invite_to_claim"));
    assert.ok(macroTargets.includes("faction-strategy.witness_next_move"));

    // Event-system objectives:
    const eventTypes = arc.flatMap(q => (q.objectives || []).map(o => o.type))
      .filter(t => t === "rsvp_event" || t === "attend_event");
    assert.ok(eventTypes.length >= 2, "must include rsvp_event AND attend_event");
  });
});

describe("First Day Arc — phase progression", () => {
  beforeEach(setupDb);
  after(() => { try { db?.close(); } catch { /* noop */ } });

  it("starts at currentPhase 'claim_land' before any quest", () => {
    const r = deriveFirstDayProgress(db, USER, WORLD);
    assert.equal(r.currentPhase, "claim_land");
    assert.equal(r.complete, false);
  });

  it("in_progress doesn't advance the pointer", () => {
    startQuest("first_day_claim_land");
    const r = deriveFirstDayProgress(db, USER, WORLD);
    assert.equal(r.currentPhase, "claim_land");
    assert.equal(r.phases[0].status, "in_progress");
  });

  it("advances claim_land → invite_friend after claim completes", () => {
    completeQuest("first_day_claim_land");
    const r = deriveFirstDayProgress(db, USER, WORLD);
    assert.equal(r.currentPhase, "invite_friend");
    assert.equal(r.phases[0].complete, true);
  });

  it("advances invite_friend → attend_event after invite completes", () => {
    completeQuest("first_day_claim_land");
    completeQuest("first_day_invite_friend");
    const r = deriveFirstDayProgress(db, USER, WORLD);
    assert.equal(r.currentPhase, "attend_event");
    assert.equal(r.phases[1].complete, true);
  });

  it("advances attend_event → witness_faction_move after event completes", () => {
    completeQuest("first_day_claim_land");
    completeQuest("first_day_invite_friend");
    completeQuest("first_day_attend_event");
    const r = deriveFirstDayProgress(db, USER, WORLD);
    assert.equal(r.currentPhase, "witness_faction_move");
    assert.equal(r.phases[2].complete, true);
  });

  it("lands on 'complete' after all four quests finish", () => {
    for (const q of FIRST_DAY_QUEST_IDS) completeQuest(q);
    const r = deriveFirstDayProgress(db, USER, WORLD);
    assert.equal(r.currentPhase, "complete");
    assert.equal(r.complete, true);
    for (const p of r.phases) assert.equal(p.complete, true);
  });

  it("skipping a quest does NOT advance — phases must be sequential", () => {
    completeQuest("first_day_claim_land");
    completeQuest("first_day_attend_event"); // skip invite
    const r = deriveFirstDayProgress(db, USER, WORLD);
    assert.equal(r.currentPhase, "invite_friend");
    assert.equal(r.complete, false);
  });
});
