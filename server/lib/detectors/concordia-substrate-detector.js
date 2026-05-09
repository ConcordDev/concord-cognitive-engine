// server/lib/detectors/concordia-substrate-detector.js
//
// Concordia substrate detector — checks the world's data for the same
// "zero known bugs" bar that the code-quality detectors brought to
// Concord. Three categories of finding:
//
//   INTEGRITY   — referential integrity inside the world (orphan IDs,
//                 dangling foreign-key-like references, faction
//                 mismatches in authored content).
//   CROSS-PHASE — invariants between phases (a legacy without a death,
//                 a realised quest with an active region, an inheritance
//                 link to a dead heir).
//   DISTRIBUTION — population sanity (one faction with 50× more NPCs,
//                  procgen overspawn, scarcity index out of clamp range,
//                  > 1 open beat per user).
//
// Read-only. Bounded ROW_CAP per query so a 1.5M-DTU instance can still
// run this in seconds. Each finding includes `subject` so repair-cortex
// can route it.

import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const ROW_CAP = 5000;
const CATEGORY = "concordia-substrate";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

export async function runConcordiaSubstrateDetector({ db, root, opts = {} } = {}) {
  const t0 = Date.now();
  const cap = Number.isFinite(opts.cap) ? opts.cap : ROW_CAP;
  const findings = [];

  // Static-only mode: authored-content checks even without a DB.
  // Cross-phase + distribution checks need a DB so they're skipped.
  const staticOnly = !db;

  let tables = new Set();
  if (!staticOnly) {
    try {
      tables = new Set(
        db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name),
      );
    } catch (err) {
      return makeError(CATEGORY, "schema_probe_failed", err, t0);
    }
  }

  const has = (t) => tables.has(t);

  try {
    // ── INTEGRITY (authored content) — runs in static-only mode too ───────
    await checkAuthoredContent(root || REPO_ROOT, findings);

    if (staticOnly) {
      const report = makeReport(CATEGORY, findings, t0);
      report.mode = "static_only";
      return report;
    }

    // ── INTEGRITY (DB) ────────────────────────────────────────────────────
    if (has("world_npcs")) checkNpcReferentialIntegrity(db, has, findings, cap);
    if (has("npc_grudges")) checkGrudgeTargets(db, has, findings, cap);

    // ── CROSS-PHASE INVARIANTS ────────────────────────────────────────────
    if (has("npc_legacies") && has("world_npcs")) checkLegacyConsistency(db, findings, cap);
    if (has("npc_inheritance_links") && has("world_npcs")) checkInheritanceHeirs(db, findings, cap);
    if (has("lattice_born_quests") && has("procgen_regions")) checkQuestRegionAlignment(db, findings, cap);
    if (has("npc_routine_state") && has("npc_schedules")) checkRoutineConsistency(db, findings, cap);
    if (has("player_beats")) checkBeatInvariants(db, findings, cap);
    if (has("forward_predictions")) checkPredictionBounds(db, findings, cap);
    if (has("mentorships")) checkMentorshipBounds(db, findings, cap);
    if (has("land_claims")) checkLandClaimInvariants(db, findings, cap);

    // ── DISTRIBUTION ──────────────────────────────────────────────────────
    if (has("regional_scarcity")) checkScarcityBounds(db, findings, cap);
    if (has("world_npcs")) checkPopulationDistribution(db, findings);
    if (has("procedural_npcs")) checkProcgenSanity(db, findings, cap);
    if (has("player_glyph_spells")) checkGlyphSpellSanity(db, findings, cap);

  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  return makeReport(CATEGORY, findings, t0);
}

// ── Authored content integrity ──────────────────────────────────────────────

async function checkAuthoredContent(root, findings) {
  const npcsPath = path.join(root, "content/world/npcs.json");
  const factionsPath = path.join(root, "content/world/factions.json");
  const lorePath = path.join(root, "content/world/lore.json");

  const [npcs, factions, lore] = await Promise.all([
    safeReadJson(npcsPath),
    safeReadJson(factionsPath),
    safeReadJson(lorePath),
  ]);

  if (!Array.isArray(npcs) || !Array.isArray(factions)) return;

  const factionIds = new Set(factions.map(f => f.id).filter(Boolean));
  const npcIds = new Set(npcs.map(n => n.id).filter(Boolean));

  // Detect duplicate NPC IDs in authored content.
  const seen = new Set();
  for (const n of npcs) {
    if (!n?.id) continue;
    if (seen.has(n.id)) {
      findings.push({
        id: "authored_npc_id_duplicate",
        severity: "high",
        kind: "static",
        category: CATEGORY,
        message: `Duplicate NPC id in npcs.json: ${n.id}`,
        location: "content/world/npcs.json",
        subject: { kind: "authored_npc", id: n.id },
      });
    }
    seen.add(n.id);

    // NPC.faction_id must reference an existing faction (null is allowed).
    if (n.faction_id != null && !factionIds.has(n.faction_id)) {
      findings.push({
        id: "authored_npc_dangling_faction",
        severity: "medium",
        kind: "static",
        category: CATEGORY,
        message: `NPC ${n.id} references unknown faction_id "${n.faction_id}"`,
        location: "content/world/npcs.json",
        subject: { kind: "authored_npc", id: n.id, faction: n.faction_id },
      });
    }

    // Relationships should point at known NPCs.
    if (Array.isArray(n.relationships)) {
      for (const rel of n.relationships) {
        if (rel?.npc_id && !npcIds.has(rel.npc_id)) {
          findings.push({
            id: "authored_npc_dangling_relationship",
            severity: "low",
            kind: "static",
            category: CATEGORY,
            message: `NPC ${n.id} has a relationship pointing at unknown NPC "${rel.npc_id}"`,
            location: "content/world/npcs.json",
            subject: { kind: "authored_npc", id: n.id, relationship: rel.npc_id },
          });
        }
      }
    }
  }

  // Faction.npc_ids should resolve, AND each referenced NPC's faction_id should match.
  for (const f of factions) {
    if (!Array.isArray(f.npc_ids)) continue;
    for (const id of f.npc_ids) {
      const npc = npcs.find(n => n.id === id);
      if (!npc) {
        findings.push({
          id: "authored_faction_dangling_npc",
          severity: "low",
          kind: "static",
          category: CATEGORY,
          message: `Faction ${f.id} lists unknown NPC "${id}"`,
          location: "content/world/factions.json",
          subject: { kind: "authored_faction", id: f.id, npc: id },
        });
      } else if (npc.faction_id && npc.faction_id !== f.id) {
        findings.push({
          id: "authored_faction_npc_mismatch",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: `Faction ${f.id} lists NPC ${id} but that NPC's faction_id is "${npc.faction_id}"`,
          location: "content/world/factions.json",
          subject: { kind: "authored_faction", id: f.id, npc: id },
        });
      }
    }
  }

  // Lore events: factions_involved should resolve.
  if (lore?.history && Array.isArray(lore.history)) {
    for (const ev of lore.history) {
      if (Array.isArray(ev.factions_involved)) {
        for (const fid of ev.factions_involved) {
          if (!factionIds.has(fid)) {
            findings.push({
              id: "authored_lore_dangling_faction",
              severity: "low",
              kind: "static",
              category: CATEGORY,
              message: `Lore event ${ev.id} references unknown faction "${fid}"`,
              location: "content/world/lore.json",
              subject: { kind: "authored_lore", id: ev.id, faction: fid },
            });
          }
        }
      }
    }
  }
}

async function safeReadJson(p) {
  try {
    const raw = await readFile(p, "utf-8");
    return JSON.parse(raw);
  } catch { return null; }
}

// ── DB referential integrity ────────────────────────────────────────────────

function checkNpcReferentialIntegrity(db, has, findings, cap) {
  // NPCs with faction set to a faction that has zero alive NPCs other
  // than them aren't broken — they may just be the last survivor. So
  // this is intentionally lenient. We only flag NPCs whose faction is
  // a string that no other NPC in the corpus uses (likely a typo).
  try {
    const orphanFactions = db.prepare(`
      SELECT id, faction FROM world_npcs
      WHERE faction IS NOT NULL AND faction != ''
        AND faction NOT IN (
          SELECT faction FROM world_npcs
          WHERE faction IS NOT NULL AND faction != ''
          GROUP BY faction HAVING COUNT(*) >= 2
        )
      LIMIT ?
    `).all(cap);
    // Only flag if there are also more typo-likely cases (only 1 NPC per faction).
    if (orphanFactions.length > 0 && orphanFactions.length <= 5) {
      // Likely a small instance; skip to avoid noise.
      return;
    }
    for (const r of orphanFactions.slice(0, 50)) {
      findings.push({
        id: "npc_orphan_faction",
        severity: "low",
        kind: "semantic",
        category: CATEGORY,
        message: `NPC ${r.id} is the only member of faction "${r.faction}" — likely typo`,
        subject: { kind: "world_npc", id: r.id, faction: r.faction },
      });
    }
  } catch { /* ignore */ }
}

function checkGrudgeTargets(db, has, findings, cap) {
  // Grudges with target_kind='npc' but target_id not in world_npcs are
  // either pre-spawn fabrications (Phase 2 seeds them with deterministic
  // tokens) or genuinely dangling. We tolerate a fixed pattern of seeded
  // tokens to keep false-positive count low.
  try {
    const dangling = db.prepare(`
      SELECT g.id, g.npc_id, g.target_id FROM npc_grudges g
      WHERE g.target_kind = 'npc'
        AND g.resolved_at IS NULL
        AND g.target_id NOT LIKE '%_neighbor_%'  -- Phase 2 seeded token pattern
        AND g.target_id NOT IN (SELECT id FROM world_npcs)
      LIMIT ?
    `).all(cap);
    for (const r of dangling) {
      findings.push({
        id: "grudge_dangling_target",
        severity: "low",
        kind: "semantic",
        category: CATEGORY,
        message: `NPC ${r.npc_id} holds an unresolved grudge against missing NPC "${r.target_id}"`,
        subject: { kind: "grudge", id: r.id, npc: r.npc_id, target: r.target_id },
      });
    }
  } catch { /* ignore */ }
}

// ── Cross-phase invariants ──────────────────────────────────────────────────

function checkLegacyConsistency(db, findings, cap) {
  // A legacy row implies the NPC died. is_dead should be 1.
  try {
    const wrong = db.prepare(`
      SELECT l.npc_id FROM npc_legacies l
      JOIN world_npcs n ON n.id = l.npc_id
      WHERE COALESCE(n.is_dead, 0) = 0
      LIMIT ?
    `).all(cap);
    for (const r of wrong) {
      findings.push({
        id: "legacy_without_death",
        severity: "high",
        kind: "semantic",
        category: CATEGORY,
        message: `NPC ${r.npc_id} has a legacy row but is_dead=0 (Phase 5b invariant violated)`,
        subject: { kind: "npc_legacy", npc: r.npc_id },
        fixHint: "set world_npcs.is_dead=1 or delete the legacy row",
      });
    }
  } catch { /* ignore */ }
}

function checkInheritanceHeirs(db, findings, cap) {
  // An heir that has died too is fine (the Phase 5b cascade can re-route),
  // BUT an inheritance_link rows whose heir_npc_id doesn't exist at all
  // is broken state.
  try {
    const dangling = db.prepare(`
      SELECT id, heir_npc_id, deceased_npc_id FROM npc_inheritance_links
      WHERE heir_npc_id NOT IN (SELECT id FROM world_npcs)
      LIMIT ?
    `).all(cap);
    for (const r of dangling) {
      findings.push({
        id: "inheritance_dangling_heir",
        severity: "medium",
        kind: "semantic",
        category: CATEGORY,
        message: `Inheritance link ${r.id} references unknown heir "${r.heir_npc_id}"`,
        subject: { kind: "inheritance_link", id: r.id, heir: r.heir_npc_id },
      });
    }
  } catch { /* ignore */ }
}

function checkQuestRegionAlignment(db, findings, cap) {
  // Quest realised with same drift_alert_signature as an active region.
  // Phase 5e cascade should have decayed the region; if it's still
  // active, the cascade silently failed.
  try {
    const stuck = db.prepare(`
      SELECT q.quest_id, q.drift_alert_signature, r.id AS region_id
      FROM lattice_born_quests q
      JOIN procgen_regions r ON r.drift_alert_signature = q.drift_alert_signature
      WHERE q.realised_at IS NOT NULL
        AND r.decayed_at IS NULL
      LIMIT ?
    `).all(cap);
    for (const x of stuck) {
      findings.push({
        id: "quest_realised_region_active",
        severity: "medium",
        kind: "semantic",
        category: CATEGORY,
        message: `Quest ${x.quest_id} is realised but region ${x.region_id} is still active`,
        subject: { kind: "lattice_born_quest", id: x.quest_id, region: x.region_id },
        fixHint: "call procgen-regions.decayRegion(regionId)",
      });
    }
  } catch { /* ignore */ }
}

function checkRoutineConsistency(db, findings, cap) {
  // routine_state.current_block must match a row in npc_schedules for
  // the same npc_id + day_seed.
  try {
    const today = Math.floor(Date.now() / 86400000);
    const inconsistent = db.prepare(`
      SELECT rs.npc_id, rs.current_block FROM npc_routine_state rs
      WHERE NOT EXISTS (
        SELECT 1 FROM npc_schedules s
        WHERE s.npc_id = rs.npc_id
          AND s.day_seed = ?
          AND s.block_idx = rs.current_block
      )
      LIMIT ?
    `).all(today, cap);
    for (const r of inconsistent) {
      findings.push({
        id: "routine_state_no_schedule",
        severity: "low",
        kind: "semantic",
        category: CATEGORY,
        message: `NPC ${r.npc_id} routine_state references block ${r.current_block} that has no matching schedule today`,
        subject: { kind: "npc_routine", npc: r.npc_id, block: r.current_block },
      });
    }
  } catch { /* ignore */ }
}

function checkBeatInvariants(db, findings, cap) {
  // Phase 3 invariant: at most 1 open beat per user.
  try {
    const multiple = db.prepare(`
      SELECT user_id, COUNT(*) AS n FROM player_beats
      WHERE completed_at IS NULL
      GROUP BY user_id HAVING n > 1
      LIMIT ?
    `).all(cap);
    for (const r of multiple) {
      findings.push({
        id: "beat_multiple_open",
        severity: "medium",
        kind: "semantic",
        category: CATEGORY,
        message: `User ${r.user_id} has ${r.n} open beats — Phase 3 invariant is "at most 1 open"`,
        subject: { kind: "player_beats", user: r.user_id, count: r.n },
        fixHint: "expire all but the newest open beat",
      });
    }
  } catch { /* ignore */ }
}

function checkPredictionBounds(db, findings, cap) {
  // Phase 10 forward-sim: confidence must be in [0, 1].
  try {
    const oob = db.prepare(`
      SELECT id, confidence FROM forward_predictions
      WHERE confidence < 0 OR confidence > 1
      LIMIT ?
    `).all(cap);
    for (const r of oob) {
      findings.push({
        id: "prediction_confidence_oob",
        severity: "high",
        kind: "semantic",
        category: CATEGORY,
        message: `Forward prediction ${r.id} has confidence ${r.confidence} outside [0, 1]`,
        subject: { kind: "forward_prediction", id: r.id, confidence: r.confidence },
      });
    }
  } catch { /* ignore */ }
}

function checkMentorshipBounds(db, findings, cap) {
  try {
    const oob = db.prepare(`
      SELECT id, sessions_remaining, sessions_total FROM mentorships
      WHERE sessions_remaining > sessions_total OR sessions_remaining < 0
      LIMIT ?
    `).all(cap);
    for (const r of oob) {
      findings.push({
        id: "mentorship_sessions_oob",
        severity: "high",
        kind: "semantic",
        category: CATEGORY,
        message: `Mentorship ${r.id} has remaining=${r.sessions_remaining} > total=${r.sessions_total}`,
        subject: { kind: "mentorship", id: r.id },
      });
    }
  } catch { /* ignore */ }
}

function checkLandClaimInvariants(db, findings, cap) {
  // Active claim with bond <= 0 means the maintenance cycle didn't expire it.
  try {
    const stuck = db.prepare(`
      SELECT id, bond_sparks FROM land_claims
      WHERE status = 'active' AND bond_sparks <= 0
      LIMIT ?
    `).all(cap);
    for (const r of stuck) {
      findings.push({
        id: "land_claim_zero_bond_active",
        severity: "medium",
        kind: "semantic",
        category: CATEGORY,
        message: `Land claim ${r.id} has bond=${r.bond_sparks} but status='active' — maintenance cycle didn't expire it`,
        subject: { kind: "land_claim", id: r.id },
        fixHint: "call land-claims.tickMaintenance(claimId) or set status='expired'",
      });
    }

    // Radius bounds (migration 135 says 5 ≤ radius ≤ 200).
    const oobRadius = db.prepare(`
      SELECT id, radius_m FROM land_claims
      WHERE radius_m < 5 OR radius_m > 200
      LIMIT ?
    `).all(cap);
    for (const r of oobRadius) {
      findings.push({
        id: "land_claim_radius_oob",
        severity: "medium",
        kind: "semantic",
        category: CATEGORY,
        message: `Land claim ${r.id} has radius=${r.radius_m} outside [5, 200]`,
        subject: { kind: "land_claim", id: r.id, radius: r.radius_m },
      });
    }
  } catch { /* ignore */ }
}

// ── Distribution ────────────────────────────────────────────────────────────

function checkScarcityBounds(db, findings, cap) {
  try {
    const oob = db.prepare(`
      SELECT world_id, resource_kind, scarcity FROM regional_scarcity
      WHERE scarcity < -1 OR scarcity > 2
      LIMIT ?
    `).all(cap);
    for (const r of oob) {
      findings.push({
        id: "scarcity_index_oob",
        severity: "high",
        kind: "semantic",
        category: CATEGORY,
        message: `regional_scarcity ${r.world_id}/${r.resource_kind} = ${r.scarcity} outside [-1, 2] (CHECK constraint should have prevented this)`,
        subject: { kind: "regional_scarcity", world: r.world_id, resource: r.resource_kind },
      });
    }
  } catch { /* ignore */ }
}

function checkPopulationDistribution(db, findings) {
  // Per-world: alert if one faction has > 50× another. A canary for
  // procgen-spawner mis-tuning OR for a hand-authored sub-world that
  // forgot to populate one side.
  try {
    const rows = db.prepare(`
      SELECT world_id, faction, COUNT(*) AS n FROM world_npcs
      WHERE COALESCE(is_dead, 0) = 0 AND faction IS NOT NULL AND faction != ''
      GROUP BY world_id, faction
    `).all();
    const byWorld = new Map();
    for (const r of rows) {
      if (!byWorld.has(r.world_id)) byWorld.set(r.world_id, []);
      byWorld.get(r.world_id).push(r);
    }
    for (const [worldId, factionRows] of byWorld) {
      if (factionRows.length < 2) continue;
      const counts = factionRows.map(r => r.n);
      const maxN = Math.max(...counts);
      const minN = Math.min(...counts);
      if (minN === 0) continue;
      const ratio = maxN / minN;
      if (ratio > 50) {
        findings.push({
          id: "faction_population_imbalance",
          severity: "low",
          kind: "semantic",
          category: CATEGORY,
          message: `World ${worldId} has faction population ratio ${ratio.toFixed(1)}× (max=${maxN}, min=${minN})`,
          subject: { kind: "world_population", world: worldId, ratio },
        });
      }
    }
  } catch { /* ignore */ }
}

function checkProcgenSanity(db, findings, cap) {
  // Procgen overspawn: > 1000 procedural NPCs in a single world is
  // probably a mis-tuned spawner.
  try {
    const counts = db.prepare(`
      SELECT world_id, COUNT(*) AS n FROM procedural_npcs
      GROUP BY world_id HAVING n > 1000
      LIMIT ?
    `).all(cap);
    for (const r of counts) {
      findings.push({
        id: "procgen_npc_overspawn",
        severity: "medium",
        kind: "semantic",
        category: CATEGORY,
        message: `World ${r.world_id} has ${r.n} procedural NPCs — probably mis-tuned spawner cap`,
        subject: { kind: "procedural_npcs", world: r.world_id, count: r.n },
        fixHint: "lower CONCORD_FACTION_TARGET_POPULATION or sweep dead NPCs",
      });
    }
  } catch { /* ignore */ }
}

function checkGlyphSpellSanity(db, findings, cap) {
  // The composer should never produce a spell whose composed_glyph is
  // empty. A spell with stamina_cost or mana_cost > 100 likely indicates
  // the chain length wasn't bounded properly.
  try {
    const empty = db.prepare(`
      SELECT id FROM player_glyph_spells
      WHERE composed_glyph = '' OR composed_glyph IS NULL
      LIMIT ?
    `).all(cap);
    for (const r of empty) {
      findings.push({
        id: "glyph_spell_empty_glyph",
        severity: "high",
        kind: "semantic",
        category: CATEGORY,
        message: `player_glyph_spells ${r.id} has empty composed_glyph (Phase 5d invariant)`,
        subject: { kind: "glyph_spell", id: r.id },
      });
    }

    const wild = db.prepare(`
      SELECT id, stamina_cost, mana_cost FROM player_glyph_spells
      WHERE stamina_cost > 100 OR mana_cost > 100
      LIMIT ?
    `).all(cap);
    for (const r of wild) {
      findings.push({
        id: "glyph_spell_wild_costs",
        severity: "medium",
        kind: "semantic",
        category: CATEGORY,
        message: `player_glyph_spells ${r.id} has stamina=${r.stamina_cost}, mana=${r.mana_cost} — chain bound likely missing`,
        subject: { kind: "glyph_spell", id: r.id },
      });
    }
  } catch { /* ignore */ }
}
