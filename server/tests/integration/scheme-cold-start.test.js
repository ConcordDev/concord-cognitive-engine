/**
 * T1.3 — Scheme cold-start marquee test.
 *
 * Pins the highest-leverage claim: a cold-booted stranger can witness an NPC
 * scheme resolve that arose purely from AUTHORED interiority, with ZERO player
 * gameplay to warm the substrate.
 *
 * The scheme cycle's proposer scan requires npc_stress.stress >= 60 AND a
 * character_opinions edge <= -50. Before T1.3 those rows only accrued from
 * combat/exposure, so authored worlds booted with a dormant scheme engine.
 * deriveSchemeSubstrateFromNarrative (called inside seedNPCAsymmetry) now
 * derives both from narrative_context + relationships.
 *
 * Run: node --test tests/integration/scheme-cold-start.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up128 } from "../../migrations/128_npc_asymmetry.js";
import { up as up152 } from "../../migrations/152_npc_stress.js";
import { up as up153 } from "../../migrations/153_npc_opinions.js";
import { up as up154 } from "../../migrations/154_secrets.js";
import { up as up155 } from "../../migrations/155_npc_schemes.js";
import { up as up117 } from "../../migrations/117_faction_strategy.js";
import { up as up133 } from "../../migrations/133_npc_legacy.js";

import { seedNPCAsymmetry, deriveSchemeSubstrateFromNarrative } from "../../lib/npc-asymmetry.js";
import { getStress } from "../../lib/npc-stress.js";
import { getOpinion } from "../../lib/npc-opinions.js";
import { runNpcSchemeCycle } from "../../emergent/npc-scheme-cycle.js";

function setupDb() {
  const db = new Database(":memory:");
  up128(db); up152(db); up153(db); up154(db); up155(db); up117(db); up133(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_npcs (
      id TEXT PRIMARY KEY, name TEXT, faction TEXT, archetype TEXT, is_dead INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS world_buildings (id TEXT PRIMARY KEY, state TEXT, health_pct REAL);
  `);
  return db;
}

// A warlord carrying a weaponisable secret, with an authored ideological-nemesis
// edge toward a real co-resident NPC — the exact shape of the marquee rivalry.
const PLOTTER = {
  id: "warlord_iyatte",
  name: "Iyatte of Sandrun",
  faction: "sandrun",
  archetype: "warlord",
  narrative_context: {
    secret: "Her youngest son was born without flame; she has hidden him under a borrowed name.",
    weaponise_at: "If Sanguire-Medici tensions break into open conflict her ability to lead is contingent on the secret holding.",
  },
  relationships: [
    { npc_id: "medici_lord", type: "ideological_nemesis", notes: "Medici has hunted clues to her secret for years." },
  ],
};
const TARGET = { id: "medici_lord", name: "Lord Medici", faction: "medici", archetype: "scholar" };

describe("T1.3 — scheme cold-start from authored interiority", () => {
  it("derives stress >= 60, a <= -50 opinion edge, and a scheming coping trait at seed", async () => {
    const db = setupDb();
    db.prepare(`INSERT INTO world_npcs (id,name,faction,archetype) VALUES (?,?,?,?)`).run(PLOTTER.id, PLOTTER.name, PLOTTER.faction, PLOTTER.archetype);
    db.prepare(`INSERT INTO world_npcs (id,name,faction,archetype) VALUES (?,?,?,?)`).run(TARGET.id, TARGET.name, TARGET.faction, TARGET.archetype);

    const r = await seedNPCAsymmetry(db, PLOTTER);
    assert.equal(r.ok, true);

    const stress = getStress(db, PLOTTER.id);
    assert.ok(stress.stress >= 60, `stress should clear the 60 gate, got ${stress.stress}`);
    assert.ok(["paranoid", "cruel"].includes(stress.coping_trait), `expected scheming coping trait, got ${stress.coping_trait}`);

    const op = getOpinion(db, PLOTTER.id, "npc", TARGET.id);
    assert.ok(op && op.score <= -50, `opinion edge should be <= -50, got ${op?.score}`);
  });

  it("is deterministic — same NPC twice yields the same derived numbers", () => {
    const a = setupDb();
    const b = setupDb();
    a.prepare(`INSERT INTO world_npcs (id,name) VALUES (?,?)`).run(PLOTTER.id, PLOTTER.name);
    b.prepare(`INSERT INTO world_npcs (id,name) VALUES (?,?)`).run(PLOTTER.id, PLOTTER.name);
    const r1 = deriveSchemeSubstrateFromNarrative(a, PLOTTER);
    const r2 = deriveSchemeSubstrateFromNarrative(b, PLOTTER);
    assert.deepEqual({ s: r1.stress, c: r1.coping, e: r1.opinionEdges }, { s: r2.stress, c: r2.coping, e: r2.opinionEdges });
  });

  it("the scheme cycle proposes a plot along the authored rivalry with zero gameplay", async () => {
    const db = setupDb();
    db.prepare(`INSERT INTO world_npcs (id,name,faction,archetype) VALUES (?,?,?,?)`).run(PLOTTER.id, PLOTTER.name, PLOTTER.faction, PLOTTER.archetype);
    db.prepare(`INSERT INTO world_npcs (id,name,faction,archetype) VALUES (?,?,?,?)`).run(TARGET.id, TARGET.name, TARGET.faction, TARGET.archetype);

    await seedNPCAsymmetry(db, PLOTTER);

    // No combat, no exposure — straight to the cycle a cold-booted stranger's
    // world runs on its heartbeat.
    const out = await runNpcSchemeCycle({ db });
    assert.equal(out.ok, true);
    assert.ok(out.proposed >= 1, `expected >= 1 scheme proposed, got ${out.proposed}`);

    const scheme = db.prepare(`SELECT plotter_id, target_id, kind FROM npc_schemes WHERE plotter_id = ?`).get(PLOTTER.id);
    assert.ok(scheme, "a scheme row should exist for the plotter");
    assert.equal(scheme.target_id, TARGET.id, "scheme should target the authored nemesis");
  });

  it("does NOT seed schemes for a content-light NPC (no secret, no hostile edge)", async () => {
    const db = setupDb();
    const calm = { id: "baker_ona", name: "Ona", faction: "guild", archetype: "trader", narrative_context: {} };
    db.prepare(`INSERT INTO world_npcs (id,name,faction,archetype) VALUES (?,?,?,?)`).run(calm.id, calm.name, calm.faction, calm.archetype);
    await seedNPCAsymmetry(db, calm);
    const stress = getStress(db, calm.id);
    assert.ok(stress.stress < 60, "a content-light NPC should not cross the scheme gate");
    const out = await runNpcSchemeCycle({ db });
    assert.equal(out.proposed, 0, "no scheme should be proposed for the calm NPC");
  });
});
