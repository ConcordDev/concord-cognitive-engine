// server/lib/seasons.js
//
// Phase 5c — Seasons + Long-cycle Time.
//
// 6 seasons, 7 real-world days each. Concordia year = 6 weeks. Seasons
// silently bias env signals (Layer 7) — winter cools, summer warms,
// monsoon humidifies — modulate gather-node yield via terrainResourceBoost
// (winter herb yield is half), and emit annual events the EmergentEventFeed
// can surface.

import crypto from "node:crypto";
import logger from "../logger.js";

export const SEASONS = Object.freeze([
  { idx: 0, name: "spring",   tempBias: -2,  humidityBias: +5,  lightBias: 0,    narrative: "Spring breaks the lockstep of winter; herbs come back to the grove." },
  { idx: 1, name: "summer",   tempBias: +6,  humidityBias: -10, lightBias: +20000, narrative: "The summer sun burns longer than memory says." },
  { idx: 2, name: "monsoon",  tempBias: 0,   humidityBias: +25, lightBias: -10000, narrative: "Monsoon. The river is no longer in its banks." },
  { idx: 3, name: "harvest",  tempBias: +2,  humidityBias: -5,  lightBias: 0,    narrative: "Harvest. The granaries fill, the marketplaces overflow." },
  { idx: 4, name: "frost",    tempBias: -10, humidityBias: -15, lightBias: -5000,  narrative: "Frost. Plant roots curl in. The herbs fade." },
  { idx: 5, name: "deep_winter", tempBias: -18, humidityBias: -20, lightBias: -15000, narrative: "Deep winter. The factions ration salt; every footfall echoes." },
]);

const SEASON_LENGTH_DAYS = 7;
const SEASON_LENGTH_S = SEASON_LENGTH_DAYS * 86400;

// Per-season modulation of gather-node base yield. Winter halves herb,
// summer doubles meat (game is fat), harvest is a 1.3× general boost.
export const SEASON_NODE_YIELD_MULT = {
  spring:      { herb: 1.3, meat: 1.0, ore: 1.0, wood: 1.1, default: 1.0 },
  summer:      { herb: 0.9, meat: 1.4, ore: 1.0, wood: 1.0, default: 1.0 },
  monsoon:     { herb: 1.5, meat: 0.8, ore: 0.8, wood: 1.2, default: 0.9 },
  harvest:     { herb: 1.3, meat: 1.2, ore: 1.0, wood: 1.3, default: 1.3 },
  frost:       { herb: 0.5, meat: 0.7, ore: 1.1, wood: 0.8, default: 0.9 },
  deep_winter: { herb: 0.2, meat: 0.4, ore: 1.2, wood: 0.5, default: 0.7 },
};

// ── Time math ──────────────────────────────────────────────────────────────

/**
 * The current season for any moment in time. Pure: no DB lookup. Caller
 * uses currentSeason() for ambient queries; persistence + transitions
 * live in advanceSeasonForWorld().
 */
export function seasonFor(now = Date.now()) {
  // 6 seasons × 7 days = 42 days/year.
  const dayOfYear = Math.floor(now / 86400000) % 42;
  const idx = Math.floor(dayOfYear / SEASON_LENGTH_DAYS);
  return SEASONS[idx];
}

export function yearFor(now = Date.now()) {
  return Math.floor((now / 86400000) / 42) + 1;
}

// ── DB-backed transition ────────────────────────────────────────────────────

/**
 * Advance a world's season if the wall clock has crossed a 7-day
 * boundary since the last transition. Idempotent. Emits a season_events
 * row + 'season:transition' realtime event.
 *
 * Returns { ok, transitioned, season, year, narrative }.
 */
export function advanceSeasonForWorld(db, worldId, opts = {}) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  const now = opts.now ?? Date.now();
  const expected = seasonFor(now);
  const expectedYear = yearFor(now);

  let cur = null;
  try {
    cur = db.prepare(`SELECT * FROM world_seasons WHERE world_id = ?`).get(worldId);
  } catch { return { ok: false, reason: "no_season_table" }; }

  // First time: persist current season + emit "year_begin" event.
  if (!cur) {
    db.prepare(`
      INSERT INTO world_seasons (world_id, season_idx, year_n, transitioned_at)
      VALUES (?, ?, ?, unixepoch())
    `).run(worldId, expected.idx, expectedYear);
    insertSeasonEvent(db, worldId, expected.idx, expectedYear, "season:enter", expected.narrative);
    return { ok: true, transitioned: true, season: expected.name, year: expectedYear, narrative: expected.narrative };
  }

  if (cur.season_idx === expected.idx && cur.year_n === expectedYear) {
    return { ok: true, transitioned: false, season: SEASONS[cur.season_idx].name, year: cur.year_n };
  }

  // Capture prior values before the UPDATE — better-sqlite3 normally
  // returns a fresh row, but tests + alternate adapters may return the
  // same reference, and we don't want the UPDATE to alias-mutate cur.
  const priorYear = Number(cur.year_n);

  // Crossing boundary.
  db.prepare(`
    UPDATE world_seasons
    SET season_idx = ?, year_n = ?, transitioned_at = unixepoch()
    WHERE world_id = ?
  `).run(expected.idx, expectedYear, worldId);
  insertSeasonEvent(db, worldId, expected.idx, expectedYear, "season:transition", expected.narrative);
  // Year boundary?
  if (expectedYear > priorYear) {
    insertSeasonEvent(db, worldId, expected.idx, expectedYear, "year:begin", `Year ${expectedYear} begins.`);
  }

  // Realtime: emit world:season-transition. Best-effort.
  try {
    if (globalThis?.__CONCORD_REALTIME__?.io) {
      globalThis.__CONCORD_REALTIME__.io.to(`world:${worldId}`).emit("world:season-transition", {
        worldId,
        seasonIdx: expected.idx,
        seasonName: expected.name,
        year: expectedYear,
        narrative: expected.narrative,
        ts: Date.now(),
      });
    }
  } catch { /* socket optional */ }

  return { ok: true, transitioned: true, season: expected.name, year: expectedYear, narrative: expected.narrative };
}

function insertSeasonEvent(db, worldId, seasonIdx, yearN, eventKind, narrative) {
  try {
    db.prepare(`
      INSERT INTO season_events (id, world_id, season_idx, year_n, event_kind, narrative, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    `).run(`se_${crypto.randomUUID()}`, worldId, seasonIdx, yearN, eventKind, narrative);
  } catch (err) {
    try { logger.debug?.("seasons", "event_insert_failed", { error: err?.message }); }
    catch { /* ignore */ }
  }
}

/**
 * Read API for the env-sensor: returns the season's bias on
 * (temperature, humidity, light) which is added on top of the world's
 * authored climate.
 */
export function seasonalBias(db, worldId, now = Date.now()) {
  // We could read from world_seasons but seasonFor(now) is canonical;
  // the persisted row only differs at transition boundaries.
  const s = seasonFor(now);
  return {
    season: s.name,
    tempBias: s.tempBias,
    humidityBias: s.humidityBias,
    lightBias: s.lightBias,
    narrative: s.narrative,
  };
}

/**
 * Yield modulator for the gather route. Multiplies the base yield by
 * the season-specific factor for the resource. Defaults to 1.0.
 */
export function seasonalYieldMultiplier(resourceKind, now = Date.now()) {
  const s = seasonFor(now);
  const table = SEASON_NODE_YIELD_MULT[s.name] || {};
  return Number(table[resourceKind] ?? table.default ?? 1.0);
}

/**
 * Listing/UI helper: recent season events for a world.
 */
export function getRecentSeasonEvents(db, worldId, limit = 20) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT id, world_id, season_idx, year_n, event_kind, narrative, occurred_at
      FROM season_events WHERE world_id = ?
      ORDER BY occurred_at DESC LIMIT ?
    `).all(worldId, limit);
  } catch { return []; }
}

export const _internal = {
  SEASON_LENGTH_DAYS,
  SEASON_LENGTH_S,
  insertSeasonEvent,
};
