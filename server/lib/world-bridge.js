// server/lib/world-bridge.js
//
// WorldBridge class — how player travels between worlds via Ring of Doors.
// - enter(worldId, playerId) — moves player to that world
// - exit(worldId, playerId) — returns to hub
// - embassyCheck(playerId, worldId) — checks embassy status
// - frontierRoadTravel(playerId, start, end) — special frontier path
// - archive(playerId, worldId) — records journey to memory vault
// - ringOfDoorsState(worldId) — which doors are open

import { HUB_GROUND_NO_COMBAT } from './physics-engine.js';

export const HUB_WORLD_ID = 'concordia-hub';
export const RING_OF_DOORS = 'ring-of-doors';
export const EMBASSY_STATUS = {
  OPEN: 'open',
  CLOSED: 'closed',
  FORBIDDEN: 'forbidden',
  ORPHANED: 'orphaned',
};

/**
 * @typedef {Object} RingEntry
 * @property {string} worldId
 * @property {string} status - one of EMBASSY_STATUS
 * @property {string} [reason]
 */

/**
 * @typedef {Object} WorldTravelLog
 * @property {string} playerId
 * @property {string} fromWorldId
 * @property {string} toWorldId
 * @property {number} ts
 * @property {string} [reason]
 */

export class WorldBridge {
  /**
   * @param {{db:any, vault:any}} opts
   */
  constructor({ db, vault }) {
    this.db = db;
    this.vault = vault;
    /** @type {Map<string, string>} playerId -> currentWorldId */
    this.currentWorld = new Map();
    /** @type {Map<string, RingEntry>} */
    this.ringState = new Map();
    /** @type {WorldTravelLog[]} */
    this.travelLog = [];
  }

  /**
   * Move a player into a world.
   * @param {string} worldId
   * @param {string} playerId
   * @returns {{ok:boolean, reason?:string}}
   */
  enter(worldId, playerId) {
    const entry = this.ringState.get(worldId);
    if (entry && entry.status === EMBASSY_STATUS.FORBIDDEN) {
      return { ok: false, reason: entry.reason || 'world_forbidden' };
    }
    if (entry && entry.status === EMBASSY_STATUS.ORPHANED) {
      // orphans still allow travel but log a warning
      this.travelLog.push({
        playerId,
        fromWorldId: this.currentWorld.get(playerId) || HUB_WORLD_ID,
        toWorldId: worldId,
        ts: Date.now(),
        reason: 'orphaned_world',
      });
    }
    this.currentWorld.set(playerId, worldId);
    this.archive(playerId, worldId);
    return { ok: true };
  }

  /**
   * Return a player to the hub.
   * @param {string} worldId
   * @param {string} playerId
   * @returns {{ok:boolean}}
   */
  exit(worldId, playerId) {
    this.currentWorld.set(playerId, HUB_WORLD_ID);
    this.archive(playerId, HUB_WORLD_ID);
    return { ok: true };
  }

  /**
   * Embassy status check.
   * @param {string} playerId
   * @param {string} worldId
   * @returns {{status:string, access:boolean}}
   */
  embassyCheck(playerId, worldId) {
    const entry = this.ringState.get(worldId);
    if (!entry) return { status: EMBASSY_STATUS.OPEN, access: true };
    if (entry.status === EMBASSY_STATUS.FORBIDDEN) return { status: entry.status, access: false };
    return { status: entry.status, access: true };
  }

  /**
   * Frontier road travel — between two non-hub worlds, off-concordia-link.
   * @param {string} playerId
   * @param {string} startWorld
   * @param {string} endWorld
   * @returns {{ok:boolean, path:string[]}}
   */
  frontierRoadTravel(playerId, startWorld, endWorld) {
    // The frontier road is a special path between worlds that bypass the Concord Link.
    // Reserved for keepers and esteemed guests.
    const path = [startWorld];
    if (startWorld !== 'concordia-hub' && endWorld !== 'concordia-hub') {
      // Non-hub-to-non-hub: must go through the frontier
      path.push('concord-link-frontier');
    }
    path.push(endWorld);
    return { ok: true, path };
  }

  /**
   * Record journey to memory vault.
   * @param {string} playerId
   * @param {string} worldId
   */
  async archive(playerId, worldId) {
    if (!this.vault) return;
    const entry = {
      playerId,
      worldId,
      ts: Date.now(),
    };
    this.travelLog.push({
      playerId,
      fromWorldId: this.currentWorld.get(playerId) || HUB_WORLD_ID,
      toWorldId: worldId,
      ts: Date.now(),
    });
    try {
      await this.vault.write('world_travel', {
        playerId,
        worldId,
        ts: Date.now(),
      });
    } catch {
      // observed: vault unavailable; memory of journey stays local
    }
  }

  /**
   * Ring of Doors state for a world.
   * @param {string} worldId
   * @returns {{status:string, reason?:string}}
   */
  ringOfDoorsState(worldId) {
    const entry = this.ringState.get(worldId);
    if (!entry) return { status: EMBASSY_STATUS.OPEN };
    return { status: entry.status, reason: entry.reason };
  }

  /**
   * Set the state of a ring entry (admin).
   * @param {string} worldId
   * @param {string} status
   * @param {string} [reason]
   */
  setRingEntry(worldId, status, reason) {
    this.ringState.set(worldId, { worldId, status, reason });
  }

  /**
   * Get travel log for a player.
   * @param {string} playerId
   * @returns {WorldTravelLog[]}
   */
  getTravelLog(playerId) {
    return this.travelLog.filter(t => t.playerId === playerId);
  }

  /**
   * Get current world for a player.
   * @param {string} playerId
   * @returns {string|null}
   */
  getCurrentWorld(playerId) {
    return this.currentWorld.get(playerId) || null;
  }
}

export default WorldBridge;
