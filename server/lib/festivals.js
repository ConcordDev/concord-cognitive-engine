// @sync-fs-ok: one-time festival-content load at init. Sync fs in this file is intentional and not on the user request path (audited 2026-06).
// server/lib/festivals.js
//
// Phase BB1 — annual festival engine.
//
// Festivals are calendrical, not ruler-issued. Each one declares a
// (season_idx, day_in_season_start..end) window. The festival-trigger
// heartbeat (server/emergent/festival-trigger-cycle.js) checks the
// current day-of-year against every festival row, opens any matches
// (idempotent on (festival_id, world_id, year_idx)), and emits
// `festival:started`. On window-end, emits `festival:ended` + leaves
// the festival_active row in place as the historical record.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, "..", "..", "content", "festivals");

const SEASON_LENGTH_DAYS = 7;
const YEAR_LENGTH_DAYS = SEASON_LENGTH_DAYS * 6;
const MS_PER_DAY = 86_400_000;

/**
 * Pure: derive { season_idx, day_in_season, year_idx } from a ms timestamp.
 * Mirrors seasons.js#seasonFor + yearFor but exposes day_in_season too.
 */
export function calendarFor(now = Date.now()) {
  const dayOfYear = Math.floor(now / MS_PER_DAY) % YEAR_LENGTH_DAYS;
  const season_idx = Math.floor(dayOfYear / SEASON_LENGTH_DAYS);
  const day_in_season = dayOfYear % SEASON_LENGTH_DAYS;
  const year_idx = Math.floor((now / MS_PER_DAY) / YEAR_LENGTH_DAYS) + 1;
  return { season_idx, day_in_season, year_idx, dayOfYear };
}

/**
 * Load and persist all content/festivals/*.json into the festivals
 * table. Idempotent on PK — re-running is safe. Returns count loaded.
 */
export function loadFestivalsFromContent(db) {
  if (!db) return { ok: false, error: "no_db" };
  let loaded = 0;
  let files;
  try {
    files = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith(".json"));
  } catch {
    return { ok: true, loaded: 0, reason: "content_dir_missing" };
  }
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), "utf8"));
      if (!parsed.id || typeof parsed.season_idx !== "number") continue;
      db.prepare(`
        INSERT INTO festivals
          (id, name, season_idx, day_in_season_start, day_in_season_end,
           repeats_yearly, decoration_tag, content_pack)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          season_idx = excluded.season_idx,
          day_in_season_start = excluded.day_in_season_start,
          day_in_season_end = excluded.day_in_season_end,
          decoration_tag = excluded.decoration_tag,
          content_pack = excluded.content_pack
      `).run(
        parsed.id,
        parsed.name || parsed.id,
        parsed.season_idx,
        parsed.day_in_season_start ?? 0,
        parsed.day_in_season_end ?? (parsed.day_in_season_start ?? 0),
        parsed.repeats_yearly === false ? 0 : 1,
        parsed.decoration_tag || null,
        file,
      );
      loaded++;
    } catch (err) {
      logger.warn?.("festivals", "load_failed", { file, error: err?.message });
    }
  }
  return { ok: true, loaded };
}

/** All festivals registered in the DB. */
export function listFestivals(db) {
  if (!db) return [];
  try {
    return db.prepare(`SELECT * FROM festivals`).all();
  } catch { return []; }
}

/**
 * Trigger a pass: open any festival whose window contains the current
 * (season_idx, day_in_season). Idempotent on (festival_id, world_id,
 * year_idx) — re-pass on the same day is a no-op.
 */
export function runFestivalTriggerPass(db, worldId, opts = {}) {
  if (!db || !worldId) return { ok: false, error: "missing_inputs" };
  const now = opts.now || Date.now();
  const cal = calendarFor(now);
  let opened = [];

  try {
    const festivals = db.prepare(`SELECT * FROM festivals`).all();
    for (const f of festivals) {
      const inWindow =
        f.season_idx === cal.season_idx &&
        cal.day_in_season >= f.day_in_season_start &&
        cal.day_in_season <= f.day_in_season_end;
      if (!inWindow) continue;
      const endsAtDay = (cal.dayOfYear - cal.day_in_season) + f.day_in_season_end;
      // ends_at = midnight after the last day of the window.
      const yearStartMs = Math.floor(now / MS_PER_DAY) * MS_PER_DAY -
                          (cal.dayOfYear * MS_PER_DAY);
      const endsAtMs = yearStartMs + (endsAtDay + 1) * MS_PER_DAY;
      try {
        const r = db.prepare(`
          INSERT INTO festival_active
            (festival_id, world_id, year_idx, ends_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(festival_id, world_id, year_idx) DO NOTHING
        `).run(f.id, worldId, cal.year_idx, Math.floor(endsAtMs / 1000));
        if (r.changes > 0) opened.push({ festivalId: f.id, name: f.name });
      } catch (err) {
        logger.debug?.("festivals", "open_failed", { festivalId: f.id, error: err?.message });
      }
    }
    return { ok: true, opened, calendar: cal };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/** Festivals currently active in a world (ends_at > now). */
export function listActiveFestivals(db, worldId, now = Date.now()) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT fa.festival_id, fa.world_id, fa.year_idx, fa.started_at, fa.ends_at,
             f.name, f.decoration_tag
      FROM festival_active fa
      JOIN festivals f ON f.id = fa.festival_id
      WHERE fa.world_id = ? AND fa.ends_at > ?
      ORDER BY fa.started_at DESC
    `).all(worldId, Math.floor(now / 1000));
  } catch { return []; }
}

export { YEAR_LENGTH_DAYS, SEASON_LENGTH_DAYS };
