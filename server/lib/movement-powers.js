// server/lib/movement-powers.js
//
// Universal Move System — Phase 4: movement powers (lore-bound, acquirable,
// level-gated). Pure logic; the route layer applies it to the live avatar +
// flight-physics. Each power is a SUSTAINED DRAIN on the Pillar-2 gauge — flight
// sips mana/bio/charge; run out and you fall. Level gates the tier (a L1 ice-slide
// is short/slow/thirsty; a L200 one is a freeway that sips).
//
// Travel-power research (superhero MMOs): flight and super-speed historically
// DON'T compose (you can't fly at super-speed), and speed powers carry recharge
// windows — encoded in CONFLICTS + cooldownS. Cross-world potency (Pillar 3) is
// applied by the caller via cross-world-potency.js. Kill-switch
// CONCORD_MOVEMENT_POWERS=0 disables activation.

// power → profile. drainPerSec on the gauge; minLevel gates acquisition; speeds m/s.
export const MOVEMENT_POWERS = {
  flight:       { archetype: "flight",       gauge: "mana",    activationCost: 8,  drainPerSec: 3.0, minLevel: 20, baseSpeedMs: 7,  cooldownS: 0,  elementalDependency: null },
  super_speed:  { archetype: "speed_trail",  gauge: "stamina", activationCost: 5,  drainPerSec: 6.0, minLevel: 15, baseSpeedMs: 16, cooldownS: 4,  elementalDependency: null },
  ice_slide:    { archetype: "surface_ride", gauge: "mana",    activationCost: 3,  drainPerSec: 2.0, minLevel: 10, baseSpeedMs: 11, cooldownS: 0,  elementalDependency: "ice" },
  fire_flight:  { archetype: "flight",       gauge: "bio",     activationCost: 10, drainPerSec: 4.0, minLevel: 30, baseSpeedMs: 9,  cooldownS: 0,  elementalDependency: "fire" },
  web_swing:    { archetype: "web_swing",    gauge: "stamina", activationCost: 2,  drainPerSec: 1.5, minLevel: 8,  baseSpeedMs: 14, cooldownS: 0,  elementalDependency: null },
  blink:        { archetype: "blink",        gauge: "mana",    activationCost: 12, drainPerSec: 0,   minLevel: 25, baseSpeedMs: 0,  cooldownS: 6,  elementalDependency: null },
  air_dash:     { archetype: "speed_trail",  gauge: "stamina", activationCost: 4,  drainPerSec: 0,   minLevel: 5,  baseSpeedMs: 18, cooldownS: 2,  elementalDependency: null },
  wall_run:     { archetype: "surface_ride", gauge: "stamina", activationCost: 1,  drainPerSec: 1.0, minLevel: 5,  baseSpeedMs: 8,  cooldownS: 0,  elementalDependency: null },
};

// Powers that cannot be active simultaneously (R4: no flying at super-speed →
// no god-mobility stacking). Sorted-pair keys.
const CONFLICTS = new Set(["flight|super_speed", "fire_flight|super_speed", "flight|fire_flight"]);

export function getMovementPower(power) {
  return MOVEMENT_POWERS[power] || null;
}

/** Two powers conflict (can't stack) — order-independent. */
export function conflicts(a, b) {
  if (!a || !b || a === b) return false;
  return CONFLICTS.has([a, b].sort().join("|"));
}

/** Tier 1..5 from skill level (mirrors move-resolver tierForLevel: rev every 10 lv). */
export function tierForLevel(level) {
  const rev = Math.floor((Math.max(1, Number(level) || 1) - 1) / 10);
  if (rev >= 150) return 5;
  if (rev >= 50) return 4;
  if (rev >= 15) return 3;
  if (rev >= 5) return 2;
  return 1;
}

/** Tier-scaled speed (higher level → faster + more efficient). */
export function speedFor(power, level) {
  const p = getMovementPower(power);
  if (!p) return 0;
  return p.baseSpeedMs * (0.7 + 0.12 * tierForLevel(level)); // tier1 .82× … tier5 1.3×
}

/** Tier-scaled drain (higher level sips less — the "freeway that sips" at L200). */
export function drainPerSecFor(power, level) {
  const p = getMovementPower(power);
  if (!p) return 0;
  return p.drainPerSec * (1.3 - 0.06 * tierForLevel(level)); // tier1 1.24× … tier5 1.0×
}

/**
 * Can the player activate this power right now?
 * @returns {{ ok:boolean, reason:string|null }}
 */
export function canActivate({ power, skillLevel = 0, gauge = 0, activeNow = null, worldAvailable = true } = {}) {
  if (process.env.CONCORD_MOVEMENT_POWERS === "0") return { ok: false, reason: "disabled" };
  const p = getMovementPower(power);
  if (!p) return { ok: false, reason: "unknown_power" };
  if (!worldAvailable) return { ok: false, reason: "world_forbids" }; // Pillar 2 (crime world = none)
  if (skillLevel < p.minLevel) return { ok: false, reason: `requires_level_${p.minLevel}` };
  if (gauge < p.activationCost) return { ok: false, reason: "insufficient_gauge" };
  if (activeNow && conflicts(power, activeNow)) return { ok: false, reason: `conflicts_with_${activeNow}` };
  return { ok: true, reason: null };
}

/**
 * Advance a sustained power one tick. Returns the new gauge + whether it must
 * deactivate (ran out → you fall).
 */
export function drainTick({ power, gaugeRemaining, dtSec = 0.016, skillLevel = 0 }) {
  const drain = drainPerSecFor(power, skillLevel) * Math.max(0, dtSec);
  const next = Math.max(0, (Number(gaugeRemaining) || 0) - drain);
  return { gaugeRemaining: next, deactivate: next <= 0 && drain > 0 };
}
