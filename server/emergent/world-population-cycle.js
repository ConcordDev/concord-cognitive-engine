// server/emergent/world-population-cycle.js
//
// Phase H — primary populator. Every 15 min (~60 ticks) tops each
// active world's factions to the density target declared in
// loops.json#npcDensity.targetPerFaction, biased by archetype need.
//
// Per spawn:
//   1. generateNpc({ factionId, seed, worldId }) — existing helper.
//   2. linkBloodline — pick a candidate authored ancestor in the same
//      faction; assign a 2-3-generation chain so the procgen NPC reads
//      as a descendant of an authored character.
//   3. ensureNpcAuthoredSkills(db, npc) — existing milestone-based skills.
//   4. seedNPCAsymmetry(db, npc) — existing grudges/preoccupations/desires.
//   5. composeBackstory — deterministic by default, LLM-enhanced when
//      CONCORD_PROCGEN_BACKSTORY_LLM=true (with fallback). Stored on
//      world_npcs.narrative_context.backstory.
//
// Kill-switch: CONCORD_PROCGEN_NPCS=0.
// Per-pass cap: CONCORD_WORLD_POPULATION_PER_PASS (default 30).

import logger from "../logger.js";
import crypto from "node:crypto";
import { generateNpc, persistGeneratedNpc, FACTION_PROFILES } from "../lib/npc-generator.js";
import { getNpcDensityTarget, getWorldVoice, isLoopEnabledForWorld } from "../lib/world-flavor.js";
import { composeDeterministicBackstory, composeLlmBackstory } from "../lib/npc-backstory.js";
import { getArchetypeNeeds, ARCHETYPE_LIST } from "../lib/archetype-needs.js";

const MAX_PER_PASS = Number(process.env.CONCORD_WORLD_POPULATION_PER_PASS) || 30;
const LLM_SPAWNS_PER_PASS = Number(process.env.CONCORD_WORLD_POPULATION_LLM_PER_PASS) || 5;

/**
 * @param {object} ctx - { db, state, tickCount, reason, worldId? }
 */
export async function runWorldPopulationCycle(ctx = {}) {
  const db = ctx?.db;
  if (process.env.CONCORD_PROCGEN_NPCS === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  // When running inside a world shard, ctx.worldId scopes us to one world.
  // Otherwise iterate all worlds (parent-side fallback when sharding off).
  let activeWorlds;
  if (ctx.worldId) {
    activeWorlds = [ctx.worldId];
  } else {
    try {
      activeWorlds = db.prepare(`SELECT id FROM worlds LIMIT 20`).all().map(r => r.id).filter(Boolean);
    } catch {
      try {
        activeWorlds = db.prepare(`
          SELECT DISTINCT world_id FROM world_npcs WHERE COALESCE(is_dead, 0) = 0 LIMIT 10
        `).all().map(r => r.world_id).filter(Boolean);
      } catch { return { ok: true, spawned: 0, reason: "no_world_table" }; }
    }
  }
  if (!activeWorlds || activeWorlds.length === 0) return { ok: true, spawned: 0 };

  const factionIds = Object.keys(FACTION_PROFILES).filter(f => f !== "default");
  let spawned = 0;
  let llmUsed = 0;
  const perWorldStats = {};

  for (const worldId of activeWorlds) {
    if (spawned >= MAX_PER_PASS) break;
    // Phase G — respect per-world loop enabled flag.
    if (!isLoopEnabledForWorld(worldId, "world-population-cycle")) continue;

    const targetPerFaction = getNpcDensityTarget(worldId, 50);
    const worldVoice = getWorldVoice(worldId);
    perWorldStats[worldId] = { spawned: 0, target: targetPerFaction };

    for (const factionId of factionIds) {
      if (spawned >= MAX_PER_PASS) break;

      let alive = 0;
      try {
        const r = db.prepare(`
          SELECT COUNT(*) AS n FROM world_npcs
          WHERE world_id = ? AND faction = ? AND COALESCE(is_dead, 0) = 0
        `).get(worldId, factionId);
        alive = r?.n || 0;
      } catch { continue; }

      const deficit = Math.max(0, targetPerFaction - alive);
      if (deficit === 0) continue;

      const needs = getArchetypeNeeds(db, worldId, factionId);
      const weightedArchetypes = pickArchetypesForSpawn(needs, deficit);

      // Determine seed offset.
      let nextSeed = 0;
      try {
        const r = db.prepare(`
          SELECT COUNT(*) AS n FROM procedural_npcs
          WHERE faction = ? AND world_id = ?
        `).get(factionId, worldId);
        nextSeed = r?.n || 0;
      } catch { /* table optional */ }

      // Spawn batch — cap each faction at min(deficit, 5 per pass) to keep
      // any single faction from monopolising MAX_PER_PASS.
      const factionCap = Math.min(deficit, 5, MAX_PER_PASS - spawned);
      for (let i = 0; i < factionCap; i++) {
        const archetypeHint = weightedArchetypes[i % weightedArchetypes.length] ?? null;
        const seed = `gen_${nextSeed + i}`;
        const npc = generateNpc({ factionId, seed, worldId, archetypeHint });
        if (!npc) continue;
        try {
          const r = persistGeneratedNpc(db, npc);
          if (!r.ok || r.action !== "created") continue;
          spawned++;
          perWorldStats[worldId].spawned++;

          // Phase H side effects per spawned NPC.
          linkBloodline(db, npc, factionId, worldId);
          ensureSkillsSafe(db, npc);
          seedAsymmetrySafe(db, npc);
          const useLlm = llmUsed < LLM_SPAWNS_PER_PASS && process.env.CONCORD_PROCGEN_BACKSTORY_LLM === "true";
          const backstory = useLlm
            ? await composeLlmBackstory(npc, { id: factionId }, { worldId, voiceTone: worldVoice?.tone }, ctx.llm)
            : composeDeterministicBackstory(npc, { id: factionId }, { worldId, voiceTone: worldVoice?.tone });
          if (useLlm) llmUsed++;
          persistBackstorySafe(db, npc.id, backstory);
        } catch (err) {
          logger.warn?.("world-population-cycle", "spawn_failed", {
            worldId, factionId, seed, error: err?.message,
          });
        }
      }
    }
  }

  if (spawned > 0) {
    logger.info?.("world-population-cycle", "spawn_pass_complete", {
      spawned, llmUsed, worlds: Object.keys(perWorldStats).length,
    });
  }
  return { ok: true, spawned, llmUsed, perWorld: perWorldStats };
}

/**
 * Weight archetypes by need: positive deltas get spawn-priority, negative
 * deltas get de-prioritised. Returns an array of archetype names sized to
 * `count`, biased so the most-needed archetype appears most often.
 */
function pickArchetypesForSpawn(needs, count) {
  // Convert deltas to non-negative weights (shift so min becomes 0+1).
  const min = Math.min(...Object.values(needs), 0);
  const weights = {};
  let total = 0;
  for (const a of ARCHETYPE_LIST) {
    const w = Math.max(1, needs[a] - min + 1);
    weights[a] = w;
    total += w;
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    let pick = Math.random() * total;
    let chosen = ARCHETYPE_LIST[0];
    for (const a of ARCHETYPE_LIST) {
      pick -= weights[a];
      if (pick <= 0) { chosen = a; break; }
    }
    out.push(chosen);
  }
  return out;
}

/**
 * Link a procedural NPC into the bloodline of an authored ancestor in the
 * same faction. Writes one row to npc_ancestry with `dilution ∈ [0.25, 1.0]`.
 * If no authored ancestor available, uses the faction id as the bloodline
 * key with dilution 1.0 (a "founding" line).
 */
function linkBloodline(db, npc, factionId, worldId) {
  try {
    // 1. Find a candidate authored ancestor.
    let ancestor = null;
    try {
      const r = db.prepare(`
        SELECT n.id, COALESCE(a.primary_bloodline, n.id) AS bloodline,
               COALESCE(a.dilution, 1.0) AS dilution
        FROM world_npcs n
        LEFT JOIN npc_ancestry a ON a.npc_id = n.id
        WHERE n.world_id = ? AND n.faction = ?
          AND COALESCE(n.is_dead, 0) = 0
          AND n.id NOT LIKE 'gen_%'
          AND n.id NOT LIKE 'usergen_%'
        ORDER BY RANDOM() LIMIT 1
      `).get(worldId, factionId);
      if (r) ancestor = r;
    } catch { /* npc_ancestry table optional */ }

    const primary = ancestor?.bloodline ?? `founding_${factionId}`;
    // Dilute by 0.25–0.5 per generational hop (2–3 hops); clamp at 0.25.
    const ancestorDilution = Number(ancestor?.dilution ?? 1.0);
    const hops = 2 + Math.floor(Math.random() * 2);  // 2 or 3
    const newDilution = Math.max(0.25, ancestorDilution * Math.pow(0.65, hops));

    try {
      db.prepare(`
        INSERT INTO npc_ancestry (npc_id, primary_bloodline, dilution)
        VALUES (?, ?, ?)
        ON CONFLICT(npc_id) DO UPDATE SET
          primary_bloodline = excluded.primary_bloodline,
          dilution = excluded.dilution
      `).run(npc.id, primary, newDilution);
    } catch { /* table missing → skip linkage, NPC still exists */ }

    // 2. Inheritance link row (lightweight — useful for the cross-world feed).
    if (ancestor?.id) {
      try {
        db.prepare(`
          INSERT INTO npc_inheritance_links
            (deceased_npc_id, heir_npc_id, inherited_kind)
          VALUES (?, ?, 'bloodline')
          ON CONFLICT DO NOTHING
        `).run(ancestor.id, npc.id);
      } catch { /* table optional or different schema */ }
    }

    // Decorate the NPC object so the backstory composer sees the link.
    npc.ancestry = { primary_bloodline: primary, dilution: newDilution };
  } catch (err) {
    logger.warn?.("world-population-cycle", "bloodline_link_failed", {
      npcId: npc?.id, error: err?.message,
    });
  }
}

function ensureSkillsSafe(db, npc) {
  try {
    // Lazy import to avoid loading npc-skill-author on cold paths.
    import("../lib/npc-skill-author.js").then(m => {
      try { m.ensureNpcAuthoredSkills?.(db, npc); } catch { /* skill seed best-effort */ }
    }).catch(() => { /* module optional */ });
  } catch { /* best-effort */ }
}

function seedAsymmetrySafe(db, npc) {
  try {
    import("../lib/npc-asymmetry.js").then(m => {
      try { m.seedNPCAsymmetry?.(db, npc); } catch { /* asymmetry seed best-effort */ }
    }).catch(() => { /* module optional */ });
  } catch { /* best-effort */ }
}

function persistBackstorySafe(db, npcId, backstory) {
  if (!backstory) return;
  try {
    // world_npcs.narrative_context is a JSON column.
    const row = db.prepare(`SELECT narrative_context FROM world_npcs WHERE id = ?`).get(npcId);
    const parsed = row?.narrative_context ? safeParse(row.narrative_context) : {};
    parsed.backstory = backstory;
    db.prepare(`UPDATE world_npcs SET narrative_context = ? WHERE id = ?`).run(JSON.stringify(parsed), npcId);
  } catch (err) {
    // narrative_context column may not exist on minimal builds — write to
    // procedural_npcs table instead if present.
    try {
      db.prepare(`UPDATE procedural_npcs SET backstory = ? WHERE npc_id = ?`).run(backstory, npcId);
    } catch { /* nowhere to persist — backstory lost, NPC still alive */ }
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
