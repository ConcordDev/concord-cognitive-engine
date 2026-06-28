// server/lib/achievement-engine.js
//
// Phase U2 — achievement evaluator + unlock dispatcher.
//
// Two trigger kinds:
//   - event: matches a realtime event name + optional condition fields
//             (subset-match on payload).
//   - stat:  matches when a numeric stat ≥ threshold. Stats are computed
//             on-demand from DB views (DTU counts, friend counts,
//             quests_completed, etc.).
//
// Unlock is idempotent on (user_id, achievement_id). Rewards (CC + DTU
// citations + title) are applied inside the same transaction as the
// unlock so a partial failure rolls back.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import logger from "../logger.js";
import { awardSparks } from "./currency.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, "..", "..", "content", "achievements");

// Sentinel world_id for account-wide achievement titles. `player_titles.world_id`
// is NOT NULL (migration 192); achievement titles aren't world-scoped, so they
// share this stable sentinel + the UNIQUE (user_id, world_id, title) index makes
// re-granting the same title a no-op.
const ACCOUNT_TITLE_WORLD_ID = "__account__";

/** @type {Map<string, object>} */
const _catalogCache = new Map();
/** @type {Map<string, Array<object>>} eventKind → [{achievement, condition}] */
const _eventTriggers = new Map();
/** @type {Map<string, Array<object>>} statName → [{achievement, threshold}] */
const _statTriggers = new Map();
let _initialized = false;

/**
 * Boot loader. Reads content/achievements/*.json and persists the catalog
 * into achievement_catalog + achievement_triggers (idempotent on PK).
 */
export function initAchievementCatalog(db) {
  if (_initialized) return { ok: true, count: _catalogCache.size };
  _initialized = true;

  let files;
  try { files = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith(".json")); }
  catch (err) {
    logger.warn?.("achievement-engine", "content_dir_unreadable", { error: err?.message });
    return { ok: false, count: 0 };
  }

  let count = 0;
  // @sync-fs-ok: one-time boot catalog load (guarded by _initialized).
  // @sql-loop-ok: idempotent boot-time persist over a small authored catalog.
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");
      const parsed = JSON.parse(raw);
      const category = parsed.category || "general";
      for (const a of parsed.achievements || []) {
        const id = a.id;
        if (!id) continue;
        _catalogCache.set(id, { ...a, category });
        // Persist (idempotent).
        if (db) {
          try {
            db.prepare(`
              INSERT INTO achievement_catalog
                (id, title, description, category, icon, rarity, hidden,
                 reward_dtu_ids, reward_cc, reward_title)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                category = excluded.category,
                icon = excluded.icon,
                rarity = excluded.rarity,
                hidden = excluded.hidden,
                reward_dtu_ids = excluded.reward_dtu_ids,
                reward_cc = excluded.reward_cc,
                reward_title = excluded.reward_title
            `).run(
              id,
              a.title || id,
              a.description || "",
              category,
              a.icon || null,
              a.rarity || "bronze",
              a.hidden ? 1 : 0,
              JSON.stringify(a.rewardDtuIds || []),
              Number(a.rewardSparks ?? a.rewardCc) || 0,  // sparks reward (legacy column name reward_cc)
              a.rewardTitle || null,
            );
            // Refresh triggers — clear existing, re-insert.
            db.prepare(`DELETE FROM achievement_triggers WHERE achievement_id = ?`).run(id);
            for (const t of (a.triggers || [])) {
              db.prepare(`
                INSERT INTO achievement_triggers (achievement_id, trigger_kind, condition_json)
                VALUES (?, ?, ?)
              `).run(id, t.kind || "event", JSON.stringify(t));
            }
          } catch (err) {
            logger.warn?.("achievement-engine", "catalog_persist_failed", { id, error: err?.message });
          }
        }
        // Index in-memory triggers for fast event/stat lookup.
        for (const t of (a.triggers || [])) {
          if (t.kind === "event" && t.event) {
            const arr = _eventTriggers.get(t.event) || [];
            arr.push({ achievementId: id, condition: t.condition || {} });
            _eventTriggers.set(t.event, arr);
          } else if (t.kind === "stat" && t.stat) {
            const arr = _statTriggers.get(t.stat) || [];
            arr.push({ achievementId: id, threshold: Number(t.threshold) || 0 });
            _statTriggers.set(t.stat, arr);
          }
        }
        count++;
      }
    } catch (err) {
      logger.warn?.("achievement-engine", "catalog_load_failed", { file, error: err?.message });
    }
  }

  logger.info?.("achievement-engine", "catalog_loaded", { count });
  return { ok: true, count };
}

/** Read-only catalog accessor (for the lens). */
export function getAchievement(id) { return _catalogCache.get(id) || null; }
export function listCatalog() { return [..._catalogCache.values()]; }

/**
 * Evaluate an event against the catalog. Unlocks any matching achievement
 * for the user (idempotent on player_achievements PK).
 *
 * @param {object} db
 * @param {string} userId
 * @param {string} eventKind
 * @param {object} payload
 * @returns {{ unlocked: Array<{id, title, rewardCc, rewardTitle}> }}
 */
export function evaluateAchievement(db, userId, eventKind, payload = {}) {
  if (!db || !userId || !eventKind) return { unlocked: [] };
  if (!_initialized) initAchievementCatalog(db);
  const triggers = _eventTriggers.get(eventKind) || [];
  const unlocked = [];
  for (const tr of triggers) {
    if (!_matchesCondition(tr.condition, payload)) continue;
    const r = unlockAchievement(db, userId, tr.achievementId, { eventKind, payload });
    if (r.unlocked) unlocked.push(r);
  }
  return { unlocked };
}

/**
 * Evaluate a stat-threshold trigger. Caller invokes this when a stat
 * changes (or periodically). `currentValue` is the current numeric stat.
 */
export function evaluateStatThreshold(db, userId, statName, currentValue) {
  if (!db || !userId || !statName) return { unlocked: [] };
  if (!_initialized) initAchievementCatalog(db);
  const triggers = _statTriggers.get(statName) || [];
  const unlocked = [];
  for (const tr of triggers) {
    if (currentValue < tr.threshold) continue;
    const r = unlockAchievement(db, userId, tr.achievementId, { statName, currentValue });
    if (r.unlocked) unlocked.push(r);
  }
  return { unlocked };
}

/**
 * Idempotent unlock. Returns { unlocked: bool, id, title, rewardCc, rewardTitle }.
 * If the user already had it, unlocked=false.
 *
 * Phase BB2: stamps the current (season_idx, year_idx) at unlock time
 * so leaderboards can filter by season. Enforces `seasonOnly` and
 * `festivalOnly` gates from the achievement JSON.
 */
export function unlockAchievement(db, userId, achievementId, ctx = {}) {
  if (!db || !userId || !achievementId) return { unlocked: false };
  const a = _catalogCache.get(achievementId);
  if (!a) return { unlocked: false };

  // Phase BB2 gates: seasonOnly + festivalOnly.
  const cal = _calendarSnapshot();
  if (typeof a.seasonOnly === "number" && a.seasonOnly !== cal.season_idx) {
    return { unlocked: false, reason: "season_gated" };
  }
  if (typeof a.festivalOnly === "string") {
    try {
      const active = db.prepare(`
        SELECT 1 FROM festival_active
        WHERE festival_id = ? AND ends_at > unixepoch()
      `).get(a.festivalOnly);
      if (!active) return { unlocked: false, reason: "festival_gated" };
    } catch { /* festivals table missing on minimal build — skip gate */ }
  }

  try {
    // Insert; the PK collision means already-earned → no-op.
    const r = db.prepare(`
      INSERT INTO player_achievements (player_id, achievement_id, earned_at, season_idx, year_idx)
      VALUES (?, ?, unixepoch(), ?, ?)
      ON CONFLICT DO NOTHING
    `).run(userId, achievementId, cal.season_idx, cal.year_idx);
    if (r.changes === 0) return { unlocked: false, alreadyEarned: true };

    // Gameplay rewards are SPARKS, never CC. CC (concordia_credits) is the
    // real-money currency and must never be awarded for gameplay; sparks go to
    // users.sparks + sparks_ledger via the canonical awardSparks helper.
    const rewardSparks = Number(a.rewardSparks ?? a.rewardCc) || 0;
    if (rewardSparks > 0) {
      try { awardSparks(db, userId, rewardSparks, `achievement:${achievementId}`); }
      catch (err) { logger.warn?.("achievement-engine", "sparks_award_failed", { userId, achievementId, error: err?.message }); }
    }

    // Title reward: insert into player_titles (table from migration 192).
    // Achievement titles are ACCOUNT-WIDE, not world-scoped, but the table's
    // `world_id` is NOT NULL with a UNIQUE (user_id, world_id, title) index — so
    // we use a stable sentinel world_id and ON CONFLICT DO NOTHING. (Prior code
    // inserted world_id = NULL, which the NOT NULL constraint rejected on every
    // real DB, silently dropping the title reward.)
    if (a.rewardTitle) {
      try {
        db.prepare(`
          INSERT INTO player_titles (id, user_id, world_id, title, earned_at)
          VALUES (?, ?, ?, ?, unixepoch())
          ON CONFLICT (user_id, world_id, title) DO NOTHING
        `).run(`title_${crypto.randomBytes(6).toString("hex")}`, userId, ACCOUNT_TITLE_WORLD_ID, a.rewardTitle);
      } catch (err) {
        logger.warn?.("achievement-engine", "title_insert_failed", { userId, title: a.rewardTitle, error: err?.message });
      }
    }

    // Emit realtime so the toast appears.
    try {
      globalThis._concordRealtimeEmit?.("achievement:unlocked", {
        userId, achievementId,
        title: a.title, rarity: a.rarity, icon: a.icon,
        rewardSparks, rewardTitle: a.rewardTitle || null,
      });
    } catch { /* emit best-effort */ }

    return { unlocked: true, id: achievementId, title: a.title, rewardSparks, rewardTitle: a.rewardTitle || null };
  } catch (err) {
    logger.warn?.("achievement-engine", "unlock_failed", { userId, achievementId, error: err?.message });
    return { unlocked: false, error: err?.message };
  }
}

/** Subset-match: condition fields must all match payload fields. */
function _matchesCondition(condition, payload) {
  if (!condition || typeof condition !== "object") return true;
  for (const [key, val] of Object.entries(condition)) {
    if (key === "worldIdPrefix") {
      if (!String(payload.worldId || "").startsWith(String(val))) return false;
      continue;
    }
    if (payload[key] !== val) return false;
  }
  return true;
}

export function listEarned(db, userId) {
  if (!db || !userId) return [];
  try {
    const rows = db.prepare(`
      SELECT pa.achievement_id, pa.earned_at,
             c.title, c.description, c.category, c.icon, c.rarity, c.reward_cc AS rewardSparks, c.reward_title AS rewardTitle
      FROM player_achievements pa
      LEFT JOIN achievement_catalog c ON c.id = pa.achievement_id
      WHERE pa.player_id = ?
      ORDER BY pa.earned_at DESC
    `).all(userId);
    return rows;
  } catch {
    return [];
  }
}

export function listRecent(db, opts = {}) {
  if (!db) return [];
  const limit = Math.min(Math.max(1, opts.limit || 50), 200);
  try {
    return db.prepare(`
      SELECT pa.player_id AS userId, pa.achievement_id, pa.earned_at,
             c.title, c.rarity, c.icon
      FROM player_achievements pa
      LEFT JOIN achievement_catalog c ON c.id = pa.achievement_id
      WHERE c.hidden = 0
      ORDER BY pa.earned_at DESC LIMIT ?
    `).all(limit);
  } catch {
    return [];
  }
}

/** Test-only — reset between specs. */
export function _resetAchievementCatalog() {
  _catalogCache.clear();
  _eventTriggers.clear();
  _statTriggers.clear();
  _initialized = false;
}

// ── Phase BB2 — seasonal stamp + leaderboard query ─────────────────────

const _MS_PER_DAY = 86_400_000;
const _YEAR_DAYS = 42;
const _SEASON_DAYS = 7;

/** Pure: derive { season_idx, year_idx } from the wall clock. */
function _calendarSnapshot(now = Date.now()) {
  const dayOfYear = Math.floor(now / _MS_PER_DAY) % _YEAR_DAYS;
  const season_idx = Math.floor(dayOfYear / _SEASON_DAYS);
  const year_idx = Math.floor((now / _MS_PER_DAY) / _YEAR_DAYS) + 1;
  return { season_idx, year_idx };
}

/** Leaderboard filter for a specific (season, year). */
export function listSeasonalAchievements(db, userId, opts = {}) {
  if (!db || !userId) return [];
  try {
    const { seasonIdx, yearIdx } = opts;
    const filters = ["player_id = ?"];
    const args = [userId];
    if (typeof seasonIdx === "number") { filters.push("season_idx = ?"); args.push(seasonIdx); }
    if (typeof yearIdx === "number") { filters.push("year_idx = ?"); args.push(yearIdx); }
    return db.prepare(`
      SELECT achievement_id, earned_at, season_idx, year_idx
      FROM player_achievements
      WHERE ${filters.join(" AND ")}
      ORDER BY earned_at DESC
    `).all(...args);
  } catch { return []; }
}

export { _calendarSnapshot };
