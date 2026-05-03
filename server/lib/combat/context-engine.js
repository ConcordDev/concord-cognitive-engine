// server/lib/combat/context-engine.js
//
// Detects the active combat context for a fighter from their world state.
// Pure: no IO, no DB, no side-effects. Returns the context label plus a
// modifiers bundle that callers (damage calc, flow engine, hotbar UI) can
// blend into their own behavior without knowing the matrix themselves.
//
// Six contexts:
//   - ground       — feet on terrain, no special mode (default)
//   - aerial       — above terrain by > AERIAL_HEIGHT or velocity.y > sustained
//   - vehicle      — riding a vehicle (mount, car, ship)
//   - hacker       — in netrunner / digital overlay mode (flagged by player)
//   - underwater   — y below water surface elevation
//   - mixed        — multiple contexts active at once (rare; e.g. flying +
//                    hacking simultaneously). Modifiers blend.
//
// Each context carries `modifiers`:
//   damageMul       — multiplicative on outgoing damage from this context
//   incomingMul     — multiplicative on incoming damage taken in this context
//   manaCostMul     — spells cost more/less here
//   staminaCostMul  — physical attacks cost more/less stamina
//   bioPowerCostMul — biological/magical hybrid abilities cost differently
//   evadeBonus      — flat additive evade %
//   styleHints      — array of style names the flow engine should preference
//                     ("aerial-chain", "ground-grapple", "vehicle-ram", etc.)

export const COMBAT_CONTEXTS = Object.freeze({
  GROUND:     "ground",
  AERIAL:     "aerial",
  VEHICLE:    "vehicle",
  HACKER:     "hacker",
  UNDERWATER: "underwater",
  MIXED:      "mixed",
});

export const AERIAL_HEIGHT_THRESHOLD = 3.0;     // metres above ground
export const SUSTAINED_VY_THRESHOLD  = 4.0;     // m/s upward to count as flying

const CONTEXT_MODIFIERS = Object.freeze({
  ground:     { damageMul: 1.00, incomingMul: 1.00, manaCostMul: 1.00, staminaCostMul: 1.00, bioPowerCostMul: 1.00, evadeBonus: 0,
                styleHints: ["ufc", "street-fighter", "ground-grapple"] },
  aerial:     { damageMul: 1.15, incomingMul: 1.00, manaCostMul: 1.05, staminaCostMul: 1.20, bioPowerCostMul: 0.95, evadeBonus: 0.10,
                styleHints: ["aerial-chain", "dive-bomb", "ki-blast"] },
  vehicle:    { damageMul: 1.40, incomingMul: 0.85, manaCostMul: 1.30, staminaCostMul: 0.50, bioPowerCostMul: 1.00, evadeBonus: 0,
                styleHints: ["vehicle-ram", "mounted-weapon", "drive-by"] },
  hacker:     { damageMul: 0.75, incomingMul: 1.20, manaCostMul: 0.60, staminaCostMul: 1.00, bioPowerCostMul: 0.80, evadeBonus: 0.15,
                styleHints: ["breach", "overload", "system-stun", "ice-pick"] },
  underwater: { damageMul: 0.85, incomingMul: 0.95, manaCostMul: 1.10, staminaCostMul: 1.40, bioPowerCostMul: 1.00, evadeBonus: 0.05,
                styleHints: ["drag-strike", "current-throw", "drowning-grapple"] },
  mixed:      { damageMul: 1.10, incomingMul: 1.05, manaCostMul: 1.00, staminaCostMul: 1.10, bioPowerCostMul: 0.95, evadeBonus: 0.05,
                styleHints: ["adaptive"] },
});

/**
 * @typedef {Object} CombatContextInput
 * @property {{ x: number, y: number, z: number }} position
 * @property {{ x: number, y: number, z: number }} [velocity]
 * @property {number}  [groundY]            — terrain Y at fighter position
 * @property {number}  [waterSurfaceY]      — water level if underwater volume present
 * @property {boolean} [inVehicle]
 * @property {boolean} [hackerMode]
 * @property {boolean} [grounded]           — physics says fighter is on a surface
 *
 * @typedef {Object} CombatContext
 * @property {string}  context              — one of COMBAT_CONTEXTS
 * @property {string[]} activeContexts      — when multiple fire (mixed case)
 * @property {Object}  modifiers
 * @property {string[]} styleHints
 */

/**
 * Determine the active combat context. Returns CombatContext.
 *
 * Priority for the primary context label (used by single-context callers):
 *   vehicle > hacker > underwater > aerial > ground
 * The full activeContexts array always lists every flag that's true.
 */
export function detectCombatContext(input = {}) {
  const pos       = input.position ?? { x: 0, y: 0, z: 0 };
  const vel       = input.velocity ?? { x: 0, y: 0, z: 0 };
  const groundY   = typeof input.groundY === "number" ? input.groundY : 0;
  const waterY    = typeof input.waterSurfaceY === "number" ? input.waterSurfaceY : null;
  const grounded  = !!input.grounded;
  const inVehicle = !!input.inVehicle;
  const hacker    = !!input.hackerMode;

  const heightAbove = pos.y - groundY;

  const isVehicle    = inVehicle;
  const isHacker     = hacker;
  const isUnderwater = waterY != null && pos.y < waterY - 0.2;
  const isAerial     = !grounded && (heightAbove > AERIAL_HEIGHT_THRESHOLD || (vel.y ?? 0) > SUSTAINED_VY_THRESHOLD);

  const active = [];
  if (isVehicle)    active.push(COMBAT_CONTEXTS.VEHICLE);
  if (isHacker)     active.push(COMBAT_CONTEXTS.HACKER);
  if (isUnderwater) active.push(COMBAT_CONTEXTS.UNDERWATER);
  if (isAerial)     active.push(COMBAT_CONTEXTS.AERIAL);
  if (active.length === 0) active.push(COMBAT_CONTEXTS.GROUND);

  // Single primary context
  let primary = active[0];
  // If two+ exclusive contexts are active that aren't a natural superset
  // (e.g. aerial + hacker), surface as 'mixed' so callers can treat the
  // blended modifier set explicitly.
  if (active.length > 1) {
    primary = COMBAT_CONTEXTS.MIXED;
  }

  const modifiers = CONTEXT_MODIFIERS[primary] ?? CONTEXT_MODIFIERS.ground;

  return {
    context: primary,
    activeContexts: active,
    modifiers: { ...modifiers },
    styleHints: [...modifiers.styleHints],
  };
}

/**
 * Blend two context modifiers (for testing what a transition feels like or
 * for the rare three-context overlap). Multiplicative fields multiply,
 * additive fields add, hint arrays concatenate.
 */
export function blendModifiers(a, b) {
  const A = a?.modifiers ?? a ?? {};
  const B = b?.modifiers ?? b ?? {};
  return {
    damageMul:       (A.damageMul       ?? 1) * (B.damageMul       ?? 1),
    incomingMul:     (A.incomingMul     ?? 1) * (B.incomingMul     ?? 1),
    manaCostMul:     (A.manaCostMul     ?? 1) * (B.manaCostMul     ?? 1),
    staminaCostMul:  (A.staminaCostMul  ?? 1) * (B.staminaCostMul  ?? 1),
    bioPowerCostMul: (A.bioPowerCostMul ?? 1) * (B.bioPowerCostMul ?? 1),
    evadeBonus:      (A.evadeBonus      ?? 0) + (B.evadeBonus      ?? 0),
    styleHints:      [...(A.styleHints ?? []), ...(B.styleHints ?? [])],
  };
}

export const _internal = { CONTEXT_MODIFIERS };
