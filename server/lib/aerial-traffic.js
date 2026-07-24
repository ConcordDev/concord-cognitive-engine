// server/lib/aerial-traffic.js
//
// C16 (master-spec "ambient aerial traffic — non-empty sky") — pure route
// construction + deterministic position-over-time math for a small number
// of server-tracked ambient air entities per world.
//
// ── What this is NOT ────────────────────────────────────────────────────
// Not full NPCs. No dialogue, no AI, no combat, no inventory, no DB row per
// entity. A `world_npcs` row (the real NPC substrate) would fabricate a
// person where none is authored; these are unowned background traffic —
// the same "genuinely small, honest shape" call CLAUDE.md's Sixth Invariant
// makes for anything decorative: real and server-scheduled, but not padded
// out into a heavier substrate than the feature needs. State lives
// in-memory only (`STATE.aerialTraffic`, initialised lazily by the cycle),
// the same posture `server/lib/brawl.js`'s header documents for its own
// ephemeral Maps ("invites are ephemeral... active brawls clear on
// endBrawl") — nothing here has player stakes, ownership, or economy
// weight, so nothing here needs to survive a restart.
//
// ── Route sourcing — real data only, never invented geometry ───────────────
// Primary source: `landingPadsForWorld(worldId)` (server/lib/
// building-purpose.js) — the 3 real authored touch-down markers in
// `content/world/concordia-hub/city-layout.json#landingPads` (Plaza/
// Riverside/Industrial Skydock). Fallback (worlds with no authored pads):
// district polygon centroids from `listDistricts` (server/lib/districts.js,
// migration 374). A world with fewer than 2 usable waypoints from EITHER
// source gets an honest empty route — `routeForWorld` returns
// `{ waypoints: [], source: 'none' }` and the cycle spawns nothing for it,
// the same "never fabricate geometry for a world nobody has designed"
// posture `districts.js#seedDefaultDistricts`'s own header states.
//
// ── Flavor — grounded in the real Crosswind Couriers faction, not invented ──
// `content/world/concordia-hub/factions.json` already has the Crosswind
// Couriers as an alliance partner of the merchant faction, and
// `content/world/concordia-hub/npcs.json`'s `courier_kel_sandren`
// ("Crosswind Courier of the Concordant Hub") is an authored member NPC.
// The hub's landing pads (`city-layout.json`'s own `_landingPadsComment`)
// are explicitly built for "flight-capable mounts and future aircraft" —
// so ambient sky traffic running scheduled loops between skydocks reads as
// the Crosswind Couriers' own air routes, not an invented faction or a
// generic sci-fi "cargo drone". `AERIAL_TRAFFIC_KIND` is the one kind this
// module ships; a second flavor for a different world would need that
// world's own authored lore to ground it in, same rule.
//
// ── Altitude — an authored design dial, not fabricated physics ─────────────
// Unlike `land_air_transition_controller.gd`'s ground-crossing trigger
// (which deliberately avoids a fabricated fixed-altitude constant because a
// real signal — `is_on_floor()` — already exists), there is no real
// server-side "flight altitude" signal to read for background traffic that
// never touches player physics. `CRUISE_ALTITUDE_M` is therefore an
// explicit, documented, env-overridable design dial in the same spirit as
// the "Phase D first-draft constants (untuned)" table in CLAUDE.md — a real
// authored number, never claimed to be measured or derived. It is offset
// from each waypoint's own real `elevation_m` (pads) / `elevationHint`
// (districts), so the absolute height still tracks real per-location data.
//
// ── Speed — bounded under the real flight-mount floor ───────────────────────
// `world-lens-godot/avatar/aerial_mount_controller.gd`'s header cites the
// real seeded flight-capable species speeds (`server/seeds/mount_species.
// json`): hippogriff 11.0 m/s, gryphon 12.0 m/s, juvenile_wyvern 10.5 m/s —
// the slowest real flight mount. `DEFAULT_SPEED_MPS` is set below that
// floor so ambient traffic never appears to outpace a player's own mount.

import { landingPadsForWorld } from "./building-purpose.js";
import { listDistricts } from "./districts.js";

// Re-exported so callers (the heartbeat cycle, tests) can pull the real
// data-source functions from this one module without a second import line —
// this module owns "how do I get a route for a world," including which raw
// data sources feed it.
export { landingPadsForWorld, listDistricts };

/** The one grounded flavor this module ships — see header. */
export const AERIAL_TRAFFIC_KIND = "crosswind-courier";

/** Design dial — see header "Altitude" section. */
export const CRUISE_ALTITUDE_M = Number(process.env.CONCORD_AERIAL_CRUISE_ALTITUDE_M) || 60;

/** Design dial — see header "Speed" section. Below juvenile_wyvern's 10.5 m/s floor. */
export const DEFAULT_SPEED_MPS = Number(process.env.CONCORD_AERIAL_SPEED_MPS) || 9;

/** "A small number" per the task brief — never floods the sky. */
export const MAX_ACTIVE_PER_WORLD = Number(process.env.CONCORD_AERIAL_MAX_PER_WORLD) || 3;

/** Retire + let a fresh one respawn after this long, so ids don't grow forever
 *  and the route occasionally re-rolls if the underlying data changes. */
export const MAX_LIFETIME_MS = Number(process.env.CONCORD_AERIAL_MAX_LIFETIME_MS) || 45 * 60 * 1000;

const MIN_WAYPOINTS = 2;

/**
 * Centroid of a polygon given as [{x,z}, ...] — plain vertex average (exact
 * for districts.js's rect() quads; a reasonable centroid approximation for
 * any convex polygon in general). Pure. Returns null for <3 vertices.
 * @param {Array<{x:number,z:number}>} boundary
 * @returns {{x:number,z:number}|null}
 */
export function centroidOfPolygon(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3) return null;
  let sx = 0, sz = 0, n = 0;
  for (const v of boundary) {
    if (!v || typeof v.x !== "number" || typeof v.z !== "number") continue;
    sx += v.x; sz += v.z; n++;
  }
  if (n === 0) return null;
  return { x: sx / n, z: sz / n };
}

/**
 * Build a closed-loop waypoint route from real landing pads. Pure.
 * @param {Array<object>} landingPads - shape from landingPadsForWorld()
 * @returns {Array<{x:number,y:number,z:number}>}
 */
export function buildRouteFromLandingPads(landingPads) {
  if (!Array.isArray(landingPads)) return [];
  const out = [];
  for (const pad of landingPads) {
    const pos = pad?.position;
    if (!pos || typeof pos.x !== "number" || typeof pos.z !== "number") continue;
    const elevation = Number(pad.elevation_m) || 0;
    out.push({ x: pos.x, y: elevation + CRUISE_ALTITUDE_M, z: pos.z });
  }
  return out.length >= MIN_WAYPOINTS ? out : [];
}

/**
 * Build a closed-loop waypoint route from real district centroids
 * (fallback for worlds with no authored landing pads). Pure.
 * @param {Array<object>} districts - shape from listDistricts()
 * @returns {Array<{x:number,y:number,z:number}>}
 */
export function buildRouteFromDistrictCentroids(districts) {
  if (!Array.isArray(districts)) return [];
  const out = [];
  for (const d of districts) {
    const c = centroidOfPolygon(d?.boundary);
    if (!c) continue;
    const elevation = Number(d.elevationHint) || 0;
    out.push({ x: c.x, y: elevation + CRUISE_ALTITUDE_M, z: c.z });
  }
  return out.length >= MIN_WAYPOINTS ? out : [];
}

/**
 * Choose the real route for a world: landing pads first, district centroids
 * as fallback, honest empty if neither has enough waypoints. Pure (callers
 * pass in already-fetched data so this stays DB/IO-free and testable).
 * @param {{landingPads?: Array, districts?: Array}} data
 * @returns {{waypoints: Array<{x:number,y:number,z:number}>, source: 'landing_pads'|'district_centroids'|'none'}}
 */
export function routeForWorld({ landingPads, districts } = {}) {
  const fromPads = buildRouteFromLandingPads(landingPads);
  if (fromPads.length >= MIN_WAYPOINTS) return { waypoints: fromPads, source: "landing_pads" };
  const fromDistricts = buildRouteFromDistrictCentroids(districts);
  if (fromDistricts.length >= MIN_WAYPOINTS) return { waypoints: fromDistricts, source: "district_centroids" };
  return { waypoints: [], source: "none" };
}

/**
 * Total length (meters) of the CLOSED loop through `waypoints` (wraps last
 * back to first). Pure. Returns 0 for <2 waypoints.
 * @param {Array<{x:number,y:number,z:number}>} waypoints
 * @returns {number}
 */
export function routeLength(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < MIN_WAYPOINTS) return 0;
  let total = 0;
  for (let i = 0; i < waypoints.length; i++) {
    const a = waypoints[i];
    const b = waypoints[(i + 1) % waypoints.length];
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return total;
}

/**
 * Deterministic position + heading along a closed-loop route at a given
 * wall-clock time. Pure function of (route, speed, startedAt, now) — no
 * randomness, no state — so both the server broadcast and (in principle) a
 * client that already knows the schedule could compute the identical
 * answer independently. Loops forever (mod route length). Heading uses the
 * same `Math.atan2(dx, dz)` convention `city-presence.js:1273` already uses
 * for NPC `direction`, so a consumer doesn't need a second convention.
 *
 * @param {{waypoints: Array<{x:number,y:number,z:number}>, speedMps: number, startedAtMs: number, nowMs: number}} args
 * @returns {{x:number,y:number,z:number,heading:number}|null}
 */
export function positionAtTime({ waypoints, speedMps, startedAtMs, nowMs }) {
  if (!Array.isArray(waypoints) || waypoints.length < MIN_WAYPOINTS) return null;
  const totalLen = routeLength(waypoints);
  if (totalLen <= 0) return null;
  const speed = Number(speedMps) > 0 ? Number(speedMps) : DEFAULT_SPEED_MPS;

  const elapsedS = Math.max(0, (Number(nowMs) - Number(startedAtMs)) / 1000);
  let dist = (elapsedS * speed) % totalLen;
  if (dist < 0) dist += totalLen;

  for (let i = 0; i < waypoints.length; i++) {
    const a = waypoints[i];
    const b = waypoints[(i + 1) % waypoints.length];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (segLen <= 0) continue;
    if (dist <= segLen) {
      const t = dist / segLen;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const z = a.z + (b.z - a.z) * t;
      const heading = Math.atan2(b.x - a.x, b.z - a.z);
      return { x, y, z, heading };
    }
    dist -= segLen;
  }
  // Floating-point edge case (dist landed exactly on the loop boundary) —
  // hold the first waypoint rather than returning null (never fabricate a
  // discontinuity for a rounding error).
  const first = waypoints[0];
  return { x: first.x, y: first.y, z: first.z, heading: 0 };
}

/**
 * Deterministic-ish id — not cryptographically unique, just collision-safe
 * enough for an in-memory ambient registry capped at MAX_ACTIVE_PER_WORLD.
 * @returns {string}
 */
export function makeEntityId(worldId, index, nowMs) {
  return `aerial:${worldId}:${index}:${nowMs}`;
}

/**
 * Construct a new ambient entity record. Pure (caller supplies `nowMs`).
 * @returns {object}
 */
export function spawnEntity({ worldId, waypoints, kind = AERIAL_TRAFFIC_KIND, speedMps = DEFAULT_SPEED_MPS, nowMs, index = 0 }) {
  return {
    id: makeEntityId(worldId, index, nowMs),
    worldId,
    kind,
    route: waypoints,
    speedMps,
    startedAtMs: nowMs,
    routeLengthM: routeLength(waypoints),
  };
}

/** Pure gate: is there room to spawn another entity in this world? */
export function shouldSpawnMore({ activeCount, maxActive = MAX_ACTIVE_PER_WORLD }) {
  return Number(activeCount) < Number(maxActive);
}

/** Pure gate: has this entity outlived its authored lifetime? */
export function shouldDespawn({ entity, nowMs, maxLifetimeMs = MAX_LIFETIME_MS }) {
  if (!entity || typeof entity.startedAtMs !== "number") return true;
  return (Number(nowMs) - entity.startedAtMs) >= Number(maxLifetimeMs);
}

/**
 * The broadcast-ready snapshot for one entity at `nowMs` — the payload
 * shape the `world:aerial-traffic` event (docs/GODOT_PROTOCOL.md) carries
 * per entity. Returns null if the entity's route is degenerate (never
 * fabricates a position).
 */
export function computeSnapshot(entity, nowMs) {
  const pos = positionAtTime({ waypoints: entity?.route, speedMps: entity?.speedMps, startedAtMs: entity?.startedAtMs, nowMs });
  if (!pos) return null;
  return {
    id: entity.id,
    kind: entity.kind,
    x: pos.x,
    y: pos.y,
    z: pos.z,
    heading: pos.heading,
  };
}

export default {
  AERIAL_TRAFFIC_KIND,
  CRUISE_ALTITUDE_M,
  DEFAULT_SPEED_MPS,
  MAX_ACTIVE_PER_WORLD,
  MAX_LIFETIME_MS,
  centroidOfPolygon,
  buildRouteFromLandingPads,
  buildRouteFromDistrictCentroids,
  routeForWorld,
  routeLength,
  positionAtTime,
  makeEntityId,
  spawnEntity,
  shouldSpawnMore,
  shouldDespawn,
  computeSnapshot,
  landingPadsForWorld,
  listDistricts,
};
