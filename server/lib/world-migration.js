// server/lib/world-migration.js
//
// WS3 — the outward-migration engine (hybrid re-anchor + drift).
//
// The world is not static: creatures crossbreed, NPCs/hostiles gain XP and
// evolve skills on heartbeats, factions run strategy cycles. If strong entities
// stay put, the low-level ring around the hub silts up with veterans and new
// players have nowhere to grind. The fix is an outward-migration pressure: as an
// entity grows in level, it drifts toward the frontier, leaving the hub to
// refill with fresh weak spawns (WS2). That same drift produces the food chain
// and faction/kingdom hot-spots organically.
//
// The home band is derived from level on the fly (homeBandFor), so there's no
// per-entity bookkeeping and no schema change: when an entity levels up, its
// desired radius moves outward and the drift/step carries it there. An entity
// is only pushed until it reaches the INNER edge of its home band — beyond that
// it roams freely. This keeps the gradient self-maintaining without herding
// everything onto a thin ring.
//
// Pure (no DB, no I/O). Callers: creature drift rides creature-flock-cycle;
// NPC re-anchor rides the world-migration-cycle heartbeat. Both share the math
// here. Conservation is the caller's contract — these helpers only move points.

import { homeBandFor, distanceFromHub, outwardUnit } from "./world-gradient.js";

// How close (m) to the home-band inner edge counts as "arrived" — avoids jitter.
const ARRIVE_TOLERANCE_M = 8;

/**
 * The inner radius of the band that should host an entity of this level. An
 * entity inside this radius is over-leveled for where it sits and should
 * migrate outward; at or beyond it, no migration pressure. Pure.
 */
export function homeInnerRadius(config, level) {
  const cfg = config;
  const band = homeBandFor(cfg, level);
  const span = Math.max(1, cfg.worldRadiusM - cfg.hubRadiusM);
  return cfg.hubRadiusM + (band / cfg.bandCount) * span;
}

/** Radius deficit: how far short of its home-band inner edge an entity sits (>=0). Pure. */
export function radiusDeficit(config, anchor, x, z, level) {
  return Math.max(0, homeInnerRadius(config, level) - distanceFromHub(anchor, x, z));
}

/**
 * Outward drift FORCE (velocity-space vector) for a continuous mover (boids).
 * Zero when the entity is already in/beyond its home band; otherwise points
 * away from the hub, scaled by how far inside it is (capped). The caller adds
 * this to its velocity before its own speed clamp. Pure.
 */
export function outwardDriftForce(config, anchor, x, z, level, { gain = 0.1, maxForce = 2.0 } = {}) {
  const deficit = radiusDeficit(config, anchor, x, z, level);
  if (deficit <= ARRIVE_TOLERANCE_M) return { fx: 0, fz: 0 };
  const u = outwardUnit(anchor, x, z);
  const mag = Math.min(deficit * gain, maxForce);
  return { fx: u.x * mag, fz: u.z * mag };
}

/**
 * One discrete migration STEP for a periodic mover (NPC re-anchor). Returns a
 * new {x, z} nudged outward toward the home-band inner edge by up to maxStep,
 * or null when already arrived (no write needed). Pure.
 */
export function migrationStep(config, anchor, x, z, level, maxStep = 40) {
  const deficit = radiusDeficit(config, anchor, x, z, level);
  if (deficit <= ARRIVE_TOLERANCE_M) return null;
  const u = outwardUnit(anchor, x, z);
  const step = Math.min(deficit, Math.max(1, maxStep));
  return { x: x + u.x * step, z: z + u.z * step };
}

export const MIGRATION_CONSTANTS = Object.freeze({ ARRIVE_TOLERANCE_M });
