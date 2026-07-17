// server/emergent/privacy-retention-sweep.js
//
// Enforces the per-user retention policy declared through the privacy lens
// (server/domains/privacy.js#retentionGet / #retentionSet). Before this
// module, `RETENTION_CATEGORIES` round-tripped honestly (a user could store
// "delete access_logs after 7 days") but nothing ever read the config back
// and acted on it — a pure policy register with zero enforcement effect.
// This heartbeat is what turns the declaration into a real consequence.
//
// ── Honest scope (read before extending) ───────────────────────────────────
// The privacy lens declares SIX retention categories, but only TWO of them
// have a real, reachable, per-user, per-category store this domain owns:
//
//   - "access_logs"  -> STATE.privacyLens.accessLog  (Map<userId, event[]>)
//   - "dsar_records" -> STATE.privacyLens.dsars      (Map<userId, Map<dsarId, request>>)
//
// The other four categories are declared policy with NO reachable backing
// store from here, and this sweep does not fabricate enforcement for them:
//   - "chat_history"    — lives in STATE.sessions (the chat lens), a
//                          different subsystem with its own invariants.
//                          Wiring this needs a cross-domain decision this
//                          pass does not make unilaterally.
//   - "world_activity"  — spread across dozens of per-world DB tables; no
//                          single per-user "world activity" store exists.
//   - "search_queries"  — grepped the codebase; no search-query log exists
//                          anywhere (frontend or backend). There is
//                          structurally nothing to sweep.
//   - "drafts"           — `lens_drafts` already has an UNRELATED, fixed
//                          30-day GC (server/emergent/draft-gc-cycle.js,
//                          env CONCORD_DRAFT_TTL_DAYS) that ignores this
//                          per-user policy entirely. Making the user's
//                          declared windowDays/action override the global
//                          draft TTL is a real feature, but it's an owner
//                          decision (should per-user override win over the
//                          platform-wide draft TTL?) — not made here.
//
// `privacy.retentionSweepStatus` reports this split back to the caller every
// run (enforcedCategories vs declaredOnlyCategories) so the partiality is
// observable via the API, not silently hidden behind a "sweep ran" toast.
//
// ── Persistence honesty ─────────────────────────────────────────────────────
// STATE.privacyLens is an in-memory Map substrate (see privacy.js's own
// header comment) — there is no dedicated SQL table for it. It DOES survive
// a graceful restart: "privacyLens" is registered in
// server/lib/lens-state-persistence.js#LENS_STATE_KEYS, so the existing
// debounced state-snapshot mechanism (server.js saveStateDebounced ->
// state_snapshots row / concord_state.json) round-trips it like every other
// `STATE.<x>Lens` bucket. It does NOT survive a hard crash between saves
// (the same 250ms debounce window every other lens-state bucket accepts).
//
// Per the project invariant: a heartbeat module must never throw.

import { RETENTION_CATEGORIES, RETENTION_ACTIONS } from "../domains/privacy.js";

export const ENFORCEABLE_CATEGORIES = ["access_logs", "dsar_records"];

const DEFAULT_DAYS_BY_CATEGORY = new Map(
  RETENTION_CATEGORIES.map(c => [c.category, c.defaultDays])
);

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ARCHIVE_PER_USER = 1000;

/** Resolve the effective { windowDays, action } for a user+category, falling
 * back to the documented default when the user never called retentionSet. */
function effectivePolicy(retentionBucketForUser, category) {
  const explicit = retentionBucketForUser?.get ? retentionBucketForUser.get(category) : null;
  if (explicit && Number.isFinite(explicit.windowDays) && RETENTION_ACTIONS.includes(explicit.action)) {
    return { windowDays: explicit.windowDays, action: explicit.action };
  }
  const defaultDays = DEFAULT_DAYS_BY_CATEGORY.get(category);
  return { windowDays: Number.isFinite(defaultDays) ? defaultDays : 0, action: "delete" };
}

function pushArchive(privacyLens, userId, category, record) {
  if (!privacyLens.retentionArchive) privacyLens.retentionArchive = new Map();
  if (!privacyLens.retentionArchive.has(userId)) privacyLens.retentionArchive.set(userId, []);
  const arr = privacyLens.retentionArchive.get(userId);
  arr.push({ category, archivedAt: Date.now(), record });
  if (arr.length > MAX_ARCHIVE_PER_USER) arr.splice(0, arr.length - MAX_ARCHIVE_PER_USER);
}

/** Sweep STATE.privacyLens.accessLog. Returns { actioned, usersTouched }. */
function sweepAccessLogs(privacyLens, nowMs) {
  let actioned = 0;
  let usersTouched = 0;
  const bucket = privacyLens.accessLog;
  if (!(bucket instanceof Map)) return { actioned, usersTouched };
  for (const [userId, log] of bucket.entries()) {
    try {
      if (!Array.isArray(log) || log.length === 0) continue;
      const retentionBucketForUser = privacyLens.retention instanceof Map
        ? privacyLens.retention.get(userId) : null;
      const { windowDays, action } = effectivePolicy(retentionBucketForUser, "access_logs");
      if (!windowDays || windowDays <= 0) continue; // 0 = keep forever, by design
      const cutoff = nowMs - windowDays * DAY_MS;
      let touchedThisUser = false;
      const kept = [];
      for (const event of log) {
        const at = Number(event?.at);
        if (!Number.isFinite(at) || at >= cutoff) { kept.push(event); continue; }
        // Past the retention window — apply the declared action.
        actioned++;
        touchedThisUser = true;
        if (action === "delete") continue; // drop the event entirely
        if (action === "anonymize") {
          kept.push({
            ...event,
            actor: "redacted",
            lensId: "",
            dataCategory: "redacted",
            anonymized: true,
            anonymizedAt: nowMs,
          });
          continue;
        }
        // action === "archive": move the full event out of the active log
        // into a separate archive bucket (still exists, no longer live).
        pushArchive(privacyLens, userId, "access_logs", event);
      }
      bucket.set(userId, kept);
      if (touchedThisUser) usersTouched++;
    } catch { /* one malformed user must never abort the sweep */ }
  }
  return { actioned, usersTouched };
}

/** Sweep STATE.privacyLens.dsars. Returns { actioned, usersTouched }. */
function sweepDsarRecords(privacyLens, nowMs) {
  let actioned = 0;
  let usersTouched = 0;
  const bucket = privacyLens.dsars;
  if (!(bucket instanceof Map)) return { actioned, usersTouched };
  for (const [userId, dsarMap] of bucket.entries()) {
    try {
      if (!(dsarMap instanceof Map) || dsarMap.size === 0) continue;
      const retentionBucketForUser = privacyLens.retention instanceof Map
        ? privacyLens.retention.get(userId) : null;
      const { windowDays, action } = effectivePolicy(retentionBucketForUser, "dsar_records");
      if (!windowDays || windowDays <= 0) continue; // 0 = keep forever
      const cutoff = nowMs - windowDays * DAY_MS;
      let touchedThisUser = false;
      for (const [dsarId, req] of Array.from(dsarMap.entries())) {
        const submittedAt = Number(req?.submittedAt);
        if (!Number.isFinite(submittedAt) || submittedAt >= cutoff) continue;
        actioned++;
        touchedThisUser = true;
        if (action === "delete") {
          dsarMap.delete(dsarId);
          continue;
        }
        if (action === "anonymize") {
          dsarMap.set(dsarId, {
            ...req,
            note: "",
            anonymized: true,
            anonymizedAt: nowMs,
          });
          continue;
        }
        // action === "archive": move the full record out, drop from active map.
        pushArchive(privacyLens, userId, "dsar_records", req);
        dsarMap.delete(dsarId);
      }
      if (touchedThisUser) usersTouched++;
    } catch { /* one malformed user must never abort the sweep */ }
  }
  return { actioned, usersTouched };
}

/**
 * Heartbeat entry point. Signature matches the { state, db, tickCount }
 * contract every registerHeartbeat handler receives — this module only
 * needs `state` (STATE.privacyLens is a pure in-memory substrate, no db).
 */
export async function runPrivacyRetentionSweep({ state } = {}) {
  if (process.env.CONCORD_PRIVACY_RETENTION_SWEEP === "0") {
    return { ok: false, reason: "disabled" };
  }
  try {
    const privacyLens = state?.privacyLens;
    if (!privacyLens) return { ok: true, reason: "no_data" };

    const nowMs = Date.now();
    const accessResult = sweepAccessLogs(privacyLens, nowMs);
    const dsarResult = sweepDsarRecords(privacyLens, nowMs);
    const totalActioned = accessResult.actioned + dsarResult.actioned;

    const prevStatus = privacyLens.retentionSweep || {};
    const status = {
      lastRunAt: nowMs,
      totalRuns: (prevStatus.totalRuns || 0) + 1,
      lastActioned: totalActioned,
      totalActionedAllTime: (prevStatus.totalActionedAllTime || 0) + totalActioned,
      byCategory: {
        access_logs: {
          actioned: accessResult.actioned,
          usersTouched: accessResult.usersTouched,
        },
        dsar_records: {
          actioned: dsarResult.actioned,
          usersTouched: dsarResult.usersTouched,
        },
      },
      enforcedCategories: ENFORCEABLE_CATEGORIES,
      declaredOnlyCategories: RETENTION_CATEGORIES
        .map(c => c.category)
        .filter(c => !ENFORCEABLE_CATEGORIES.includes(c)),
    };
    privacyLens.retentionSweep = status;

    if (totalActioned > 0 && typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch { /* best effort */ }
    }

    return { ok: true, actioned: totalActioned, byCategory: status.byCategory };
  } catch (e) {
    return { ok: false, reason: "sweep_failed", error: String(e?.message || e) };
  }
}
