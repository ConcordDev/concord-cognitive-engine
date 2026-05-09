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
// Cost lookup: `MACRO_COST_UNITS` map; default 0 for unlisted macros
// (i.e. logged but not charged).

import { recordTransaction, checkRefIdProcessed } from "../economy/ledger.js";
import { getFlag } from "./feature-flags.js";

const MACRO_REVENUE_ACCOUNT = "__platform_macro_revenue";

// Cost in CC per call. Values picked to match the plan's seed numbers
// (detectors.run = 5, repair.runProphet = 20, dtu.upsert_shadow = 1).
// Anything not in the map costs 0 — i.e. logged for telemetry but free.
//
// Override per-deployment by setting CONCORD_MACRO_COSTS_JSON to a JSON
// blob that's merged on top of this default at module load time.
const DEFAULT_MACRO_COST_UNITS = {
  "detectors:run": 5,
  "detectors:runAll": 25,
  "detectors:findings": 1,
  "detectors:summary": 1,
  "repair:runProphet": 20,
  "repair:runSurgeon": 30,
  "repair:record_decision": 0,
  "dtu:upsert_shadow": 1,
  "dx:registerCodebase": 0,
  "dx:recordFixDecision": 0,
  "dx:getCodebaseFindings": 1,
  "billing:usage": 0,
  "billing:balance": 0,
  "billing:history": 0,
  "billing:getCurrentQuota": 0,
};

let MACRO_COST_UNITS = { ...DEFAULT_MACRO_COST_UNITS };
try {
  if (process.env.CONCORD_MACRO_COSTS_JSON) {
    const overrides = JSON.parse(process.env.CONCORD_MACRO_COSTS_JSON);
    if (overrides && typeof overrides === "object") {
      MACRO_COST_UNITS = { ...MACRO_COST_UNITS, ...overrides };
    }
  }
} catch (err) {
  console.warn("[macro-billing] CONCORD_MACRO_COSTS_JSON parse failed:", err.message);
}

export function costForMacro(domain, name) {
  return MACRO_COST_UNITS[`${domain}:${name}`] ?? 0;
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
 * Convenience wrapper used by the `macro:afterExecute` hook. Logs the
 * call, then optionally charges the wallet. NEVER throws.
 *
 * Returns the merged result — `recorded` for the log, `charged` for the
 * wallet. Either may be `{ ok: false, reason }` and the caller still
 * proceeds with the macro response.
 */
export function billMacroCall(db, ctx) {
  const cost = costForMacro(ctx.domain, ctx.name);
  const recorded = recordMacroCall(db, { ...ctx, costUnits: cost });
  let charged = { ok: false, reason: "skipped" };
  try {
    charged = chargeMacroCall(db, { ...ctx, costUnits: cost });
  } catch (err) {
    console.warn("[macro-billing] billMacroCall.charge threw:", err.message);
    charged = { ok: false, reason: err.message };
  }
  return { recorded, charged };
}
