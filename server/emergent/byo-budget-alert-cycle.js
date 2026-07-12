// server/emergent/byo-budget-alert-cycle.js
//
// Wave 4 gap-closure — BYO-keys proactive spend alerts
// (docs/lens-specs/byo-keys-capability-map.md, checklist item #10:
// "Spend alerts / email or push notification at a % threshold" —
// previously GENUINELY MISSING).
//
// `byo_keys.budget_status` already computes usdPct/tokenPct/exceeded
// per slot, but it's pull-only: a user only learns they crossed a
// cap by opening the BYO-keys lens and calling it. This heartbeat
// makes it push instead.
//
// Reuses the existing notification channel rather than inventing a
// new one:
//   - server/domains/byo-keys.js#checkSpendAlerts() does the once-
//     per-crossing bookkeeping (returns only NEWLY-crossed alerts;
//     see that function's header comment for the exact dedupe rule).
//   - server/emergent/social-layer.js#createNotification() is the
//     same substrate that already turns likes/comments/mentions/DMs
//     into a live in-app signal: it's wired to a real-time
//     `social:notification` socket event via `setSocialEmitter`
//     (server.js, boot time), which the frontend's
//     `useSocialNotificationToast` hook (mounted once, globally, in
//     AppShell) renders as a toast — the user does not need to have
//     the byo-keys lens open, or any lens open, to see it.
//
// Honesty note (verified at runtime, not just by reading source):
// the real-time toast path is genuinely live end-to-end. The
// separate REST-backed persistent notification list
// (`/api/social/notifications`, the bell/NotificationCenter) reads
// from `STATE.notifications` — a flat Map that nothing in the
// codebase ever writes to (`createNotification` writes into
// `STATE._social.notifications` instead) — so a user who is offline
// when this fires currently has no durable record to catch up on
// later. That is a pre-existing bug in the shared social-notification
// wiring (affects every notification type, not just this one) and is
// out of scope for this gap-closure unit; flagged here rather than
// silently relying on a channel that doesn't fully work end-to-end.
//
// Frequency 20 (~5 min at the default 15s tick) — matches the cadence
// of other lightweight per-user sweeps (metrics-decay, repair-cycle).
// Kill-switch: CONCORD_BYO_BUDGET_ALERTS=0.
//
// Per CLAUDE.md's heartbeat invariant ("Heartbeat modules must never
// throw"), every path here is wrapped in try/catch and always
// resolves to a plain { ok, ... } object.

import { checkSpendAlerts } from "../domains/byo-keys.js";
import { createNotification } from "./social-layer.js";

const SLOT_LABEL = Object.freeze({
  conscious: "Conscious",
  subconscious: "Subconscious",
  utility: "Utility",
  repair: "Repair",
  vision: "Vision",
});

function composeAlertContent(alert) {
  const label = SLOT_LABEL[alert.slot] || alert.slot;
  const parts = [];
  if (alert.usdPct != null && alert.budget?.monthlyUsdCap != null) {
    parts.push(`${Math.round(alert.usdPct * 100)}% of your $${alert.budget.monthlyUsdCap} USD cap`);
  }
  if (alert.tokenPct != null && alert.budget?.monthlyTokenCap != null) {
    parts.push(`${Math.round(alert.tokenPct * 100)}% of your ${alert.budget.monthlyTokenCap}-token cap`);
  }
  const pctText = parts.length > 0 ? parts.join(", ") : `${Math.round(alert.threshold * 100)}%`;
  return alert.threshold >= 1
    ? `Your ${label} brain budget hit its monthly cap (${pctText}). New calls on this slot will be blocked until next month or you raise the cap.`
    : `Your ${label} brain budget reached ${pctText} for the month — worth a look before it's exhausted.`;
}

/**
 * Heartbeat handler. Signature matches the registerHeartbeat contract:
 * `(ctx: { state, db, tickCount, reason }) => Promise<void>|void`.
 */
export async function runByoBudgetAlertCycle(ctx = {}) {
  if (process.env.CONCORD_BYO_BUDGET_ALERTS === "0") return { ok: true, skipped: "disabled" };
  try {
    const state = ctx?.state ?? globalThis._concordSTATE ?? null;
    let swept;
    try {
      swept = checkSpendAlerts();
    } catch (e) {
      return { ok: false, error: `checkSpendAlerts_failed:${String(e?.message || e)}` };
    }
    if (!swept?.ok || !Array.isArray(swept.fired) || swept.fired.length === 0) {
      return { ok: true, fired: 0, notified: 0 };
    }

    let notified = 0;
    for (const alert of swept.fired) {
      try {
        const r = createNotification(state, {
          userId: alert.userId,
          type: "budget_alert",
          content: composeAlertContent(alert),
        });
        if (r?.ok) notified++;
      } catch (_e) {
        // One bad notification must never stop the sweep or the tick.
      }
    }
    return { ok: true, fired: swept.fired.length, notified };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export default runByoBudgetAlertCycle;
