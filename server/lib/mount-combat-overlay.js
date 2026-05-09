// server/lib/mount-combat-overlay.js
//
// Concordia Procedural Mount System Phase B4 — `mounted_modifier`
// overlay applied multiplicatively on top of the 5 base combat profiles
// (server/lib/combat-polish.js#COMBAT_PROFILES).
//
// CLAUDE.md invariant: mounted combat applies overlay multiplicatively;
// overlay read from `combat_actor_state.mount_state.mounted_modifier_active`.
// No piece of overlay should more than 2× any combat constant — overlays
// are tilts, not flips.

// Per-archetype overlays. Keyed by mount-archetype tags (warhorse,
// dire_wolf, chimera, hippogriff, gryphon, wyvern, salamander_mount,
// giant_elk, generic). Multiplied onto the base profile fields below.
//
// Constants we modulate:
//   gas_strike_cost          — riding burns more gas vs. standing.
//   gas_recovery_per_s       — recovery slower while mounted (mount fatigue).
//   combo_window_ms          — slightly longer (charge bias).
//   parry_window_ms          — tighter (less footwork).
//   dodge_window_ms          — depends on mount agility.
//   stagger_chance           — heavier mounts stagger more.
//
// Plus a `mounted_finishers` array of finisher names the profile
// unlocks while mounted (applied only to combo_finishers > 0 strikes).

const NEUTRAL = Object.freeze({
  gas_strike_cost_mul:     1.0,
  gas_recovery_per_s_mul:  1.0,
  combo_window_ms_mul:     1.0,
  parry_window_ms_mul:     1.0,
  dodge_window_ms_mul:     1.0,
  stagger_chance_mul:      1.0,
  speed_factor:            1.0,
  mounted_finishers:       [],
});

export const MOUNTED_MODIFIER = Object.freeze({
  warhorse: {
    gas_strike_cost_mul:    1.20,   // heavier swings cost more
    gas_recovery_per_s_mul: 0.85,
    combo_window_ms_mul:    1.10,
    parry_window_ms_mul:    0.90,
    dodge_window_ms_mul:    0.95,
    stagger_chance_mul:     1.40,
    speed_factor:           1.05,
    mounted_finishers:      ["lance_thrust", "trample"],
  },
  dire_wolf: {
    gas_strike_cost_mul:    1.10,
    gas_recovery_per_s_mul: 1.00,
    combo_window_ms_mul:    1.05,
    parry_window_ms_mul:    0.95,
    dodge_window_ms_mul:    1.05,
    stagger_chance_mul:     1.10,
    speed_factor:           1.10,
    mounted_finishers:      ["pounce_takedown", "pack_strike"],
  },
  chimera: {
    gas_strike_cost_mul:    1.30,
    gas_recovery_per_s_mul: 0.80,
    combo_window_ms_mul:    1.20,
    parry_window_ms_mul:    0.80,
    dodge_window_ms_mul:    0.85,
    stagger_chance_mul:     1.70,
    speed_factor:           0.95,
    mounted_finishers:      ["dragon_breath", "tail_sweep", "talon_rake"],
  },
  giant_elk: {
    gas_strike_cost_mul:    1.15,
    gas_recovery_per_s_mul: 0.90,
    combo_window_ms_mul:    1.05,
    parry_window_ms_mul:    0.95,
    dodge_window_ms_mul:    1.00,
    stagger_chance_mul:     1.30,
    speed_factor:           1.00,
    mounted_finishers:      ["antler_charge"],
  },
  salamander_mount: {
    gas_strike_cost_mul:    1.05,
    gas_recovery_per_s_mul: 1.00,
    combo_window_ms_mul:    1.00,
    parry_window_ms_mul:    1.00,
    dodge_window_ms_mul:    1.00,
    stagger_chance_mul:     1.15,
    speed_factor:           0.95,
    mounted_finishers:      ["ember_breath"],
  },
  hippogriff: {
    gas_strike_cost_mul:    1.10,
    gas_recovery_per_s_mul: 0.95,
    combo_window_ms_mul:    1.00,
    parry_window_ms_mul:    1.00,
    dodge_window_ms_mul:    1.10,
    stagger_chance_mul:     1.05,
    speed_factor:           1.20,
    mounted_finishers:      ["aerial_dive", "talon_strike"],
  },
  gryphon: {
    gas_strike_cost_mul:    1.20,
    gas_recovery_per_s_mul: 0.90,
    combo_window_ms_mul:    1.05,
    parry_window_ms_mul:    0.95,
    dodge_window_ms_mul:    1.10,
    stagger_chance_mul:     1.20,
    speed_factor:           1.30,
    mounted_finishers:      ["aerial_dive", "talon_rake"],
  },
  juvenile_wyvern: {
    gas_strike_cost_mul:    1.25,
    gas_recovery_per_s_mul: 0.85,
    combo_window_ms_mul:    1.10,
    parry_window_ms_mul:    0.90,
    dodge_window_ms_mul:    1.00,
    stagger_chance_mul:     1.50,
    speed_factor:           1.15,
    mounted_finishers:      ["wing_buffet", "tail_lash", "ember_breath"],
  },
  generic: { ...NEUTRAL },
});

const CLAMP_MIN = 0.5;
const CLAMP_MAX = 2.0;
const clamp = (x) => Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, x));

/**
 * Apply the overlay to a base combat profile, returning a new (frozen)
 * effective-profile object. Caller should NOT mutate the input.
 *
 * @param {object} profile — base profile from COMBAT_PROFILES
 * @param {string} archetypeKey — species_id (or 'generic' fallback)
 * @returns {object} effective profile
 */
export function applyMountedOverlay(profile, archetypeKey) {
  if (!profile) return profile;
  const overlay = MOUNTED_MODIFIER[archetypeKey] || MOUNTED_MODIFIER.generic;
  return Object.freeze({
    ...profile,
    gas_strike_cost:    profile.gas_strike_cost    * clamp(overlay.gas_strike_cost_mul),
    gas_recovery_per_s: profile.gas_recovery_per_s * clamp(overlay.gas_recovery_per_s_mul),
    combo_window_ms:    profile.combo_window_ms    * clamp(overlay.combo_window_ms_mul),
    parry_window_ms:    profile.parry_window_ms    * clamp(overlay.parry_window_ms_mul),
    dodge_window_ms:    profile.dodge_window_ms    * clamp(overlay.dodge_window_ms_mul),
    stagger_chance:     Math.min(1, profile.stagger_chance * clamp(overlay.stagger_chance_mul)),
    _mounted_overlay_active: true,
    _mount_archetype: archetypeKey,
    _speed_factor: clamp(overlay.speed_factor),
    _mounted_finishers: overlay.mounted_finishers.slice(),
  });
}

/**
 * Read the rider's archetype from combat_actor_state.mount_state.
 * Returns null when not mounted.
 */
export function readMountState(db, actorKind, actorId) {
  if (!db) return null;
  try {
    const row = db.prepare(`
      SELECT mount_state FROM combat_actor_state
      WHERE actor_kind = ? AND actor_id = ?
    `).get(actorKind, actorId);
    if (!row?.mount_state) return null;
    return JSON.parse(row.mount_state);
  } catch {
    return null;
  }
}

/**
 * Persist the rider's mount_state JSON. Caller passes
 * `{ mount_id, archetype, mounted_modifier_active: true }`. Cleared
 * on dismount.
 */
export function setMountState(db, actorKind, actorId, mountState) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    db.prepare(`
      UPDATE combat_actor_state
      SET mount_state = ?, updated_at = unixepoch()
      WHERE actor_kind = ? AND actor_id = ?
    `).run(mountState ? JSON.stringify(mountState) : null, actorKind, actorId);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export const _internals = { CLAMP_MIN, CLAMP_MAX };
