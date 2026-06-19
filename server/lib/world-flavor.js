// @sync-fs-ok: world-flavor content load, cached per world. Sync fs in this file is intentional and not on the user request path (audited 2026-06).
// server/lib/world-flavor.js
//
// Phase G — per-world flavor. Each sub-world declares which simulation
// loops are active, its signal climate, faction starting state, NPC
// density target, and skill ceilings via `content/world/<world>/loops.json`.
//
// The seeder (lib/content-seeder.js#discoverSubWorlds) already auto-picks
// up any file in the world directory. This module loads + validates the
// flavor data and exposes it to the heartbeat dispatcher, environment
// sensor, combat anti-cheat, and population cycle.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORLD_CONTENT_ROOT = path.resolve(__dirname, "..", "..", "content", "world");

/** @typedef {{
 *    loops?: Record<string, { enabled?: boolean, frequency?: number }>,
 *    climate?: { baseTemp?: number, humidity?: number, airQuality?: number, illumination?: number, weather?: string, structuralStress?: number, ambientDb?: number },
 *    factionStartState?: Record<string, { stance?: string, momentum?: number, target?: string|null }>,
 *    skillCeilings?: Record<string, number>,
 *    npcDensity?: { targetPerFaction?: number, max?: number, archetypeWeights?: Record<string, number> },
 *    marketplaceModulators?: { feeMultiplier?: number, scarcityBias?: number },
 *    worldVoice?: { tone?: string, vocabulary?: string[], avoid?: string[], examples?: string[] }
 * }} WorldFlavor */

/** @type {Map<string, WorldFlavor>} */
const _flavorCache = new Map();
let _initialized = false;

const VALID_STANCES = new Set(["consolidate", "expand", "war", "alliance", "rebuild", "isolation"]);

/**
 * Validate the parsed flavor JSON. Returns `{ ok, errors }`. Soft errors
 * (unknown fields, missing optional fields) are tolerated. Hard errors
 * (negative frequency, ceiling > 10000, density > 10000) reject.
 */
export function validateFlavor(json) {
  const errors = [];
  if (json == null) return { ok: true, errors };
  if (typeof json !== "object" || Array.isArray(json)) {
    errors.push("flavor must be an object");
    return { ok: false, errors };
  }
  if (json.loops) {
    if (typeof json.loops !== "object" || Array.isArray(json.loops)) {
      errors.push("loops must be an object");
    } else {
      for (const [id, opts] of Object.entries(json.loops)) {
        if (opts == null || typeof opts !== "object") {
          errors.push(`loops.${id} must be an object`);
          continue;
        }
        if (opts.frequency != null && (!Number.isInteger(opts.frequency) || opts.frequency < 1)) {
          errors.push(`loops.${id}.frequency must be a positive integer`);
        }
      }
    }
  }
  if (json.climate) {
    const c = json.climate;
    for (const num of ["baseTemp", "humidity", "airQuality", "illumination", "structuralStress", "ambientDb"]) {
      if (c[num] != null && typeof c[num] !== "number") {
        errors.push(`climate.${num} must be numeric`);
      }
    }
  }
  if (json.factionStartState) {
    for (const [factionId, fs] of Object.entries(json.factionStartState)) {
      if (fs?.stance && !VALID_STANCES.has(fs.stance)) {
        errors.push(`factionStartState.${factionId}.stance must be one of ${[...VALID_STANCES].join("|")}`);
      }
      if (fs?.momentum != null && (typeof fs.momentum !== "number" || fs.momentum < -1 || fs.momentum > 1)) {
        errors.push(`factionStartState.${factionId}.momentum must be in [-1, 1]`);
      }
    }
  }
  if (json.skillCeilings) {
    for (const [element, ceiling] of Object.entries(json.skillCeilings)) {
      if (typeof ceiling !== "number" || ceiling < 0 || ceiling > 10_000) {
        errors.push(`skillCeilings.${element} must be 0..10000`);
      }
    }
  }
  if (json.npcDensity) {
    const d = json.npcDensity;
    if (d.targetPerFaction != null && (typeof d.targetPerFaction !== "number" || d.targetPerFaction < 0 || d.targetPerFaction > 10_000)) {
      errors.push("npcDensity.targetPerFaction must be 0..10000");
    }
    if (d.max != null && (typeof d.max !== "number" || d.max < 0 || d.max > 100_000)) {
      errors.push("npcDensity.max must be 0..100000");
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Read all `content/world/<world>/loops.json` files into the cache.
 * Idempotent — second call is a no-op. Soft-fails per world: a bad
 * flavor file logs a warning but doesn't block boot.
 */
export function initWorldFlavors() {
  if (_initialized) return _flavorCache;
  _initialized = true;
  let dirents;
  try {
    dirents = fs.readdirSync(WORLD_CONTENT_ROOT, { withFileTypes: true });
  } catch (err) {
    logger.warn("world-flavor", "content_world_unreadable", { error: err?.message });
    return _flavorCache;
  }
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    if (d.name.startsWith("_")) continue;
    const worldId = d.name;
    const flavorPath = path.join(WORLD_CONTENT_ROOT, worldId, "loops.json");
    if (!fs.existsSync(flavorPath)) continue;
    try {
      const raw = fs.readFileSync(flavorPath, "utf8");
      const parsed = JSON.parse(raw);
      const { ok, errors } = validateFlavor(parsed);
      if (!ok) {
        logger.warn("world-flavor", "flavor_validation_failed", { worldId, errors });
        continue;
      }
      _flavorCache.set(worldId, parsed);
    } catch (err) {
      logger.warn("world-flavor", "flavor_load_failed", { worldId, error: err?.message });
    }
  }
  logger.info("world-flavor", "flavor_loaded", { count: _flavorCache.size, worlds: Array.from(_flavorCache.keys()) });
  return _flavorCache;
}

/** @returns {WorldFlavor} the parsed + validated flavor for that world, or `{}` if absent. */
export function getWorldFlavor(worldId) {
  if (!_initialized) initWorldFlavors();
  return _flavorCache.get(worldId) ?? {};
}

/**
 * Test if a heartbeat module is enabled for a given world.
 * Worlds without a loops.json have all modules enabled (legacy behaviour).
 * Worlds with a loops.json declare per-module `enabled: bool`; missing
 * entries default to enabled=true (so a partial loops.json is additive,
 * never restrictive by accident).
 */
export function isLoopEnabledForWorld(worldId, moduleId) {
  const flavor = getWorldFlavor(worldId);
  const loop = flavor.loops?.[moduleId];
  if (!loop) return true;
  return loop.enabled !== false;
}

/**
 * Per-module frequency override for a world. Returns the override value
 * or null if no override (caller uses the registry default).
 */
export function getLoopFrequencyForWorld(worldId, moduleId) {
  const flavor = getWorldFlavor(worldId);
  const loop = flavor.loops?.[moduleId];
  if (!loop || !Number.isInteger(loop.frequency) || loop.frequency < 1) return null;
  return loop.frequency;
}

/** Climate override fed into environment-sensor's per-world baseline. */
export function getClimateOverride(worldId) {
  return getWorldFlavor(worldId).climate ?? null;
}

/** Skill ceiling cap used by combat-anti-cheat (max-damage modulation). */
export function getSkillCeiling(worldId, element) {
  const ceilings = getWorldFlavor(worldId).skillCeilings ?? {};
  return typeof ceilings[element] === "number" ? ceilings[element] : null;
}

/** NPC density target the world-population-cycle uses. */
export function getNpcDensityTarget(worldId, fallback = 50) {
  const d = getWorldFlavor(worldId).npcDensity ?? {};
  return Number.isFinite(d.targetPerFaction) ? d.targetPerFaction : fallback;
}

/** Faction-start-state seed picked up by faction-strategy bootstrap. */
export function getFactionStartState(worldId, factionId) {
  const fss = getWorldFlavor(worldId).factionStartState ?? {};
  return fss[factionId] ?? fss.default ?? null;
}

/** Marketplace modulators (fee + scarcity) applied per world. */
export function getMarketplaceModulators(worldId) {
  return getWorldFlavor(worldId).marketplaceModulators ?? {};
}

/** Per-world LLM voice (Phase O) — read by prompt-registry composer. */
export function getWorldVoice(worldId) {
  return getWorldFlavor(worldId).worldVoice ?? null;
}

/** Diagnostic — used by /api/worlds/:worldId/flavor + ops-telemetry. */
export function listAllFlavors() {
  if (!_initialized) initWorldFlavors();
  return Array.from(_flavorCache.entries()).map(([worldId, flavor]) => ({
    worldId,
    enabledLoopCount: Object.values(flavor.loops ?? {}).filter(l => l.enabled !== false).length,
    declaredLoops: Object.keys(flavor.loops ?? {}),
    npcDensityTarget: flavor.npcDensity?.targetPerFaction ?? null,
    climate: flavor.climate ?? null,
    voiceTone: flavor.worldVoice?.tone ?? null,
  }));
}

/** Test-only reset between specs. */
export function _resetWorldFlavors() {
  _flavorCache.clear();
  _initialized = false;
}
