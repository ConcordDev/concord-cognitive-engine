// Legibility W3 — thread the cause. Pins that applyMove stamps causal context
// (previous_momentum, relation_score, trigger) into faction_strategy_log.payload_json
// so the news/stake surfaces can show WHY, not just what.
//
// Run: node --test tests/faction-cause-payload.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as mig117 from "../migrations/117_faction_strategy.js";
import { ensureFactionState, setRelation, applyMove } from "../lib/embodied/faction-strategy.js";

let db;
beforeEach(() => {
  db = new Database(":memory:");
  mig117.up(db);
  ensureFactionState(db, "fA");
  ensureFactionState(db, "fB");
});
afterEach(() => { try { db.close(); } catch { /* noop */ } });

describe("W3 — faction move records its cause", () => {
  it("stamps previous_momentum + relation_score + trigger into the payload", () => {
    setRelation(db, "fA", "fB", { score: -0.8, kind: "war" }); // hostile → a DECLARE_WAR reads as retaliation
    applyMove(db, "fA", { move: "DECLARE_WAR", target: "fB", summary: "fA declares war on fB", deltaMomentum: 0.1 }, []);
    const row = db.prepare(`SELECT payload_json FROM faction_strategy_log WHERE faction_id = 'fA' ORDER BY occurred_at DESC LIMIT 1`).get();
    const p = JSON.parse(row.payload_json);
    assert.equal(typeof p.previous_momentum, "number");
    assert.equal(p.relation_score, -0.8);
    assert.equal(p.trigger, "retaliation"); // hostile relation → retaliation, not expansion_collision
  });

  it("a war with no prior hostility reads as expansion_collision", () => {
    setRelation(db, "fA", "fB", { score: 0.1, kind: "neutral" });
    applyMove(db, "fA", { move: "DECLARE_WAR", target: "fB", summary: "x", deltaMomentum: 0.1 }, []);
    const p = JSON.parse(db.prepare(`SELECT payload_json FROM faction_strategy_log WHERE faction_id='fA' ORDER BY occurred_at DESC LIMIT 1`).get().payload_json);
    assert.equal(p.trigger, "expansion_collision");
  });
});
