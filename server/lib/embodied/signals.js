// server/lib/embodied/signals.js
//
// Layer 7: embodied signal store. Read/write helpers over the
// embodied_signal_log table (migration 108).
//
// CELL_SIZE = 50m. World is 2000x2000 (per world-gathering.js) so we
// have a 40x40 cell grid per world. signalsForWorld(db, worldId, location?)
// folds rows in a 3x3 cell window around `location` (or all cells if no
// location given).
//
// Recency-weighted average: a row recorded 10s ago weighs ~1.0; a row
// 600s ago weighs ~0.05. Old rows already past `decay_at` are excluded
// at the SQL level so the math stays bounded.
//
// Channel naming follows the sensory-OS convention from earlier layers:
//   thermal_os.ambient_temp        — Celsius, baseline ~15
//   chemical_os.humidity           — 0..100
//   chemical_os.air_quality        — 0..1 (1 = pristine, 0 = toxic)
//   sight_os.illumination          — lux, 0..120000
//   sonic_os.ambient_db            — decibels, 20..120
//   tactile_force_os.ambient_pressure — kPa around 101.325
//   tactile_force_os.structural_stress — 0..1 cumulative damage signal
//
// Readers MUST tolerate `hasData: false` — fresh installs and quiet
// worlds will have no rows, in which case signalsForWorld returns
// neutral defaults and downstream consumers (elementalEnvBoost) collapse
// to 1.0 multipliers. Layer 7.5 must degrade gracefully.

import crypto from "node:crypto";

export const CELL_SIZE = 50;
export const RECENCY_HALF_LIFE_S = 180; // a 3-min-old row weighs half as much as a fresh one.

const DEFAULT_TTL_S = 900;
const DEFAULTS = Object.freeze({
  "thermal_os.ambient_temp":          15,
  "chemical_os.humidity":             50,
  "chemical_os.air_quality":          0.92,
  "sight_os.illumination":            10000,
  "sonic_os.ambient_db":              42,
  "tactile_force_os.ambient_pressure": 101.325,
  "tactile_force_os.structural_stress": 0,
});

/** Quantize world (x, z) to cell coords. */
export function cellOf(x, z) {
  return {
    cell_x: Math.floor(Number(x) / CELL_SIZE),
    cell_z: Math.floor(Number(z) / CELL_SIZE),
  };
}

/**
 * Append a signal row. Caller chooses TTL based on disturbance class:
 *   - 30s  for transient lightning/illumination flash
 *   - 300s for skill-cast feedback
 *   - 900s for sensor baseline + slow drifts (humidity/air-quality)
 *
 * `value` is added as a delta on top of channel default for `source = skill_cast`,
 * `combat`, and `world_event` rows; for `sensor` and `world_seed` rows it
 * is treated as the ABSOLUTE reading. signalsForWorld() folds both classes.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} opts
 * @param {string} opts.worldId
 * @param {number} opts.x
 * @param {number} opts.z
 * @param {string} opts.channel
 * @param {number} opts.value
 * @param {string} opts.source — 'sensor'|'skill_cast'|'world_event'|'combat'|'world_seed'
 * @param {string} [opts.sourceId]
 * @param {number} [opts.ttlSeconds]
 */
export function recordSignal(db, opts) {
  if (!db || !opts) return null;
  const { worldId, x, z, channel, value, source, sourceId = null } = opts;
  if (!worldId || !channel || !Number.isFinite(Number(value)) || !source) return null;
  const ttl = Math.max(5, Math.min(86400, Number(opts.ttlSeconds ?? DEFAULT_TTL_S)));
  const { cell_x, cell_z } = cellOf(x ?? 0, z ?? 0);
  const id = `sig_${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  try {
    db.prepare(`
      INSERT INTO embodied_signal_log
        (id, world_id, cell_x, cell_z, channel, value, source, source_id, recorded_at, decay_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, worldId, cell_x, cell_z, channel, Number(value), source, sourceId, now, now + ttl);
    return { id, cell_x, cell_z };
  } catch {
    return null;
  }
}

/**
 * Fold signals for a world (optionally restricted to a 3x3 cell window).
 * Returns one merged number per channel, recency-weighted, plus a
 * derived `weatherKind` heuristic and a `hasData` flag.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @param {{ x: number, z: number } | null} [location]
 * @returns {object}
 */
export function signalsForWorld(db, worldId, location = null) {
  const out = { ...DEFAULTS, hasData: false, weatherKind: "clear" };
  // Camel-case aliases must be present on every return path, including the
  // early-return when no rows exist — downstream consumers (combat,
  // gather, NPC dialogue tone) read by alias, not by channel key.
  _attachAliases(out);
  if (!db || !worldId) return out;

  const now = Math.floor(Date.now() / 1000);
  let rows;
  try {
    if (location && Number.isFinite(location.x) && Number.isFinite(location.z)) {
      const { cell_x, cell_z } = cellOf(location.x, location.z);
      rows = db.prepare(`
        SELECT channel, value, source, recorded_at FROM embodied_signal_log
        WHERE world_id = ?
          AND decay_at >= ?
          AND cell_x BETWEEN ? AND ?
          AND cell_z BETWEEN ? AND ?
      `).all(worldId, now, cell_x - 1, cell_x + 1, cell_z - 1, cell_z + 1);
    } else {
      rows = db.prepare(`
        SELECT channel, value, source, recorded_at FROM embodied_signal_log
        WHERE world_id = ? AND decay_at >= ?
      `).all(worldId, now);
    }
  } catch {
    return out;
  }
  if (!rows || rows.length === 0) return out;

  // Per-channel: split absolute (sensor/world_seed) from delta (everything else),
  // recency-weighted average for absolutes, recency-weighted SUM for deltas.
  /** @type {Map<string, { absSum: number, absW: number, deltaSum: number }>} */
  const acc = new Map();
  for (const r of rows) {
    const ch = r.channel;
    const ageS = Math.max(1, now - r.recorded_at);
    const w = Math.pow(0.5, ageS / RECENCY_HALF_LIFE_S);
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    let cur = acc.get(ch);
    if (!cur) { cur = { absSum: 0, absW: 0, deltaSum: 0 }; acc.set(ch, cur); }
    if (r.source === "sensor" || r.source === "world_seed") {
      cur.absSum += v * w;
      cur.absW   += w;
    } else {
      cur.deltaSum += v * w;
    }
  }

  for (const [ch, agg] of acc) {
    const base = agg.absW > 0 ? (agg.absSum / agg.absW) : (DEFAULTS[ch] ?? 0);
    out[ch] = base + agg.deltaSum;
  }
  out.hasData = true;

  _attachAliases(out);

  // Derived weather heuristic.
  if (out.humidity > 80 && out.pressure < 100.5) out.weatherKind = "storm";
  else if (out.humidity > 75) out.weatherKind = "rain";
  else if (out.temperature < 2 && out.humidity > 60) out.weatherKind = "snow";
  else if (out.light > 80000 && out.humidity < 50) out.weatherKind = "sunny";
  else if (out.airQuality < 0.6) out.weatherKind = "smog";
  else out.weatherKind = "clear";

  return out;
}

function _attachAliases(out) {
  out.temperature      = out["thermal_os.ambient_temp"];
  out.humidity         = out["chemical_os.humidity"];
  out.airQuality       = out["chemical_os.air_quality"];
  out.light            = out["sight_os.illumination"];
  out.noise            = out["sonic_os.ambient_db"];
  out.pressure         = out["tactile_force_os.ambient_pressure"];
  out.structuralStress = out["tactile_force_os.structural_stress"];
}

/** GC sweep: hard-delete rows past their TTL. Bounded by the index. */
export function decaySweep(db) {
  if (!db) return 0;
  try {
    const r = db.prepare("DELETE FROM embodied_signal_log WHERE decay_at < unixepoch()").run();
    return r.changes;
  } catch {
    return 0;
  }
}

/**
 * Idempotent world-seed: writes a one-time absolute baseline per channel
 * with a long TTL. Used by content-seeder + tests so freshly-seeded worlds
 * have a starting climate before the env-sensor heartbeat fires.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @param {object} [overrides] — partial { temperature, humidity, light, ... }
 */
export function seedWorldClimate(db, worldId, overrides = {}) {
  if (!db || !worldId) return;
  const map = {
    "thermal_os.ambient_temp":           overrides.temperature ?? DEFAULTS["thermal_os.ambient_temp"],
    "chemical_os.humidity":              overrides.humidity    ?? DEFAULTS["chemical_os.humidity"],
    "chemical_os.air_quality":           overrides.airQuality  ?? DEFAULTS["chemical_os.air_quality"],
    "sight_os.illumination":             overrides.light       ?? DEFAULTS["sight_os.illumination"],
    "sonic_os.ambient_db":               overrides.noise       ?? DEFAULTS["sonic_os.ambient_db"],
    "tactile_force_os.ambient_pressure": overrides.pressure    ?? DEFAULTS["tactile_force_os.ambient_pressure"],
  };
  for (const [channel, value] of Object.entries(map)) {
    recordSignal(db, {
      worldId, x: 1000, z: 1000,
      channel, value: Number(value),
      source: "world_seed", sourceId: worldId,
      ttlSeconds: 86400, // 24h — the env-sensor will refresh long before that
    });
  }
}
