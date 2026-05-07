// server/lib/brain-training/outcome-signals.js
//
// Layer 3: Multi-signal outcome resolver.
//
// The brain-training pipeline currently uses ONE quality signal:
// engagement-followup ("user made another call within 30min"). This
// module adds 12 explicit outcome signals from across the substrate
// so the daily refresh corpus reflects actual quality, not just
// engagement.
//
// Signal taxonomy (positive / negative):
//
//   POSITIVE (mark interaction as 'positive' in brain_interactions):
//     citation_registered          — economy/royalty-cascade.js
//     dtu_promoted                 — emergent/promotion-pipeline.js (MEGA/HYPER)
//     dream_consolidated           — emergent/dream-cycle.js phase 4
//     coherence_pass               — lib/coherence-check.js#validateDecree
//     evo_asset_refined            — lib/evo-asset/registry.js
//     royalty_paid                 — economy ledger
//     reputation_badge_earned      — lib/reputation-badges.js
//     council_consensus            — lib/council-theater.js
//     affect_valence_delta         — lib/affect-bridge.js (positive Δ)
//     repair_fix_stuck             — emergent/repair-cortex.js (24h no-recur)
//     promotion_approved           — promotion:approved event
//     quality_approved             — quality:approved event
//     verification_pass            — emergent/verification-pipeline.js
//
//   NEGATIVE (mark interaction as 'negative'):
//     refusal_field_block          — lib/refusal-field.js
//     anti_cheat_block             — combat anti-cheat
//     repair_failure               — emergent/repair-cortex.js
//     content_guard_moderation     — lib/content-guard.js
//     spam_blocked                 — emergent/spam-prevention.js
//     wash_trade_flag              — economy/marketplace-service.js
//     coherence_fail               — lib/coherence-check.js
//     hypothesis_invalidated       — emergent/hypothesis-engine.js
//
// Callers invoke emitOutcomeSignal(db, interactionId, outcome, signal).
// The signal's source is recorded so we can later weight signals
// differently in corpus selection (e.g., "citation" worth more than
// "engagement_followup").

import { resolveBrainInteraction } from "./interaction-log.js";

const VALID_OUTCOMES = new Set(["positive", "negative", "neutral", "expired"]);

const POSITIVE_SIGNAL_SOURCES = new Set([
  "citation_registered",
  "dtu_promoted",
  "dream_consolidated",
  "coherence_pass",
  "evo_asset_refined",
  "royalty_paid",
  "reputation_badge_earned",
  "council_consensus",
  "affect_valence_delta",
  "repair_fix_stuck",
  "promotion_approved",
  "quality_approved",
  "verification_pass",
  "engagement_followup", // existing
]);

const NEGATIVE_SIGNAL_SOURCES = new Set([
  "refusal_field_block",
  "anti_cheat_block",
  "repair_failure",
  "content_guard_moderation",
  "spam_blocked",
  "wash_trade_flag",
  "coherence_fail",
  "hypothesis_invalidated",
  "affect_valence_delta", // can be positive or negative — explicit outcome param decides
]);

/**
 * Emit an outcome signal for a brain interaction. Idempotent — only
 * flips pending rows. Records the signal source in outcome_signal so
 * later weighting / debugging is possible.
 *
 * @param {object} db
 * @param {string} interactionId — brain_interactions.id
 * @param {'positive'|'negative'|'neutral'|'expired'} outcome
 * @param {object} signal — { source, ...details }; source must be in
 *                          POSITIVE_SIGNAL_SOURCES or NEGATIVE_SIGNAL_SOURCES
 * @returns {{ ok: boolean, applied?: boolean, error?: string }}
 */
export function emitOutcomeSignal(db, interactionId, outcome, signal) {
  if (!db || !interactionId) return { ok: false, error: "missing_args" };
  if (!VALID_OUTCOMES.has(outcome)) return { ok: false, error: "invalid_outcome" };
  if (!signal || typeof signal !== "object" || !signal.source) {
    return { ok: false, error: "missing_signal_source" };
  }
  const source = String(signal.source);
  // Validate source against the appropriate set so callers can't
  // smuggle arbitrary strings into the corpus weighting later.
  if (outcome === "positive" && !POSITIVE_SIGNAL_SOURCES.has(source)) {
    return { ok: false, error: `positive outcome with non-positive source: ${source}` };
  }
  if (outcome === "negative" && !NEGATIVE_SIGNAL_SOURCES.has(source)) {
    return { ok: false, error: `negative outcome with non-negative source: ${source}` };
  }
  try {
    const applied = resolveBrainInteraction(db, interactionId, outcome, signal);
    return { ok: true, applied };
  } catch (e) {
    return { ok: false, error: e?.message || "exception" };
  }
}

/**
 * Bulk-emit signals for many interactions (e.g. when MEGA promotion
 * walks the source-DTU lineage and marks all contributing
 * interactions positive in one pass).
 */
export function emitOutcomeSignalsBulk(db, signals = []) {
  if (!db || !Array.isArray(signals)) return { ok: false, applied: 0 };
  let applied = 0;
  for (const s of signals) {
    const r = emitOutcomeSignal(db, s.interactionId, s.outcome, s.signal);
    if (r.ok && r.applied) applied++;
  }
  return { ok: true, applied };
}

/**
 * Inspection helper: return per-source counts of resolved outcomes
 * over a recent window. Useful for the lattice lens corpus dashboard.
 */
export function getOutcomeSourceStats(db, sinceTs = 0) {
  if (!db) return { sources: [] };
  try {
    const rows = db.prepare(
      `SELECT outcome_signal, outcome, COUNT(*) AS c
         FROM brain_interactions
        WHERE outcome != 'pending'
          AND outcome_at >= ?
        GROUP BY outcome_signal, outcome
        ORDER BY c DESC
        LIMIT 200`,
    ).all(sinceTs || 0);

    const sources = new Map();
    for (const r of rows) {
      let src = "unknown";
      try {
        const parsed = JSON.parse(r.outcome_signal || "{}");
        src = parsed.source || "unknown";
      } catch { /* keep unknown */ }
      const key = `${src}::${r.outcome}`;
      sources.set(key, (sources.get(key) || 0) + r.c);
    }
    return {
      sources: [...sources.entries()].map(([k, c]) => {
        const [source, outcome] = k.split("::");
        return { source, outcome, count: c };
      }),
    };
  } catch {
    return { sources: [] };
  }
}

export const _internal = {
  POSITIVE_SIGNAL_SOURCES,
  NEGATIVE_SIGNAL_SOURCES,
  VALID_OUTCOMES,
};
