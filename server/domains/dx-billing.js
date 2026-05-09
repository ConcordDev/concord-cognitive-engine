// server/domains/dx-billing.js
//
// DX Platform Phase A1 — read-only macros for the per-call billing
// surface. Plugin / web users hit these to render usage charts, top-up
// CTAs, and the status-bar quota indicator.
//
// All macros are read-only (no wallet mutation here — billing.* is
// surfaced by the `macro:afterExecute` hook calling `billMacroCall`
// directly). These are registered into `publicReadDomains` so they're
// callable with a JWT or with a plugin API key carrying the
// `billing.balance` scope.

import { listUserQuotas, limitForMacro } from "../lib/macro-quota.js";
import { costForMacro } from "../lib/macro-billing.js";

const HOUR_S = 3600;
const DAY_S  = 86400;
const WEEK_S = 604800;

export default function registerDxBillingMacros(register) {
  // billing.usage — per-day breakdown of macro_call_log for the caller.
  // Default lookback = 7 days. Returns `{ ok, days: [{ ts_day, count, cost }] }`.
  register("billing", "usage", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const lookbackS = Math.max(HOUR_S, Math.min(input.lookbackS || WEEK_S, 90 * DAY_S));
    const since = Math.floor(Date.now() / 1000) - lookbackS;
    try {
      const rows = db.prepare(`
        SELECT
          (ts / 86400) AS ts_day,
          domain,
          macro_name,
          COUNT(*) AS calls,
          SUM(cost_units) AS cost,
          SUM(duration_ms) AS duration_ms_total,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
        FROM macro_call_log
        WHERE user_id = ? AND ts >= ?
        GROUP BY ts_day, domain, macro_name
        ORDER BY ts_day DESC, cost DESC
      `).all(userId, since);
      return { ok: true, lookbackS, rows };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }, { note: "per-day per-macro usage rollup for the caller" });

  // billing.balance — current CC wallet balance.
  // Wraps the existing economy/balances.js#getBalance.
  register("billing", "balance", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    try {
      const { getBalance } = await import("../economy/balances.js");
      const b = getBalance(db, userId);
      return { ok: true, balance: b.balance, totalCredits: b.totalCredits, totalDebits: b.totalDebits };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }, { note: "caller's CC wallet balance, derived from economy_ledger" });

  // billing.history — last N macro calls (default 100). For the plugin
  // sidebar's per-call audit trail.
  register("billing", "history", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const limit = Math.max(1, Math.min(input.limit || 100, 500));
    try {
      const rows = db.prepare(`
        SELECT id, api_key_id, domain, macro_name, cost_units, duration_ms, status, ref_id, ts
        FROM macro_call_log
        WHERE user_id = ?
        ORDER BY ts DESC
        LIMIT ?
      `).all(userId, limit);
      return { ok: true, rows };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }, { note: "last N macro calls for the caller" });

  // billing.getCurrentQuota — render the status-bar.
  register("billing", "getCurrentQuota", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, quotas: listUserQuotas(db, userId) };
  }, { note: "remaining per-macro per-minute quota for the caller" });

  // billing.priceForMacro — public read. Plugin uses this to estimate
  // cost before invoking heavy macros.
  register("billing", "priceForMacro", async (_ctx, input = {}) => {
    if (!input.domain || !input.name) return { ok: false, reason: "missing_domain_or_name" };
    return {
      ok: true,
      domain: input.domain,
      name: input.name,
      costUnits: costForMacro(input.domain, input.name),
      perMinuteLimit: limitForMacro(input.domain, input.name),
    };
  }, { note: "cost in CC + per-user per-minute limit for a given (domain, macro)" });
}
