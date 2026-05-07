// server/lib/embodied/environment-sensor.js
//
// Layer 7: Environmental sensor — turns weather/biome/time-of-day into
// numeric sensory readings the rest of the substrate consumes.
//
// Per-tick this module:
//   1. Reads every active world (any world with at least one NPC).
//   2. For each world, computes current environmental signals based on
//      world weather, time-of-day, and any biome variability.
//   3. Writes the readings to embodied_signal_log (audit + brain-context).
//   4. Calls hookEcology(worldId, signals) so the QualiaEngine sensory
//      OS channels (thermal_os, sight_os, chemical_os, sonic_os,
//      tactile_force_os) get updated.
//
// The fauna-spawner consumes signalsForWorld(db, worldId) on each tick
// to derive species spawn modifiers (cold = bug × 0.1, etc.).
//
// Future: per-chunk variability via altitude/biome polygon lookups.
// V1 ships world-singleton readings — adequate for the demo loop where
// a player walks into "the cold zone" and sees ecology shift.

import crypto from "node:crypto";

const DEFAULT_WORLD = "concordia-hub";

// Biome-base climate priors. world weather modulates these per tick.
// Values are raw (°C, lux, %RH, dB, hPa, 0-1 air-quality); environment-
// sensor normalizes per channel before writing the signal log.
const BIOME_BASELINES = {
  plains:    { temperature: 18, light: 50000, humidity: 55, sound: 35, pressure: 1013, airQuality: 0.85 },
  forest:    { temperature: 14, light: 12000, humidity: 75, sound: 30, pressure: 1013, airQuality: 0.92 },
  highland:  { temperature:  8, light: 60000, humidity: 50, sound: 25, pressure:  950, airQuality: 0.95 },
  mountain:  { temperature: -5, light: 70000, humidity: 35, sound: 20, pressure:  800, airQuality: 0.98 },
  water:     { temperature: 16, light: 90000, humidity: 95, sound: 40, pressure: 1013, airQuality: 0.90 },
  desert:    { temperature: 35, light:120000, humidity: 10, sound: 25, pressure: 1013, airQuality: 0.75 },
  tundra:    { temperature:-15, light: 25000, humidity: 60, sound: 15, pressure: 1010, airQuality: 0.97 },
  swamp:     { temperature: 20, light:  8000, humidity: 95, sound: 50, pressure: 1015, airQuality: 0.65 },
};

const DEFAULT_BIOME = "plains";

/**
 * Run one environment-sense tick. Reads worlds + weather, computes
 * signals, writes to embodied_signal_log, calls hookEcology.
 *
 * @param {{ db: object, state?: object }} ctx
 * @returns {{ ok: boolean, worlds: number, signalsWritten: number }}
 */
export async function runEnvironmentSense({ db }) {
  if (!db) return { ok: false, reason: "no_db" };
  let worlds = [];
  try {
    worlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_npcs WHERE is_dead = 0
    `).all().map((r) => r.world_id);
  } catch { worlds = [DEFAULT_WORLD]; }
  if (worlds.length === 0) worlds = [DEFAULT_WORLD];

  let signalsWritten = 0;
  const insertStmt = db.prepare(`
    INSERT INTO embodied_signal_log
      (id, world_id, location_x, location_z, channel, value, raw_value, observer_id, observer_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'environment-sensor', 'sensor')
  `);

  for (const worldId of worlds) {
    const signals = _computeWorldSignals(db, worldId);
    // Write each signal as a row (location null = world-singleton reading).
    for (const [channel, { value, rawValue }] of Object.entries(signals._channels || {})) {
      try {
        insertStmt.run(
          `es_${crypto.randomBytes(6).toString("hex")}`,
          worldId, null, null, channel, value, rawValue,
        );
        signalsWritten++;
      } catch { /* per-row failure is non-fatal */ }
    }
    // Cross-link to existential OS via hookEcology.
    try {
      const { hookEcology } = await import("../../existential/hooks.js");
      hookEcology(worldId, signals);
    } catch { /* hook may not be loaded */ }
  }
  return { ok: true, worlds: worlds.length, signalsWritten };
}

/**
 * Compute current environmental signals for a world. Looks up any
 * weather state if available; otherwise uses biome baselines.
 * Time-of-day modulates light + temperature.
 *
 * Returns a flat object that hookEcology consumes plus a _channels
 * map of { channel: { value: 0-1, rawValue } } for the signal log.
 */
function _computeWorldSignals(db, worldId) {
  // Try to read current weather from worlds.weather_state if the column
  // exists. Most deployments use a simpler weather model.
  let weatherKind = "clear";
  let timeOfDay = _currentTimeOfDay();
  try {
    const w = db.prepare(`SELECT weather_state, time_of_day FROM worlds WHERE id = ?`).get(worldId);
    if (w?.weather_state) weatherKind = String(w.weather_state).toLowerCase();
    if (w?.time_of_day) timeOfDay = String(w.time_of_day).toLowerCase();
  } catch { /* schema may not have these columns; use defaults */ }

  // Pick a representative biome for the world. V1 uses the most-spawned
  // biome; future versions can sample multiple biomes for spatial signal
  // gradient.
  let biome = DEFAULT_BIOME;
  try {
    const b = db.prepare(`
      SELECT biome, COUNT(*) AS c FROM creature_population
      WHERE world_id = ?
      GROUP BY biome
      ORDER BY c DESC LIMIT 1
    `).get(worldId);
    if (b?.biome) biome = b.biome;
  } catch { /* creature_population may be empty */ }

  const base = BIOME_BASELINES[biome] || BIOME_BASELINES[DEFAULT_BIOME];

  // Apply weather modifiers (raw deltas).
  const weatherMods = _weatherModifiers(weatherKind);
  const totMods = _timeOfDayModifiers(timeOfDay);

  const temperature = base.temperature + weatherMods.dTemp + totMods.dTemp;
  const light       = Math.max(1, base.light * weatherMods.lightMul * totMods.lightMul);
  const humidity    = Math.max(0, Math.min(100, base.humidity + weatherMods.dHum));
  const sound       = Math.max(0, base.sound + weatherMods.dSound);
  const pressure    = base.pressure + weatherMods.dPressure;
  const airQuality  = Math.max(0, Math.min(1, base.airQuality + weatherMods.dAirQuality));

  // Build the channel map (normalized 0-1 with raw_value for audit).
  const channels = {
    "thermal_os.ambient_temp":          { value: _clamp01((temperature + 40) / 100), rawValue: temperature },
    "sight_os.illumination":            { value: _clamp01(Math.log10(light) / 5),    rawValue: light },
    "chemical_os.humidity":             { value: _clamp01(humidity / 100),            rawValue: humidity },
    "sonic_os.ambient_db":              { value: _clamp01(sound / 120),               rawValue: sound },
    "tactile_force_os.ambient_pressure":{ value: _clamp01(0.5 + (pressure - 1013) / 200), rawValue: pressure },
    "chemical_os.air_quality":          { value: _clamp01(airQuality),                rawValue: airQuality },
  };

  return {
    biome, weatherKind, timeOfDay,
    temperature, light, humidity, sound, pressure, airQuality,
    _channels: channels,
  };
}

function _weatherModifiers(kind) {
  switch (kind) {
    case "rain":   return { dTemp: -3,  lightMul: 0.4, dHum: +30, dSound: +20, dPressure: -8,  dAirQuality: +0.10 };
    case "storm":  return { dTemp: -5,  lightMul: 0.2, dHum: +40, dSound: +50, dPressure: -15, dAirQuality: +0.05 };
    case "snow":   return { dTemp: -15, lightMul: 0.5, dHum: -10, dSound: -10, dPressure: -5,  dAirQuality: +0.05 };
    case "fog":    return { dTemp: -2,  lightMul: 0.3, dHum: +20, dSound: -5,  dPressure: -2,  dAirQuality: -0.10 };
    case "heat":   return { dTemp: +12, lightMul: 1.1, dHum: -25, dSound: 0,   dPressure: -3,  dAirQuality: -0.20 };
    case "clear":
    default:       return { dTemp: 0,   lightMul: 1.0, dHum: 0,   dSound: 0,   dPressure: 0,   dAirQuality: 0 };
  }
}

function _timeOfDayModifiers(tod) {
  switch (tod) {
    case "night":   return { dTemp: -8,  lightMul: 0.005 };
    case "dawn":    return { dTemp: -4,  lightMul: 0.3 };
    case "dusk":    return { dTemp: -2,  lightMul: 0.4 };
    case "morning": return { dTemp: -1,  lightMul: 0.8 };
    case "afternoon":
    case "noon":    return { dTemp: +3,  lightMul: 1.1 };
    default:        return { dTemp: 0,   lightMul: 1.0 };
  }
}

function _currentTimeOfDay() {
  const h = new Date().getUTCHours();
  if (h >= 22 || h < 5)  return "night";
  if (h < 7)             return "dawn";
  if (h < 11)            return "morning";
  if (h < 14)            return "noon";
  if (h < 18)            return "afternoon";
  if (h < 22)            return "dusk";
  return "night";
}

function _clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Return current signals for a world. Used by fauna-spawner (Layer 7
 * extension) and chat-context-assembly to inform brain prompts about
 * environmental conditions. Cheap — recomputes from inputs each call.
 */
export function signalsForWorld(db, worldId = DEFAULT_WORLD) {
  if (!db) return null;
  return _computeWorldSignals(db, worldId);
}

/**
 * Return the most-recent N signals across all channels for a world.
 * Used by chat handler context assembly when the user mentions
 * environmental concepts.
 */
export function recentSignalsForWorld(db, worldId = DEFAULT_WORLD, limit = 30) {
  if (!db) return [];
  try {
    return db.prepare(
      `SELECT id, channel, value, raw_value, observer_type, observed_at
         FROM embodied_signal_log
        WHERE world_id = ?
        ORDER BY observed_at DESC
        LIMIT ?`,
    ).all(worldId, limit);
  } catch { return []; }
}

export const _internal = { BIOME_BASELINES, DEFAULT_WORLD };
