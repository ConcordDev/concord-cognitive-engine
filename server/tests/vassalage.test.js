/**
 * Living Society — Phase 11: governance hierarchy.
 *
 *   - a vassal swears fealty (one liege per polity);
 *   - tribute flows UP each edge into the liege treasury (skim diverts);
 *   - a liege that fails to defend a raided vassal accrues a grievance + the
 *     vassal becomes secession-eligible;
 *   - controlling every realm recognizes an Emperor (lore minted, no menu);
 *   - emperor death shatters the empire into an EMPTY throne (no heir) + secedes.
 *
 * Run: node --test tests/vassalage.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up289 } from "../migrations/289_vassalage.js";
import {
  swearFealty, runTribute, recordVassalRaid, recordLiegeDefense,
  sweepProtectionFailures, recognizeEmperor, onEmperorDeath, getVassals, VASSALAGE_CONSTANTS,
} from "../lib/vassalage.js";

const W = "w1";
function mkDb() {
  const db = new Database(":memory:");
  up289(db);
  db.exec(`
    CREATE TABLE realms (id TEXT PRIMARY KEY, world_id TEXT, faction_id TEXT, ruler_id TEXT, ruler_kind TEXT, treasury INTEGER DEFAULT 1000);
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, settlement_id TEXT, wealth_sparks REAL DEFAULT 0, is_dead INTEGER DEFAULT 0);
    CREATE TABLE npc_grudges (id TEXT PRIMARY KEY, npc_id TEXT, target_kind TEXT, target_id TEXT, narrative TEXT, severity INTEGER, event_at INTEGER DEFAULT (unixepoch()), resolved_at INTEGER);
    CREATE TABLE world_chronicle (id TEXT PRIMARY KEY, world_id TEXT, kind TEXT, dedupe_key TEXT, title TEXT, body TEXT, importance INTEGER, composer TEXT, created_at INTEGER DEFAULT (unixepoch()), UNIQUE(world_id, dedupe_key));
    CREATE TABLE world_events (id TEXT PRIMARY KEY, world_id TEXT, event_type TEXT, title TEXT, description TEXT, created_at INTEGER);
  `);
  return db;
}

describe("Phase 11 — vassalage + tribute", () => {
  it("a vassal swears fealty (one liege per polity)", () => {
    const db = mkDb();
    swearFealty(db, { worldId: W, liegeKind: "realm", liegeId: "kingdom", vassalKind: "settlement", vassalId: "town", tributeRate: 50 });
    assert.equal(getVassals(db, "realm", "kingdom").length, 1);
    // re-swearing updates, doesn't duplicate
    swearFealty(db, { worldId: W, liegeKind: "realm", liegeId: "kingdom2", vassalKind: "settlement", vassalId: "town", tributeRate: 80 });
    assert.equal(getVassals(db, "realm", "kingdom").length, 0);
    assert.equal(getVassals(db, "realm", "kingdom2").length, 1);
  });

  it("tribute flows up into the liege treasury (skim diverts a cut)", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO realms (id, world_id, treasury) VALUES ('kingdom', ?, 1000), ('town_realm', ?, 500)`).run(W, W);
    db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES ('collector', ?)`).run(W);
    swearFealty(db, { worldId: W, liegeKind: "realm", liegeId: "kingdom", vassalKind: "realm", vassalId: "town_realm", tributeRate: 100, tributeCadenceS: 0, skimPct: 0.1, collectorId: "collector" });
    const r = runTribute(db, W, 1_000_000);
    assert.equal(r.flowed, 90);
    assert.equal(r.skimmed, 10);
    assert.equal(db.prepare(`SELECT treasury FROM realms WHERE id='kingdom'`).get().treasury, 1090);
    assert.equal(db.prepare(`SELECT treasury FROM realms WHERE id='town_realm'`).get().treasury, 400); // debited full 100
    assert.equal(db.prepare(`SELECT wealth_sparks FROM world_npcs WHERE id='collector'`).get().wealth_sparks, 10);
  });
});

describe("Phase 11 — protection accountability", () => {
  it("a liege that fails to defend a raided vassal accrues a grievance + secession", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_npcs (id, world_id, settlement_id) VALUES ('citizen', ?, 'town')`).run(W);
    swearFealty(db, { worldId: W, liegeKind: "realm", liegeId: "kingdom", vassalKind: "settlement", vassalId: "town", tributeRate: 50 });
    recordVassalRaid(db, "settlement", "town", 1000);
    // window not elapsed yet
    assert.equal(sweepProtectionFailures(db, W, 1000 + 10).failures, 0);
    // past the window with no defense → failure
    const r = sweepProtectionFailures(db, W, 1000 + VASSALAGE_CONSTANTS.PROTECTION_WINDOW_S + 1);
    assert.equal(r.failures, 1);
    assert.ok(db.prepare(`SELECT severity FROM npc_grudges WHERE npc_id='citizen' AND target_id='kingdom'`).get(), "citizen holds a grievance vs the liege");
    assert.equal(db.prepare(`SELECT secession_eligible FROM vassalage WHERE vassal_id='town'`).get().secession_eligible, 1);
  });

  it("a defended raid clears the obligation (no failure)", () => {
    const db = mkDb();
    swearFealty(db, { worldId: W, liegeKind: "realm", liegeId: "kingdom", vassalKind: "settlement", vassalId: "town" });
    recordVassalRaid(db, "settlement", "town", 1000);
    recordLiegeDefense(db, "settlement", "town", 1100);
    assert.equal(sweepProtectionFailures(db, W, 1000 + VASSALAGE_CONSTANTS.PROTECTION_WINDOW_S + 1).failures, 0);
  });
});

describe("Phase 11 — Emperor (earned, unstable, shatters-on-death)", () => {
  it("controlling every realm recognizes an Emperor (no menu) + death empties the throne", () => {
    const db = mkDb();
    // one faction controls both realms
    db.prepare(`INSERT INTO realms (id, world_id, faction_id) VALUES ('r1', ?, 'iron_crown'), ('r2', ?, 'iron_crown')`).run(W, W);
    const r = recognizeEmperor(db, W);
    assert.equal(r.recognized, true);
    assert.equal(r.emperorId, "iron_crown");
    assert.equal(r.unstable, true);
    assert.ok(db.prepare(`SELECT 1 FROM world_chronicle WHERE kind='emperor'`).get(), "emperor crowning minted as lore");
    // idempotent
    assert.equal(recognizeEmperor(db, W).alreadyCrowned, true);
    // death = power vacuum, empty throne (no heir)
    swearFealty(db, { worldId: W, liegeKind: "realm", liegeId: "iron_crown", vassalKind: "settlement", vassalId: "town" });
    const d = onEmperorDeath(db, W, "iron_crown");
    assert.equal(d.throneEmpty, true);
    assert.ok(db.prepare(`SELECT fell_at FROM world_emperors WHERE world_id=?`).get(W).fell_at, "throne fell");
    assert.ok(db.prepare(`SELECT 1 FROM world_events WHERE event_type='power_vacuum'`).get(), "power vacuum event");
    assert.equal(db.prepare(`SELECT status FROM vassalage WHERE vassal_id='town'`).get().status, "seceding");
  });

  it("does not crown when realms are not unified", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO realms (id, world_id, faction_id) VALUES ('r1', ?, 'a'), ('r2', ?, 'b')`).run(W, W);
    assert.equal(recognizeEmperor(db, W).recognized, false);
  });
});
