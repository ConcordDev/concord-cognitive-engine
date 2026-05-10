/**
 * Tier-2 contract tests for Sprint C / Track A2 — character_opinions.
 *
 * Pins:
 *   - recordOpinionEvent inserts at neutral, applies delta, recomputes kind
 *   - getOpinion round-trip
 *   - decayOpinions drifts toward 0 only when last_event_at < now-24h
 *   - cascadeFamilyAndAlly: heir 50% + faction siblings 25%
 *   - aggregateOpinionsToTarget for kingdom-loyalty queries
 *
 * Run: node --test tests/npc-opinions.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  recordOpinionEvent,
  getOpinion,
  decayOpinions,
  cascadeFamilyAndAlly,
  aggregateOpinionsToTarget,
  OPINION_CONSTANTS,
} from "../lib/npc-opinions.js";
import { up as up153 } from "../migrations/153_npc_opinions.js";

function setupDb() {
  const db = new Database(":memory:");
  up153(db);
  // For cascade tests we need world_npcs + npc_inheritance_links.
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_npcs (
      id TEXT PRIMARY KEY, faction TEXT, is_dead INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS npc_inheritance_links (
      id TEXT PRIMARY KEY, deceased_npc_id TEXT, heir_npc_id TEXT
    );
  `);
  return db;
}

describe("Sprint C / A2 — recordOpinionEvent", () => {
  it("inserts at neutral 0 and applies delta with kind recomputation", () => {
    const db = setupDb();
    const r1 = recordOpinionEvent(db, { npcId: "n1", targetKind: "player", targetId: "u1" }, 35, "saved my life");
    assert.equal(r1.score, 35);
    assert.equal(r1.kind, "likes");

    const r2 = recordOpinionEvent(db, { npcId: "n1", targetKind: "player", targetId: "u1" }, 40);
    assert.equal(r2.score, 75);
    assert.equal(r2.kind, "admires");
  });

  it("noop on zero delta or missing inputs", () => {
    const db = setupDb();
    assert.equal(recordOpinionEvent(db, { npcId: "n1", targetKind: "player", targetId: "u1" }, 0).action, "noop");
    assert.equal(recordOpinionEvent(db, {}, 5).ok, false);
  });

  it("clamps to -100..+100", () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "n1", targetKind: "player", targetId: "u1" }, 200);
    assert.equal(getOpinion(db, "n1", "player", "u1").score, 100);
    recordOpinionEvent(db, { npcId: "n1", targetKind: "player", targetId: "u1" }, -300);
    assert.equal(getOpinion(db, "n1", "player", "u1").score, -100);
    assert.equal(getOpinion(db, "n1", "player", "u1").kind, "hates");
  });

  it("kind boundaries", () => {
    assert.equal(OPINION_CONSTANTS.KIND_FROM_SCORE(80), "admires");
    assert.equal(OPINION_CONSTANTS.KIND_FROM_SCORE(40), "likes");
    assert.equal(OPINION_CONSTANTS.KIND_FROM_SCORE(15), "respects");
    assert.equal(OPINION_CONSTANTS.KIND_FROM_SCORE(0), "neutral");
    assert.equal(OPINION_CONSTANTS.KIND_FROM_SCORE(-15), "wary");
    assert.equal(OPINION_CONSTANTS.KIND_FROM_SCORE(-40), "envies");
    assert.equal(OPINION_CONSTANTS.KIND_FROM_SCORE(-60), "fears");
    assert.equal(OPINION_CONSTANTS.KIND_FROM_SCORE(-90), "hates");
  });
});

describe("Sprint C / A2 — decayOpinions", () => {
  it("drifts positive scores toward 0 only after 24h dormancy", () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "n1", targetKind: "player", targetId: "u1" }, 50);
    // Immediate decay does nothing (last_event_at fresh).
    decayOpinions(db);
    assert.equal(getOpinion(db, "n1", "player", "u1").score, 50);
    // Backdate.
    db.prepare(`UPDATE character_opinions SET last_event_at = unixepoch() - 86500`).run();
    decayOpinions(db);
    assert.equal(getOpinion(db, "n1", "player", "u1").score, 49); // 50 - 1
  });

  it("drifts negative scores toward 0 with same logic", () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "n1", targetKind: "player", targetId: "u1" }, -40);
    db.prepare(`UPDATE character_opinions SET last_event_at = unixepoch() - 86500`).run();
    decayOpinions(db);
    assert.equal(getOpinion(db, "n1", "player", "u1").score, -39);
  });
});

describe("Sprint C / A2 — cascadeFamilyAndAlly", () => {
  it("ripples delta to heirs (50%) and faction siblings (25%)", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO world_npcs (id, faction) VALUES ('decedent','iron_wardens')`).run();
    db.prepare(`INSERT INTO world_npcs (id, faction) VALUES ('sib1','iron_wardens')`).run();
    db.prepare(`INSERT INTO world_npcs (id, faction) VALUES ('sib2','iron_wardens')`).run();
    db.prepare(`INSERT INTO npc_inheritance_links (id, deceased_npc_id, heir_npc_id) VALUES ('l1','decedent','heir1')`).run();

    const r = cascadeFamilyAndAlly(db, "decedent", "player", "u1", -40, "killed kin");
    assert.equal(r.heirs, 1);
    assert.equal(r.faction, 2);
    assert.equal(getOpinion(db, "heir1", "player", "u1").score, -20); // 50% of -40
    assert.equal(getOpinion(db, "sib1", "player", "u1").score, -10);  // 25% of -40
    assert.equal(getOpinion(db, "sib2", "player", "u1").score, -10);
  });
});

describe("Sprint C / A2 — aggregateOpinionsToTarget", () => {
  it("returns avg/count/low/high for a target", () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "n1", targetKind: "kingdom", targetId: "k1" }, 60);
    recordOpinionEvent(db, { npcId: "n2", targetKind: "kingdom", targetId: "k1" }, -20);
    recordOpinionEvent(db, { npcId: "n3", targetKind: "kingdom", targetId: "k1" }, 5);
    const r = aggregateOpinionsToTarget(db, "kingdom", "k1");
    assert.equal(r.count, 3);
    assert.ok(Math.abs(r.avg - 15) <= 1); // (60 + -20 + 5) / 3 = 15
    assert.equal(r.low, -20);
    assert.equal(r.high, 60);
  });
});
