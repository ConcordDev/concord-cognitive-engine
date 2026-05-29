/**
 * E3 — skill-evolution drama + faction E→S rank ladder.
 *
 * Pins:
 *   - composeEvolutionBeat is deterministic + well-shaped (the "Arise" beat).
 *   - rankLetterFor / tierToRank map the 6 tiers onto E→S (level-independent).
 *   - computeFactionReputation surfaces a `rank`.
 *   - refreshFactionReputationCache emits `reputation:rank-up` on an UPWARD tier
 *     crossing only (not on first compute, not on a downward move).
 *
 * Run: node --test tests/e3-evolution-rank.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up153 } from "../migrations/153_npc_opinions.js";
import { composeEvolutionBeat } from "../lib/skill-evolution.js";
import {
  rankLetterFor, tierToRank, scoreToTier,
  computeFactionReputation, refreshFactionReputationCache,
} from "../lib/faction-reputation.js";

describe("E3 — composeEvolutionBeat", () => {
  it("is deterministic for the same (skill, level)", () => {
    const a = composeEvolutionBeat("Cinder Step", 30);
    const b = composeEvolutionBeat("Cinder Step", 30);
    assert.deepEqual(a, b);
    assert.ok(a.title.includes("Cinder Step"));
    assert.ok(a.subtitle.includes("30"));
    assert.equal(a.tier, 3);
  });

  it("differs across milestone tiers", () => {
    const t1 = composeEvolutionBeat("Cinder Step", 10);
    const t3 = composeEvolutionBeat("Cinder Step", 30);
    assert.notEqual(t1.title, t3.title);
  });
});

describe("E3 — faction E→S rank ladder", () => {
  it("maps the 6 tiers onto E→S", () => {
    assert.equal(tierToRank("hated"), "E");
    assert.equal(tierToRank("hostile"), "D");
    assert.equal(tierToRank("neutral"), "C");
    assert.equal(tierToRank("friendly"), "B");
    assert.equal(tierToRank("honored"), "A");
    assert.equal(tierToRank("exalted"), "S");
  });

  it("rankLetterFor reads straight off score (level-independent)", () => {
    assert.equal(rankLetterFor(-80), "E");   // hated
    assert.equal(rankLetterFor(0), "C");     // neutral
    assert.equal(rankLetterFor(90), "S");    // exalted
    assert.equal(scoreToTier(90), "exalted");
  });
});

describe("E3 — reputation:rank-up emission", () => {
  let db, captured, prev;

  function setup() {
    const d = new Database(":memory:");
    up153(d);
    d.exec(`
      CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, faction TEXT);
      CREATE TABLE player_faction_reputation_cache (
        user_id TEXT, world_id TEXT, faction_id TEXT,
        score REAL, tier TEXT, opinion_count INTEGER, updated_at INTEGER,
        PRIMARY KEY (user_id, world_id, faction_id)
      );
    `);
    // two faction NPCs the player has opinions with
    d.prepare(`INSERT INTO world_npcs (id, world_id, faction) VALUES ('n1','w','iron_guild'),('n2','w','iron_guild')`).run();
    return d;
  }

  function setOpinion(d, npc, score) {
    d.prepare(`
      INSERT INTO character_opinions (npc_id, target_kind, target_id, score, kind)
      VALUES (?, 'player', 'u1', ?, 'neutral')
      ON CONFLICT(npc_id, target_kind, target_id) DO UPDATE SET score = excluded.score
    `).run(npc, score);
  }

  beforeEach(() => {
    prev = globalThis._concordRealtimeEmit;
    captured = [];
    globalThis._concordRealtimeEmit = (name, payload) => captured.push({ name, payload });
    db = setup();
  });
  afterEach(() => { globalThis._concordRealtimeEmit = prev; });

  it("includes rank in computed reputation", () => {
    setOpinion(db, "n1", 80); setOpinion(db, "n2", 80);
    const rep = computeFactionReputation(db, "u1", "iron_guild", "w");
    assert.equal(rep.tier, "exalted");
    assert.equal(rep.rank, "S");
  });

  it("does NOT emit on first compute (no prior tier)", () => {
    setOpinion(db, "n1", 20); setOpinion(db, "n2", 20); // friendly
    refreshFactionReputationCache(db);
    assert.equal(captured.filter(c => c.name === "reputation:rank-up").length, 0);
  });

  it("emits rank-up on an upward tier crossing", () => {
    setOpinion(db, "n1", 20); setOpinion(db, "n2", 20); // friendly (B)
    refreshFactionReputationCache(db);                  // seeds cache, no event
    setOpinion(db, "n1", 90); setOpinion(db, "n2", 90); // exalted (S)
    refreshFactionReputationCache(db);
    const ev = captured.filter(c => c.name === "reputation:rank-up");
    assert.equal(ev.length, 1);
    assert.equal(ev[0].payload.fromRank, "B");
    assert.equal(ev[0].payload.rank, "S");
    assert.equal(ev[0].payload.tier, "exalted");
  });

  it("does NOT emit on a downward crossing", () => {
    setOpinion(db, "n1", 90); setOpinion(db, "n2", 90); // exalted
    refreshFactionReputationCache(db);
    setOpinion(db, "n1", 20); setOpinion(db, "n2", 20); // drop to friendly
    refreshFactionReputationCache(db);
    assert.equal(captured.filter(c => c.name === "reputation:rank-up").length, 0);
  });
});
