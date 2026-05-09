// server/emergent/repair-cortex/detector-bridge.js
//
// Phase 5 — central pay-down engine.
//
// Bridges detector output into repair-cortex action. For every NEW finding
// (not in baseline):
//   - if a registered fix matches → enqueue an auto-fix task
//   - otherwise → call observe() so pain-and-avoidance learning kicks in
//   - always log a DTU per existing logRepairDTU pattern
//
// Pure functions where possible. Side effects (queue / observe / DTU)
// gated through optional callbacks so this module is easy to test in
// isolation.
//
// The fix registry lives in server/lib/autofix/index.js; this module
// just routes.

import logger from "../../logger.js";

let _enqueuedTasks = [];
let _observeFn = null;
let _logDtuFn = null;

/** Wire optional callbacks (called once during repair-cortex init). */
export function configureBridge({ observe, logDtu } = {}) {
  if (typeof observe === "function") _observeFn = observe;
  if (typeof logDtu === "function") _logDtuFn = logDtu;
}

/** Snapshot of currently-enqueued tasks for the repair-cortex lens. */
export function pendingTasks() { return [..._enqueuedTasks]; }

/** Flush — used by repair-cortex-apply.js after applying fixes. */
export function _flushPendingTasks() { const out = _enqueuedTasks; _enqueuedTasks = []; return out; }

/**
 * Ingest a detector report + delta. Each new finding is routed:
 *   - matched fix → enqueue task
 *   - severity ≥ high → observe (pain learning) + log DTU
 *   - critical → also forward to auto-proposal
 *
 * @param {object} report   the runAllDetectors() output
 * @param {object} [delta]  diffAgainstBaseline output (added: [...])
 */
export async function ingestDetectorDelta(report, delta) {
  if (!report) return { ok: false, reason: "no_report" };

  // Discover the auto-fix registry — lazy import so circular deps don't bite.
  let registry;
  try {
    const mod = await import("../../lib/autofix/index.js");
    registry = mod.listFixes ? mod.listFixes() : [];
  } catch (_e) { registry = []; }

  const newFindings = (delta?.added || []).map(a => ({ detector: a.detector, ...a.finding }));
  const sourceFindings = newFindings.length > 0
    ? newFindings
    : (report.reports || []).flatMap(r => (r.findings || []).map(f => ({ detector: r.id, ...f })));

  const enqueued = [];
  const observed = [];
  for (const f of sourceFindings) {
    if (f.severity === "info") continue;

    // Match a fix by fixHint + fix.matchFinding(f).
    const fix = registry.find(x => typeof x.matchFinding === "function" && x.matchFinding(f));
    if (fix) {
      const task = {
        id: `task:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        finding: f,
        fix: fix.id,
        riskTier: fix.riskTier || "low",
        enqueuedAt: new Date().toISOString(),
        status: "pending",
      };
      _enqueuedTasks.push(task);
      enqueued.push(task);
    }

    if ((f.severity === "high" || f.severity === "critical") && _observeFn) {
      try {
        _observeFn(new Error(`detector:${f.detector}:${f.id}`), `detector_finding:${f.detector}`);
        observed.push(f);
      } catch (_e) { /* observe should never crash this path */ }
    }
  }

  // Log a DTU summarizing the run for forensic chain-of-custody.
  if (_logDtuFn) {
    try {
      _logDtuFn("post_build_guardian", "detector_sweep", {
        generatedAt: report.generatedAt,
        totals: report.totals,
        deltaAdded: newFindings.length,
        enqueued: enqueued.length,
        observed: observed.length,
      });
    } catch (_e) { /* logDtu best-effort */ }
  }

  // Critical findings: also flow through auto-proposal.
  try {
    const criticals = sourceFindings.filter(f => f.severity === "critical");
    if (criticals.length > 0 && process.env.CONCORD_AUTO_GOVERNANCE !== "0") {
      const ap = await import("../../lib/governance/auto-proposal.js");
      // No db handle in this scope — auto-proposal tolerates db=null and
      // still returns a structured proposal object the heartbeat's
      // db-level dispatcher already wrote.
      ap.bulkPostFromFindings(null, criticals);
    }
  } catch (_e) { /* auto-proposal optional */ }

  try {
    logger.info?.("repair-cortex/detector-bridge", "delta_ingested", {
      enqueued: enqueued.length, observed: observed.length, newFindings: newFindings.length,
    });
  } catch { /* logging best-effort */ }

  return {
    ok: true,
    enqueued: enqueued.length,
    observed: observed.length,
    pendingTotal: _enqueuedTasks.length,
  };
}
