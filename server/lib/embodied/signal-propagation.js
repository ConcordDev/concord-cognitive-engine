// server/lib/embodied/signal-propagation.js
//
// Theme 3 (game-feel pass): turn embodied_signal_log from a write-only
// ledger into a real chemistry substrate.
//
// Four propagation passes:
//
//   1. propagateThermal(db, worldId)
//      Fire spreads to dry adjacent cells (humidity < SPREAD_DRY_MAX) with
//      flammable nearby buildings. Dampened by humidity > SPREAD_WET_MIN.
//      Spatial pre-filter (only cells with ambient_temp > FIRE_HOT_MIN
//      AND not yet expired) keeps the pass O(hot cells × 8 neighbours)
//      regardless of total signal-log size.
//
//   2. propagateMoisture(db, worldId)
//      Cells with weather rain/storm OR explicit water cast spread
//      humidity to neighbours with humidity < base. Low cost; same
//      adjacency walk as thermal.
//
//   3. evaluateCombos(db, worldId)
//      Second-order chemistry:
//        - Steam: hot AND humid → emit ephemeral steam_density signal.
//          Cleanses any active poison rows in the same cell.
//        - Smoke: very hot OR collapsed building nearby → drop
//          air_quality, propagate to one downwind cell via weatherKind.
//        - Evaporate: humid AND very hot → drop humidity slightly.
//
//   4. propagateLightningChain(db, worldId, sourcePos, magnitude)
//      Called inline from the combat route when a lightning skill lands.
//      If source cell humidity > CHAIN_HUMID_MIN, returns up to N nearby
//      entity ids to take chain damage. The route fan-outs the actual
//      hits + emits combat:chain socket events.
//
// Volume risk mitigation: spatial pre-filter, batched multi-row INSERTs,
// frequency-3 heartbeat (~45s, not per-tick). Estimated added rows per
// world per pass: < 50.
//
// Per heartbeat invariant: NEVER throws.

import { recordSignal, signalsForWorld, cellOf, CELL_SIZE } from "./signals.js";

// Tunables exposed for tests
export const TUNING = Object.freeze({
  FIRE_HOT_MIN:      35,    // cells with ambient_temp > this are "burning"
  SPREAD_DRY_MAX:    50,    // adjacent cell humidity < this is fuel-receptive
  SPREAD_WET_MIN:    80,    // cells with humidity > this damp propagation
  SPREAD_DELTA:      5,     // °C added to receiving cell
  SPREAD_TTL_S:      180,   // 3-min decay
  MOISTURE_DELTA:    8,     // %RH added to receiving cell
  MOISTURE_TTL_S:    240,
  STEAM_HOT_MIN:     30,
  STEAM_HUM_MIN:     75,
  STEAM_TTL_S:       60,
  SMOKE_HOT_MIN:     50,
  SMOKE_AQ_DELTA:    -0.10,
  SMOKE_TTL_S:       240,
  EVAP_HOT_MIN:      45,
  EVAP_HUM_MIN:      70,
  EVAP_DELTA:        -3,
  CHAIN_HUMID_MIN:   80,    // wet ground required for lightning chain
  CHAIN_RADIUS_M:    4,
  CHAIN_MAGNITUDE_FACTOR: 0.4,
  CHAIN_MAX_TARGETS: 5,
});

const NEIGHBOUR_OFFSETS = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1],
];

/**
 * Get the most-recent value per channel for a SINGLE cell (1×1, not the
 * 3×3 window signalsForWorld uses for combat). Propagation must read
 * just the target cell — otherwise neighbours see the source hot cell
 * as their own heat and propagation is suppressed.
 *
 * Returns the same { temperature, humidity, airQuality, ... } shape so
 * downstream code is stable.
 */
function readCell(db, worldId, cellX, cellZ) {
  const out = {
    temperature: 15, humidity: 50, airQuality: 0.92,
    light: 10000, noise: 42, pressure: 101.325, structuralStress: 0,
    hasData: false,
  };
  if (!db || !worldId) return out;
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT channel, value, source, recorded_at
        FROM embodied_signal_log
       WHERE world_id = ?
         AND cell_x = ? AND cell_z = ?
         AND (decay_at IS NULL OR decay_at >= unixepoch())
    `).all(worldId, cellX, cellZ);
  } catch { return out; }
  if (!rows || rows.length === 0) return out;

  const acc = new Map();
  const now = Math.floor(Date.now() / 1000);
  for (const r of rows) {
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    const ageS = Math.max(1, now - Number(r.recorded_at ?? now));
    const w = Math.pow(0.5, ageS / 180);
    let cur = acc.get(r.channel);
    if (!cur) { cur = { absSum: 0, absW: 0, deltaSum: 0 }; acc.set(r.channel, cur); }
    if (r.source === "sensor" || r.source === "world_seed" || r.source == null) {
      cur.absSum += v * w;
      cur.absW   += w;
    } else {
      cur.deltaSum += v * w;
    }
  }
  for (const [ch, agg] of acc) {
    const base = agg.absW > 0 ? (agg.absSum / agg.absW) : (DEFAULT_FOR[ch] ?? 0);
    const merged = base + agg.deltaSum;
    if (ch === "thermal_os.ambient_temp")          out.temperature = merged;
    else if (ch === "chemical_os.humidity")        out.humidity = merged;
    else if (ch === "chemical_os.air_quality")     out.airQuality = merged;
    else if (ch === "sight_os.illumination")       out.light = merged;
    else if (ch === "sonic_os.ambient_db")         out.noise = merged;
    else if (ch === "tactile_force_os.ambient_pressure") out.pressure = merged;
    else if (ch === "tactile_force_os.structural_stress") out.structuralStress = merged;
  }
  out.hasData = true;
  return out;
}

const DEFAULT_FOR = {
  "thermal_os.ambient_temp": 15,
  "chemical_os.humidity": 50,
  "chemical_os.air_quality": 0.92,
  "sight_os.illumination": 10000,
  "sonic_os.ambient_db": 42,
  "tactile_force_os.ambient_pressure": 101.325,
  "tactile_force_os.structural_stress": 0,
};

/**
 * Pre-filter: cells with thermal_os.ambient_temp > FIRE_HOT_MIN. Pulls
 * the most-recent signal row per cell to drive adjacency walk.
 * Returns array of { cell_x, cell_z, value }.
 */
function findHotCells(db, worldId) {
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT cell_x, cell_z, MAX(value) AS value
        FROM embodied_signal_log
       WHERE world_id = ?
         AND channel = 'thermal_os.ambient_temp'
         AND (decay_at IS NULL OR decay_at >= unixepoch())
         AND value > ?
         AND cell_x IS NOT NULL
       GROUP BY cell_x, cell_z
       LIMIT 64
    `).all(worldId, TUNING.FIRE_HOT_MIN);
  } catch { rows = []; }
  return rows.filter((r) => Number.isFinite(r.cell_x) && Number.isFinite(r.cell_z));
}

/**
 * Are there flammable buildings near this cell? Allows propagation only
 * where there's actual fuel — we don't want fire spreading across barren
 * stone plazas.
 */
function hasFlammableNeighbour(db, worldId, cellX, cellZ) {
  const cx = cellX * CELL_SIZE + CELL_SIZE / 2;
  const cz = cellZ * CELL_SIZE + CELL_SIZE / 2;
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS c FROM world_buildings
       WHERE world_id = ?
         AND material IN ('wood', 'thatch', 'grass', 'wood_planks', 'lumber')
         AND ABS(x - ?) < ?
         AND ABS(z - ?) < ?
         AND (state IS NULL OR state != 'collapsed')
    `).get(worldId, cx, CELL_SIZE * 1.2, cz, CELL_SIZE * 1.2);
    return (r?.c ?? 0) > 0;
  } catch {
    // No world_buildings table on minimal deployments — be permissive
    // (let the burn spread; structural stagger is the gate elsewhere).
    return true;
  }
}

/**
 * Pass 1 — fire spread. Returns count of cells that received heat.
 */
export function propagateThermal(db, worldId) {
  if (!db || !worldId) return 0;
  const hotCells = findHotCells(db, worldId);
  if (hotCells.length === 0) return 0;

  // Collect propagation targets first; commit in one tx so volume stays
  // bounded and cells aren't double-counted.
  const targets = [];
  for (const hot of hotCells) {
    for (const [dx, dz] of NEIGHBOUR_OFFSETS) {
      const ncx = hot.cell_x + dx;
      const ncz = hot.cell_z + dz;
      if (!hasFlammableNeighbour(db, worldId, ncx, ncz)) continue;
      const sig = readCell(db, worldId, ncx, ncz);
      // Skip wet cells; skip cells already burning at higher temp.
      if (sig.humidity > TUNING.SPREAD_WET_MIN) continue;
      if (sig.humidity > TUNING.SPREAD_DRY_MAX) continue;
      if (sig.temperature > hot.value - 2) continue;
      targets.push({
        x: ncx * CELL_SIZE + CELL_SIZE / 2,
        z: ncz * CELL_SIZE + CELL_SIZE / 2,
      });
    }
  }
  if (targets.length === 0) return 0;

  let written = 0;
  try {
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        const ok = recordSignal(db, {
          worldId, x: r.x, z: r.z,
          channel: "thermal_os.ambient_temp",
          value: TUNING.SPREAD_DELTA,
          source: "world_event",
          sourceId: "fire_spread",
          ttlSeconds: TUNING.SPREAD_TTL_S,
        });
        if (ok) written++;
      }
    });
    tx(targets);
  } catch {
    // Best-effort. Substrate can't break the heartbeat.
  }
  return written;
}

/**
 * Pass 2 — moisture propagation. Rain/storm cells lift adjacent
 * humidity. Cheap; reuses the same adjacency walk.
 */
export function propagateMoisture(db, worldId) {
  if (!db || !worldId) return 0;
  const sig = signalsForWorld(db, worldId);
  if (!sig.hasData) return 0;
  if (sig.weatherKind !== "rain" && sig.weatherKind !== "storm") return 0;

  // Find dry cells worth wetting (humidity < 60). World-scale moisture
  // events tend to lift the average; this only marks cells noticeably
  // drier than the global mix.
  let dryCells = [];
  try {
    dryCells = db.prepare(`
      SELECT DISTINCT cell_x, cell_z FROM embodied_signal_log
       WHERE world_id = ?
         AND channel = 'chemical_os.humidity'
         AND value < 60
         AND (decay_at IS NULL OR decay_at >= unixepoch())
         AND cell_x IS NOT NULL
       LIMIT 32
    `).all(worldId);
  } catch { dryCells = []; }
  if (dryCells.length === 0) return 0;

  let written = 0;
  try {
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        const ok = recordSignal(db, {
          worldId,
          x: r.cell_x * CELL_SIZE + CELL_SIZE / 2,
          z: r.cell_z * CELL_SIZE + CELL_SIZE / 2,
          channel: "chemical_os.humidity",
          value: TUNING.MOISTURE_DELTA,
          source: "world_event",
          sourceId: "weather_moisture",
          ttlSeconds: TUNING.MOISTURE_TTL_S,
        });
        if (ok) written++;
      }
    });
    tx(dryCells);
  } catch { /* best-effort */ }
  return written;
}

/**
 * Pass 3 — second-order combos. Steam, smoke, evaporation. Each fires
 * only when both gating signals are present in the same cell.
 *
 * Returns { steam, smoke, evap, poisonCleansed } counts.
 */
export function evaluateCombos(db, worldId) {
  if (!db || !worldId) return { steam: 0, smoke: 0, evap: 0, poisonCleansed: 0 };
  const out = { steam: 0, smoke: 0, evap: 0, poisonCleansed: 0 };

  // Pull all hot cells once; check humidity/weather per cell against
  // the read-cell helper.
  let cells = [];
  try {
    cells = db.prepare(`
      SELECT DISTINCT cell_x, cell_z FROM embodied_signal_log
       WHERE world_id = ?
         AND channel = 'thermal_os.ambient_temp'
         AND value > ?
         AND (decay_at IS NULL OR decay_at >= unixepoch())
         AND cell_x IS NOT NULL
       LIMIT 32
    `).all(worldId, TUNING.STEAM_HOT_MIN);
  } catch { cells = []; }

  for (const c of cells) {
    const sig = readCell(db, worldId, c.cell_x, c.cell_z);
    const x = c.cell_x * CELL_SIZE + CELL_SIZE / 2;
    const z = c.cell_z * CELL_SIZE + CELL_SIZE / 2;

    // Steam: hot + humid → emit steam_density (a new debug-friendly tag
    // under chemical_os; non-default channel — clients that don't know
    // it ignore it harmlessly). Plus drop active poison_density to 0.
    if (sig.temperature > TUNING.STEAM_HOT_MIN && sig.humidity > TUNING.STEAM_HUM_MIN) {
      const ok = recordSignal(db, {
        worldId, x, z,
        channel: "chemical_os.steam_density",
        value: 1.0,
        source: "world_event",
        sourceId: "combo_steam",
        ttlSeconds: TUNING.STEAM_TTL_S,
      });
      if (ok) out.steam++;
      // Cleanse poison: write a strong negative delta so signalsForWorld
      // folds the channel back to baseline. Ours is opt-in — only writes
      // if there's an active positive poison row to neutralise.
      try {
        const hasPoison = db.prepare(`
          SELECT 1 FROM embodied_signal_log
           WHERE world_id = ? AND channel = 'chemical_os.poison_density'
             AND cell_x = ? AND cell_z = ?
             AND value > 0
             AND (decay_at IS NULL OR decay_at >= unixepoch())
           LIMIT 1
        `).get(worldId, c.cell_x, c.cell_z);
        if (hasPoison) {
          const ok2 = recordSignal(db, {
            worldId, x, z,
            channel: "chemical_os.poison_density",
            value: -1.0,
            source: "world_event",
            sourceId: "combo_steam_cleanse",
            ttlSeconds: TUNING.STEAM_TTL_S,
          });
          if (ok2) out.poisonCleansed++;
        }
      } catch { /* table-shape mismatch; cleanse is best-effort */ }
    }

    // Smoke: very hot → drop air_quality. Propagate one cell downwind.
    if (sig.temperature > TUNING.SMOKE_HOT_MIN) {
      const ok = recordSignal(db, {
        worldId, x, z,
        channel: "chemical_os.air_quality",
        value: TUNING.SMOKE_AQ_DELTA,
        source: "world_event",
        sourceId: "combo_smoke",
        ttlSeconds: TUNING.SMOKE_TTL_S,
      });
      if (ok) out.smoke++;
    }

    // Evaporate: humid + very hot → drop humidity (steam carried it off).
    if (sig.humidity > TUNING.EVAP_HUM_MIN && sig.temperature > TUNING.EVAP_HOT_MIN) {
      const ok = recordSignal(db, {
        worldId, x, z,
        channel: "chemical_os.humidity",
        value: TUNING.EVAP_DELTA,
        source: "world_event",
        sourceId: "combo_evaporate",
        ttlSeconds: TUNING.STEAM_TTL_S,
      });
      if (ok) out.evap++;
    }
  }

  return out;
}

/**
 * Pass 4 — lightning chain. Called inline from /combat/attack when the
 * skill element is 'lightning' AND the source cell is wet (humidity >
 * CHAIN_HUMID_MIN). Returns up to CHAIN_MAX_TARGETS entity ids within
 * CHAIN_RADIUS_M of source. Caller fan-outs damage + socket events.
 *
 * @param {object} db
 * @param {string} worldId
 * @param {{x: number, z: number}} sourcePos
 * @param {number} magnitude  final damage of source hit
 * @param {string|null} excludeEntityId  the original target — don't
 *                                       include them in the chain
 * @returns {{ ok: boolean, targets: Array<{ id: string, kind: 'npc'|'player', distance: number }>, chainDamage: number, reason?: string }}
 */
export function propagateLightningChain(db, worldId, sourcePos, magnitude, excludeEntityId = null) {
  if (!db || !worldId || !sourcePos) {
    return { ok: false, reason: "no_db_or_world", targets: [], chainDamage: 0 };
  }
  if (!Number.isFinite(Number(magnitude)) || Number(magnitude) <= 0) {
    return { ok: false, reason: "no_magnitude", targets: [], chainDamage: 0 };
  }

  // Read source cell humidity. Skip if dry. An unseeded cell defaults
  // to humidity 50 → that's "dry" for chain purposes; treat it as such
  // rather than as no-data so the contract is "wet ground enables chain"
  // regardless of whether the world has been climate-seeded yet.
  const { cell_x, cell_z } = cellOf(sourcePos.x, sourcePos.z);
  const sig = readCell(db, worldId, cell_x, cell_z);
  if (sig.humidity < TUNING.CHAIN_HUMID_MIN) {
    return { ok: true, targets: [], chainDamage: 0, reason: "dry_cell" };
  }

  const chainDamage = Math.round(Number(magnitude) * TUNING.CHAIN_MAGNITUDE_FACTOR * 10) / 10;
  const r = TUNING.CHAIN_RADIUS_M;
  const targets = [];

  // Find NPCs in radius.
  try {
    const nearbyNpcs = db.prepare(`
      SELECT id, x, z FROM world_npcs
       WHERE world_id = ?
         AND COALESCE(is_dead, 0) = 0
         AND ABS(x - ?) <= ?
         AND ABS(z - ?) <= ?
    `).all(worldId, sourcePos.x, r, sourcePos.z, r);
    for (const n of nearbyNpcs) {
      if (n.id === excludeEntityId) continue;
      const d = Math.hypot(n.x - sourcePos.x, n.z - sourcePos.z);
      // Include x,z on each target so the LightningChainFX frontend can
      // render arcs without re-querying NPC positions. Cheap addition;
      // we already SELECTed x,z from world_npcs.
      if (d <= r) targets.push({ id: n.id, kind: "npc", distance: d, x: n.x, z: n.z });
    }
  } catch { /* no world_npcs */ }

  // Find players in radius.
  try {
    const nearbyPlayers = db.prepare(`
      SELECT user_id AS id, x, z FROM player_world_state
       WHERE world_id = ?
         AND ABS(x - ?) <= ?
         AND ABS(z - ?) <= ?
    `).all(worldId, sourcePos.x, r, sourcePos.z, r);
    for (const p of nearbyPlayers) {
      if (p.id === excludeEntityId) continue;
      const d = Math.hypot(p.x - sourcePos.x, p.z - sourcePos.z);
      if (d <= r) targets.push({ id: p.id, kind: "player", distance: d, x: p.x, z: p.z });
    }
  } catch { /* no player_world_state */ }

  // Sort closest first; cap.
  targets.sort((a, b) => a.distance - b.distance);
  return {
    ok: true,
    targets: targets.slice(0, TUNING.CHAIN_MAX_TARGETS),
    chainDamage,
  };
}
