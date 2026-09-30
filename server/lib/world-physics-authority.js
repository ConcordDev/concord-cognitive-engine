// server/lib/world-physics-authority.js
//
// Named movement + collision authority for Concordia / Unity / Godot.
// Reuses PhysicsEngine (refusal fields, obstacles). Does not invent a second sim.
// Unity SendMove is an INTENT; this module is the position truth.

import { PhysicsEngine, DEFAULT_DT_MS } from "./physics-engine.js";

const engine = new PhysicsEngine({ db: null });

const DEFAULT_WORLDS = {
  "concordia-hub": {
    worldId: "concordia-hub",
    // Plaza walking is allowed. Obstacles prove collision authority.
    obstacles: [
      { x: 24, z: 0, r: 1.6, kind: "pillar" },
      { x: -18, z: 12, r: 1.4, kind: "crate" },
    ],
    noCombatZones: [],
  },
  fantasy: {
    worldId: "fantasy",
    obstacles: [{ x: 8, z: 8, r: 2.0, kind: "boulder" }],
    noCombatZones: [],
  },
};

function ensureWorld(worldId) {
  const id = String(worldId || "concordia-hub");
  if (!engine.worlds.has(id)) {
    const preset = DEFAULT_WORLDS[id] || { worldId: id, obstacles: [], noCombatZones: [] };
    engine.registerWorld(preset);
  }
  return engine.worlds.get(id);
}

/**
 * Apply a client-intended position. First sighting registers; later calls
 * treat the delta as movement and collide/dampen/refuse.
 */
export function applyAuthoritativeMove({ playerId, worldId = "concordia-hub", x = 0, z = 0, dtMs = DEFAULT_DT_MS } = {}) {
  if (!playerId) return { ok: false, reason: "missing_player" };
  const wid = String(worldId || "concordia-hub");
  ensureWorld(wid);
  let p = engine.players.get(playerId);
  const ix = Number(x) || 0;
  const iz = Number(z) || 0;
  if (!p) {
    engine.registerPlayer({ id: playerId, worldId: wid, x: ix, z: iz, hp: 100, divinity: 0 });
    return { ok: true, x: ix, z: iz, collided: false, dampedBy: 0, refused: false, registered: true, worldId: wid };
  }
  if (p.worldId !== wid) {
    engine.registerPlayer({ ...p, worldId: wid, x: ix, z: iz });
    return { ok: true, x: ix, z: iz, collided: false, dampedBy: 0, refused: false, worldChanged: true, worldId: wid };
  }
  const result = engine.applyMovement(playerId, wid, ix - p.x, iz - p.z, dtMs);
  return { ok: true, ...result, worldId: wid };
}

export function applyRefusal(refusalId, position, kind) {
  engine.applyRefusalField(refusalId, position, kind);
}

export function removeRefusal(refusalId) {
  engine.removeRefusalField(refusalId);
}

export function collisionResolve(a, b) {
  return engine.collisionResolve(a, b);
}

export function combatAllowed(worldId, attackerId, defenderId) {
  return engine.combatProximity(worldId, attackerId, defenderId);
}

export function getPlayer(playerId) {
  return engine.players.get(playerId) || null;
}

export function getEngine() {
  return engine;
}

export function resetPhysicsAuthorityForTest() {
  engine.players.clear();
  engine.worlds.clear();
  engine.activeRefusals.clear();
}

export default {
  applyAuthoritativeMove,
  applyRefusal,
  removeRefusal,
  collisionResolve,
  combatAllowed,
  getPlayer,
  getEngine,
  resetPhysicsAuthorityForTest,
};
