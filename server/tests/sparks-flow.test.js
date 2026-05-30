/**
 * Living Society — Phase 3 (sparks-flow) + Phase 4 (grievance vs authority).
 *
 *   - a payday moves sparks employer→worker along an edge;
 *   - a skim diverts the right fraction to the collector (corruption);
 *   - an empty treasury → unpaid → a grievance the worker holds vs the employer
 *     (deepening on repeat — the broke-villain escalation);
 *   - payday is idempotent within its window;
 *   - recordAuthorityGrievance accumulates on one edge + is queryable per authority.
 *
 * Run: node --test tests/sparks-flow.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up283 } from "../migrations/283_employment_edges.js";
import { createEmploymentEdge, runPayday } from "../lib/sparks-flow.js";
import { recordAuthorityGrievance, grievanceAgainstAuthority } from "../lib/npc-asymmetry.js";

const W = "w1";
function mkDb() {
  const db = new Database(":memory:");
  up283(db);
  db.exec(`
    CREATE TABLE realms (id TEXT PRIMARY KEY, name TEXT, world_id TEXT, treasury INTEGER DEFAULT 1000, tax_rate REAL DEFAULT 0.1, updated_at INTEGER);
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, wealth_sparks REAL DEFAULT 0, is_dead INTEGER DEFAULT 0);
    CREATE TABLE users (id TEXT PRIMARY KEY, sparks INTEGER DEFAULT 0);
    CREATE TABLE sparks_ledger (id TEXT PRIMARY KEY, user_id TEXT, delta INTEGER, reason TEXT, world_id TEXT, created_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE npc_grudges (
      id TEXT PRIMARY KEY, npc_id TEXT, target_kind TEXT CHECK (target_kind IN ('player','npc','faction')),
      target_id TEXT, narrative TEXT, severity INTEGER DEFAULT 5, event_at INTEGER DEFAULT (unixepoch()), resolved_at INTEGER
    );
  `);
  return db;
}

describe("Phase 3 — payday flow", () => {
  it("moves sparks from a realm treasury to an NPC worker", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO realms (id, world_id, treasury) VALUES ('r1', ?, 1000)`).run(W);
    db.prepare(`INSERT INTO world_npcs (id, world_id, wealth_sparks) VALUES ('n1', ?, 0)`).run(W);
    createEmploymentEdge(db, { worldId: W, employerKind: "realm", employerId: "r1", workerKind: "npc", workerId: "n1", rateSparks: 50, paydayFreqS: 100 });
    const r = runPayday(db, W, 1_000_000);
    assert.equal(r.paid, 1);
    assert.equal(db.prepare(`SELECT wealth_sparks FROM world_npcs WHERE id='n1'`).get().wealth_sparks, 50);
    assert.equal(db.prepare(`SELECT treasury FROM realms WHERE id='r1'`).get().treasury, 950);
  });

  it("a collector skims the right fraction (corruption = flow diversion)", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO realms (id, world_id, treasury) VALUES ('r1', ?, 1000)`).run(W);
    db.prepare(`INSERT INTO world_npcs (id, world_id, wealth_sparks) VALUES ('n1', ?, 0), ('col', ?, 0)`).run(W, W);
    createEmploymentEdge(db, { worldId: W, employerKind: "realm", employerId: "r1", workerKind: "npc", workerId: "n1", rateSparks: 100, paydayFreqS: 100, skimPct: 0.2, collectorKind: "npc", collectorId: "col" });
    runPayday(db, W, 1_000_000);
    assert.equal(db.prepare(`SELECT wealth_sparks FROM world_npcs WHERE id='n1'`).get().wealth_sparks, 80);
    assert.equal(db.prepare(`SELECT wealth_sparks FROM world_npcs WHERE id='col'`).get().wealth_sparks, 20);
  });

  it("an empty treasury → unpaid → grievance vs the employer (deepens on repeat)", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO realms (id, world_id, treasury) VALUES ('r1', ?, 0)`).run(W);
    db.prepare(`INSERT INTO world_npcs (id, world_id, wealth_sparks) VALUES ('n1', ?, 0)`).run(W);
    createEmploymentEdge(db, { worldId: W, employerKind: "realm", employerId: "r1", workerKind: "npc", workerId: "n1", rateSparks: 50, paydayFreqS: 0 });
    const r1 = runPayday(db, W, 1_000_000);
    assert.equal(r1.unpaid, 1);
    const g1 = grievanceAgainstAuthority(db, "faction", "r1");
    assert.ok(g1.total > 0, "grievance recorded against the realm");
    const sev1 = db.prepare(`SELECT severity FROM npc_grudges WHERE npc_id='n1'`).get().severity;
    // second stiffing deepens the same grievance
    runPayday(db, W, 1_000_001);
    const sev2 = db.prepare(`SELECT severity FROM npc_grudges WHERE npc_id='n1'`).get().severity;
    assert.ok(sev2 >= sev1, `grievance deepened: ${sev1} -> ${sev2}`);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM npc_grudges WHERE npc_id='n1'`).get().n, 1, "one edge, not spam rows");
  });

  it("payday is idempotent within its window", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO realms (id, world_id, treasury) VALUES ('r1', ?, 1000)`).run(W);
    db.prepare(`INSERT INTO world_npcs (id, world_id, wealth_sparks) VALUES ('n1', ?, 0)`).run(W);
    createEmploymentEdge(db, { worldId: W, employerKind: "realm", employerId: "r1", workerKind: "npc", workerId: "n1", rateSparks: 50, paydayFreqS: 1000 });
    runPayday(db, W, 1_000_000);
    const r2 = runPayday(db, W, 1_000_000); // same instant, within window
    assert.equal(r2.paid, 0);
    assert.equal(db.prepare(`SELECT wealth_sparks FROM world_npcs WHERE id='n1'`).get().wealth_sparks, 50);
  });
});

describe("Phase 4 — grievance vs authority", () => {
  it("accumulates on one (npc, authority) edge + maps realm→faction kind", () => {
    const db = mkDb();
    const a = recordAuthorityGrievance(db, "n1", { targetKind: "realm", targetId: "r1", eventKind: "harsh_decree" });
    assert.equal(a.action, "added");
    const b = recordAuthorityGrievance(db, "n1", { targetKind: "realm", targetId: "r1", eventKind: "conscripted" });
    assert.equal(b.action, "deepened");
    const q = grievanceAgainstAuthority(db, "realm", "r1");
    assert.equal(q.count, 1);
    assert.ok(q.total >= 5);
  });

  it("a ruler-NPC grievance lands as target_kind='npc'", () => {
    const db = mkDb();
    recordAuthorityGrievance(db, "n2", { targetKind: "ruler", targetId: "lord_x", eventKind: "kin_killed_by_enforcer" });
    const row = db.prepare(`SELECT target_kind, target_id FROM npc_grudges WHERE npc_id='n2'`).get();
    assert.equal(row.target_kind, "npc");
    assert.equal(row.target_id, "lord_x");
  });
});
