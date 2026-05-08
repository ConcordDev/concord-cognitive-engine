/**
 * Tier-2 contract tests for Layer 11: faction emergent strategy.
 *
 * Pins:
 *   - ensureFactionState idempotency
 *   - getRelation / setRelation primary-key ordering (a < b)
 *   - pickMove state machine (war momentum exits, expand collisions, etc.)
 *   - applyMove transactional log + state + relations + rival momentum
 *   - getRecentMoves ordering
 *   - runFactionStrategyCycle advances ready factions
 *
 * Run: node --test tests/embodied-faction-strategy.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  ensureFactionState,
  getRelation,
  setRelation,
  pickMove,
  applyMove,
  getRecentMoves,
  STANCES,
  MOVE_COOLDOWN_S,
} from "../lib/embodied/faction-strategy.js";
import { runFactionStrategyCycle } from "../emergent/faction-strategy-cycle.js";
import { up as up112 } from "../migrations/117_faction_strategy.js";

function setupDb() {
  const db = new Database(":memory:");
  up112(db);
  return db;
}

// ───────────────────────────────────────────────────────────────────────────
// ensureFactionState
// ───────────────────────────────────────────────────────────────────────────

describe("ensureFactionState", () => {
  it("creates a default-stance row for a fresh faction", () => {
    const db = setupDb();
    const r = ensureFactionState(db, "fac-a");
    assert.ok(r);
    assert.equal(r.faction_id, "fac-a");
    assert.equal(r.stance, "consolidate");
    assert.equal(r.momentum, 0);
  });

  it("idempotent on second call", () => {
    const db = setupDb();
    ensureFactionState(db, "fac-a");
    const r2 = ensureFactionState(db, "fac-a");
    assert.equal(r2.faction_id, "fac-a");
    const count = db.prepare(`SELECT COUNT(*) AS n FROM faction_strategy_state`).get();
    assert.equal(count.n, 1);
  });

  it("respects opts overrides on creation", () => {
    const db = setupDb();
    const r = ensureFactionState(db, "fac-x", { stance: "war", momentum: 0.3 });
    assert.equal(r.stance, "war");
    assert.ok(Math.abs(r.momentum - 0.3) < 0.0001);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getRelation / setRelation
// ───────────────────────────────────────────────────────────────────────────

describe("getRelation / setRelation", () => {
  it("default neutral when no row", () => {
    const db = setupDb();
    const r = getRelation(db, "a", "b");
    assert.equal(r.score, 0);
    assert.equal(r.kind, "neutral");
  });

  it("setRelation sorts pair so PRIMARY KEY holds", () => {
    const db = setupDb();
    setRelation(db, "z-faction", "a-faction", { score: -0.7, kind: "war" });
    const r = getRelation(db, "a-faction", "z-faction");
    assert.ok(Math.abs(r.score + 0.7) < 0.0001);
    assert.equal(r.kind, "war");
  });

  it("setRelation upserts (no duplicate insert)", () => {
    const db = setupDb();
    setRelation(db, "a", "b", { score: 0.3, kind: "tension" });
    setRelation(db, "a", "b", { score: 0.8, kind: "alliance" });
    const r = getRelation(db, "a", "b");
    assert.ok(Math.abs(r.score - 0.8) < 0.0001);
    assert.equal(r.kind, "alliance");
    const count = db.prepare(`SELECT COUNT(*) AS n FROM faction_relations`).get();
    assert.equal(count.n, 1);
  });

  it("rejects same-faction pair", () => {
    const db = setupDb();
    const r = setRelation(db, "a", "a", { score: 1, kind: "alliance" });
    assert.equal(r, null);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// pickMove — state machine
// ───────────────────────────────────────────────────────────────────────────

describe("pickMove state machine", () => {
  it("war + low momentum → SEEK_TRUCE → rebuild", () => {
    const state = { faction_id: "f1", stance: "war", momentum: -0.7, target_id: "f2", phase: 0 };
    const m = pickMove(state, [{ faction_id: "f2", stance: "war", momentum: 0.3 }]);
    assert.equal(m.move, "SEEK_TRUCE");
    assert.equal(m.newStance, "rebuild");
    assert.equal(m.newKind, "truce");
  });

  it("war + acceptable momentum → RAID", () => {
    const state = { faction_id: "f1", stance: "war", momentum: 0.1, target_id: "f2", phase: 0 };
    const m = pickMove(state, []);
    assert.equal(m.move, "RAID");
    assert.equal(m.target, "f2");
  });

  it("rebuild + recovered momentum → DECLARE_REBUILD → consolidate", () => {
    const state = { faction_id: "f1", stance: "rebuild", momentum: 0.05, phase: 0 };
    const m = pickMove(state, []);
    assert.equal(m.move, "DECLARE_REBUILD");
    assert.equal(m.newStance, "consolidate");
  });

  it("isolation → DECLARE_REBUILD → consolidate", () => {
    const state = { faction_id: "f1", stance: "isolation", momentum: 0, phase: 0 };
    const m = pickMove(state, []);
    assert.equal(m.move, "DECLARE_REBUILD");
    assert.equal(m.newStance, "consolidate");
  });

  it("expand always returns a valid stance transition or move", () => {
    const state = { faction_id: "f1", stance: "expand", momentum: 0.1, phase: 0 };
    const m = pickMove(state, [{ faction_id: "f2", stance: "expand", momentum: 0 }]);
    assert.ok(["DECLARE_WAR", "FORTIFY", "PROCLAIM_EXPANSION"].includes(m.move));
  });

  it("returned move always has a summary string", () => {
    for (const stance of STANCES) {
      const m = pickMove({ faction_id: "f1", stance, momentum: 0, phase: 0 }, []);
      assert.ok(typeof m.summary === "string" && m.summary.length > 0,
        `move for stance ${stance} is missing summary`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// applyMove — transactional persistence
// ───────────────────────────────────────────────────────────────────────────

describe("applyMove", () => {
  let db;
  beforeEach(() => {
    db = setupDb();
    ensureFactionState(db, "f1", { stance: "war", momentum: 0.2 });
    ensureFactionState(db, "f2", { stance: "war", momentum: 0.0 });
    setRelation(db, "f1", "f2", { score: -0.5, kind: "war" });
  });

  it("logs the move + advances state + cooldown", () => {
    const allStates = db.prepare(`SELECT * FROM faction_strategy_state`).all();
    const f1 = allStates.find(s => s.faction_id === "f1");
    const peers = allStates.filter(s => s.faction_id !== "f1");

    const picked = pickMove(f1, peers);
    const applied = applyMove(db, "f1", picked, allStates);
    assert.ok(applied);

    const log = db.prepare(`SELECT * FROM faction_strategy_log WHERE faction_id = ?`).all("f1");
    assert.equal(log.length, 1);

    const state = db.prepare(`SELECT * FROM faction_strategy_state WHERE faction_id = ?`).get("f1");
    assert.ok(state.next_move_at >= Math.floor(Date.now() / 1000) + MOVE_COOLDOWN_S - 5);
    assert.equal(state.last_move_id, log[0].id);
    assert.equal(state.phase, 1);
  });

  it("RAID mirrors momentum onto the rival faction", () => {
    const allStates = db.prepare(`SELECT * FROM faction_strategy_state`).all();
    // Force a deterministic positive raid by patching the picked spec.
    const picked = {
      move: "RAID", target: "f2",
      summary: "test raid",
      deltaMomentum: 0.1,
    };
    applyMove(db, "f1", picked, allStates);
    const f1After = db.prepare(`SELECT momentum FROM faction_strategy_state WHERE faction_id = ?`).get("f1");
    const f2After = db.prepare(`SELECT momentum FROM faction_strategy_state WHERE faction_id = ?`).get("f2");
    assert.ok(Math.abs(f1After.momentum - 0.3) < 0.0001, `f1 = ${f1After.momentum}`);
    assert.ok(Math.abs(f2After.momentum - (-0.1)) < 0.0001, `f2 = ${f2After.momentum}`);
  });

  it("DECLARE_WAR sets relations score=-1 kind='war'", () => {
    const allStates = db.prepare(`SELECT * FROM faction_strategy_state`).all();
    const picked = {
      move: "DECLARE_WAR", target: "f2",
      summary: "test war declaration",
      deltaMomentum: 0.05, newStance: "war",
      newKind: "war", newScore: -1,
    };
    applyMove(db, "f1", picked, allStates);
    const rel = getRelation(db, "f1", "f2");
    assert.equal(rel.kind, "war");
    assert.ok(Math.abs(rel.score + 1) < 0.0001);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// runFactionStrategyCycle
// ───────────────────────────────────────────────────────────────────────────

describe("runFactionStrategyCycle", () => {
  it("returns ok with 0 advanced when no factions exist", async () => {
    const db = setupDb();
    const r = await runFactionStrategyCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.advanced, 0);
  });

  it("advances ready factions and respects cooldown", async () => {
    const db = setupDb();
    ensureFactionState(db, "f1");
    ensureFactionState(db, "f2");
    const r1 = await runFactionStrategyCycle({ db });
    assert.equal(r1.advanced, 2);

    // Both now have next_move_at in the future — second pass advances 0.
    const r2 = await runFactionStrategyCycle({ db });
    assert.equal(r2.advanced, 0);
  });

  it("logs each move", async () => {
    const db = setupDb();
    ensureFactionState(db, "f1");
    await runFactionStrategyCycle({ db });
    const recent = getRecentMoves(db);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].faction_id, "f1");
  });
});
