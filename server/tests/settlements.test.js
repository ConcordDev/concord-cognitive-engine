/**
 * Living Society — Phase 1.5: settlement composition + vacancy + relationships.
 *
 *   - checkCoverage reports the role gaps a settlement is missing;
 *   - killing a role-holder opens a vacancy (every role load-bearing);
 *   - the recruit-cycle fills a vacancy from a local same-role candidate, OR
 *     escalates resentment + a grievance vs the killer when none is available;
 *   - authored relationships[] are ingested into npc_relationships with the
 *     right rel_type mapping.
 *
 * Run: node --test tests/settlements.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up287 } from "../migrations/287_settlements.js";
import {
  createSettlement, checkCoverage, openVacancy, recruitForVacancy,
  listOpenVacancies, roleForArchetype, SETTLEMENT_ROLES,
} from "../lib/settlements.js";
import { seedAuthoredRelationships, mapAuthoredRelType } from "../lib/npc-family.js";

const W = "w1";
function mkDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, name TEXT, archetype TEXT, npc_type TEXT, state TEXT, is_dead INTEGER DEFAULT 0
    );
    CREATE TABLE npc_grudges (id TEXT PRIMARY KEY, npc_id TEXT, target_kind TEXT, target_id TEXT, narrative TEXT, severity INTEGER, event_at INTEGER DEFAULT (unixepoch()), resolved_at INTEGER);
    CREATE TABLE npc_relationships (id TEXT PRIMARY KEY, npc_id TEXT, related_id TEXT, rel_type TEXT, strength REAL DEFAULT 1.0, created_at INTEGER DEFAULT (unixepoch()), UNIQUE(npc_id, related_id, rel_type));
  `);
  up287(db);
  return db;
}
function addNpc(db, id, { name = id, archetype = "farmer", settlementId = null, role = null } = {}) {
  db.prepare(`INSERT INTO world_npcs (id, world_id, name, archetype, npc_type, state, settlement_id, settlement_role) VALUES (?, ?, ?, ?, 'npc', ?, ?, ?)`)
    .run(id, W, name, archetype, JSON.stringify({ name }), settlementId, role);
}

describe("Phase 1.5 — composition coverage", () => {
  it("reports the role gaps a settlement is missing", () => {
    const db = mkDb();
    const s = createSettlement(db, { worldId: W, name: "Hollow" }).id;
    addNpc(db, "n1", { archetype: "farmer", settlementId: s, role: "farmer" });
    const cov = checkCoverage(db, s);
    assert.equal(cov.covered, false);
    const gapRoles = cov.gaps.map((g) => g.role);
    assert.ok(gapRoles.includes("blacksmith"), "missing blacksmith is a gap");
    assert.ok(gapRoles.includes("healer"));
    assert.ok(!gapRoles.includes("farmer"), "farmer is covered (min 1)");
  });

  it("roleForArchetype maps civilians + martials onto roles", () => {
    assert.equal(roleForArchetype("farmer"), "farmer");
    assert.equal(roleForArchetype("warrior"), "guard");
    assert.equal(roleForArchetype("trader"), "merchant");
    assert.ok(SETTLEMENT_ROLES.includes("blacksmith"));
  });
});

describe("Phase 1.5 — vacancy is load-bearing", () => {
  it("the recruit-cycle fills a vacancy from a local same-role candidate", () => {
    const db = mkDb();
    const s = createSettlement(db, { worldId: W, name: "Mill" }).id;
    addNpc(db, "smith1", { archetype: "scholar", settlementId: s, role: "blacksmith" });
    addNpc(db, "spare_smith", { archetype: "scholar" }); // unsettled same-role candidate
    const v = openVacancy(db, { settlementId: s, worldId: W, role: "blacksmith", killerId: "user_x", killerKind: "player" });
    const [vac] = listOpenVacancies(db, W);
    const r = recruitForVacancy(db, vac);
    assert.equal(r.filled, true);
    assert.equal(r.by, "spare_smith");
    assert.equal(listOpenVacancies(db, W).length, 0);
  });

  it("an unfilled vacancy escalates resentment + a grievance vs the killer", () => {
    const db = mkDb();
    const s = createSettlement(db, { worldId: W, name: "Edge" }).id;
    addNpc(db, "witness", { archetype: "farmer", settlementId: s, role: "farmer" });
    openVacancy(db, { settlementId: s, worldId: W, role: "blacksmith", killerId: "user_x", killerKind: "player" });
    const [vac] = listOpenVacancies(db, W);
    const r = recruitForVacancy(db, vac); // no candidate
    assert.equal(r.filled, false);
    // grievance recorded against the killer
    const g = db.prepare(`SELECT target_kind, target_id, severity FROM npc_grudges WHERE npc_id='witness'`).get();
    assert.ok(g, "witness holds a grievance");
    assert.equal(g.target_kind, "player");
    assert.equal(g.target_id, "user_x");
    // resentment bumped on the vacancy
    assert.ok(db.prepare(`SELECT resentment FROM settlement_vacancies WHERE id=?`).get(vac.id).resentment >= 1);
  });
});

describe("Phase 1.5 — authored relationship ingestion", () => {
  it("maps authored types + ingests into npc_relationships", () => {
    assert.equal(mapAuthoredRelType("husband"), "spouse");
    assert.equal(mapAuthoredRelType("nemesis"), "rival");
    const db = mkDb();
    addNpc(db, "kiren", { name: "Kiren" });
    addNpc(db, "orin", { name: "Orin" });
    const r = seedAuthoredRelationships(db, W, [
      { name: "Kiren", relationships: [{ type: "sibling", target: "Orin" }, { type: "ally", target: "Ghost" }] },
    ]);
    assert.equal(r.seeded, 1);     // Orin resolves; Ghost doesn't
    assert.equal(r.skipped, 1);
    const rel = db.prepare(`SELECT rel_type FROM npc_relationships WHERE npc_id='kiren' AND related_id='orin'`).get();
    assert.equal(rel.rel_type, "sibling");
    // reciprocal edge
    assert.ok(db.prepare(`SELECT 1 FROM npc_relationships WHERE npc_id='orin' AND related_id='kiren'`).get());
  });
});
