/**
 * Style parameter sets — Sprint D / T6
 *
 * Five fighting / movement styles. Each is a config blob describing
 * stance / range / stiffness curves / limb priorities / common combos.
 *
 * Motion intent (e.g. "throw fast hook with right hand at target") +
 * style + body params resolves to motor targets at runtime via the
 * combat-biomechanics pipeline (Sprint D / U1 wires these up).
 *
 * Replaces the implicit "every NPC fights the same" assumption with a
 * lightweight authored config that NPCs inherit from their faction or
 * archetype.
 */

import type { StiffnessMode } from './joint-motors';

export type FightingStyleId = 'karate' | 'muay_thai' | 'wing_chun' | 'capoeira' | 'classical_swordwork';

export type LimbPriority = 'fists' | 'elbows' | 'knees' | 'feet' | 'sword' | 'shield' | 'grappling';

export interface FightingStyle {
  id:                FightingStyleId;
  displayName:       string;
  /** Stance width as fraction of shoulder width (0.8–1.6). */
  stanceWidth:       number;
  /** Preferred fighting range in metres. */
  preferredRangeM:   number;
  /**
   * Phase-stiffness curve per combat phase. Each motor switch happens
   * at the corresponding phase boundary in U1's biomechanics output.
   */
  stiffnessCurve: {
    rest:           StiffnessMode;
    anticipation:   StiffnessMode;
    drive:          StiffnessMode;
    impact:         StiffnessMode;
    peak:           StiffnessMode;
    follow_through: StiffnessMode;
    settle:         StiffnessMode;
  };
  /** Ordered limb priorities — primary attack = first item. */
  limbPriorities:    LimbPriority[];
  /** Typical 2-to-3-strike combos in this style (move IDs from combat-biomechanics). */
  commonCombos:      string[][];
  /** Linguistic flavour for narrative prompts ("fluid", "explosive", "patient"). */
  cadence:           string;
}

export const STYLES: Record<FightingStyleId, FightingStyle> = {
  karate: {
    id: 'karate',
    displayName: 'Karate (Shotokan)',
    stanceWidth: 1.20,
    preferredRangeM: 1.4,
    stiffnessCurve: {
      rest:           'focused',
      anticipation:   'focused',
      drive:          'explosive',
      impact:         'explosive',
      peak:           'explosive',
      follow_through: 'focused',
      settle:         'focused',
    },
    limbPriorities: ['fists', 'feet', 'knees', 'elbows', 'grappling'],
    commonCombos: [
      ['attack-light', 'attack-heavy'],         // jab → reverse punch
      ['attack-light', 'kick'],                 // jab → front kick
      ['attack-heavy', 'kick'],                 // reverse punch → roundhouse
    ],
    cadence: 'explosive — measured rest, snap commitment',
  },
  muay_thai: {
    id: 'muay_thai',
    displayName: 'Muay Thai',
    stanceWidth: 1.05,
    preferredRangeM: 1.0,
    stiffnessCurve: {
      rest:           'focused',
      anticipation:   'focused',
      drive:          'explosive',
      impact:         'explosive',
      peak:           'explosive',
      follow_through: 'focused',
      settle:         'focused',
    },
    limbPriorities: ['knees', 'elbows', 'feet', 'fists', 'grappling'],
    commonCombos: [
      ['attack-light', 'kick'],                 // jab → low kick
      ['attack-heavy', 'attack-heavy'],         // body shot → body shot (knee hooks)
      ['grapple', 'attack-heavy'],              // clinch → knee
      ['kick', 'kick'],                         // low → high kick
    ],
    cadence: 'heavy — knee/elbow forward, clinch-favouring',
  },
  wing_chun: {
    id: 'wing_chun',
    displayName: 'Wing Chun',
    stanceWidth: 0.85,
    preferredRangeM: 0.6,
    stiffnessCurve: {
      rest:           'focused',
      anticipation:   'focused',
      drive:          'focused',
      impact:         'focused',
      peak:           'focused',
      follow_through: 'focused',
      settle:         'focused',
    },
    limbPriorities: ['fists', 'elbows', 'grappling', 'knees', 'feet'],
    commonCombos: [
      ['attack-light', 'attack-light', 'attack-light'],  // chain punch
      ['attack-light', 'attack-heavy'],                  // tan sao → bong sao
      ['grapple', 'attack-light'],                       // trap → vertical fist
    ],
    cadence: 'centerline-focused — rapid trapping, short range',
  },
  capoeira: {
    id: 'capoeira',
    displayName: 'Capoeira',
    stanceWidth: 1.40,
    preferredRangeM: 1.6,
    stiffnessCurve: {
      rest:           'relaxed',
      anticipation:   'focused',
      drive:          'explosive',
      impact:         'explosive',
      peak:           'explosive',
      follow_through: 'relaxed',     // signature flow-through
      settle:         'relaxed',
    },
    limbPriorities: ['feet', 'knees', 'fists', 'grappling', 'elbows'],
    commonCombos: [
      ['attack-light', 'kick'],                 // dodge in → meia lua
      ['kick', 'kick'],                         // sweep → roundhouse
      ['kick', 'attack-light'],                 // armada → backhand
    ],
    cadence: 'fluid — perpetual sway, kicks-from-impossible-angles',
  },
  classical_swordwork: {
    id: 'classical_swordwork',
    displayName: 'Classical Swordwork',
    stanceWidth: 1.15,
    preferredRangeM: 2.2,
    stiffnessCurve: {
      rest:           'focused',
      anticipation:   'focused',
      drive:          'explosive',
      impact:         'explosive',
      peak:           'explosive',
      follow_through: 'focused',
      settle:         'focused',
    },
    limbPriorities: ['sword', 'shield', 'fists', 'feet', 'grappling'],
    commonCombos: [
      ['attack-light', 'attack-light'],         // beat → cut
      ['attack-heavy', 'attack-light'],         // false-edge cut → thrust
      ['attack-light', 'attack-heavy'],         // feint → committed cut
    ],
    cadence: 'patient — distance-managed, weapon-priority',
  },
};

/**
 * Resolve a style for a given context. NPCs inherit from faction
 * preferences; players pick at character-creation. Falls back to muay_thai
 * (utilitarian baseline) if nothing matches.
 */
export interface StyleSelectionContext {
  factionId?:        string;
  archetype?:        string;
  preferredStyleId?: FightingStyleId;
}

const FACTION_STYLE_HINTS: Record<string, FightingStyleId> = {
  iron_wardens:       'classical_swordwork',
  scholars_guild:     'wing_chun',
  shadow_network:     'capoeira',
  merchant_collective:'muay_thai',
};

const ARCHETYPE_STYLE_HINTS: Record<string, FightingStyleId> = {
  warrior:        'classical_swordwork',
  guard:          'classical_swordwork',
  scholar:        'wing_chun',
  mystic:         'wing_chun',
  hunter:         'capoeira',
  trader:         'muay_thai',
  acrobat:        'capoeira',
  monk:           'karate',
};

export function pickStyle(ctx: StyleSelectionContext): FightingStyle {
  if (ctx.preferredStyleId && STYLES[ctx.preferredStyleId]) return STYLES[ctx.preferredStyleId];
  if (ctx.factionId && FACTION_STYLE_HINTS[ctx.factionId]) return STYLES[FACTION_STYLE_HINTS[ctx.factionId]];
  if (ctx.archetype && ARCHETYPE_STYLE_HINTS[ctx.archetype]) return STYLES[ARCHETYPE_STYLE_HINTS[ctx.archetype]];
  return STYLES.muay_thai;
}

export const STYLE_CONSTANTS = Object.freeze({
  STYLES,
  FACTION_STYLE_HINTS,
  ARCHETYPE_STYLE_HINTS,
});
