// server/lib/embodied/wind-currents.js
//
// Concordia Phase 7 — wind currents + thermals for aerial flight.
//
// Layer 7 (embodied signals) already records thermal_os.ambient_temp
// per-(world, cell). This module derives a deterministic wind vector
// + thermal-lift index from those signals so flight physics has a
// real backdrop. The function is pure given (worldId, x, z, ySignals):
//   - Base wind direction is seeded from worldId (so each world has
//     a prevailing pattern). Magnitude scales with temp gradient (a
//     cold cell next to a hot cell drives a stronger wind).
//   - Vertical lift (thermal) scales with absolute temp — hot cells
//     yield positive lift, cold cells yield sink.
//
// Returns:
//   { wind: {x, y, z}, lift, baseMag, sourceCellTempC }
//
// Lift is in m/s of vertical velocity contribution; flight physics
// adds it to glide descent so a thermal can reverse the parachute
// fall and let the player gain altitude.
//
// Pure / cache-free / deterministic — caller can call per-tick without
// thinking about cost. Tests pin the determinism + lift sign per
// temperature regime.

import crypto from "node:crypto";

const THERMAL_BASE_C        = 18;   // 18°C = no thermal lift
const THERMAL_LIFT_PER_5C   = 0.6;  // each +5°C above base yields +0.6 m/s
const THERMAL_LIFT_MAX_MS   = 4.0;  // cap so cells don't catapult
const THERMAL_LIFT_MIN_MS   = -2.5; // sink in cold cells, capped
const BASE_WIND_MAG_MS      = 1.5;
const WIND_TEMP_AMPLIFIER   = 0.18; // m/s per °C deviation from base
const PREVAILING_ANGLE_BITS = 8;

function seedAngleForWorld(worldId) {
  // Hash worldId → 8-bit angle bucket [0, 256), map to [0, 2π).
  const h = crypto.createHash("sha1").update(worldId || "concordia-hub").digest();
  const bits = h[0] % (1 << PREVAILING_ANGLE_BITS);
  return (bits / (1 << PREVAILING_ANGLE_BITS)) * Math.PI * 2;
}

/**
 * Compute the wind + lift vector for a (worldId, position, signals)
 * triple. `signals` should be the row returned by signalsForWorld.
 * If signals are missing or `hasData` false, returns a default
 * prevailing-wind-only result with zero lift.
 */
export function windAt(worldId, position, signals) {
  const angle = seedAngleForWorld(worldId);
  const noSignal = !signals || signals.hasData === false;
  // When there's no signal we ignore any temperature field — the
  // cell hasn't reported, so we don't pretend to know its thermal
  // state.
  const tempC = (!noSignal && signals && Number.isFinite(signals.temperature)) ? Number(signals.temperature) : THERMAL_BASE_C;

  const tempDelta = tempC - THERMAL_BASE_C;
  const lift = noSignal
    ? 0
    : Math.max(THERMAL_LIFT_MIN_MS, Math.min(THERMAL_LIFT_MAX_MS,
        (tempDelta / 5) * THERMAL_LIFT_PER_5C));

  const mag = noSignal
    ? BASE_WIND_MAG_MS
    : Math.max(0, BASE_WIND_MAG_MS + Math.abs(tempDelta) * WIND_TEMP_AMPLIFIER);

  return {
    wind: {
      x: Math.cos(angle) * mag,
      y: 0,
      z: Math.sin(angle) * mag,
    },
    lift,
    baseMag: mag,
    sourceCellTempC: tempC,
    angleRad: angle,
    hasData: !noSignal,
  };
}

/**
 * Caller convenience: read the signals via lib/embodied/signals.js
 * and call windAt. Returns the same shape. Falls back to default
 * (no-data) when the signals module is absent or signal table is
 * missing.
 */
export async function windAtViaSignals(db, worldId, position) {
  if (!db || !worldId) return windAt(worldId, position, null);
  try {
    const { signalsForWorld } = await import("./signals.js");
    const signals = signalsForWorld(db, worldId, position);
    return windAt(worldId, position, signals);
  } catch {
    return windAt(worldId, position, null);
  }
}

export const WIND_CONSTANTS = Object.freeze({
  THERMAL_BASE_C,
  THERMAL_LIFT_PER_5C,
  THERMAL_LIFT_MAX_MS,
  THERMAL_LIFT_MIN_MS,
  BASE_WIND_MAG_MS,
  WIND_TEMP_AMPLIFIER,
});
