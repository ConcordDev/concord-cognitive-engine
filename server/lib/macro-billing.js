// server/lib/macro-billing.js
//
// Per-call macro billing for the DX Platform (Phase A1).
//
// Two responsibilities:
//   1) `recordMacroCall(db, ctx)` — append a row to `macro_call_log` for
//      every macro that flowed through `runMacro()` (one row per call,
//      regardless of auth type). This is the audit trail.
//   2) `chargeMacroCall(db, ctx)` — when the call carried an
//      `api_key_id` (i.e. plugin / SDK clients), write a FEE entry to
//      `economy_ledger` debiting the user and crediting the platform
//      macro-revenue account. Idempotent via the ledger's `ref_id`.
//
// Invariants (CLAUDE.md):
//   - Wallet-debit failures MUST NOT throw out of the macro hook. Debit
//     is post-execute and best-effort. Macro execution success/failure
//     is owned by the macro itself, not by billing.
//   - Free-tier (cookie-auth, no `api_key_id`) calls log to
//     `macro_call_log` with `cost_units = 0` and DO NOT debit a wallet.
//   - Idempotency lives in `ref_id`, which is `${apiKeyId}:${callId}`.
//     A retry with the same `ref_id` is a no-op at both the macro_call_log
//     UNIQUE index and the ledger.
//
// Cost lookup: every macro is classified read|write|compute (or free)
// and priced from the tiered API_PRICING constants — see
// categoryForMacro + costForMacro below. Per-deployment overrides via
// CONCORD_MACRO_COSTS_JSON. API-key calls additionally run through a
// unified monthly free allowance shared with the HTTP-route metering
// layer (api_monthly_usage, migration 017).

import { recordTransaction, checkRefIdProcessed } from "../economy/ledger.js";
import { getFlag } from "./feature-flags.js";
import { API_CONSTANTS } from "./api-billing-constants.js";

const MACRO_REVENUE_ACCOUNT = "__platform_macro_revenue";

// ── Macro pricing ────────────────────────────────────────────────────
//
// The macro API is priced to match GPT-4.1-mini: every (domain, macro)
// pair is classified into one of three tiers and charged the matching
// per-call CC amount (Concord Coin is USD-pegged 1:1). Classification is
// name-heuristic, mirroring the LLM/read hints the behaviour smoke
// harness already uses so categorisation stays consistent across the
// codebase. An unrecognised macro defaults to `write` — the "typical
// call" middle tier.
//
//   free     0            billing/usage introspection + telemetry macros
//   read     READ_COST    get/list/search/stats/... — cheap lookups
//   write    WRITE_COST   create/update/delete/... — the default tier
//   compute  COMPUTE_COST LLM-backed + codebase-analysis macros

// Clearly-generative verbs → an LLM brain almost certainly runs.
const LLM_HINT_RE = /^(respond|chat|reply|deliberate|narrate|synthesize|generate|brainstorm|propose|critique|reason|explain|elaborate|expand|rewrite|translate|tutor|teach|answer|ask|dream|imagine|compose|debate|persuade|argue|summarize|summarise)/i;
// Read-shape verbs → cheap lookups, no mutation.
const READ_HINT_RE = /^(get|list|search|recent|stat|status|count|find|read|fetch|paginated|export|preview|facet|trending|summary|history|tally|metric|view|show|info|describe|inspect|peek|lookup|resolve|exists|catalog|browse|query)/i;
// Whole domains that are always compute-tier (codebase analysis / repair).
const HEAVY_DOMAINS = new Set(["detectors", "repair", "dx"]);
// Macros that stay free regardless of tier — billing introspection (so a
// client can always check its own balance/quota) + zero-cost telemetry
// hooks. Mirrors the old cost-map `0` entries.
const FREE_MACROS = new Set([
  "billing:usage", "billing:balance", "billing:history", "billing:getCurrentQuota",
  "repair:record_decision", "dx:registerCodebase", "dx:recordFixDecision",
]);

/**
 * Classify a macro into a billing category: free | read | write | compute.
 */
export function categoryForMacro(domain, name) {
  const d = String(domain || "");
  const n = String(name || "");
  if (FREE_MACROS.has(`${d}:${n}`)) return "free";
  if (HEAVY_DOMAINS.has(d)) return "compute";
  if (LLM_HINT_RE.test(n) || /llm|brain/i.test(n)) return "compute";
  if (READ_HINT_RE.test(n)) return "read";
  return "write";
}

const CATEGORY_COST = {
  free: 0,
  read: API_CONSTANTS.READ_COST,
  write: API_CONSTANTS.WRITE_COST,
  compute: API_CONSTANTS.COMPUTE_COST,
};

// Per-deployment explicit overrides: CONCORD_MACRO_COSTS_JSON is a JSON
// object of `"domain:macro": costInCC` pairs that wins over the tiered
// default — an escape hatch for ops without a code change.
let MACRO_COST_OVERRIDES = {};
try {
  if (process.env.CONCORD_MACRO_COSTS_JSON) {
    const parsed = JSON.parse(process.env.CONCORD_MACRO_COSTS_JSON);
    if (parsed && typeof parsed === "object") MACRO_COST_OVERRIDES = parsed;
  }
} catch (err) {
  console.warn("[macro-billing] CONCORD_MACRO_COSTS_JSON parse failed:", err.message);
}

/**
 * Cost in CC for a single macro call. An explicit override wins;
 * otherwise the tiered per-category price. Never negative; an
 * unrecognised macro falls back to the write tier.
 */
export function costForMacro(domain, name) {
  const key = `${domain}:${name}`;
  if (Object.prototype.hasOwnProperty.call(MACRO_COST_OVERRIDES, key)) {
    const v = Number(MACRO_COST_OVERRIDES[key]);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }
  return CATEGORY_COST[categoryForMacro(domain, name)] ?? API_CONSTANTS.WRITE_COST;
}

// ── Monthly free allowance ───────────────────────────────────────────
//
// API-key calls run through a unified monthly free quota shared with the
// HTTP-route metering layer via the `api_monthly_usage` table (migration
// 017). The first FREE_*_PER_MONTH calls of each category in a calendar
// month cost 0; everything after is charged. Cookie-auth (no api_key_id)
// traffic never reaches here — it was already free.
const CATEGORY_TO_USAGE_COL = { read: "reads", write: "writes", compute: "computes" };
const FREE_BY_CATEGORY = {
  reads: API_CONSTANTS.FREE_READS_PER_MONTH,
  writes: API_CONSTANTS.FREE_WRITES_PER_MONTH,
  computes: API_CONSTANTS.FREE_COMPUTES_PER_MONTH,
};

function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7); // "YYYY-MM"
}

/**
 * Record one call of `category` against the user's monthly usage counter
 * and return the effective cost — 0 if the call fell within the free
 * allowance, else `tieredCost`. Best-effort: any DB error → not free,
 * full cost, never throws. The `${col}` interpolation is safe — `col`
 * comes only from the fixed CATEGORY_TO_USAGE_COL allowlist, never user
 * input.
 */
function meterMonthlyUsage(db, userId, category, tieredCost) {
  const col = CATEGORY_TO_USAGE_COL[category];
  if (!col || !db || !userId) return { free: false, cost: tieredCost };
  const limit = FREE_BY_CATEGORY[col] ?? 0;
  const month = monthKey();
  try {
    const row = db.prepare(
      `SELECT ${col} AS used FROM api_monthly_usage WHERE user_id = ? AND month = ?`
    ).get(userId, month);
    const usedBefore = row?.used || 0;
    const free = usedBefore < limit;
    const cost = free ? 0 : tieredCost;
    db.prepare(`
      INSERT INTO api_monthly_usage (user_id, month, ${col}, total_cost)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(user_id, month) DO UPDATE SET ${col} = ${col} + 1, total_cost = total_cost + ?
    `).run(userId, month, cost, cost);
    return { free, cost, usedBefore, limit };
  } catch {
    return { free: false, cost: tieredCost };
  }
}

/**
 * Append a row to `macro_call_log`. Always best-effort: any error is
 * swallowed and logged, never thrown.
 *
 * @param {object} db — better-sqlite3
 * @param {object} ctx — { userId?, apiKeyId?, domain, name, durationMs, status, costUnits, cascadePaymentId?, refId? }
 * @returns {{ok: boolean, id?: number, reason?: string}}
 */
export function recordMacroCall(db, ctx) {
  if (!getFlag("FF_MACRO_BILLING", 1)) return { ok: false, reason: "billing_disabled" };
  if (!db || !ctx || !ctx.domain || !ctx.name) return { ok: false, reason: "invalid_args" };

  const status = ctx.status || "ok";
  const costUnits = Number.isFinite(ctx.costUnits) ? ctx.costUnits : 0;
  const durationMs = Number.isFinite(ctx.durationMs) ? Math.max(0, Math.floor(ctx.durationMs)) : 0;

  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO macro_call_log
        (user_id, api_key_id, domain, macro_name, cost_units, duration_ms, status, cascade_payment_id, ref_id, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `);
    const r = stmt.run(
      ctx.userId || null,
      ctx.apiKeyId || null,
      ctx.domain,
      ctx.name,
      costUnits,
      durationMs,
      status,
      ctx.cascadePaymentId || null,
      ctx.refId || null,
    );
    return { ok: true, id: r.lastInsertRowid };
  } catch (err) {
    console.warn("[macro-billing] recordMacroCall failed:", err.message);
    return { ok: false, reason: err.message };
  }
}

/**
 * Charge the user's wallet for an API-key-authenticated macro call.
 * No-op when:
 *   - billing flag is off
 *   - no `apiKeyId` (cookie-auth / free-tier)
 *   - no `userId`
 *   - cost is 0 (free macro)
 *   - the same `refId` already has a ledger entry (idempotent retry)
 *
 * @returns {{ok: boolean, charged?: number, ledgerId?: string, reason?: string}}
 */
export function chargeMacroCall(db, ctx) {
  if (!getFlag("FF_MACRO_BILLING", 1)) return { ok: false, reason: "billing_disabled" };
  if (!db || !ctx) return { ok: false, reason: "invalid_args" };
  if (!ctx.apiKeyId || !ctx.userId) return { ok: false, reason: "free_tier" };

  const cost = Number.isFinite(ctx.costUnits) ? ctx.costUnits : costForMacro(ctx.domain, ctx.name);
  if (!cost || cost <= 0) return { ok: false, reason: "zero_cost" };

  const refId = ctx.refId;
  if (!refId) return { ok: false, reason: "missing_ref_id" };

  // Idempotency check — if the ledger already has this refId, skip.
  try {
    const prior = checkRefIdProcessed(db, refId);
    if (prior.exists) return { ok: true, ledgerId: prior.entries?.[0]?.id, reason: "already_charged" };
  } catch { /* best-effort */ }

  try {
    const { id, createdAt } = recordTransaction(db, {
      type: "FEE",
      from: ctx.userId,
      to: MACRO_REVENUE_ACCOUNT,
      amount: cost,
      fee: 0,
      net: cost,
      status: "complete",
      refId,
      metadata: {
        kind: "macro_call",
        domain: ctx.domain,
        macro: ctx.name,
        api_key_id: ctx.apiKeyId,
      },
    });
    return { ok: true, charged: cost, ledgerId: id, createdAt };
  } catch (err) {
    console.warn("[macro-billing] chargeMacroCall failed:", err.message);
    return { ok: false, reason: err.message };
  }
}

/**
 * Convenience wrapper used by the `macro:afterExecute` hook. Classifies
 * + prices the call, applies the monthly free allowance, logs it, then
 * optionally charges the wallet. NEVER throws.
 *
 * Returns the merged result — `recorded` for the log, `charged` for the
 * wallet, plus `category` and `freeAllowanceUsed`. Either of recorded /
 * charged may be `{ ok: false, reason }` and the caller still proceeds
 * with the macro response.
 */
export function billMacroCall(db, ctx) {
  const category = categoryForMacro(ctx.domain, ctx.name);
  let cost = costForMacro(ctx.domain, ctx.name);

  // Calls that never ran to a successful result (quota_exceeded,
  // rate_limited, error) are not billed — "pay for results" — and they
  // don't consume the monthly free allowance.
  if (ctx.status && ctx.status !== "ok") cost = 0;

  // API-key calls run through the unified monthly free allowance
  // (api_monthly_usage). Cookie-auth calls have no apiKeyId — already
  // free, allowance untouched. `free`-category macros never charge.
  let freeAllowanceUsed = false;
  if (cost > 0 && ctx.apiKeyId && ctx.userId && category !== "free") {
    const metered = meterMonthlyUsage(db, ctx.userId, category, cost);
    cost = metered.cost;
    freeAllowanceUsed = metered.free;
  }

  const recorded = recordMacroCall(db, { ...ctx, costUnits: cost });
  let charged = { ok: false, reason: "skipped" };
  try {
    charged = chargeMacroCall(db, { ...ctx, costUnits: cost });
  } catch (err) {
    console.warn("[macro-billing] billMacroCall.charge threw:", err.message);
    charged = { ok: false, reason: err.message };
  }
  return { recorded, charged, category, freeAllowanceUsed };
}
