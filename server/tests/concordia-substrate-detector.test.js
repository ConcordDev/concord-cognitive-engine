/**
 * Tier-2 contract tests for ConcordiaSubstrateDetector.
 *
 * Pinned per category:
 *
 *   INTEGRITY (authored content):
 *     - duplicate authored NPC id → high
 *     - NPC.faction_id pointing at unknown faction → medium
 *     - NPC relationship pointing at unknown NPC → low
 *     - Faction.npc_ids pointing at unknown NPC → low
 *     - Faction.npc_ids/NPC.faction_id mismatch → medium
 *     - Lore event factions_involved unknown → low
 *
 *   CROSS-PHASE INVARIANTS:
 *     - legacy without is_dead=1 → high
 *     - inheritance link to unknown heir → medium
 *     - quest realised but region active → medium
 *     - routine_state without matching schedule → low
 *     - >1 open beat per user → medium
 *     - prediction confidence outside [0,1] → high
 *     - mentorship sessions_remaining > total → high
 *     - active land claim with bond <= 0 → medium
 *     - land claim radius outside [5, 200] → medium
 *
 *   DISTRIBUTION:
 *     - regional_scarcity outside [-1, 2] → high
 *     - faction population ratio > 50× → low
 *     - >1000 procedural NPCs in a single world → medium
 *     - empty composed_glyph → high
 *     - glyph spell with stamina/mana > 100 → medium
 *
 * Run: node --test tests/concordia-substrate-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { runConcordiaSubstrateDetector } from "../lib/detectors/concordia-substrate-detector.js";

// ── Fake DB ─────────────────────────────────────────────────────────────────

function makeFakeDb({ tables = [] } = {}) {
  const data = {};
  const tableSet = new Set(tables);
  for (const t of tables) data[t] = [];

  const stubbedSchema = Array.from(tableSet).map(name => ({ name, type: "table" }));

  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return { all: (...a) => allStmt(s, a) };
  }

  function allStmt(sql, args) {
    if (sql.startsWith("SELECT name FROM sqlite_master")) {
      return stubbedSchema;
    }
    if (sql.startsWith("PRAGMA table_info")) return [];

    // World NPCs
    if (sql.startsWith("SELECT id, faction FROM world_npcs")) {
      const rows = data.world_npcs || [];
      const factionCounts = {};
      for (const r of rows) {
        if (!r.faction) continue;
        factionCounts[r.faction] = (factionCounts[r.faction] || 0) + 1;
      }
      const onlyOne = rows.filter(r => r.faction && factionCounts[r.faction] === 1);
      return onlyOne.slice(0, args[0]);
    }

    if (sql.startsWith("SELECT g.id, g.npc_id, g.target_id FROM npc_grudges g")) {
      const rows = data.npc_grudges || [];
      const npcIds = new Set((data.world_npcs || []).map(n => n.id));
      return rows
        .filter(g => g.target_kind === "npc" && g.resolved_at == null && !g.target_id.includes("_neighbor_") && !npcIds.has(g.target_id))
        .slice(0, args[0]);
    }

    if (sql.startsWith("SELECT l.npc_id FROM npc_legacies l")) {
      const legacies = data.npc_legacies || [];
      const npcs = new Map((data.world_npcs || []).map(n => [n.id, n]));
      return legacies
        .filter(l => {
          const n = npcs.get(l.npc_id);
          return n && !n.is_dead;
        })
        .map(l => ({ npc_id: l.npc_id }))
        .slice(0, args[0]);
    }

    if (sql.startsWith("SELECT id, heir_npc_id, deceased_npc_id FROM npc_inheritance_links")) {
      const links = data.npc_inheritance_links || [];
      const npcIds = new Set((data.world_npcs || []).map(n => n.id));
      return links.filter(l => !npcIds.has(l.heir_npc_id)).slice(0, args[0]);
    }

    if (sql.startsWith("SELECT q.quest_id, q.drift_alert_signature, r.id AS region_id")) {
      const quests = data.lattice_born_quests || [];
      const regions = data.procgen_regions || [];
      const out = [];
      for (const q of quests) {
        if (q.realised_at == null) continue;
        for (const r of regions) {
          if (r.drift_alert_signature !== q.drift_alert_signature) continue;
          if (r.decayed_at == null) out.push({ quest_id: q.quest_id, drift_alert_signature: q.drift_alert_signature, region_id: r.id });
        }
      }
      return out.slice(0, args[0]);
    }

    if (sql.startsWith("SELECT rs.npc_id, rs.current_block FROM npc_routine_state rs")) {
      const states = data.npc_routine_state || [];
      const schedules = data.npc_schedules || [];
      const today = args[0];
      return states.filter(rs => {
        return !schedules.some(s => s.npc_id === rs.npc_id && s.day_seed === today && s.block_idx === rs.current_block);
      }).slice(0, args[1]);
    }

    if (sql.startsWith("SELECT user_id, COUNT(*) AS n FROM player_beats")) {
      const beats = data.player_beats || [];
      const counts = {};
      for (const b of beats) {
        if (b.completed_at != null) continue;
        counts[b.user_id] = (counts[b.user_id] || 0) + 1;
      }
      return Object.entries(counts).filter(([_, n]) => n > 1).map(([user_id, n]) => ({ user_id, n })).slice(0, args[0]);
    }

    if (sql.startsWith("SELECT id, confidence FROM forward_predictions")) {
      const ps = data.forward_predictions || [];
      return ps.filter(p => p.confidence < 0 || p.confidence > 1).slice(0, args[0]);
    }

    if (sql.startsWith("SELECT id, sessions_remaining, sessions_total FROM mentorships")) {
      const ms = data.mentorships || [];
      return ms.filter(m => m.sessions_remaining > m.sessions_total || m.sessions_remaining < 0).slice(0, args[0]);
    }

    if (sql.startsWith("SELECT id, bond_sparks FROM land_claims") && sql.includes("status = 'active'")) {
      const cs = data.land_claims || [];
      return cs.filter(c => c.status === "active" && c.bond_sparks <= 0).slice(0, args[0]);
    }

    if (sql.startsWith("SELECT id, radius_m FROM land_claims")) {
      const cs = data.land_claims || [];
      return cs.filter(c => c.radius_m < 5 || c.radius_m > 200).slice(0, args[0]);
    }

    if (sql.startsWith("SELECT world_id, resource_kind, scarcity FROM regional_scarcity")) {
      const rs = data.regional_scarcity || [];
      return rs.filter(r => r.scarcity < -1 || r.scarcity > 2).slice(0, args[0]);
    }

    if (sql.startsWith("SELECT world_id, faction, COUNT(*) AS n FROM world_npcs")) {
      const ns = data.world_npcs || [];
      const counts = {};
      for (const n of ns) {
        if (n.is_dead) continue;
        if (!n.faction) continue;
        const k = `${n.world_id}|${n.faction}`;
        counts[k] = (counts[k] || 0) + 1;
      }
      return Object.entries(counts).map(([k, n]) => {
        const [world_id, faction] = k.split("|");
        return { world_id, faction, n };
      });
    }

    if (sql.startsWith("SELECT world_id, COUNT(*) AS n FROM procedural_npcs")) {
      const ps = data.procedural_npcs || [];
      const counts = {};
      for (const p of ps) counts[p.world_id] = (counts[p.world_id] || 0) + 1;
      return Object.entries(counts).filter(([_, n]) => n > 1000).map(([world_id, n]) => ({ world_id, n })).slice(0, args[0]);
    }

    if (sql.startsWith("SELECT id FROM player_glyph_spells WHERE composed_glyph")) {
      const ss = data.player_glyph_spells || [];
      return ss.filter(s => !s.composed_glyph).slice(0, args[0]);
    }

    if (sql.startsWith("SELECT id, stamina_cost, mana_cost FROM player_glyph_spells")) {
      const ss = data.player_glyph_spells || [];
      return ss.filter(s => (s.stamina_cost > 100) || (s.mana_cost > 100)).slice(0, args[0]);
    }

    return [];
  }

  return { prepare, _data: data };
}

// ── Authored content fixtures ───────────────────────────────────────────────

function withTempContent(setup) {
  const dir = path.join(tmpdir(), `concord-detector-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path.join(dir, "content/world"), { recursive: true });
  setup(dir);
  return dir;
}

function tearDown(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ConcordiaSubstrateDetector — empty / no-data states", () => {
  it("static-only mode runs authored-content checks without DB", async () => {
    const r = await runConcordiaSubstrateDetector({ root: "/nonexistent" });
    assert.equal(r.ok, true);
    assert.equal(r.mode, "static_only");
  });

  it("returns ok with no findings on empty DB + missing content", async () => {
    const db = makeFakeDb({ tables: [] });
    const r = await runConcordiaSubstrateDetector({ db, root: "/nonexistent" });
    assert.equal(r.ok, true);
    assert.equal(r.summary.total, 0);
  });
});

describe("INTEGRITY — authored content checks", () => {
  it("flags duplicate NPC id as high", async () => {
    const dir = withTempContent(d => {
      writeFileSync(path.join(d, "content/world/npcs.json"), JSON.stringify([
        { id: "npc:a", name: "A" },
        { id: "npc:a", name: "B" },
      ]));
      writeFileSync(path.join(d, "content/world/factions.json"), JSON.stringify([]));
      writeFileSync(path.join(d, "content/world/lore.json"), JSON.stringify({ history: [] }));
    });
    try {
      const db = makeFakeDb({ tables: [] });
      const r = await runConcordiaSubstrateDetector({ db, root: dir });
      assert.equal(r.ok, true);
      const dup = r.findings.find(f => f.id === "authored_npc_id_duplicate");
      assert.ok(dup);
      assert.equal(dup.severity, "high");
    } finally { tearDown(dir); }
  });

  it("flags NPC pointing at unknown faction (medium)", async () => {
    const dir = withTempContent(d => {
      writeFileSync(path.join(d, "content/world/npcs.json"), JSON.stringify([
        { id: "npc:a", name: "A", faction_id: "ghosts_who_arent_real" },
      ]));
      writeFileSync(path.join(d, "content/world/factions.json"), JSON.stringify([
        { id: "real_faction", name: "Real" },
      ]));
      writeFileSync(path.join(d, "content/world/lore.json"), JSON.stringify({ history: [] }));
    });
    try {
      const db = makeFakeDb({ tables: [] });
      const r = await runConcordiaSubstrateDetector({ db, root: dir });
      const f = r.findings.find(x => x.id === "authored_npc_dangling_faction");
      assert.ok(f);
      assert.equal(f.severity, "medium");
    } finally { tearDown(dir); }
  });

  it("flags Faction.npc_ids/NPC.faction_id mismatch", async () => {
    const dir = withTempContent(d => {
      writeFileSync(path.join(d, "content/world/npcs.json"), JSON.stringify([
        { id: "npc:a", name: "A", faction_id: "factionA" },
      ]));
      writeFileSync(path.join(d, "content/world/factions.json"), JSON.stringify([
        { id: "factionB", name: "B", npc_ids: ["npc:a"] }, // mismatch — npc:a says factionA
      ]));
      writeFileSync(path.join(d, "content/world/lore.json"), JSON.stringify({ history: [] }));
    });
    try {
      const db = makeFakeDb({ tables: [] });
      const r = await runConcordiaSubstrateDetector({ db, root: dir });
      const f = r.findings.find(x => x.id === "authored_faction_npc_mismatch");
      assert.ok(f);
      assert.equal(f.severity, "medium");
    } finally { tearDown(dir); }
  });

  it("flags lore event with unknown faction", async () => {
    const dir = withTempContent(d => {
      writeFileSync(path.join(d, "content/world/npcs.json"), JSON.stringify([]));
      writeFileSync(path.join(d, "content/world/factions.json"), JSON.stringify([{ id: "real" }]));
      writeFileSync(path.join(d, "content/world/lore.json"), JSON.stringify({
        history: [{ id: "ev1", title: "x", factions_involved: ["fake_faction"] }],
      }));
    });
    try {
      const db = makeFakeDb({ tables: [] });
      const r = await runConcordiaSubstrateDetector({ db, root: dir });
      const f = r.findings.find(x => x.id === "authored_lore_dangling_faction");
      assert.ok(f);
    } finally { tearDown(dir); }
  });
});

describe("CROSS-PHASE — substrate invariants", () => {
  it("flags legacy without death (Phase 5b violation)", async () => {
    const db = makeFakeDb({ tables: ["world_npcs", "npc_legacies"] });
    db._data.world_npcs.push({ id: "npc:undead", is_dead: 0, faction: "x" });
    db._data.npc_legacies.push({ npc_id: "npc:undead" });
    const r = await runConcordiaSubstrateDetector({ db, root: "/nope" });
    const f = r.findings.find(x => x.id === "legacy_without_death");
    assert.ok(f);
    assert.equal(f.severity, "high");
  });

  it("flags inheritance link to unknown heir", async () => {
    const db = makeFakeDb({ tables: ["world_npcs", "npc_inheritance_links"] });
    db._data.world_npcs.push({ id: "npc:a", is_dead: 0, faction: "x" });
    db._data.npc_inheritance_links.push({ id: "il1", deceased_npc_id: "npc:dead", heir_npc_id: "npc:ghost" });
    const r = await runConcordiaSubstrateDetector({ db, root: "/nope" });
    const f = r.findings.find(x => x.id === "inheritance_dangling_heir");
    assert.ok(f);
  });

  it("flags realised quest with active region", async () => {
    const db = makeFakeDb({ tables: ["lattice_born_quests", "procgen_regions"] });
    db._data.lattice_born_quests.push({ quest_id: "q1", drift_alert_signature: "sig1", realised_at: 1234 });
    db._data.procgen_regions.push({ id: "r1", drift_alert_signature: "sig1", decayed_at: null });
    const r = await runConcordiaSubstrateDetector({ db, root: "/nope" });
    const f = r.findings.find(x => x.id === "quest_realised_region_active");
    assert.ok(f);
    assert.equal(f.severity, "medium");
  });

  it("flags multiple open beats for one user (Phase 3 invariant)", async () => {
    const db = makeFakeDb({ tables: ["player_beats"] });
    db._data.player_beats.push(
      { user_id: "u1", completed_at: null },
      { user_id: "u1", completed_at: null },
      { user_id: "u1", completed_at: null },
    );
    const r = await runConcordiaSubstrateDetector({ db, root: "/nope" });
    const f = r.findings.find(x => x.id === "beat_multiple_open");
    assert.ok(f);
    assert.equal(f.severity, "medium");
  });

  it("flags forward prediction confidence out of [0, 1]", async () => {
    const db = makeFakeDb({ tables: ["forward_predictions"] });
    db._data.forward_predictions.push({ id: "p1", confidence: 1.5 });
    db._data.forward_predictions.push({ id: "p2", confidence: -0.1 });
    const r = await runConcordiaSubstrateDetector({ db, root: "/nope" });
    const fs = r.findings.filter(x => x.id === "prediction_confidence_oob");
    assert.equal(fs.length, 2);
    assert.equal(fs[0].severity, "high");
  });

  it("flags mentorship sessions_remaining > total", async () => {
    const db = makeFakeDb({ tables: ["mentorships"] });
    db._data.mentorships.push({ id: "m1", sessions_remaining: 5, sessions_total: 3 });
    const r = await runConcordiaSubstrateDetector({ db, root: "/nope" });
    const f = r.findings.find(x => x.id === "mentorship_sessions_oob");
    assert.ok(f);
    assert.equal(f.severity, "high");
  });

  it("flags active land claim with non-positive bond", async () => {
    const db = makeFakeDb({ tables: ["land_claims"] });
    db._data.land_claims.push({ id: "c1", status: "active", bond_sparks: 0, radius_m: 30 });
    const r = await runConcordiaSubstrateDetector({ db, root: "/nope" });
    const f = r.findings.find(x => x.id === "land_claim_zero_bond_active");
    assert.ok(f);
  });

  it("flags land claim radius out of bounds", async () => {
    const db = makeFakeDb({ tables: ["land_claims"] });
    db._data.land_claims.push({ id: "c1", status: "active", bond_sparks: 50, radius_m: 500 });
    const r = await runConcordiaSubstrateDetector({ db, root: "/nope" });
    const f = r.findings.find(x => x.id === "land_claim_radius_oob");
    assert.ok(f);
  });
});

describe("DISTRIBUTION — population + index sanity", () => {
  it("flags scarcity index out of [-1, 2]", async () => {
    const db = makeFakeDb({ tables: ["regional_scarcity"] });
    db._data.regional_scarcity.push({ world_id: "w", resource_kind: "ore", scarcity: 5 });
    const r = await runConcordiaSubstrateDetector({ db, root: "/nope" });
    const f = r.findings.find(x => x.id === "scarcity_index_oob");
    assert.ok(f);
    assert.equal(f.severity, "high");
  });

  it("flags faction population > 50× ratio", async () => {
    const db = makeFakeDb({ tables: ["world_npcs"] });
    for (let i = 0; i < 100; i++) db._data.world_npcs.push({ id: `n${i}`, world_id: "w", faction: "big", is_dead: 0 });
    db._data.world_npcs.push({ id: "lone", world_id: "w", faction: "tiny", is_dead: 0 });
    const r = await runConcordiaSubstrateDetector({ db, root: "/nope" });
    const f = r.findings.find(x => x.id === "faction_population_imbalance");
    assert.ok(f);
  });

  it("flags procgen overspawn > 1000 per world", async () => {
    const db = makeFakeDb({ tables: ["procedural_npcs"] });
    for (let i = 0; i < 1500; i++) db._data.procedural_npcs.push({ npc_id: `pn${i}`, world_id: "w" });
    const r = await runConcordiaSubstrateDetector({ db, root: "/nope" });
    const f = r.findings.find(x => x.id === "procgen_npc_overspawn");
    assert.ok(f);
    assert.equal(f.severity, "medium");
  });

  it("flags empty composed_glyph", async () => {
    const db = makeFakeDb({ tables: ["player_glyph_spells"] });
    db._data.player_glyph_spells.push({ id: "ps1", composed_glyph: "", stamina_cost: 1, mana_cost: 1 });
    const r = await runConcordiaSubstrateDetector({ db, root: "/nope" });
    const f = r.findings.find(x => x.id === "glyph_spell_empty_glyph");
    assert.ok(f);
    assert.equal(f.severity, "high");
  });

  it("flags glyph spell with > 100 cost", async () => {
    const db = makeFakeDb({ tables: ["player_glyph_spells"] });
    db._data.player_glyph_spells.push({ id: "ps1", composed_glyph: "⟐", stamina_cost: 200, mana_cost: 5 });
    const r = await runConcordiaSubstrateDetector({ db, root: "/nope" });
    const f = r.findings.find(x => x.id === "glyph_spell_wild_costs");
    assert.ok(f);
  });
});

describe("Detector returns clean on healthy state", () => {
  it("zero findings when everything is consistent", async () => {
    const dir = withTempContent(d => {
      writeFileSync(path.join(d, "content/world/npcs.json"), JSON.stringify([
        { id: "npc:a", name: "A", faction_id: "real" },
      ]));
      writeFileSync(path.join(d, "content/world/factions.json"), JSON.stringify([
        { id: "real", name: "Real", npc_ids: ["npc:a"] },
      ]));
      writeFileSync(path.join(d, "content/world/lore.json"), JSON.stringify({
        history: [{ id: "ev1", title: "x", factions_involved: ["real"] }],
      }));
    });
    try {
      const db = makeFakeDb({ tables: ["world_npcs", "player_beats", "regional_scarcity"] });
      // Healthy state: 1 NPC in faction, no over-broadcast scarcity, no
      // cross-phase violations.
      db._data.world_npcs.push({ id: "n1", world_id: "w", faction: "real", is_dead: 0 });
      db._data.world_npcs.push({ id: "n2", world_id: "w", faction: "real", is_dead: 0 });
      db._data.regional_scarcity.push({ world_id: "w", resource_kind: "ore", scarcity: 0.3 });
      const r = await runConcordiaSubstrateDetector({ db, root: dir });
      assert.equal(r.ok, true);
      assert.equal(r.summary.total, 0, `expected 0 findings, got ${r.summary.total}: ${JSON.stringify(r.findings)}`);
    } finally { tearDown(dir); }
  });
});
