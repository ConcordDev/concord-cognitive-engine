// server/lib/npc-combat-profiles.js
//
// Combat profile sidecar to npc-archetypes.js.
//
// Each archetype gets a combat profile with:
//   - stance:           visual posture identity (read by AvatarSystem3D
//                        + BodyLanguageOverlay)
//   - telegraphMs:      anticipation window before attacks land
//                        (must match combat-biomechanics.anticipationMs ladder)
//   - counterWindowMs:  parry / dodge window after the telegraph fires
//                        — bigger window = easier enemy
//   - signatureMoves:   the recognizable rotation of moves this archetype
//                        favors. Combat AI samples from these so each
//                        archetype has a *readable behavior pattern*
//   - tier:             biomechanics tier 1-5 (controls amplitude / poise)
//
// Resolution path: combat code calls `getCombatProfile(archetype)`.
// Unmapped archetypes fall back to GENERIC_PROFILE so any new archetype
// added to npc-archetypes.js still gets sane defaults without crashing.

const GENERIC_PROFILE = {
  stance:          'neutral',
  telegraphMs:     180,
  counterWindowMs: 220,
  signatureMoves:  ['attack-light', 'attack-light', 'attack-heavy', 'block'],
  tier:            2,
  weaponClass:     'fist',
};

/**
 * Per-archetype overrides. Anything not in this map uses GENERIC_PROFILE.
 * Tuned so different archetypes feel categorically different to fight:
 *
 *   - small / fast: short telegraph + tight counter window + many lights
 *   - large / heavy: long telegraph + wide counter window + heavy slams
 *   - magical: medium telegraph + ranged primary + dodge tax on player
 *   - undead: slow + huge telegraph + wide counter window + stagger-resist
 *   - bosses: bespoke per-name overrides where authored
 */
export const COMBAT_PROFILES = Object.freeze({
  // ── Fantasy enemies ────────────────────────────────────────────
  goblin: {
    stance: 'crouch',     telegraphMs: 110, counterWindowMs: 180,
    signatureMoves: ['attack-light', 'attack-light', 'dodge', 'attack-light'],
    tier: 1, weaponClass: 'dagger',
  },
  orc_warrior: {
    stance: 'wide',       telegraphMs: 220, counterWindowMs: 280,
    signatureMoves: ['attack-heavy', 'attack-light', 'attack-heavy'],
    tier: 3, weaponClass: 'axe',
  },
  dark_wizard: {
    stance: 'channel',    telegraphMs: 280, counterWindowMs: 200,
    signatureMoves: ['spell-cast', 'spell-cast', 'evade'],
    tier: 3, weaponClass: 'staff',
  },
  undead: {
    stance: 'shamble',    telegraphMs: 300, counterWindowMs: 350,
    signatureMoves: ['attack-heavy', 'attack-heavy', 'grapple'],
    tier: 2, weaponClass: 'fist',
  },
  troll: {
    stance: 'huge',       telegraphMs: 320, counterWindowMs: 320,
    signatureMoves: ['attack-heavy', 'attack-heavy', 'kick', 'attack-heavy'],
    tier: 4, weaponClass: 'club',
  },

  // ── Superhero enemies ─────────────────────────────────────────
  henchman: {
    stance: 'guard',      telegraphMs: 160, counterWindowMs: 220,
    signatureMoves: ['attack-light', 'attack-light', 'block'],
    tier: 1, weaponClass: 'pistol',
  },
  mutant_brute: {
    stance: 'lumber',     telegraphMs: 250, counterWindowMs: 300,
    signatureMoves: ['attack-heavy', 'grapple', 'attack-heavy'],
    tier: 3, weaponClass: 'fist',
  },
  tech_villain: {
    stance: 'tactical',   telegraphMs: 200, counterWindowMs: 220,
    signatureMoves: ['ranged', 'evade', 'spell-cast'],
    tier: 3, weaponClass: 'rifle',
  },
  alien_soldier: {
    stance: 'rifle-ready', telegraphMs: 180, counterWindowMs: 200,
    signatureMoves: ['ranged', 'ranged', 'evade', 'ranged'],
    tier: 3, weaponClass: 'rifle',
  },
  corrupted_hero: {
    stance: 'duelist',    telegraphMs: 130, counterWindowMs: 160,
    signatureMoves: ['attack-light', 'parry', 'attack-heavy', 'parry'],
    tier: 4, weaponClass: 'blade',
  },
  robot_enforcer: {
    stance: 'mech',       telegraphMs: 280, counterWindowMs: 280,
    signatureMoves: ['attack-heavy', 'ranged', 'attack-heavy'],
    tier: 3, weaponClass: 'fist',
  },

  // ── Concordia native ──────────────────────────────────────────
  knight: {
    stance: 'guard',      telegraphMs: 200, counterWindowMs: 240,
    signatureMoves: ['attack-light', 'block', 'attack-heavy', 'parry'],
    tier: 3, weaponClass: 'blade',
  },
  knight_rogue: {
    stance: 'duelist',    telegraphMs: 140, counterWindowMs: 180,
    signatureMoves: ['attack-light', 'dodge', 'attack-heavy', 'attack-light'],
    tier: 3, weaponClass: 'blade',
  },
  monk: {
    stance: 'meditation', telegraphMs: 150, counterWindowMs: 220,
    signatureMoves: ['attack-light', 'parry', 'attack-light', 'block'],
    tier: 4, weaponClass: 'fist',
  },

  // ── Bosses (bespoke; conscious AI may override at runtime) ─────
  crime_lord: {
    stance: 'commanding', telegraphMs: 180, counterWindowMs: 200,
    signatureMoves: ['ranged', 'attack-heavy', 'evade', 'spell-cast'],
    tier: 5, weaponClass: 'pistol',
  },
  dimension_ruler: {
    stance: 'imperious',  telegraphMs: 240, counterWindowMs: 220,
    signatureMoves: ['spell-cast', 'attack-heavy', 'spell-cast', 'attack-heavy'],
    tier: 5, weaponClass: 'staff',
  },
  shadow_government: {
    stance: 'concealed',  telegraphMs: 90,  counterWindowMs: 140,
    signatureMoves: ['attack-light', 'evade', 'attack-light', 'evade'],
    tier: 5, weaponClass: 'blade',
  },
  ember_sprite: {
    stance: 'hover',      telegraphMs: 130, counterWindowMs: 200,
    signatureMoves: ['spell-cast', 'evade', 'spell-cast'],
    tier: 1, weaponClass: 'spell',
  },
});

/**
 * Resolve combat profile for an archetype. Falls back to GENERIC_PROFILE
 * for unmapped archetypes so combat AI never crashes.
 *
 * @param {string} archetypeName
 * @returns {object}
 */
export function getCombatProfile(archetypeName) {
  return COMBAT_PROFILES[archetypeName] ?? GENERIC_PROFILE;
}

export { GENERIC_PROFILE };
