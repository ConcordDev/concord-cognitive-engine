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

// Gameplay-derived assets are virtual blueprints, not files. We synthesize
// a deterministic "gameplay://kind/sourceId" path so the registry's
// local_path-or-(source,source_id) dedup still works after migration 100
// relaxed local_path to nullable.
function _gameplayPath(kind, sourceId) {
  return `gameplay://${kind}/${sourceId}`;
}

// recordInteraction expects an actor object {kind, id} per registry.js:73.
// Bridge callers pass plain ids; wrap them as 'system' actors so the
// interaction log gets a valid row.
function _systemActor(id) {
  return { kind: "system", id: id ?? null };
}

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
      localPath: _gameplayPath(ASSET_KIND.CREATURE, sourceId),
      qualityLevel: 0,
    });
    if (r?.id) recordInteraction(db, r.id, _systemActor(blueprint.id), "spawn", 0.5);
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
      localPath: _gameplayPath(kind, sourceId),
      // Cross-world hybrids start at higher quality because they're rarer and more distinct.
      qualityLevel: crossWorld ? 2 : 1,
    });
    if (r?.id) {
      recordInteraction(db, r.id, _systemActor(hybrid.id), "born", crossWorld ? 1.5 : 1.0);
      // Bonus: stable lineage = recompute score immediately so it surfaces in resolveCurrentBest.
      if (isSpecies) recomputeEvolutionScore(db, r.id);
    }
    return r;
  });
}

/* ── Player & item events ─────────────────────────────────────────── */

export function onPlayerCraft(db, { userId, recipeId, itemId, label, payload, quality = 0 }) {
  if (!db || !itemId) return null;
  return _safe(() => {
    const sourceId = `craft:${userId ?? "unknown"}:${recipeId ?? "freeform"}:${itemId}`;
    const r = registerAsset(db, {
      kind:    ASSET_KIND.CRAFT,
      source:  "concordia",
      sourceId,
      localPath: _gameplayPath(ASSET_KIND.CRAFT, sourceId),
      qualityLevel: quality,
    });
    if (r?.id) recordInteraction(db, r.id, { kind: "user", id: userId ?? null }, "craft", 1.2);
    return r;
  });
}

export function onLootDropped(db, { lootId, killerId, victimId, label, payload }) {
  if (!db || !lootId) return null;
  return _safe(() => {
    const sourceId = `loot:${victimId ?? "unknown"}:${lootId}`;
    const r = registerAsset(db, {
      kind:     ASSET_KIND.DROP,
      source:   "concordia",
      sourceId,
      localPath: _gameplayPath(ASSET_KIND.DROP, sourceId),
      qualityLevel: 0,
    });
    if (r?.id) recordInteraction(db, r.id, _systemActor(killerId), "drop", 1.0);
    return r;
  });
}

export function onCombatHit(db, { attackerId, victimId, weapon, damage, isCrit }) {
  if (!db || !weapon || !weapon.id) return null;
  return _safe(() => {
    // Each weapon used in combat earns interaction weight scaling with
    // damage + crit. Frequently-used weapons evolve into refined versions.
    const weight = (damage / 50) * (isCrit ? 1.5 : 1.0);
    return recordInteraction(db, weapon.id, { kind: "user", id: attackerId ?? null }, "combat_hit", weight);
  });
}

/* ── Skill events ─────────────────────────────────────────────────── */

export function onSkillAuthored(db, { skill, origin }) {
  if (!db || !skill?.id) return null;
  return _safe(() => {
    const sourceId = `skill:${skill.id}`;
    const r = registerAsset(db, {
      kind:     ASSET_KIND.SKILL,
      source:   "concordia",
      sourceId,
      localPath: _gameplayPath(ASSET_KIND.SKILL, sourceId),
      qualityLevel: skill.provenance?.parentId ? 1 : 0, // derivative skills start a bit higher
    });
    if (r?.id) recordInteraction(db, r.id, _systemActor(origin ?? skill.provenance?.origin ?? "emergent"), "authored", 1.0);
    return r;
  });
}

/**
 * Skill use during play: bumps interaction weight on the skill asset, and
 * also bumps the actor's "mastery" pseudo-asset which drives skill
 * derivatives over time.
 *
 * Resolves the registered asset id by (source='concordia', source_id='skill:<skillId>')
 * before recording — onSkillAuthored uses that source_id convention and
 * registerAsset returns a UUID, so the per-skill UUID has to be looked up.
 * If the skill was never authored, auto-register it so the use still counts.
 */
export function onSkillUsed(db, { skillId, actorId, isHit = true }) {
  if (!db || !skillId) return null;
  return _safe(() => {
    const sourceId = `skill:${skillId}`;
    let row;
    try {
      row = db.prepare(
        `SELECT id FROM evo_assets WHERE source = 'concordia' AND source_id = ?`
      ).get(sourceId);
    } catch { /* table may not exist yet — let auto-register surface it */ }
    let assetId = row?.id;
    if (!assetId) {
      const r = registerAsset(db, {
        kind:     ASSET_KIND.SKILL,
        source:   "concordia",
        sourceId,
        localPath: _gameplayPath(ASSET_KIND.SKILL, sourceId),
        qualityLevel: 0,
      });
      assetId = r?.id;
    }
    if (!assetId) return null;
    return recordInteraction(db, assetId, { kind: "user", id: actorId ?? null }, isHit ? "use_hit" : "use_miss", isHit ? 1.0 : 0.3);
  });
}
