// server/lib/foundry/status-window.js
//
// Foundry Phase 7 — Status Window (isekai-style).
//
// A world-adaptive character status panel. The world's status-window
// config carries style (classic-rpg / minimal / ornate / sci-fi-hud),
// showHiddenStats, and titleSystem.
//
// This module owns the earnable-titles substrate (player_titles) and
// the composition that assembles a status object the frontend renders.
// It does NOT hard-depend on every player-stat table existing — the
// caller passes already-fetched stats/skills/effects in via `sources`,
// so the lib stays testable and decoupled from schema drift. Titles,
// which Phase 7 owns, are queried directly.

import { randomUUID } from "node:crypto";

const VALID_STYLES = ["classic-rpg", "minimal", "ornate", "sci-fi-hud"];

const DEFAULT_CONFIG = Object.freeze({
  style: "classic-rpg",
  showHiddenStats: false,
  titleSystem: true,
});

function cfg(c) {
  const merged = { ...DEFAULT_CONFIG, ...(c && typeof c === "object" ? c : {}) };
  if (!VALID_STYLES.includes(merged.style)) merged.style = DEFAULT_CONFIG.style;
  return merged;
}

/**
 * Award a title to a player in a world. Idempotent — the unique index
 * on (user_id, world_id, title) means re-awarding is a no-op.
 * @returns {{ ok, awarded }}  awarded=false if they already had it
 */
export function awardTitle(db, userId, worldId, title) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId || !worldId || !title) return { ok: false, reason: "missing_args" };
  const clean = String(title).trim().slice(0, 80);
  if (!clean) return { ok: false, reason: "empty_title" };
  try {
    const r = db.prepare(`
      INSERT INTO player_titles (id, user_id, world_id, title, earned_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, world_id, title) DO NOTHING
    `).run(`title_${randomUUID().replace(/-/g, "").slice(0, 16)}`, userId, worldId, clean, Date.now());
    return { ok: true, awarded: r.changes > 0, title: clean };
  } catch (e) {
    return { ok: false, reason: "award_failed", error: String(e?.message || e) };
  }
}

/** A player's earned titles in a world, newest first. */
export function listTitles(db, userId, worldId) {
  if (!db || !userId || !worldId) return [];
  return db.prepare(`
    SELECT title, earned_at FROM player_titles
    WHERE user_id = ? AND world_id = ? ORDER BY earned_at DESC
  `).all(userId, worldId).map((r) => ({ title: r.title, earnedAt: r.earned_at }));
}

/**
 * Compose the world-adaptive status window for a player.
 *
 * @param {object} db
 * @param {string} userId
 * @param {string} worldId
 * @param {object} worldConfig  — rule_modulators.status_window
 * @param {object} [sources]    — caller-supplied stat data, all optional:
 *   { stats: {hp,stamina,...}, skills: [{id,level}], effects: [...],
 *     inventoryCount: n, hiddenStats: {...} }
 * @returns {{ ok, window }}
 */
export function composeStatusWindow(db, userId, worldId, worldConfig, sources = {}) {
  const c = cfg(worldConfig);
  const titles = c.titleSystem ? listTitles(db, userId, worldId) : [];
  const s = sources && typeof sources === "object" ? sources : {};

  const window = {
    style: c.style,
    userId,
    worldId,
    titles: titles.map((t) => t.title),
    activeTitle: titles[0]?.title ?? null,
    stats: s.stats && typeof s.stats === "object" ? s.stats : {},
    skills: Array.isArray(s.skills) ? s.skills : [],
    effects: Array.isArray(s.effects) ? s.effects : [],
    inventoryCount: Number.isFinite(s.inventoryCount) ? s.inventoryCount : 0,
  };
  // Hidden stats only surface when the world opts in.
  if (c.showHiddenStats && s.hiddenStats && typeof s.hiddenStats === "object") {
    window.hiddenStats = s.hiddenStats;
  }
  return { ok: true, window };
}

export const STATUS_WINDOW_INTERNALS = Object.freeze({ DEFAULT_CONFIG, VALID_STYLES });
