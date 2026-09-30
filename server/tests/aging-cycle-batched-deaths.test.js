// runAgingCycle — batched death-processing transaction.
//
// The last of the population-scale heartbeat write-loops found in the
// 2026-08-23 audit (see lib/npc-simulator.js#_flushPendingPersists for the
// full measured rationale) — deliberately deferred at the time because
// onNpcDeath's inheritance cascade looked too complex to batch blind.
// Re-verified onNpcDeath and its whole call chain are fully synchronous
// (zero await), same shape as every other fix, and wrapped the same way.
//
// Minimal hand-rolled schema, same established pattern as
// tests/npc-combat-los.test.js — world_npcs + npc_ages (what advanceAging
// needs) + npc_legacies (onNpcDeath's core, always-attempted insert).
// Every OTHER table onNpcDeath touches (settlements, heirs, grudges, etc.)
// is wrapped in its own try/catch there and gracefully no-ops when
// missing — deliberately not replicated here, matching how onNpcDeath's
// own source documents those tables as "optional".

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runAgingCycle } from "../emergent/concordia-cycles.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, faction TEXT, archetype TEXT,
      npc_type TEXT, state TEXT, is_dead INTEGER DEFAULT 0,
      current_location TEXT
    );
    CREATE TABLE npc_ages (
      npc_id TEXT PRIMARY KEY, expected_death_concordia_day INTEGER
    );
    CREATE TABLE npc_legacies (
      id TEXT PRIMARY KEY, npc_id TEXT, world_id TEXT, died_at INTEGER,
      cause_of_death TEXT, last_words TEXT, tomb_x REAL, tomb_z REAL,
      faction TEXT, archetype TEXT
    );
    CREATE TABLE world_seasons (year_n INTEGER, transitioned_at INTEGER);
  `);
  return db;
}

function seedNpc(db, id, expectedDeathDay, opts = {}) {
  db.prepare(
    `INSERT INTO world_npcs (id, world_id, faction, archetype, npc_type, state, is_dead) VALUES (?, 'w1', ?, ?, 'generic', '{}', 0)`,
  ).run(id, opts.faction || "neutral", opts.archetype || "generic");
  db.prepare(`INSERT INTO npc_ages (npc_id, expected_death_concordia_day) VALUES (?, ?)`).run(id, expectedDeathDay);
}

describe("runAgingCycle — batched death processing", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("processes every NPC due for death and commits a legacy record for each, in one pass", async () => {
    seedNpc(db, "npc-1", 100);
    seedNpc(db, "npc-2", 100);
    seedNpc(db, "npc-3", 100);

    const result = await runAgingCycle({ db });
    assert.equal(result.ok, true);
    assert.equal(result.killed, 3);
    assert.equal(result.failed, 0);

    for (const id of ["npc-1", "npc-2", "npc-3"]) {
      const npc = db.prepare(`SELECT is_dead FROM world_npcs WHERE id = ?`).get(id);
      assert.equal(npc.is_dead, 1, `${id} must be marked dead`);
      const legacy = db.prepare(`SELECT cause_of_death FROM npc_legacies WHERE npc_id = ?`).get(id);
      assert.ok(legacy, `${id} must have a committed legacy row`);
      assert.equal(legacy.cause_of_death, "natural");
    }
  });

  it("leaves NPCs not yet due for death untouched", async () => {
    seedNpc(db, "npc-future", 999999);

    const result = await runAgingCycle({ db });
    assert.equal(result.killed, 0);
    const npc = db.prepare(`SELECT is_dead FROM world_npcs WHERE id = 'npc-future'`).get();
    assert.equal(npc.is_dead, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) as n FROM npc_legacies`).get().n, 0);
  });

  it("is idempotent — re-running after deaths are processed does not double-process", async () => {
    seedNpc(db, "npc-1", 100);
    await runAgingCycle({ db });
    const secondPass = await runAgingCycle({ db });
    assert.equal(secondPass.killed, 0, "already-dead NPC (is_dead=1) is excluded by advanceAging's own query");
    assert.equal(db.prepare(`SELECT COUNT(*) as n FROM npc_legacies WHERE npc_id = 'npc-1'`).get().n, 1);
  });

  it("one NPC's failure (row vanished between advanceAging's read and this pass) does not block the others' processing", async () => {
    seedNpc(db, "npc-good", 100);
    // A due row with no matching world_npcs record — selDecStmt.get() returns
    // undefined, the `if (dec)` guard skips it silently (not a thrown error,
    // but proves the batch keeps going regardless).
    db.prepare(`INSERT INTO npc_ages (npc_id, expected_death_concordia_day) VALUES ('npc-ghost', 100)`).run();

    const result = await runAgingCycle({ db });
    assert.equal(result.considered, 2);
    assert.equal(result.killed, 1, "only the real NPC is processed");
    const good = db.prepare(`SELECT is_dead FROM world_npcs WHERE id = 'npc-good'`).get();
    assert.equal(good.is_dead, 1);
  });

  it("mutation check: a broken death-processing transaction is caught and non-fatal (safeRun wrapper)", async () => {
    seedNpc(db, "npc-1", 100);
    const brokenDb = {
      prepare: () => { throw new Error("simulated DB failure"); },
    };
    const result = await runAgingCycle({ db: brokenDb });
    assert.equal(result.ok, false, "safeRun must catch the throw and report failure honestly, never crash the caller");
  });
});
