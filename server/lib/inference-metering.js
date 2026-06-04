// server/lib/inference-metering.js
//
// Wave 7 / Track D2 — token metering that PROVES the cost story. The inference_spans
// table (mig 058) has existed but nothing wrote to it, so the IP claim ("a thousand
// NPCs for the cost of ten") was unmeasured. This is the missing WRITER + the
// aggregation a buyer needs: "N actors ran M ticks for K LLM calls / T tokens / $C".
//
// recordInferenceSpan is the centralized hook every LLM call site calls (route it
// through the queue/selectBrain path so it can't be bypassed). It NEVER throws —
// metering must never break inference.
//
//   recordInferenceSpan(db, span)               -> { ok }
//   aggregateInferenceCosts(db, { sinceHours })  -> { calls, tokensIn, tokensOut, byBrain, costUsd, ... }

import { aggregateCosts, formatCost } from "./inference/cost-model.js";

/**
 * Write one inference span. Best-effort; a minimal build without the table is a
 * silent no-op. Never throws.
 * @param {object} span { inferenceId, spanType, brainUsed, modelUsed, tokensIn,
 *                        tokensOut, latencyMs, stepCount?, toolName?, lensId?, callerId?, error? }
 */
export function recordInferenceSpan(db, span = {}) {
  if (!db || !span) return { ok: false };
  try {
    db.prepare(`
      INSERT INTO inference_spans
        (inference_id, span_type, brain_used, model_used, tokens_in, tokens_out,
         latency_ms, step_count, tool_name, lens_id, caller_id, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(span.inferenceId || `inf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
      String(span.spanType || "chat"),
      span.brainUsed || null, span.modelUsed || null,
      Math.max(0, Number(span.tokensIn) || 0), Math.max(0, Number(span.tokensOut) || 0),
      Math.max(0, Number(span.latencyMs) || 0), Math.max(0, Number(span.stepCount) || 0),
      span.toolName || null, span.lensId || null, span.callerId || null,
      span.error ? String(span.error).slice(0, 500) : null,
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Aggregate the cost story over a window. Returns call count, token totals, a per-brain
 * breakdown, and the dollar cost (via the existing cost-model). This is the artifact the
 * /api/admin/inference-costs route + /lenses/ops-telemetry surface.
 */
export function aggregateInferenceCosts(db, { sinceHours = 24 } = {}) {
  const empty = { calls: 0, tokensIn: 0, tokensOut: 0, byBrain: {}, costUsd: 0, costLabel: "$0", sinceHours };
  if (!db) return empty;
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT * FROM inference_spans
      WHERE recorded_at >= datetime('now', ?)
    `).all(`-${Math.max(1, Number(sinceHours) || 24)} hours`);
  } catch {
    return empty;
  }
  if (!rows.length) return empty;

  let tokensIn = 0, tokensOut = 0;
  const byBrain = {};
  for (const r of rows) {
    tokensIn += Number(r.tokens_in) || 0;
    tokensOut += Number(r.tokens_out) || 0;
    const b = r.brain_used || "unknown";
    if (!byBrain[b]) byBrain[b] = { calls: 0, tokensIn: 0, tokensOut: 0 };
    byBrain[b].calls++;
    byBrain[b].tokensIn += Number(r.tokens_in) || 0;
    byBrain[b].tokensOut += Number(r.tokens_out) || 0;
  }

  let costUsd = 0;
  try { costUsd = aggregateCosts(rows).totalUsd; } catch { /* cost-model optional */ }

  return {
    calls: rows.length,
    tokensIn, tokensOut,
    byBrain,
    costUsd,
    costLabel: formatCost(costUsd),
    sinceHours,
  };
}
