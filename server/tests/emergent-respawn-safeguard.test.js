/**
 * Tier-2 contract tests for the emergent respawn safeguard.
 *
 * The invariant under test: "emergents can't die for real."
 *
 * Two layers:
 *   1. isProtectedEmergent() returns true for is_conscious=1 NPCs and false
 *      for normal hostiles. The combat routes use this to refuse attacks
 *      at the door (primary protection).
 *   2. runEmergentRespawnSafeguard() restores is_conscious=1 NPCs that
 *      have been marked is_dead=1, regardless of how they got there.
 *      This is the fallback for any code path that bypassed the primary.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  runEmergentRespawnSafeguard,
  isProtectedEmergent,
  _RESPAWN_HP_RESTORE,
} from "../lib/emergent-respawn-safeguard.js";

function setupDb() {
  const db = new Database(":memory:");
  // Minimal world_npcs schema with the columns the safeguard reads/writes.
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      archetype TEXT,
      faction TEXT,
      is_conscious INTEGER DEFAULT 0,
      is_immortal INTEGER DEFAULT 0,
      is_dead INTEGER DEFAULT 0,
      current_hp INTEGER DEFAULT 100,
      max_hp INTEGER DEFAULT 100,
      state TEXT
    );
    CREATE TABLE npc_consequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      details TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  return db;
}

// ── isProtectedEmergent ───────────────────────────────────────────────────

describe("isProtectedEmergent — gates at the route door", () => {
  it("returns true for is_conscious=1 NPCs", () => {
    const db = setupDb();
    db.prepare("INSERT INTO world_npcs (id, world_id, is_conscious) VALUES (?, ?, ?)")
      .run("emergent_one", "concordia-hub", 1);
    assert.equal(isProtectedEmergent(db, "emergent_one"), true);
  });

  it("returns false for is_conscious=0 NPCs (regular hostiles)", () => {
    const db = setupDb();
    db.prepare("INSERT INTO world_npcs (id, world_id, is_conscious) VALUES (?, ?, ?)")
      .run("orc_grunt", "fantasy", 0);
    assert.equal(isProtectedEmergent(db, "orc_grunt"), false);
  });

  it("returns false for unknown npcId (fail-open since downstream still checks)", () => {
    const db = setupDb();
    assert.equal(isProtectedEmergent(db, "nobody"), false);
  });

  it("returns false on db error (does not throw)", () => {
    // Pass a malformed db to force the catch branch
    assert.equal(isProtectedEmergent(null, "x"), false);
  });
});

// ── runEmergentRespawnSafeguard ───────────────────────────────────────────

describe("runEmergentRespawnSafeguard — fallback restores dead emergents", () => {
  it("restores is_conscious=1 NPCs from is_dead=1 → is_dead=0", () => {
    const db = setupDb();
    db.prepare("INSERT INTO world_npcs (id, world_id, is_conscious, is_dead, current_hp, max_hp) VALUES (?, ?, 1, 1, 0, 100)")
      .run("emergent_dead", "concordia-hub");
    const r = runEmergentRespawnSafeguard({ db });
    assert.equal(r.ok, true);
    assert.equal(r.restored, 1);
    assert.equal(r.errors, 0);
    const row = db.prepare("SELECT is_dead, current_hp FROM world_npcs WHERE id = ?").get("emergent_dead");
    assert.equal(row.is_dead, 0);
    assert.equal(row.current_hp, Math.round(100 * _RESPAWN_HP_RESTORE));
  });

  it("does NOT touch non-conscious NPCs that are dead (they stay dead)", () => {
    const db = setupDb();
    db.prepare("INSERT INTO world_npcs (id, world_id, is_conscious, is_dead, current_hp, max_hp) VALUES (?, ?, 0, 1, 0, 100)")
      .run("orc_corpse", "fantasy");
    const r = runEmergentRespawnSafeguard({ db });
    assert.equal(r.ok, true);
    assert.equal(r.restored, 0);
    const row = db.prepare("SELECT is_dead FROM world_npcs WHERE id = ?").get("orc_corpse");
    assert.equal(row.is_dead, 1);
  });

  it("logs the respawn to npc_consequences for audit (Sovereign-themed)", () => {
    const db = setupDb();
    db.prepare("INSERT INTO world_npcs (id, world_id, is_conscious, is_dead, current_hp, max_hp) VALUES (?, ?, 1, 1, 0, 100)")
      .run("emergent_audit", "concordia-hub");
    runEmergentRespawnSafeguard({ db });
    const log = db.prepare("SELECT event_type, details FROM npc_consequences WHERE npc_id = ?").get("emergent_audit");
    assert.equal(log.event_type, "sovereign_respawn");
    const details = JSON.parse(log.details);
    assert.equal(details.reason, "sovereign_protection_restored_agent");
    assert.equal(details.world_id, "concordia-hub");
    assert.match(details.note, /Sovereign/);
  });

  it("is idempotent — re-running finds no candidates", () => {
    const db = setupDb();
    db.prepare("INSERT INTO world_npcs (id, world_id, is_conscious, is_dead, current_hp, max_hp) VALUES (?, ?, 1, 1, 0, 100)")
      .run("emergent_idem", "concordia-hub");
    runEmergentRespawnSafeguard({ db });
    const r2 = runEmergentRespawnSafeguard({ db });
    assert.equal(r2.restored, 0); // already restored
  });

  it("handles multiple dead emergents in one pass", () => {
    const db = setupDb();
    for (let i = 0; i < 5; i++) {
      db.prepare("INSERT INTO world_npcs (id, world_id, is_conscious, is_dead, current_hp, max_hp) VALUES (?, ?, 1, 1, 0, 100)")
        .run(`em_${i}`, "concordia-hub");
    }
    const r = runEmergentRespawnSafeguard({ db });
    assert.equal(r.restored, 5);
  });

  it("does not crash on missing world_npcs schema (returns reason)", () => {
    const broken = new Database(":memory:");
    const r = runEmergentRespawnSafeguard({ db: broken });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "schema_unavailable");
  });

  it("missing db returns no_db", () => {
    const r = runEmergentRespawnSafeguard({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });
});
