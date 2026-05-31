// server/lib/firearms.js
//
// Universal Move System — Phase 3: guns, balanced (not OP). Pure ballistics +
// magazine logic; the route/domain layer persists state and applies damage.
//
// Anti-OP levers, all here:
//   - RANGED PARRY WINDOW = 0. A gun user must NOT parry as fast as a swordsman
//     (the real bug the audit found). Firearms expose parryWindowMs: 0.
//   - Two-point LINEAR damage falloff to a non-zero floor (CS/Warframe/Overwatch),
//     NOT a drop-to-zero parabola — full ≤ falloffStart, linear down to
//     minDamageFloor at maxRange, clamped at the floor beyond. This is what
//     creates clean weapon-class specialization (shotgun steep, rifle shallow).
//   - Magazine + reload recovery + recoil/spread bloom gate sustained fire.
//
// Numbers are first-draft balance dials (untuned) — documented in docs/BALANCE_DIALS.md.

// archetype → ballistic profile. ranges in metres, times in ms, damage absolute.
export const GUN_ARCHETYPES = {
  pistol:  { magazine: 12, reloadMs: 1200, baseDamage: 18, falloffStart: 12, maxRange: 35,  minDamageFloor: 0.50, fireIntervalMs: 170, recoilPerShot: 0.06, spreadBloom: 0.5,  pellets: 1 },
  smg:     { magazine: 30, reloadMs: 1800, baseDamage: 12, falloffStart: 8,  maxRange: 25,  minDamageFloor: 0.40, fireIntervalMs: 80,  recoilPerShot: 0.04, spreadBloom: 0.8,  pellets: 1 },
  rifle:   { magazine: 30, reloadMs: 2200, baseDamage: 22, falloffStart: 25, maxRange: 70,  minDamageFloor: 0.60, fireIntervalMs: 110, recoilPerShot: 0.08, spreadBloom: 0.4,  pellets: 1 },
  shotgun: { magazine: 6,  reloadMs: 2800, baseDamage: 9,  falloffStart: 4,  maxRange: 18,  minDamageFloor: 0.15, fireIntervalMs: 700, recoilPerShot: 0.22, spreadBloom: 1.4,  pellets: 8 },
  sniper:  { magazine: 5,  reloadMs: 2600, baseDamage: 80, falloffStart: 40, maxRange: 200, minDamageFloor: 0.70, fireIntervalMs: 1100, recoilPerShot: 0.25, spreadBloom: 0.1, pellets: 1 },
  energy:  { magazine: 20, reloadMs: 2000, baseDamage: 16, falloffStart: 20, maxRange: 60,  minDamageFloor: 0.55, fireIntervalMs: 130, recoilPerShot: 0.03, spreadBloom: 0.3,  pellets: 1 },
};

// Ranged weapons do NOT parry — the load-bearing anti-OP invariant.
export const RANGED_PARRY_WINDOW_MS = 0;

export function getGunProfile(archetype) {
  return GUN_ARCHETYPES[archetype] || GUN_ARCHETYPES.pistol;
}

/**
 * Two-point linear damage falloff to a non-zero floor. Per-pellet × pellet count.
 * @returns {number} damage dealt at `distanceM`
 */
export function damageAtRange(archetype, distanceM, { tierMultiplier = 1 } = {}) {
  const g = getGunProfile(archetype);
  const d = Math.max(0, Number(distanceM) || 0);
  let factor;
  if (d <= g.falloffStart) factor = 1;
  else if (d >= g.maxRange) factor = g.minDamageFloor;
  else factor = 1 - (1 - g.minDamageFloor) * ((d - g.falloffStart) / (g.maxRange - g.falloffStart));
  return g.baseDamage * g.pellets * factor * tierMultiplier;
}

/** Spread (radians-ish, abstract) after `consecutiveShots` — recoil bloom. */
export function spreadAt(archetype, consecutiveShots = 0) {
  const g = getGunProfile(archetype);
  return g.spreadBloom * (1 - Math.exp(-0.25 * Math.max(0, consecutiveShots)));
}

// ── Magazine state (pure value object; caller persists) ──────────────────────
export function createMagazine(archetype) {
  const g = getGunProfile(archetype);
  return { archetype, capacity: g.magazine, rounds: g.magazine, reloadingUntil: 0 };
}

/** Fire one trigger pull. Returns { ok, mag, needsReload }. No ammo → needsReload. */
export function fire(mag, nowMs = Date.now()) {
  if (!mag || mag.rounds <= 0) return { ok: false, mag, needsReload: true };
  if (mag.reloadingUntil && nowMs < mag.reloadingUntil) return { ok: false, mag, needsReload: false, reloading: true };
  return { ok: true, mag: { ...mag, rounds: mag.rounds - 1 }, needsReload: mag.rounds - 1 <= 0 };
}

/** Begin a reload. Returns { mag, reloadMs }. Magazine refills when reloadingUntil passes. */
export function reload(mag, nowMs = Date.now()) {
  const g = getGunProfile(mag?.archetype);
  return { mag: { ...mag, rounds: g.magazine, reloadingUntil: nowMs + g.reloadMs }, reloadMs: g.reloadMs };
}
