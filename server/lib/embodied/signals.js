// server/lib/embodied/signals.js
//
// Layer 7 reader/writer over `embodied_signal_log` (created by
// migration 112_embodied_signals.js, extended by migration
// 113_embodied_signal_log_unification.js).
//
// Post-merge of claude/lattice-consent-infra (PR #301): main's Layer 7
// table is canonical. This module preserves our `recordSignal`,
// `signalsForWorld`, `decaySweep`, `seedWorldClimate`, `cellOf`,
// `CELL_SIZE` exports — the API our Phase 7.5 / 8 code paths
// (`routes/worlds.js`, `lib/embodied/skill-environment.js`) depend on.
//
// CELL_SIZE = 50m. World is 2000x2000 → 40x40 = 1600 cells per world.
// signalsForWorld(db, worldId, location?) folds rows in a 3x3 cell
// window around `location` (or all cells if no location given).
//
// Recency-weighted average: a row recorded 10s ago weighs ~1.0; a row
// 600s ago weighs ~0.05. Old rows past `decay_at` are excluded at the
// SQL level so the math stays bounded.
//
// `value` is added as a delta on top of channel default for `source =
// skill_cast`, `combat`, and `world_event` rows; for `sensor` and
// `world_seed` rows it is treated as the ABSOLUTE reading.
// signalsForWorld() folds both classes.
//
// Schema reconciliation:
//   - location_x, location_z (REAL) — main's columns; we write raw
//     coords here for compatibility with main's queries
//   - cell_x, cell_z (INTEGER) — our additions via migration 113;
//     populated by recordSignal so cell-window reads are O(index)
//   - source (TEXT) — our taxonomy; main's observer_type may be
//     populated separately by main's environment-sensor for the
//     'sensor' / 'npc' / 'player' / 'creature' axis. Both can coexist.
//   - decay_at (INTEGER) — our TTL; main's environment-sensor doesn't
//     populate this, so its rows persist indefinitely until
//     application-side filtering. Our queries respect decay_at.

import crypto from "node:crypto";

export const CELL_SIZE = 50;
export const RECENCY_HALF_LIFE_S = 180; // 3-min half-life

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
 * Append a signal row to the merged-schema embodied_signal_log table.
 * Writes both location_x/z (main's coords) and cell_x/z (our quantized)
 * so both query paths work.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} opts
 *   { worldId, x, z, channel, value, source, sourceId?, ttlSeconds? }
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
        (id, world_id, location_x, location_z, cell_x, cell_z,
         channel, value, source, source_id,
         observed_at, recorded_at, decay_at, train_consented)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id, worldId,
      Number(x ?? 0), Number(z ?? 0),
      cell_x, cell_z,
      channel, Number(value),
      source, sourceId,
      now, now, now + ttl,
    );
    // Loud delta on the sonic channel from a non-sensor source = audible event.
    // Fan out so the client SoundscapeEngine can briefly raise/duck ambient
    // volume in response. Sensor/seed baselines are the floor and don't pulse.
    if (
      channel === "sonic_os.ambient_db" &&
      source !== "sensor" && source !== "world_seed" &&
      Number(value) > 5
    ) {
      try {
        const io = globalThis?.__CONCORD_REALTIME__?.io;
        if (io) {
          io.to(`world:${worldId}`).emit("world:sonic-pulse", {
            worldId,
            x: Number(x ?? 0),
            z: Number(z ?? 0),
            cellX: cell_x,
            cellZ: cell_z,
            value: Number(value),
            source,
            sourceId,
            at: now,
          });
        }
      } catch {
        // realtime emit best-effort; never poison the signal write
      }
    }
    return { id, cell_x, cell_z };
  } catch {
    return null;
  }
}

/**
 * Fold signals for a world (optionally restricted to a 3x3 cell window).
 * Returns one merged number per channel, recency-weighted, plus a
 * derived `weatherKind` heuristic and a `hasData` flag.
 */
export function signalsForWorld(db, worldId, location = null) {
  const out = { ...DEFAULTS, hasData: false, weatherKind: "clear" };
  _attachAliases(out);
  if (!db || !worldId) return out;

  const now = Math.floor(Date.now() / 1000);
  let rows;
  try {
    if (location && Number.isFinite(location.x) && Number.isFinite(location.z)) {
      const { cell_x, cell_z } = cellOf(location.x, location.z);
      rows = db.prepare(`
        SELECT channel, value, source, recorded_at, observed_at
          FROM embodied_signal_log
         WHERE world_id = ?
           AND (decay_at IS NULL OR decay_at >= ?)
           AND (
             (cell_x BETWEEN ? AND ? AND cell_z BETWEEN ? AND ?)
             OR (cell_x IS NULL AND location_x IS NOT NULL
                 AND ABS(location_x - ?) <= ? AND ABS(location_z - ?) <= ?)
           )
      `).all(
        worldId, now,
        cell_x - 1, cell_x + 1, cell_z - 1, cell_z + 1,
        Number(location.x), CELL_SIZE * 1.5,
        Number(location.z), CELL_SIZE * 1.5,
      );
    } else {
      rows = db.prepare(`
        SELECT channel, value, source, recorded_at, observed_at
          FROM embodied_signal_log
         WHERE world_id = ?
           AND (decay_at IS NULL OR decay_at >= ?)
      `).all(worldId, now);
    }
  } catch {
    return out;
  }
  if (!rows || rows.length === 0) return out;

  const acc = new Map();
  for (const r of rows) {
    const ch = r.channel;
    const ts = Number(r.recorded_at ?? r.observed_at ?? now);
    const ageS = Math.max(1, now - ts);
    const w = Math.pow(0.5, ageS / RECENCY_HALF_LIFE_S);
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    let cur = acc.get(ch);
    if (!cur) { cur = { absSum: 0, absW: 0, deltaSum: 0 }; acc.set(ch, cur); }
    if (r.source === "sensor" || r.source === "world_seed" || r.source == null) {
      // null source = main's environment-sense output; treat as absolute
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

/** GC sweep: hard-delete rows past their TTL (if decay_at set). */
export function decaySweep(db) {
  if (!db) return 0;
  try {
    const r = db.prepare(`
      DELETE FROM embodied_signal_log
       WHERE decay_at IS NOT NULL AND decay_at < unixepoch()
    `).run();
    return r.changes;
  } catch {
    return 0;
  }
}

/**
 * Idempotent world-seed: writes a one-time absolute baseline per channel
 * with a long TTL.
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
      ttlSeconds: 86400,
    });
  }
}
