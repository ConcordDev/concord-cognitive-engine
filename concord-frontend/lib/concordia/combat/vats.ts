// VATS — Vault-Tec Assisted Targeting System (Fallout-inspired).
// Entering VATS pauses action, shows hit-chance per body part, and
// costs Action Points derived from the player's Agility SPECIAL stat.

import { SPECIALStats, deriveStats } from '../player-stats';

// ── Types ────────────────────────────────────────────────────────────

export type BodyPart =
  | 'head' | 'torso' | 'left_arm' | 'right_arm' | 'left_leg' | 'right_leg';

export interface VATSTarget {
  entityId: string;
  entityName: string;
  distance: number;       // metres
  health: number;         // 0-100
  bodyParts: BodyPartTarget[];
}

export interface BodyPartTarget {
  part: BodyPart;
  hitChance: number;      // 0-100 %
  damageMultiplier: number;
  apCost: number;
  statusEffect?: string;  // 'crippled', 'blinded', 'slowed', etc.
}

// Effects when a body part is crippled (Fallout DNA)
export const CRIPPLE_EFFECTS: Record<BodyPart, string> = {
  head:      'blinded (−50% perception)',
  torso:     'winded (−30% stamina regen)',
  left_arm:  'weakened left arm (−20% melee)',
  right_arm: 'weakened right arm (−30% melee)',
  left_leg:  'limping (−25% speed)',
  right_leg: 'limping (−25% speed)',
};

// ── Compute hit chances ──────────────────────────────────────────────

export function computeVATSTargets(
  targets: Array<{ id: string; name: string; distance: number; health: number }>,
  special: SPECIALStats,
): VATSTarget[] {
  // Base accuracy decays with distance; Perception extends effective range
  const rangeBonus = (special.perception - 5) * 3; // metres

  return targets.map((t) => {
    const distancePenalty = Math.max(0, (t.distance - (10 + rangeBonus)) * 2);
    const baseChance = Math.max(5, 85 - distancePenalty + (special.luck - 5) * 2);

    const bodyParts: BodyPartTarget[] = [
      { part: 'torso',     hitChance: Math.min(95, baseChance + 10), damageMultiplier: 1.0, apCost: 8 },
      { part: 'head',      hitChance: Math.min(85, baseChance - 25), damageMultiplier: 2.5, apCost: 15, statusEffect: CRIPPLE_EFFECTS.head },
      { part: 'right_arm', hitChance: Math.min(90, baseChance - 5),  damageMultiplier: 0.9, apCost: 10, statusEffect: CRIPPLE_EFFECTS.right_arm },
      { part: 'left_arm',  hitChance: Math.min(90, baseChance - 5),  damageMultiplier: 0.9, apCost: 10, statusEffect: CRIPPLE_EFFECTS.left_arm },
      { part: 'right_leg', hitChance: Math.min(90, baseChance),      damageMultiplier: 0.7, apCost: 8,  statusEffect: CRIPPLE_EFFECTS.right_leg },
      { part: 'left_leg',  hitChance: Math.min(90, baseChance),      damageMultiplier: 0.7, apCost: 8,  statusEffect: CRIPPLE_EFFECTS.left_leg },
    ];

    return { entityId: t.id, entityName: t.name, distance: t.distance, health: t.health, bodyParts };
  });
}

// ── VATS state machine ────────────────────────────────────────────────

export interface VATSState {
  active: boolean;
  ap: number;
  maxAp: number;
  selectedTarget: string | null;
  selectedPart: BodyPart | null;
  targets: VATSTarget[];
  queuedShots: VATSShot[];
}

export interface VATSShot {
  targetId: string;
  part: BodyPart;
  apCost: number;
}

export function createVATSState(special: SPECIALStats): VATSState {
  const { vatsApPool } = deriveStats(special);
  return {
    active: false,
    ap: vatsApPool,
    maxAp: vatsApPool,
    selectedTarget: null,
    selectedPart: null,
    targets: [],
    queuedShots: [],
  };
}

export function queueVATSShot(
  state: VATSState,
  targetId: string,
  part: BodyPart,
  apCost: number,
): VATSState {
  if (state.ap < apCost) return state;
  return {
    ...state,
    ap: state.ap - apCost,
    queuedShots: [...state.queuedShots, { targetId, part, apCost }],
  };
}

export function exitVATS(state: VATSState): VATSState {
  return { ...state, active: false, selectedTarget: null, selectedPart: null, queuedShots: [] };
}

// AP regenerates at 20/second when not in VATS
export function regenAP(state: VATSState, deltaSeconds: number): VATSState {
  if (state.active) return state;
  const newAp = Math.min(state.maxAp, state.ap + 20 * deltaSeconds);
  return { ...state, ap: newAp };
}
