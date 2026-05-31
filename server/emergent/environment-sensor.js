// server/emergent/environment-sensor.js
//
// Layer 7 heartbeat: writes baseline ambient signals for every active world
// every 5 ticks (~75s) and runs decay GC.
//
// "Active world" = any world with at least one row in world_visits whose
// `departed_at IS NULL`. Quiet worlds incur zero writes — the table stays
// bounded to active play.
//
// The baseline is derived from:
//   - World rule_modulators (if the world declares a climate band)
//   - Time-of-day (light intensity follows a sin curve over 24h)
//   - World defaults otherwise
//
// This module is intentionally simple. Real weather variation, seasonal
// drift, and biome-specific readings are layered on top by world events and
// by skill-cast feedback. The sensor's only job is to keep a fresh
// `source = sensor` row per channel per active world so signalsForWorld()
// has something to fold against.

import { recordSignal, decaySweep } from "../lib/embodied/signals.js";
import { getClimateOverride } from "../lib/world-flavor.js";
import logger from "../logger.js";

const SECONDS_PER_DAY = 86400;
const SENSOR_TTL_S    = 600; // 10 min — must outlive the 75s tick interval

/**
 * Compute a 0..1 daylight factor from the world's time-of-day.
 * Worlds without a `time_of_day_s` row default to noon.
 */
function daylightFactor(secondsOfDay) {
  const s = ((Number(secondsOfDay) || 43200) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  // sin curve peaks at noon (s = 43200), troughs at midnight.
  const phase = (s / SECONDS_PER_DAY) * 2 * Math.PI - Math.PI / 2;
  return Math.max(0, Math.sin(phase));
}

/**
 * Heartbeat handler. Registered in server.js with frequency: 5.
 *
 * @param {{ db: import('better-sqlite3').Database, state: object, tickCount: number }} ctx
 */
export function runEnvironmentSensor({ db, state: _state, tickCount: _tickCount } = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  // 1) GC first — keeps the working set small for the read in step 3.
  let pruned = 0;
  try { pruned = decaySweep(db); } catch { /* non-fatal */ }

  // 2) Discover active worlds. Defensive against world_visits being missing.
  let activeWorlds = [];
  try {
    activeWorlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_visits WHERE departed_at IS NULL
    `).all().map(r => r.world_id).filter(Boolean);
  } catch {
    return { ok: false, reason: "world_visits_missing", pruned };
  }
  if (activeWorlds.length === 0) return { ok: true, pruned, worlds: 0 };

  // 3) For each, read climate config + time-of-day, write baseline.
  // Single batched fetch of rule_modulators replaces per-world loop (was N+1).
  let written = 0;
  const placeholders = activeWorlds.map(() => "?").join(",");
  const worldRows = activeWorlds.length > 0
    ? db.prepare(`SELECT id, rule_modulators FROM worlds WHERE id IN (${placeholders})`).all(...activeWorlds)
    : [];
  const rulesByWorld = new Map(worldRows.map(r => [r.id, _safeParseJSON(r.rule_modulators) ?? {}]));

  // time_of_day_s lives on the same row when present — try one batched
  // SELECT first, fall back per-world if the column doesn't exist.
  let todByWorld = new Map();
  try {
    const todRows = activeWorlds.length > 0
      ? db.prepare(`SELECT id, time_of_day_s FROM worlds WHERE id IN (${placeholders})`).all(...activeWorlds)
      : [];
    todByWorld = new Map(todRows.map(r => [r.id, Number(r.time_of_day_s)]));
  } catch { /* column may not exist on minimal builds */ }

  for (const worldId of activeWorlds) {
    try {
      const rules = rulesByWorld.get(worldId) ?? {};
      // Phase G — loops.json#climate takes precedence over worlds.rule_modulators.climate
      // so the operator can tune climate per-world without a DB migration.
      const flavorClimate = getClimateOverride(worldId);
      const climate = flavorClimate ? {
        // Map flavor schema (baseTemp/illumination/etc) onto the sensor's expected
        // names (temperature/peakLight/etc) so existing readers keep working.
        temperature: flavorClimate.baseTemp ?? rules.climate?.temperature ?? 15,
        humidity:    flavorClimate.humidity ?? rules.climate?.humidity ?? 50,
        airQuality:  (flavorClimate.airQuality != null) ? (flavorClimate.airQuality / 100) : (rules.climate?.airQuality ?? 0.92),
        noise:       flavorClimate.ambientDb ?? rules.climate?.noise ?? 42,
        pressure:    rules.climate?.pressure ?? 101.325,
        peakLight:   (flavorClimate.illumination != null) ? (flavorClimate.illumination * 100_000) : (rules.climate?.peakLight ?? 100_000),
      } : (rules.climate ?? {});

      // Time-of-day: prefer worlds.time_of_day_s if the column exists; fall
      // back to wall-clock UTC seconds-of-day. Tests can pin either.
      let secondsOfDay = todByWorld.get(worldId);
      if (!Number.isFinite(secondsOfDay)) {
        secondsOfDay = (Math.floor(Date.now() / 1000)) % SECONDS_PER_DAY;
      }
      const dayF = daylightFactor(secondsOfDay);

      const temperature = Number(climate.temperature ?? 15);
      const humidity    = Number(climate.humidity ?? 50);
      const airQuality  = Number(climate.airQuality ?? 0.92);
      const noise       = Number(climate.noise ?? 42);
      const pressure    = Number(climate.pressure ?? 101.325);

      // Light scales with day factor (ambient quarter, sun three-quarters).
      const peakLux = Number(climate.peakLight ?? 100000);
      const ambientLux = 2000;
      const light = ambientLux + (peakLux - ambientLux) * dayF;

      // Persist the live day-night clock + a derived weather onto the world so
      // the DB is the canonical source other systems (and the embodied sensor's
      // weather_state/time_of_day read) can query. Guarded for pre-303 builds.
      try {
        const hourOfDay = (secondsOfDay / 3600) % 24;
        const todLabel = hourOfDay < 5 || hourOfDay >= 21 ? "night"
          : hourOfDay < 8 ? "dawn" : hourOfDay < 18 ? "day" : "dusk";
        const weatherState = humidity >= 80 ? "rain" : airQuality < 0.6 ? "smog" : "clear";
        db.prepare(`UPDATE worlds SET time_of_day_s = ?, time_of_day = ?, weather_state = ? WHERE id = ?`)
          .run(secondsOfDay, todLabel, weatherState, worldId);
      } catch { /* worlds day/night columns absent on minimal builds */ }

      // Per-channel one-row baseline. Each replaces the prior sensor reading
      // because signalsForWorld recency-weights the absolute reads.
      const channels = [
        ["thermal_os.ambient_temp",           temperature],
        ["chemical_os.humidity",              humidity],
        ["chemical_os.air_quality",           airQuality],
        ["sight_os.illumination",             light],
        ["sonic_os.ambient_db",               noise],
        ["tactile_force_os.ambient_pressure", pressure],
      ];
      for (const [channel, value] of channels) {
        recordSignal(db, {
          worldId, x: 1000, z: 1000,
          channel, value, source: "sensor", sourceId: null,
          ttlSeconds: SENSOR_TTL_S,
        });
        written++;
      }
    } catch (err) {
      try { logger.warn("environment-sensor", "world_failed", { worldId, error: err?.message }); } catch { /* ignore */ }
    }
  }

  return { ok: true, pruned, worlds: activeWorlds.length, written };
}

function _safeParseJSON(s) {
  if (!s) return null;
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { return null; }
}
