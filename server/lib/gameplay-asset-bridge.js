/**
 * Gameplay → Evo-Asset Bridge
 *
 * The user's design: assets in Concordia are NOT pre-produced; they grow
 * organically from NPC, emergent, and user gameplay. A blacksmith forging
 * a unique sword produces a candidate evo-asset; an NPC defeating a rare
 * creature drops loot that becomes a new evo-asset; a creature lineage
 * stabilizing into a new species crystallizes its blueprint as an asset.
 *
 * This module is the central bridge. It listens for gameplay events
 * (combat hits, crafting completions, creature spawns, hybrid births) and
 * registers / mutates assets in the evo_assets registry. Subsequent
 * interactions raise the asset's evolution score; high-scoring assets get
 * refined (subdivision, wear, normal-map bake) by the scheduler.
 *
 * Events handled:
 *   onCreatureSpawned(blueprint)        — register creature as an asset
 *   onHybridBirth(hybrid, parents)      — register a NEW species candidate
 *   onPlayerCraft(item, recipient)      — register a craft variant
 *   onLootDropped(loot, killer, victim) — register a unique drop
 *   onCombatHit(damage, attacker, victim, weapon) — record interaction
 *   onSkillAuthored(skill, origin)      — register skill as an asset
 *
 * All handlers are best-effort; failures are logged and dropped so a
 * registry hiccup never blocks the gameplay event itself.
 */

import logger from "../logger.js";
import { registerAsset, recordInteraction, recomputeEvolutionScore } from "./evo-asset/registry.js";

const ASSET_KIND = Object.freeze({
  CREATURE: "creature",
  ITEM:     "item",
  SKILL:    "skill",
  DROP:     "drop",
  CRAFT:    "craft",
  SPECIES:  "species",
});

function _safe(fn) {
  try { return fn(); } catch (err) { logger?.warn?.({ err: err?.message }, "gameplay_asset_bridge_failed"); return null; }
}

/* ── Creature events ──────────────────────────────────────────────── */

/**
 * Register a freshly spawned creature blueprint as an asset. Each unique
 * (worldId, baselineId, topology) tuple becomes a single asset that
 * accumulates interactions across spawns; the per-spawn variations live
 * inside its blueprint history rather than fragmenting the registry.
 */
export function onCreatureSpawned(db, blueprint) {
  if (!db || !blueprint) return null;
  return _safe(() => {
    const sourceId = blueprint.provenance?.baselineId
      ? `${blueprint.worldId}:${blueprint.provenance.baselineId}`
      : `${blueprint.worldId}:${blueprint.topology}:${blueprint.provenance?.seedHash ?? "unknown"}`;

    const r = registerAsset(db, {
      kind:     ASSET_KIND.CREATURE,
      source:   "concordia",
      sourceId,
      label:    blueprint.provenance?.description ?? "creature",
      payload:  JSON.stringify(blueprint),
      qualityLevel: 0,
    });
    if (r?.assetId) recordInteraction(db, r.assetId, blueprint.id, "spawn", 0.5);
    return r;
  });
}

/**
 * A new species emerges when a hybrid stabilizes (high stability + multiple
 * generations) — it becomes a NEW baseline asset that other crossbreedings
 * can reference. The first generation of an unstable hybrid is just a
 * normal CREATURE asset; only stabilized lineages become SPECIES.
 */
export function onHybridBirth(db, { hybrid, stability, generation, crossWorld, parents }) {
  if (!db || !hybrid) return null;
  return _safe(() => {
    const isSpecies = stability >= 0.7 && generation >= 3;
    const kind   = isSpecies ? ASSET_KIND.SPECIES : ASSET_KIND.CREATURE;
    const sourceId = isSpecies
      ? `species:${hybrid.id}`
      : `hybrid:${parents?.join("+") ?? "unknown"}:${hybrid.id}`;

    const r = registerAsset(db, {
      kind,
      source:   "concordia",
      sourceId,
      label:    hybrid.provenance?.description ?? "hybrid",
      payload:  JSON.stringify({ blueprint: hybrid, stability, generation, crossWorld, parents }),
      // Cross-world hybrids start at higher quality because they're rarer and more distinct.
      qualityLevel: crossWorld ? 2 : 1,
    });
    if (r?.assetId) {
      recordInteraction(db, r.assetId, hybrid.id, "born", crossWorld ? 1.5 : 1.0);
      // Bonus: stable lineage = recompute score immediately so it surfaces in resolveCurrentBest.
      if (isSpecies) recomputeEvolutionScore(db, r.assetId);
    }
    return r;
  });
}

/* ── Player & item events ─────────────────────────────────────────── */

export function onPlayerCraft(db, { userId, recipeId, itemId, label, payload, quality = 0 }) {
  if (!db || !itemId) return null;
  return _safe(() => {
    const r = registerAsset(db, {
      kind:    ASSET_KIND.CRAFT,
      source:  "concordia",
      sourceId: `craft:${userId ?? "unknown"}:${recipeId ?? "freeform"}:${itemId}`,
      label:   label ?? "crafted item",
      payload: typeof payload === "string" ? payload : JSON.stringify(payload ?? {}),
      qualityLevel: quality,
    });
    if (r?.assetId) recordInteraction(db, r.assetId, userId, "craft", 1.2);
    return r;
  });
}

export function onLootDropped(db, { lootId, killerId, victimId, label, payload }) {
  if (!db || !lootId) return null;
  return _safe(() => {
    const r = registerAsset(db, {
      kind:     ASSET_KIND.DROP,
      source:   "concordia",
      sourceId: `loot:${victimId ?? "unknown"}:${lootId}`,
      label:    label ?? "loot drop",
      payload:  typeof payload === "string" ? payload : JSON.stringify(payload ?? {}),
      qualityLevel: 0,
    });
    if (r?.assetId) recordInteraction(db, r.assetId, killerId, "drop", 1.0);
    return r;
  });
}

export function onCombatHit(db, { attackerId, victimId, weapon, damage, isCrit }) {
  if (!db || !weapon || !weapon.id) return null;
  return _safe(() => {
    // Each weapon used in combat earns interaction weight scaling with
    // damage + crit. Frequently-used weapons evolve into refined versions.
    const weight = (damage / 50) * (isCrit ? 1.5 : 1.0);
    return recordInteraction(db, weapon.id, attackerId, "combat_hit", weight);
  });
}

/* ── Skill events ─────────────────────────────────────────────────── */

export function onSkillAuthored(db, { skill, origin }) {
  if (!db || !skill?.id) return null;
  return _safe(() => {
    const r = registerAsset(db, {
      kind:     ASSET_KIND.SKILL,
      source:   "concordia",
      sourceId: `skill:${skill.id}`,
      label:    skill.name ?? "emergent skill",
      payload:  JSON.stringify(skill),
      qualityLevel: skill.provenance?.parentId ? 1 : 0, // derivative skills start a bit higher
    });
    if (r?.assetId) recordInteraction(db, r.assetId, origin ?? skill.provenance?.origin ?? "emergent", "authored", 1.0);
    return r;
  });
}

/**
 * Skill use during play: bumps interaction weight on the skill asset, and
 * also bumps the actor's "mastery" pseudo-asset which drives skill
 * derivatives over time.
 */
export function onSkillUsed(db, { skillId, actorId, isHit = true }) {
  if (!db || !skillId) return null;
  return _safe(() => {
    return recordInteraction(db, `skill:${skillId}`, actorId, isHit ? "use_hit" : "use_miss", isHit ? 1.0 : 0.3);
  });
}
