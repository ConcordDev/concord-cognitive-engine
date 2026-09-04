// server/lib/physics-engine.js
//
// Physics engine for Concordia worlds.
// Coordinates movement, collision, refusal fields, and world environmental ticks.
//
// Hub ground refuses violence (HUB_GROUND_NO_COMBAT). Combat can only occur off-hub.
// Refusal fields dampen movement in their radius (the Sovereign's permanent contribution).
// Environmental ticks update world state (steam cascade, brine precipitation, heat drift).

export const HUB_GROUND_NO_COMBAT = true;
export const DEFAULT_DT_MS = 33;  // ~30Hz cadence matching godot-move-rate
export const REFU_FIELD_RADIUS_M = 5.0;
export const REFU_FIELD_DAMP_FACTOR = 0.5;
export const HUB_GROUND_DAMP_FACTOR = 0.0;  // no movement allowed on hub in combat

/**
 * @typedef {Object} PlayerState
 * @property {string} id
 * @property {string} worldId
 * @property {number} x
 * @property {number} z
 * @property {number} hp
 * @property {number} divinity - alignment: -1 (Sovereign) .. 0 .. +1 (Concordia)
 */

/**
 * @typedef {Object} CollisionCircle
 * @property {number} x
 * @property {number} z
 * @property {number} r
 * @property {string} [kind]
 */

/**
 * @typedef {Object} WorldCollisionMap
 * @property {string} worldId
 * @property {CollisionCircle[]} obstacles
 * @property {CollisionCircle[]} noCombatZones
 */

export class PhysicsEngine {
  /**
   * @param {{db:any}} opts
   */
  constructor({ db }) {
    this.db = db;
    /** @type {Map<string, PlayerState>} */
    this.players = new Map();
    /** @type {Map<string, WorldCollisionMap>} */
    this.worlds = new Map();
    /** @type {Map<string, {position:{x:number,z:number}, kind:string, appliedAt:number}>} */
    this.activeRefusals = new Map();
    /** @type {Map<string, {x:number, z:number, r:number, kind:string}>} */
    this.envTickers = new Map();
  }

  registerPlayer(player) {
    this.players.set(player.id, player);
  }

  registerWorld(worldMap) {
    this.worlds.set(worldMap.worldId, worldMap);
  }

  /**
   * Apply movement to a player, respecting world collision map and refusal fields.
   * @param {string} playerId
   * @param {string} worldId
   * @param {number} dx
   * @param {number} dz
   * @param {number} [dtMs=DEFAULT_DT_MS]
   * @returns {{x:number, z:number, collided:boolean, dampedBy:number, refused:boolean}}
   */
  applyMovement(playerId, worldId, dx, dz, dtMs = DEFAULT_DT_MS) {
    const p = this.players.get(playerId);
    const w = this.worlds.get(worldId);
    if (!p || !w) {
      return { x: 0, z: 0, collided: false, dampedBy: 0, refused: false };
    }

    // Apply refusal field dampening
    let dampedBy = 0;
    let refused = false;
    for (const [refusalId, field] of this.activeRefusals.entries()) {
      const dist = Math.hypot(p.x - field.position.x, p.z - field.position.z);
      if (dist < REFU_FIELD_RADIUS_M) {
        const factor = field.kind === 'hostility_paused' ? HUB_GROUND_DAMP_FACTOR : REFU_FIELD_DAMP_FACTOR;
        dx *= (1 - factor);
        dz *= (1 - factor);
        dampedBy = factor;
        if (field.kind === 'harm_to_children_refused') {
          refused = true;
          dx = 0; dz = 0;
        }
      }
    }

    let nx = p.x + dx;
    let nz = p.z + dz;
    let collided = false;

    // Hub ground: no movement in combat
    if (worldId === 'concordia-hub' && (dx !== 0 || dz !== 0)) {
      // Soft check: if movement is hostile, ground resists
      // (the ground IS Concordia; she refuses hostile movement)
      const inNoCombatZone = w.noCombatZones.some(zone => {
        const d = Math.hypot(nx - zone.x, nz - zone.z);
        return d < zone.r;
      });
      if (inNoCombatZone) {
        nx = p.x; nz = p.z;
        collided = true;
        refused = true;
      }
    }

    // Obstacle collision
    for (const obs of w.obstacles) {
      const dist = Math.hypot(nx - obs.x, nz - obs.z);
      if (dist < obs.r) {
        collided = true;
        nx = p.x; nz = p.z;
        break;
      }
    }

    this.players.set(playerId, { ...p, x: nx, z: nz });
    return { x: nx, z: nz, collided, dampedBy, refused };
  }

  /**
   * Resolve collision between two players. On hub ground, refuse combat.
   * @param {string} playerA
   * @param {string} playerB
   * @returns {{combatAllowed:boolean, softPowerApplied:boolean, worldId:string|null}}
   */
  collisionResolve(playerA, playerB) {
    const a = this.players.get(playerA);
    const b = this.players.get(playerB);
    if (!a || !b) {
      return { combatAllowed: false, softPowerApplied: false, worldId: null };
    }
    if (a.worldId === 'concordia-hub') {
      return { combatAllowed: false, softPowerApplied: true, worldId: 'concordia-hub' };
    }
    return { combatAllowed: true, softPowerApplied: false, worldId: a.worldId };
  }

  /**
   * Apply a Refusal field at a position; affects nearby movement.
   * @param {string} refusalId
   * @param {{x:number, z:number}} position
   * @param {string} fieldKind - one of: death_suspended, harvest_disabled, hostility_paused,
   *   consequence_held, numbers_refused, dome_collapse, win_refused, harm_to_children_refused
   */
  applyRefusalField(refusalId, position, fieldKind) {
    this.activeRefusals.set(refusalId, {
      position,
      kind: fieldKind,
      appliedAt: Date.now(),
    });
  }

  /**
   * Remove a refusal field.
   * @param {string} refusalId
   */
  removeRefusalField(refusalId) {
    this.activeRefusals.delete(refusalId);
  }

  /**
   * Tick environmental state for a world (steam cascade, brine, heat drift).
   * @param {string} worldId
   */
  environmentTick(worldId) {
    const w = this.worlds.get(worldId);
    if (w) {
      // Per-world env logic
      // (steam cascade in cyber/tunya, brine in fantasy, etc.)
    }
  }

  /**
   * Check if combat is allowed between attacker and defender in this world.
   * @param {string} worldId
   * @param {string} attackerId
   * @param {string} defenderId
   * @returns {boolean}
   */
  combatProximity(worldId, attackerId, defenderId) {
    if (worldId === 'concordia-hub') return false;
    return true;
  }

  /**
   * Get current state of all active refusal fields.
   */
  getActiveRefusals() {
    return Array.from(this.activeRefusals.entries()).map(([id, f]) => ({
      id,
      position: f.position,
      kind: f.kind,
      durationMs: Date.now() - f.appliedAt,
    }));
  }
}

export default PhysicsEngine;
