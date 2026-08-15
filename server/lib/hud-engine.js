// server/lib/hud-engine.js
//
// HUD state engine — what shows on screen when.
// Layout:
// - Top: refusal meter (left) + divinity alignment (center) + Cascade countdown (right)
// - Bottom: 4-slot hotbar (weapon / tool / offering / ritual)
// - Right: faction reputation (8 embassies + 3 factions)
// - Left: party status
// - Drawer: inventory
// - Notifications: queue of pending events

export const HUD_LAYOUT = {
  top: ['refusal_meter', 'divinity_alignment', 'cascade_countdown'],
  bottom: ['hotbar'],
  right: ['faction_reputation'],
  left: ['party_status'],
  drawer: ['inventory'],
  overlay: ['notifications'],
};

export const HOTBAR_SLOTS = ['weapon', 'tool', 'offering', 'ritual'];

/**
 * @typedef {Object} PlayerHudState
 * @property {string} playerId
 * @property {number} refusalMeter - 0..100, Sovereign's signature event count
 * @property {number} divinity - -1.0 (Sovereign) .. 0 .. +1.0 (Concordia)
 * @property {number} concord - 0..1 Concord alignment
 * @property {number} sovereignty - 0..1 Sovereign attention
 * @property {Map<string, number>} factionRep - keyed by faction id
 * @property {Array<{slot:string, itemId:string|null}>} hotbar
 * @property {Array<any>} inventory
 * @property {Array<{id:string, content:string, ts:number}>} notificationQueue
 */

export class HudEngine {
  /**
   * @param {{playerState:any}} opts
   */
  constructor({ playerState }) {
    this.playerState = playerState;
    /** @type {Map<string, PlayerHudState>} */
    this.states = new Map();
  }

  /**
   * Initialize HUD state for a player.
   * @param {string} playerId
   * @returns {PlayerHudState}
   */
  initPlayer(playerId) {
    const state = {
      playerId,
      refusalMeter: 0,
      divinity: 0,
      concord: 0.5,
      sovereignty: 0.0,
      factionRep: new Map(),
      hotbar: HOTBAR_SLOTS.map(slot => ({ slot, itemId: null })),
      inventory: [],
      notificationQueue: [],
    };
    this.states.set(playerId, state);
    return state;
  }

  /**
   * Compute HUD layout for a player.
   * @param {string} playerId
   * @param {number} screenWidth
   * @param {number} screenHeight
   * @returns {{regions: Record<string, {x:number, y:number, w:number, h:number}>}}
   */
  computeLayout(playerId, screenWidth, screenHeight) {
    const regions = {};
    // Top bar
    regions.refusal_meter = { x: 12, y: 12, w: 220, h: 60 };
    regions.divinity_alignment = { x: screenWidth / 2 - 150, y: 12, w: 300, h: 60 };
    regions.cascade_countdown = { x: screenWidth - 240, y: 12, w: 220, h: 60 };
    // Bottom hotbar
    regions.hotbar = {
      x: screenWidth / 2 - 200,
      y: screenHeight - 80,
      w: 400,
      h: 64,
    };
    // Right side: faction reputation
    regions.faction_reputation = {
      x: screenWidth - 240,
      y: 100,
      w: 220,
      h: screenHeight - 260,
    };
    // Left side: party status
    regions.party_status = {
      x: 12,
      y: 100,
      w: 220,
      h: screenHeight - 260,
    };
    return { regions };
  }

  /**
   * Sovereign's signature events count.
   * @param {string} playerId
   * @returns {number}
   */
  refusalMeter(playerId) {
    const s = this.states.get(playerId);
    return s ? s.refusalMeter : 0;
  }

  /**
   * 3-way divinity alignment bar.
   * @param {string} playerId
   * @returns {{concord:number, sovereignty:number, concordia:number}}
   */
  divinityAlignment(playerId) {
    const s = this.states.get(playerId);
    if (!s) return { concord: 0.5, sovereignty: 0.0, concordia: 0.5 };
    // The three sum to 1.0
    const concordia = Math.max(0, 1 - s.concord - s.sovereignty);
    return { concord: s.concord, sovereignty: s.sovereignty, concordia };
  }

  /**
   * Faction reputation (8 embassies + 3 factions).
   * @param {string} playerId
   * @returns {Record<string, number>}
   */
  factionReputation(playerId) {
    const s = this.states.get(playerId);
    if (!s) return {};
    return Object.fromEntries(s.factionRep);
  }

  /**
   * Cascade countdown for a world.
   * @param {string} worldId
   * @returns {{strength:number, daysRemaining:number, fired:boolean}}
   */
  cascadeCountdown(worldId) {
    // Delegate to cascade state on a shared game state
    return { strength: 0, daysRemaining: 7, fired: false };
  }

  /**
   * Inventory with hotbar slots.
   * @param {string} playerId
   * @returns {{hotbar:Array<{slot:string, itemId:string|null}>, inventory:Array<any>}}
   */
  inventory(playerId) {
    const s = this.states.get(playerId);
    if (!s) return { hotbar: [], inventory: [] };
    return { hotbar: s.hotbar, inventory: s.inventory };
  }

  /**
   * Notification queue for pending events.
   * @param {string} playerId
   * @returns {Array<{id:string, content:string, ts:number}>}
   */
  notificationQueue(playerId) {
    const s = this.states.get(playerId);
    return s ? s.notificationQueue : [];
  }

  /**
   * Push a notification to a player.
   * @param {string} playerId
   * @param {string} content
   * @param {string} [kind]
   */
  pushNotification(playerId, content, kind = 'event') {
    const s = this.states.get(playerId);
    if (!s) return;
    s.notificationQueue.push({
      id: `${playerId}-${Date.now()}`,
      content,
      kind,
      ts: Date.now(),
    });
  }

  /**
   * Bump refusal meter by N (Sovereign's signature came in).
   * @param {string} playerId
   * @param {number} amount
   */
  bumpRefusalMeter(playerId, amount) {
    const s = this.states.get(playerId);
    if (!s) return;
    s.refusalMeter = Math.min(100, Math.max(0, s.refusalMeter + amount));
  }

  /**
   * Adjust faction reputation.
   * @param {string} playerId
   * @param {string} factionId
   * @param {number} delta
   */
  adjustFactionRep(playerId, factionId, delta) {
    const s = this.states.get(playerId);
    if (!s) return;
    const cur = s.factionRep.get(factionId) || 0;
    s.factionRep.set(factionId, Math.max(-100, Math.min(100, cur + delta)));
  }

  /**
   * Set hotbar slot item.
   * @param {string} playerId
   * @param {string} slot
   * @param {string|null} itemId
   */
  setHotbarSlot(playerId, slot, itemId) {
    const s = this.states.get(playerId);
    if (!s) return;
    const hb = s.hotbar.find(h => h.slot === slot);
    if (hb) hb.itemId = itemId;
  }

  /**
   * Add an item to inventory.
   * @param {string} playerId
   * @param {any} item
   */
  addInventoryItem(playerId, item) {
    const s = this.states.get(playerId);
    if (!s) return;
    s.inventory.push(item);
  }
}

export default HudEngine;
