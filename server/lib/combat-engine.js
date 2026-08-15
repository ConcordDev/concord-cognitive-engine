// server/lib/combat-engine.js
//
// Combat engine for Concordia — coordinates refusal algebra, soft power, Cascade events.
//
// On the hub ground (concordia-hub), combat is REFUSED (the ground IS Concordia).
// Off-hub, combat uses refusal algebra: each attack has a damage type that maps to
// a world-scale Refusal. Cascade events fire when world strength reaches cap 9;
// they expire in 7 days unless re-recorded.

export const CASCADE_CAP = 9;
export const CASCADE_DURATION_DAYS = 7;
export const CASCADE_DURATION_MS = CASCADE_DURATION_DAYS * 24 * 60 * 60 * 1000;

export const REFUSAL_DAMAGE_TYPES = [
  'death_suspended',
  'harvest_disabled',
  'hostility_paused',
  'consequence_held',
  'numbers_refused',
  'dome_collapse',
  'win_refused',
  'harm_to_children_refused',
];

export const ATTACK_TYPES = ['refusal_parry', 'breath_dodge', 'law_strike', 'cascade_burst'];
export const BASE_DAMAGE = {
  refusal_parry: 15,
  breath_dodge: 0,    // breath_dodge is non-damaging
  law_strike: 25,
  cascade_burst: 50,
};

/**
 * @typedef {Object} Combatant
 * @property {string} id
 * @property {string} worldId
 * @property {number} hp
 */

/**
 * @typedef {Object} CascadeState
 * @property {string} worldId
 * @property {number} strength
 * @property {number} startedAt
 * @property {boolean} fired
 */

export class CombatEngine {
  /**
   * @param {{db:any, refusalEngine:any, hubGroundCheck:Function}} opts
   */
  constructor({ db, refusalEngine, hubGroundCheck }) {
    this.db = db;
    this.refusalEngine = refusalEngine;
    this.hubGroundCheck = hubGroundCheck || ((worldId) => worldId === 'concordia-hub');
    /** @type {Map<string, {attacker:string, defender:string, worldId:string, startedAt:number}>} */
    this.activeCombats = new Map();
    /** @type {Map<string, CascadeState>} */
    this.cascades = new Map();
  }

  /**
   * Initiate combat between two players in a world.
   * Returns false if hub ground refuses violence.
   * @param {string} attackerId
   * @param {string} defenderId
   * @param {string} worldId
   * @returns {boolean}
   */
  initiateCombat(attackerId, defenderId, worldId) {
    if (this.hubGroundCheck(worldId)) {
      return false;
    }
    const key = `${attackerId}-${defenderId}-${worldId}`;
    this.activeCombats.set(key, {
      attacker: attackerId,
      defender: defenderId,
      worldId,
      startedAt: Date.now(),
    });
    return true;
  }

  /**
   * Resolve an attack using refusal algebra.
   * @param {Combatant} attacker
   * @param {Combatant} defender
   * @param {string} attackType - one of ATTACK_TYPES
   * @param {{refusalId?:string, worldContext:any}} ctx
   * @returns {{hit:boolean, damage:number, refusalApplied:string|null}}
   */
  resolveAttack(attacker, defender, attackType, ctx) {
    if (this.hubGroundCheck(defender.worldId)) {
      return { hit: false, damage: 0, refusalApplied: 'hub_ground' };
    }
    if (!ATTACK_TYPES.includes(attackType)) {
      return { hit: false, damage: 0, refusalApplied: null };
    }
    const baseDamage = BASE_DAMAGE[attackType];
    if (baseDamage === undefined || baseDamage === 0) {
      return { hit: false, damage: 0, refusalApplied: null };
    }
    // Refusal field dampens damage
    const refused = ctx.refusalId && REFUSAL_DAMAGE_TYPES.includes(ctx.refusalId);
    const damage = refused ? Math.floor(baseDamage * 0.5) : baseDamage;
    return {
      hit: true,
      damage,
      refusalApplied: refused ? ctx.refusalId : null,
    };
  }

  /**
   * Apply damage to a target.
   * @param {Combatant} target
   * @param {number} amount
   * @param {string} damageType
   * @returns {{newHp:number, killed:boolean}}
   */
  applyDamage(target, amount, damageType) {
    if (damageType === 'death_suspended') {
      // The Sovereign's signature: target's HP stops at 1, never 0
      target.hp = Math.max(1, target.hp - amount);
      return { newHp: target.hp, killed: false };
    }
    target.hp = Math.max(0, target.hp - amount);
    return { newHp: target.hp, killed: target.hp <= 0 };
  }

  /**
   * Add to Cascade contribution. If world reaches cap 9, fire Cascade event.
   * @param {string} worldId
   * @param {string} attackerId
   * @param {string} defenderId
   * @returns {{strength:number, fired:boolean, daysRemaining:number}}
   */
  cascadeContribution(worldId, attackerId, defenderId) {
    let c = this.cascades.get(worldId);
    if (!c || (Date.now() - c.startedAt) > CASCADE_DURATION_MS) {
      c = { worldId, strength: 0, startedAt: Date.now(), fired: false };
      this.cascades.set(worldId, c);
    }
    c.strength += 1;
    let fired = false;
    if (c.strength >= CASCADE_CAP && !c.fired) {
      c.fired = true;
      c.startedAt = Date.now();
      fired = true;
    }
    const daysRemaining = Math.max(0, CASCADE_DURATION_DAYS - (Date.now() - c.startedAt) / (24 * 60 * 60 * 1000));
    return { strength: c.strength, fired, daysRemaining };
  }

  /**
   * Check if soft power applies (no combat) in this world.
   * @param {string} worldId
   * @param {string} action
   * @returns {boolean} - false means combat NOT allowed
   */
  softPowerCheck(worldId, action) {
    if (this.hubGroundCheck(worldId) && action === 'attack') return false;
    return true;
  }

  /**
   * Get current Cascade state for all worlds.
   */
  getCascadeStates() {
    return Array.from(this.cascades.entries()).map(([id, c]) => ({
      worldId: id,
      strength: c.strength,
      fired: c.fired,
      daysRemaining: Math.max(0, CASCADE_DURATION_DAYS - (Date.now() - c.startedAt) / (24 * 60 * 60 * 1000)),
    }));
  }
}

export default CombatEngine;
