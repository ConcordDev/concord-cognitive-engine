/**
 * T3.2 — faction-rivalry → NPC scheme-edge derivation.
 *
 * Pins:
 *   - a faction's lead NPC gets a hostile (≤-50) opinion toward the lead NPC of
 *     each authored rival faction (grounded in rival_factions + npc_ids)
 *   - the edge is schemeable: proposeScheme(motive bypass not needed) fires
 *     because the opinion crosses the gate (with stress seeded)
 *   - idempotent: re-running does not stack / double the delta
 *   - only live NPCs get edges; missing NPCs are skipped
 *
 * Run: node --test tests/integration/faction-rivalry-schemes.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up152 } from "../../migrations/152_npc_stress.js";
import { up as up153 } from "../../migrations/153_npc_opinions.js";
import { up as up155 } from "../../migrations/155_npc_schemes.js";
import { seedRivalryOpinionEdges, RIVALRY_OPINION } from "../../lib/faction-rivalry-schemes.js";
import { getOpinion } from "../../lib/npc-opinions.js";
import { proposeScheme } from "../../lib/npc-schemes.js";

function freshDb() {
  const db = new Database(":memory:");
  up152(db); up153(db); up155(db);
  db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT);`);
  return db;
}
function npc(db, id) { db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES (?, 'w1')`).run(id); }

const FACTIONS = [
  { id: "deniers", rival_factions: ["archivists", "pilgrims"], npc_ids: ["palen"] },
  { id: "archivists", rival_factions: ["deniers"], npc_ids: ["vela", "oeric"] },
  { id: "pilgrims", rival_factions: ["deniers"], npc_ids: ["isen"] },
  { id: "neutral", rival_factions: [], npc_ids: ["bystander"] },
];

describe("T3.2 — seedRivalryOpinionEdges", () => {
  it("writes hostile edges along authored rivalries", () => {
    const db = freshDb();
    ["palen", "vela", "oeric", "isen", "bystander"].forEach((id) => npc(db, id));
    const r = seedRivalryOpinionEdges(db, FACTIONS);
    assert.ok(r.edges >= 3, `expected >=3 edges, got ${r.edges}`);
    // Palen (deniers) hates Vela (archivists lead) and Isen (pilgrims lead).
    assert.equal(getOpinion(db, "palen", "npc", "vela").score, RIVALRY_OPINION);
    assert.equal(getOpinion(db, "palen", "npc", "isen").score, RIVALRY_OPINION);
    // Archivists lead (Vela) hates Palen back.
    assert.equal(getOpinion(db, "vela", "npc", "palen").score, RIVALRY_OPINION);
    // neutral faction (no rivals) seeds nothing from bystander.
    assert.equal(getOpinion(db, "bystander", "npc", "palen"), null);
    db.close();
  });

  it("the edge is schemeable once stress is present", () => {
    const db = freshDb();
    ["palen", "vela"].forEach((id) => npc(db, id));
    seedRivalryOpinionEdges(db, FACTIONS);
    // proposeScheme gate: stress>=60 AND opinion<=-50. Seed stress.
    db.prepare(`INSERT INTO npc_stress (npc_id, stress) VALUES ('palen', 65)`).run();
    const res = proposeScheme(db, { plotterNpcId: "palen", targetKind: "npc", targetId: "vela" });
    assert.equal(res.ok, true, `scheme should fire along the rivalry edge: ${res.reason}`);
    db.close();
  });

  it("is idempotent — re-running does not stack the delta", () => {
    const db = freshDb();
    ["palen", "vela", "oeric", "isen"].forEach((id) => npc(db, id));
    seedRivalryOpinionEdges(db, FACTIONS);
    const first = getOpinion(db, "palen", "npc", "vela").score;
    seedRivalryOpinionEdges(db, FACTIONS);
    seedRivalryOpinionEdges(db, FACTIONS);
    const after = getOpinion(db, "palen", "npc", "vela").score;
    assert.equal(after, first, "re-running must not deepen the edge");
    db.close();
  });

  it("skips rivalries whose lead NPC isn't live", () => {
    const db = freshDb();
    npc(db, "palen"); // vela/isen NOT inserted
    const r = seedRivalryOpinionEdges(db, FACTIONS);
    assert.equal(r.edges, 0);
    db.close();
  });
});
