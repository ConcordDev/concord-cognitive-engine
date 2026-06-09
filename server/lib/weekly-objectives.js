// server/lib/weekly-objectives.js
//
// D2 — weekly meta objective chain. A small set of objectives per ISO week,
// progressed by REAL gameplay events (combat kills, market sales, quests,
// DTU creation, boss kills) routed through the achievement bridge. Reward CC
// is claimed once per objective; the chain resets implicitly each week because
// every row is scoped by `week_key`.
//
// No fake data: progress only moves on events the engine genuinely emits.

import crypto from "crypto";

// ── Catalog ──────────────────────────────────────────────────────────────────
// `kind` is the internal objective kind; events map onto it via EVENT_TO_KIND.
export const WEEKLY_OBJECTIVE_CATALOG = [
  { objectiveId: "weekly_slayer",   title: "Weekly Slayer",    description: "Defeat 25 foes this week",        kind: "combat_kill",  target: 25, rewardCc: 120 },
  { objectiveId: "weekly_trader",   title: "Weekly Trader",    description: "Complete 5 marketplace sales",     kind: "market_sale",  target: 5,  rewardCc: 150 },
  { objectiveId: "weekly_scholar",  title: "Weekly Scholar",   description: "Author 15 DTUs this week",          kind: "dtu_created",  target: 15, rewardCc: 100 },
  { objectiveId: "weekly_quester",  title: "Weekly Quester",   description: "Complete 8 quests",                kind: "quest_done",   target: 8,  rewardCc: 130 },
  { objectiveId: "weekly_bosshunt", title: "Weekly Boss Hunt", description: "Fell 3 world or dungeon bosses",   kind: "boss_felled",  target: 3,  rewardCc: 200 },
];

// Real engine events → objective kind.
const EVENT_TO_KIND = {
  "combat:kill": "combat_kill",
  "marketplace:sold": "market_sale",
  "auction:settled": "market_sale",
  "dtu:created": "dtu_created",
  "dtu:promoted": "dtu_created",
  "quest:completed": "quest_done",
  "boss:defeated": "boss_felled",
};

// ── Week key ───────────────────────────────────────────────────────────────
/** ISO-8601 year-week string, e.g. '2026-W22'. Deterministic from a ms timestamp. */
export function currentWeekKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  // ISO week: Thursday-anchored.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((target - firstThursday) / (7 * 86400000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function tableExists(db) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='weekly_objectives'").get(); }
  catch { return false; }
}

// ── Seed / read ──────────────────────────────────────────────────────────────
/** Idempotently seed the user's objectives for the current week. Returns rows. */
export function ensureWeek(db, userId, nowMs = Date.now()) {
  if (!db || !userId || !tableExists(db)) return [];
  const weekKey = currentWeekKey(nowMs);
  const insert = db.prepare(`
    INSERT INTO weekly_objectives (id, user_id, week_key, objective_id, title, description, kind, target, reward_cc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, week_key, objective_id) DO NOTHING
  `);
  const seed = db.transaction(() => {
    for (const o of WEEKLY_OBJECTIVE_CATALOG) {
      insert.run(
        `wo_${crypto.randomBytes(6).toString("hex")}`,
        userId, weekKey, o.objectiveId, o.title, o.description, o.kind, o.target, o.rewardCc,
      );
    }
  });
  seed();
  return getWeeklyObjectives(db, userId, nowMs);
}

/** Current-week objectives with progress for a user (auto-seeds the week). */
export function getWeeklyObjectives(db, userId, nowMs = Date.now()) {
  if (!db || !userId || !tableExists(db)) return [];
  const weekKey = currentWeekKey(nowMs);
  return db.prepare(`
    SELECT objective_id AS objectiveId, title, description, kind, progress, target,
           reward_cc AS rewardCc, completed_at AS completedAt, claimed_at AS claimedAt
    FROM weekly_objectives
    WHERE user_id = ? AND week_key = ?
    ORDER BY objective_id ASC
  `).all(userId, weekKey).map((r) => ({
    ...r,
    completed: r.completedAt != null,
    claimed: r.claimedAt != null,
    pct: r.target > 0 ? Math.min(1, r.progress / r.target) : 0,
  }));
}

// ── Progress ───────────────────────────────────────────────────────────────
/**
 * Bump progress on the current week's objectives matching `kind`. Stamps
 * completed_at when the target is reached. Idempotently auto-seeds the week.
 * Returns the list of objectiveIds that newly completed on this call.
 */
export function recordObjectiveProgress(db, userId, kind, amount = 1, nowMs = Date.now()) {
  if (!db || !userId || !kind || !tableExists(db)) return { ok: false, completed: [] };
  const weekKey = currentWeekKey(nowMs);
  // Ensure the week exists so the very first event of a week still counts.
  ensureWeek(db, userId, nowMs);
  const now = Math.floor(nowMs / 1000);
  const rows = db.prepare(`
    SELECT id, progress, target, completed_at FROM weekly_objectives
    WHERE user_id = ? AND week_key = ? AND kind = ? AND completed_at IS NULL
  `).all(userId, weekKey, kind);
  const completed = [];
  // Hoist the two prepared statements out of the loop (was a per-row re-prepare).
  const stmtComplete = db.prepare(`UPDATE weekly_objectives SET progress = ?, completed_at = ? WHERE id = ?`);
  const stmtProgress = db.prepare(`UPDATE weekly_objectives SET progress = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const r of rows) {
      const next = Math.min(r.target, r.progress + Math.max(0, amount));
      if (next >= r.target) {
        stmtComplete.run(next, now, r.id);
        completed.push(r.id);
      } else {
        stmtProgress.run(next, r.id);
      }
    }
  });
  tx();
  return { ok: true, completed };
}

/** Map a realtime event kind → objective kind, then record progress. */
export function recordObjectiveProgressFromEvent(db, userId, eventKind, nowMs = Date.now()) {
  const kind = EVENT_TO_KIND[eventKind];
  if (!kind) return { ok: false, completed: [] };
  return recordObjectiveProgress(db, userId, kind, 1, nowMs);
}

// ── Claim ────────────────────────────────────────────────────────────────────
/** Credit a completed objective's reward CC once. Idempotent on claimed_at. */
export function claimObjectiveReward(db, userId, objectiveId, nowMs = Date.now()) {
  if (!db || !userId || !objectiveId || !tableExists(db)) return { ok: false, reason: "no_db" };
  const weekKey = currentWeekKey(nowMs);
  const row = db.prepare(`
    SELECT id, reward_cc, completed_at, claimed_at FROM weekly_objectives
    WHERE user_id = ? AND week_key = ? AND objective_id = ?
  `).get(userId, weekKey, objectiveId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.completed_at == null) return { ok: false, reason: "not_completed" };
  if (row.claimed_at != null) return { ok: false, reason: "already_claimed" };
  const now = Math.floor(nowMs / 1000);
  const tx = db.transaction(() => {
    db.prepare(`UPDATE weekly_objectives SET claimed_at = ? WHERE id = ?`).run(now, row.id);
    _walletCredit(db, userId, row.reward_cc, `weekly_objective:${weekKey}:${objectiveId}`);
  });
  tx();
  return { ok: true, rewardCc: row.reward_cc };
}

function _walletCredit(db, userId, amount, reason) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  try {
    db.prepare(`
      UPDATE users SET concordia_credits = concordia_credits + ? WHERE id = ?
    `).run(amount, userId);
    try {
      db.prepare(`
        INSERT INTO reward_ledger (id, user_id, kind, amount_cc, ts, ref_id)
        VALUES (?, ?, 'weekly_objective_credit', ?, unixepoch(), ?)
      `).run(`led_${crypto.randomBytes(6).toString("hex")}`, userId, amount, reason);
    } catch { /* ledger optional */ }
  } catch { /* wallet table may not exist on minimal builds */ }
}
