// @sync-fs-ok: lazy, memoized per-world calendar.json load (`_calendarCache`)
// — the same cached-content-load pattern as `world-flavor.js`'s loops.json,
// which carries the same annotation. One small read per world per process,
// never a per-request read.
// server/lib/world-calendar.js
//
// Per-world calendar overrides for the Layer 7 day/night clock.
//
// `world-kit-templates.js#calendarTemplate` scaffolds `hours_per_day` +
// `day_phases` into `content/world/<world>/calendar.json` for any world
// that wants a non-standard day (tunya: 32h "diurnal", cyber: 28h "Grid
// day", sere: 24h with authored phase names). Until this module existed,
// nothing at runtime read the file back — the environment-sensor
// heartbeat always assumed a hardcoded 24h day with generic
// night/dawn/day/dusk phase names.
//
// This module loads + caches those files (same directory-scan-on-first-
// read pattern as `world-flavor.js`'s loops.json) and exposes:
//   - getWorldCalendar(worldId)  → the parsed { hoursPerDay, dayPhases } or null
//   - resolveDayPhase(...)       → pure phase-lookup given an hour-of-day
//   - worldDayConfig(worldId)    → the effective { hoursPerDay, secondsPerDay, phases },
//                                   defaulting to the standard 24h/no-override
//                                   shape for any world without a calendar.json
//
// Worlds without `content/world/<id>/calendar.json` are completely
// unaffected — worldDayConfig() returns exactly the pre-existing 24h
// default and callers fall back to their original hardcoded phase logic.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORLD_CONTENT_ROOT = path.resolve(__dirname, "..", "..", "content", "world");

export const DEFAULT_HOURS_PER_DAY = 24;

/** @type {Map<string, { hoursPerDay: number, dayPhases: object[] } | null>} */
const _calendarCache = new Map();

function _loadCalendarFile(worldId) {
  const calPath = path.join(WORLD_CONTENT_ROOT, worldId, "calendar.json");
  if (!fs.existsSync(calPath)) return null;
  try {
    const raw = fs.readFileSync(calPath, "utf8");
    const parsed = JSON.parse(raw);
    const hoursPerDay = Number(parsed?.hours_per_day);
    if (!Number.isFinite(hoursPerDay) || hoursPerDay <= 0) return null;
    const dayPhases = Array.isArray(parsed?.day_phases)
      ? parsed.day_phases.filter((p) => p && p.id
          && Number.isFinite(Number(p.start_hour)) && Number.isFinite(Number(p.end_hour)))
      : [];
    return { hoursPerDay, dayPhases };
  } catch (err) {
    logger.warn("world-calendar", "calendar_load_failed", { worldId, error: err?.message });
    return null;
  }
}

/**
 * Returns the parsed `{ hoursPerDay, dayPhases }` for a world, or `null`
 * if the world has no `calendar.json` (or it's missing/malformed
 * `hours_per_day`). Cached per worldId for the process lifetime —
 * calendar files are static authored content, not runtime state.
 */
export function getWorldCalendar(worldId) {
  if (!worldId) return null;
  if (_calendarCache.has(worldId)) return _calendarCache.get(worldId);
  const cal = _loadCalendarFile(worldId);
  _calendarCache.set(worldId, cal);
  return cal;
}

/**
 * Resolve which `day_phases` entry an hour-of-day falls into.
 *
 * `hourOfDay` is a 0-indexed real number (0 <= hourOfDay < hoursPerDay).
 * Phases declare 1-indexed *inclusive* `start_hour`/`end_hour`, matching
 * `calendarTemplate`'s schema (a 24h world's phases partition 1..24, a
 * 28h world's partition 1..28, etc). Handles wraparound phases (e.g. a
 * night-watch declared `start_hour: 21, end_hour: 4`).
 *
 * Returns `null` if no phase matches (defensive — a well-formed calendar
 * fully partitions 1..hoursPerDay so this shouldn't happen in practice).
 */
export function resolveDayPhase(hourOfDay, hoursPerDay, phases) {
  if (!Array.isArray(phases) || phases.length === 0) return null;
  const hpd = hoursPerDay > 0 ? hoursPerDay : DEFAULT_HOURS_PER_DAY;
  // Normalize to 1..hpd (template hours are 1-indexed).
  const h = (((Math.floor(hourOfDay) % hpd) + hpd) % hpd) + 1;
  for (const p of phases) {
    const s = Number(p.start_hour);
    const e = Number(p.end_hour);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (s <= e) {
      if (h >= s && h <= e) return p;
    } else {
      // Wraps past the end of the day (e.g. 21 → 4).
      if (h >= s || h <= e) return p;
    }
  }
  return null;
}

/**
 * The effective day config for a world: `{ hoursPerDay, secondsPerDay, phases }`.
 *
 * `secondsPerDay` scales proportionally with `hoursPerDay` (each in-world
 * hour is still 3600 real seconds — a 28-hour world's day/night cycle
 * genuinely takes longer wall-clock time to complete than a 24-hour
 * world's, not just a relabeled clock).
 *
 * Worlds without a calendar.json (or a malformed one) get
 * `{ hoursPerDay: 24, secondsPerDay: 86400, phases: null }` — callers
 * MUST treat a null `phases` as "use the original hardcoded phase
 * brackets", which keeps those worlds byte-identical to the pre-calendar
 * behavior.
 */
export function worldDayConfig(worldId) {
  const cal = getWorldCalendar(worldId);
  const hoursPerDay = cal && cal.hoursPerDay > 0 ? cal.hoursPerDay : DEFAULT_HOURS_PER_DAY;
  const phases = cal && cal.dayPhases && cal.dayPhases.length > 0 ? cal.dayPhases : null;
  return { hoursPerDay, secondsPerDay: hoursPerDay * 3600, phases };
}

/** Test-only reset between specs. */
export function _resetWorldCalendars() {
  _calendarCache.clear();
}
