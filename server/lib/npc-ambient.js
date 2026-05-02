/**
 * NPC Ambient Activity — patrol routes, scheduled appearances, vendor
 * presence at stalls, the small-life that makes a city feel inhabited.
 *
 * Audit feedback: "NPCs are statistical abstractions, not visible agents."
 * The simulator + schedules already drive *what* an NPC does at a given
 * day-segment; this module drives *where* and *how* they do it: a guard
 * walks a fixed patrol loop, a baker stands behind their bread stall
 * during midday, a thief leans in alleyways at dusk.
 *
 * Each NPC gets one of:
 *   - patrol_loop:    fixed sequence of waypoints, walked in order
 *   - work_post:      single fixed location they remain at + face nearby
 *   - wander:         random short walks within a radius
 *   - sleep_anchor:   fixed bed/cot location, lie down at night
 *
 * Behaviors emit ambient hints (e.g., a patrolling guard occasionally
 * speaks a greeting or warning) which the existing dialogue system can
 * pick up. This module is data + a tick — the actual movement is applied
 * by npc-simulator.
 */

import { getCurrentBehavior } from "./npc-schedules.js";

const _routes = new Map(); // npcId -> { kind, waypoints?, post?, wanderCenter?, radius?, anchor?, idx }

/**
 * Register an ambient route for an NPC. kind is one of:
 *   patrol_loop:  { waypoints: [{x,y,z}, ...] }
 *   work_post:    { post: {x,y,z}, facing?: number }
 *   wander:       { wanderCenter: {x,y,z}, radius: number }
 *   sleep_anchor: { anchor: {x,y,z} }
 */
export function setRoute(npcId, route) {
  _routes.set(npcId, { ...route, idx: 0 });
}

/** Default route generator from archetype + spawn position. */
export function defaultRouteFor(archetype, spawn) {
  const x = spawn?.x ?? 0, y = spawn?.y ?? 0, z = spawn?.z ?? 0;
  switch (archetype) {
    case "guard":
    case "enforcer":
      return {
        kind: "patrol_loop",
        waypoints: [
          { x: x + 8,  y, z },
          { x: x + 8,  y, z: z + 8 },
          { x,         y, z: z + 8 },
          { x,         y, z },
        ],
      };
    case "baker":
    case "smith":
    case "merchant":
      return { kind: "work_post", post: { x, y, z }, facing: 0 };
    case "thief":
      return { kind: "wander", wanderCenter: { x, y, z }, radius: 6 };
    case "scholar":
    case "hacker":
    case "netrunner":
      return { kind: "work_post", post: { x, y, z }, facing: Math.PI };
    default:
      return { kind: "wander", wanderCenter: { x, y, z }, radius: 4 };
  }
}

/**
 * Compute the NPC's target position at this moment given:
 *   - their assigned route
 *   - the current day-segment (rest = sleep_anchor; work = post; etc.)
 *
 * Returns { target: {x,y,z}, facing?: number, action?: string }.
 */
export function computeAmbientTarget(npc, sleepAnchor = null) {
  const behavior = getCurrentBehavior(npc);
  const r = _routes.get(npc.id);

  // Resting NPCs head to their sleep anchor (or stay put)
  if (behavior === "rest" || behavior === "sleep") {
    if (sleepAnchor) return { target: sleepAnchor, facing: 0, action: "sleep" };
    if (r?.anchor)   return { target: r.anchor, facing: 0, action: "sleep" };
    return { target: r?.post ?? r?.wanderCenter, facing: 0, action: "rest" };
  }

  // Working / trading: stand at post if they have one
  if ((behavior === "work" || behavior === "trade") && r?.post) {
    return { target: r.post, facing: r.facing ?? 0, action: behavior };
  }

  // Patrolling: walk the loop
  if (r?.kind === "patrol_loop" && Array.isArray(r.waypoints) && r.waypoints.length > 0) {
    const wp = r.waypoints[r.idx % r.waypoints.length];
    return { target: wp, facing: 0, action: "patrol" };
  }

  // Wandering: pick a random nearby point inside radius
  if (r?.kind === "wander" && r.wanderCenter) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * (r.radius ?? 4);
    return {
      target: {
        x: r.wanderCenter.x + Math.cos(a) * d,
        y: r.wanderCenter.y,
        z: r.wanderCenter.z + Math.sin(a) * d,
      },
      facing: a,
      action: "wander",
    };
  }

  return { target: r?.post ?? { x: 0, y: 0, z: 0 }, facing: 0, action: "idle" };
}

/** Advance patrol index when an NPC reaches its waypoint. */
export function advancePatrol(npcId) {
  const r = _routes.get(npcId);
  if (!r || r.kind !== "patrol_loop") return;
  r.idx = (r.idx + 1) % (r.waypoints?.length ?? 1);
}

export function getRoute(npcId) { return _routes.get(npcId) ?? null; }
export function clearRoute(npcId) { _routes.delete(npcId); }
