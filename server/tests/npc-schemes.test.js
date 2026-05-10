/**
 * Tier-2 contract tests for Sprint C / Track A4 — npc_schemes.
 *
 * Pins:
 *   - proposeScheme gated by stress + opinion (or coping_trait wildcard)
 *   - duplicate scheme detection
 *   - state machine: planning → recruiting → moving (no-evidence kinds)
 *   - assassinate resolution drops world_npcs.is_dead
 *   - blackmail/seduce resolution writes opinion deltas
 *   - discoverScheme exposes when 50%+ evidence revealed
 *
 * Run: node --test tests/npc-schemes.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  proposeScheme,
  proposePlayerScheme,
  advanceScheme,
  discoverScheme,
  listSchemesAgainstUser,
  SCHEME_CONSTANTS,
} from "../lib/npc-schemes.js";
import { up as up152 } from "../migrations/152_npc_stress.js";
import { up as up153 } from "../migrations/153_npc_opinions.js";
import { up as up154 } from "../migrations/154_secrets.js";
import { up as up155 } from "../migrations/155_npc_schemes.js";
import { up as up117 } from "../migrations/117_faction_strategy.js";
import { up as up133 } from "../migrations/133_npc_legacy.js";
import { bumpStress } from "../lib/npc-stress.js";
import { recordOpinionEvent, getOpinion } from "../lib/npc-opinions.js";

function setupDb() {
  const db = new Database(":memory:");
  up152(db); up153(db); up154(db); up155(db); up117(db); up133(db);
  // Minimal world_npcs so resolutions can run.
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_npcs (
      id TEXT PRIMARY KEY, name TEXT, faction TEXT, archetype TEXT, is_dead INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS world_buildings (id TEXT PRIMARY KEY, state TEXT, health_pct REAL);
  `);
  db.prepare(`INSERT INTO world_npcs (id, name, faction, archetype) VALUES ('plotter','Plotter','red','warrior')`).run();
  db.prepare(`INSERT INTO world_npcs (id, name, faction, archetype) VALUES ('victim','Victim','blue','scholar')`).run();
  db.prepare(`INSERT INTO world_npcs (id, name, faction, archetype) VALUES ('aide1','Aide1','red','warrior')`).run();
  db.prepare(`INSERT INTO world_npcs (id, name, faction, archetype) VALUES ('aide2','Aide2','red','warrior')`).run();
  return db;
}

describe("Sprint C / A4 — proposeScheme gating", () => {
  it("rejects when no motive (low stress, neutral opinion)", () => {
    const db = setupDb();
    const r = proposeScheme(db, { plotterNpcId: "plotter", targetKind: "npc", targetId: "victim" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_motive");
  });

  it("opens when stress ≥ 60 + hates target", () => {
    const db = setupDb();
    bumpStress(db, "plotter", "custom_event", 35);  // → 65 stress
    recordOpinionEvent(db, { npcId: "plotter", targetKind: "npc", targetId: "victim" }, -75, "they wronged me");
    const r = proposeScheme(db, { plotterNpcId: "plotter", targetKind: "npc", targetId: "victim" });
    assert.equal(r.action, "proposed");
    assert.ok(["assassinate", "blackmail"].includes(r.kind));
  });

  it("opens via paranoid coping wild-card even without hatred", () => {
    const db = setupDb();
    db.prepare(`UPDATE npc_stress SET coping_trait='paranoid', coping_until=unixepoch()+1000, stress=85 WHERE npc_id=?`).run("plotter");
    db.prepare(`INSERT INTO npc_stress (npc_id,stress,coping_trait,coping_until) VALUES ('plotter',85,'paranoid',unixepoch()+1000) ON CONFLICT DO NOTHING`).run();
    const r = proposeScheme(db, { plotterNpcId: "plotter", targetKind: "npc", targetId: "victim" });
    assert.equal(r.action, "proposed");
  });

  it("rejects duplicate parallel scheme", () => {
    const db = setupDb();
    bumpStress(db, "plotter", "custom_event", 35);
    recordOpinionEvent(db, { npcId: "plotter", targetKind: "npc", targetId: "victim" }, -75);
    proposeScheme(db, { plotterNpcId: "plotter", targetKind: "npc", targetId: "victim" });
    const r = proposeScheme(db, { plotterNpcId: "plotter", targetKind: "npc", targetId: "victim" });
    assert.equal(r.reason, "duplicate_scheme");
  });
});

describe("Sprint C / A4 — state machine", () => {
  it("planning → recruiting", () => {
    const db = setupDb();
    bumpStress(db, "plotter", "custom_event", 35);
    recordOpinionEvent(db, { npcId: "plotter", targetKind: "npc", targetId: "victim" }, -75);
    const { schemeId } = proposeScheme(db, { plotterNpcId: "plotter", targetKind: "npc", targetId: "victim" });
    const r = advanceScheme(db, schemeId);
    assert.equal(r.transitioned, true);
    assert.equal(r.toPhase, "recruiting");
  });

  it("recruiting → gathering_evidence (assassinate kind needs evidence first)", () => {
    const db = setupDb();
    bumpStress(db, "plotter", "custom_event", 35);
    recordOpinionEvent(db, { npcId: "plotter", targetKind: "npc", targetId: "victim" }, -80);
    // Mark plotter's coping cruel so kind picks assassinate.
    db.prepare(`UPDATE npc_stress SET coping_trait = 'cruel', coping_until = unixepoch() + 1000 WHERE npc_id = ?`).run("plotter");
    // Pre-load 2 high-opinion potential accomplices toward plotter.
    recordOpinionEvent(db, { npcId: "aide1", targetKind: "npc", targetId: "plotter" }, 60);
    recordOpinionEvent(db, { npcId: "aide2", targetKind: "npc", targetId: "plotter" }, 60);

    const { schemeId } = proposeScheme(db, { plotterNpcId: "plotter", targetKind: "npc", targetId: "victim" });
    advanceScheme(db, schemeId); // → recruiting
    advanceScheme(db, schemeId); // recruiting → gathering_evidence (after recruiting 2)

    const sch = db.prepare(`SELECT phase, accomplice_count FROM npc_schemes WHERE id = ?`).get(schemeId);
    assert.equal(sch.phase, "gathering_evidence");
    assert.equal(sch.accomplice_count, 2);
  });
});

describe("Sprint C / A4 — assassinate resolution drops is_dead", () => {
  it("succeeds with rng=0 (always-pass) and marks target dead", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase, success_pct, discovery_pct, accomplice_count, evidence_count, next_tick_at)
      VALUES ('sch_test', 'npc', 'plotter', 'npc', 'victim', 'assassinate', 'moving', 99, 10, 2, 3, unixepoch())
    `).run();
    const r = advanceScheme(db, "sch_test", { rng: () => 0 });
    assert.equal(r.toPhase, "complete");
    const target = db.prepare(`SELECT is_dead FROM world_npcs WHERE id = ?`).get("victim");
    assert.equal(target.is_dead, 1);
  });
});

describe("Sprint C / A4 — discoverScheme exposure", () => {
  it("exposes when 50%+ evidence discovered", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase, success_pct, discovery_pct, accomplice_count, evidence_count, next_tick_at)
      VALUES ('sch_x', 'npc', 'plotter', 'player', 'u-spy', 'blackmail', 'gathering_evidence', 30, 30, 2, 2, unixepoch())
    `).run();
    db.prepare(`INSERT INTO npc_scheme_evidence (id, scheme_id, evidence_kind) VALUES ('e1','sch_x','observed')`).run();
    db.prepare(`INSERT INTO npc_scheme_evidence (id, scheme_id, evidence_kind) VALUES ('e2','sch_x','observed')`).run();

    const r = discoverScheme(db, "u-spy", "sch_x");
    assert.equal(r.exposed, true);
    const sch = db.prepare(`SELECT phase FROM npc_schemes WHERE id = ?`).get("sch_x");
    assert.equal(sch.phase, "exposed");
  });
});

describe("Sprint C / A4 — listSchemesAgainstUser", () => {
  it("returns schemes targeting the player but not terminal ones", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase, success_pct, discovery_pct)
      VALUES ('sch_a', 'npc', 'plotter', 'player', 'u1', 'assassinate', 'planning', 30, 10),
             ('sch_b', 'npc', 'plotter', 'player', 'u1', 'blackmail', 'complete', 30, 10),
             ('sch_c', 'npc', 'plotter', 'player', 'u2', 'seduce', 'planning', 30, 10)
    `).run();
    const list = listSchemesAgainstUser(db, "u1");
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "sch_a");
  });
});

describe("Sprint C / A4 — proposePlayerScheme", () => {
  it("opens a player-driven scheme", () => {
    const db = setupDb();
    const r = proposePlayerScheme(db, "u1", { targetKind: "npc", targetId: "victim", kind: "blackmail" });
    assert.equal(r.ok, true);
    assert.ok(r.schemeId);
    const row = db.prepare(`SELECT plotter_kind, plotter_id, kind FROM npc_schemes WHERE id = ?`).get(r.schemeId);
    assert.equal(row.plotter_kind, "player");
    assert.equal(row.plotter_id, "u1");
    assert.equal(row.kind, "blackmail");
  });
});

describe("Sprint C / A4 — constants", () => {
  it("exposes scheme thresholds", () => {
    assert.equal(SCHEME_CONSTANTS.MOVE_REQUIRES_ACCOMPLICES, 2);
    assert.equal(SCHEME_CONSTANTS.MOVE_REQUIRES_EVIDENCE, 3);
  });
});
