/**
 * Tier-2 contract tests for Concordia Phase 4 — realm-access.
 *
 * Pins:
 *   - aggregateGuardOpinion returns 0 when no guards
 *   - aggregateGuardOpinion averages across guard-archetype NPCs
 *   - canEnterRealm action ladder: welcome → neutral → suspicious → exiled
 *   - aggregate ≤ -80 auto-records exile
 *   - recordExile + pardonExile + activeExile lifecycle
 *   - listExilesForUser excludes expired + pardoned
 *
 * Run: node --test tests/realm-access.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  aggregateGuardOpinion,
  canEnterRealm,
  recordExile,
  pardonExile,
  activeExile,
  listExilesForUser,
  REALM_ACCESS_CONSTANTS,
} from "../lib/realm-access.js";
import { up as up153 } from "../migrations/153_npc_opinions.js";
import { up as up158 } from "../migrations/158_kingdoms.js";
import { up as up175 } from "../migrations/175_realm_exiles.js";
import { recordOpinionEvent } from "../lib/npc-opinions.js";

function setupDb() {
  const db = new Database(":memory:");
  up153(db); up158(db); up175(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_npcs (
      id TEXT PRIMARY KEY, name TEXT, faction TEXT, archetype TEXT, is_dead INTEGER DEFAULT 0
    );
  `);
  db.prepare(`INSERT INTO realms (id, name, world_id, faction_id) VALUES ('realm_1', 'Tunya', 'concordia-hub', 'iron_warden')`).run();
  db.prepare(`INSERT INTO world_npcs (id, name, faction, archetype) VALUES ('guard_1', 'g1', 'iron_warden', 'guard')`).run();
  db.prepare(`INSERT INTO world_npcs (id, name, faction, archetype) VALUES ('guard_2', 'g2', 'iron_warden', 'warden')`).run();
  db.prepare(`INSERT INTO world_npcs (id, name, faction, archetype) VALUES ('guard_3', 'g3', 'iron_warden', 'captain')`).run();
  db.prepare(`INSERT INTO world_npcs (id, name, faction, archetype) VALUES ('npc_civ', 'c', 'iron_warden', 'scholar')`).run();
  return db;
}

describe("Phase 4 / realm-access — aggregateGuardOpinion", () => {
  it("returns 0 when no opinions recorded", () => {
    const db = setupDb();
    assert.equal(aggregateGuardOpinion(db, "user_1", "realm_1"), 0);
  });

  it("averages across guard archetypes only", () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "guard_1", targetKind: "player", targetId: "user_1" }, -60, "x");
    recordOpinionEvent(db, { npcId: "guard_2", targetKind: "player", targetId: "user_1" }, -40, "x");
    // civilian opinion shouldn't count
    recordOpinionEvent(db, { npcId: "npc_civ", targetKind: "player", targetId: "user_1" }, 100, "x");
    const agg = aggregateGuardOpinion(db, "user_1", "realm_1");
    assert.equal(agg, -50);  // (-60 + -40) / 2
  });

  it("excludes dead guards", () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "guard_1", targetKind: "player", targetId: "user_1" }, -90, "x");
    recordOpinionEvent(db, { npcId: "guard_2", targetKind: "player", targetId: "user_1" }, +30, "x");
    db.prepare(`UPDATE world_npcs SET is_dead = 1 WHERE id = 'guard_1'`).run();
    const agg = aggregateGuardOpinion(db, "user_1", "realm_1");
    assert.equal(agg, 30);  // only guard_2 counted
  });

  it("returns 0 on unknown realm", () => {
    const db = setupDb();
    assert.equal(aggregateGuardOpinion(db, "user_1", "missing"), 0);
  });
});

describe("Phase 4 / realm-access — canEnterRealm ladder", () => {
  it("welcome when neutral or positive", () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "guard_1", targetKind: "player", targetId: "user_1" }, 20, "x");
    const r = canEnterRealm(db, "user_1", "realm_1");
    assert.equal(r.action, "welcome");
  });

  it("neutral when between -50 and 0", () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "guard_1", targetKind: "player", targetId: "user_1" }, -20, "x");
    const r = canEnterRealm(db, "user_1", "realm_1");
    assert.equal(r.action, "neutral");
  });

  it("suspicious when ≤ -50 but > -80", () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "guard_1", targetKind: "player", targetId: "user_1" }, -55, "x");
    const r = canEnterRealm(db, "user_1", "realm_1");
    assert.equal(r.action, "suspicious");
  });

  it("auto-exiles when aggregate ≤ -80", () => {
    const db = setupDb();
    recordOpinionEvent(db, { npcId: "guard_1", targetKind: "player", targetId: "user_1" }, -85, "x");
    const r = canEnterRealm(db, "user_1", "realm_1");
    assert.equal(r.action, "exiled");
    assert.ok(activeExile(db, "realm_1", "user_1"));
  });

  it("respects existing exile row even when aggregate later recovers", () => {
    const db = setupDb();
    recordExile(db, "realm_1", "user_1", { reason: "manual" });
    recordOpinionEvent(db, { npcId: "guard_1", targetKind: "player", targetId: "user_1" }, 60, "redeemed");
    const r = canEnterRealm(db, "user_1", "realm_1");
    assert.equal(r.action, "exiled");
  });
});

describe("Phase 4 / realm-access — recordExile + pardon", () => {
  it("recordExile upserts on (realm, user)", () => {
    const db = setupDb();
    recordExile(db, "realm_1", "user_1", { reason: "first" });
    recordExile(db, "realm_1", "user_1", { reason: "second" });
    const row = activeExile(db, "realm_1", "user_1");
    assert.equal(row.reason, "second");
  });

  it("pardon clears active exile", () => {
    const db = setupDb();
    recordExile(db, "realm_1", "user_1", {});
    pardonExile(db, "realm_1", "user_1", "ruler_npc");
    assert.equal(activeExile(db, "realm_1", "user_1"), null);
  });

  it("expired exile is not active", () => {
    const db = setupDb();
    // Set expires_at to 1h ago
    db.prepare(`
      INSERT INTO realm_exiles (realm_id, user_id, reason, expires_at)
      VALUES ('realm_1', 'user_1', 'test', unixepoch() - 3600)
    `).run();
    assert.equal(activeExile(db, "realm_1", "user_1"), null);
  });
});

describe("Phase 4 / realm-access — listExilesForUser", () => {
  it("returns active exiles only", () => {
    const db = setupDb();
    recordExile(db, "realm_1", "user_1", {});
    // pardoned one
    db.prepare(`INSERT INTO realms (id, name, world_id) VALUES ('realm_2', 'Akeia', 'concordia-hub')`).run();
    recordExile(db, "realm_2", "user_1", {});
    pardonExile(db, "realm_2", "user_1", "x");
    const lst = listExilesForUser(db, "user_1");
    assert.equal(lst.length, 1);
    assert.equal(lst[0].realm_id, "realm_1");
  });
});

describe("Phase 4 / realm-access — constants", () => {
  it("exposes thresholds", () => {
    assert.equal(REALM_ACCESS_CONSTANTS.REFUSED_AGGREGATE, -50);
    assert.equal(REALM_ACCESS_CONSTANTS.EXILED_AGGREGATE, -80);
  });
});
