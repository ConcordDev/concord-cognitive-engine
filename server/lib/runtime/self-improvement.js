// server/lib/runtime/self-improvement.js
//
// Post-mission learning — weakness → proposal → benchmark → promote (Ouroboros loop).

import crypto from "node:crypto";
import { runBenchmark } from "./dila-bench.js";
import { applyImprovementPatch } from "./runtime-config.js";

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_improvement_proposals'`).get();
  } catch {
    return false;
  }
}

function proposalId() {
  return `imp_${crypto.randomUUID().slice(0, 12)}`;
}

export function analyzeMissionWeakness(mission, stepLog = []) {
  const weaknesses = [];
  if (mission.status === "failed") {
    weaknesses.push({
      kind: "mission_failed",
      detail: mission.error_reason || "unknown",
      proposedFix: "Add recovery checkpoint + replan from last good state",
    });
  }
  const failedSteps = (stepLog || []).filter((s) => s.status === "failed");
  for (const s of failedSteps) {
    weaknesses.push({
      kind: "step_failed",
      detail: `${s.tool_name}: ${s.result_json || ""}`,
      proposedFix: `Add adversarial verify before ${s.tool_name}`,
    });
  }
  if (mission.tick_count > mission.total_steps * 10) {
    weaknesses.push({
      kind: "thrashing",
      detail: `tick_count=${mission.tick_count}`,
      proposedFix: "Tighten marathon wait / add DAG dependency enforcement",
    });
  }
  return weaknesses;
}

export function createImprovementProposal(db, { missionId, weakness, proposedFix, benchmarkBefore } = {}) {
  if (!db || !tablesReady(db) || !weakness) return { ok: false, reason: "missing_inputs" };
  const id = proposalId();
  try {
    db.prepare(`
      INSERT INTO runtime_improvement_proposals
        (id, mission_id, weakness, proposed_fix, benchmark_before_json, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(
      id,
      missionId || null,
      typeof weakness === "string" ? weakness : JSON.stringify(weakness),
      proposedFix || null,
      benchmarkBefore ? JSON.stringify(benchmarkBefore) : null,
    );
    return { ok: true, proposalId: id };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export async function evaluateProposal(db, proposalId, dispatchMCP, suite = "dila_core") {
  if (!db || !tablesReady(db) || !proposalId) return { ok: false, reason: "missing_inputs" };
  const row = db.prepare(`SELECT * FROM runtime_improvement_proposals WHERE id = ?`).get(proposalId);
  if (!row) return { ok: false, reason: "not_found" };

  try {
    db.prepare(`UPDATE runtime_improvement_proposals SET status = 'testing' WHERE id = ?`).run(proposalId);
  } catch { /* optional */ }

  let benchmarkAfter = null;
  if (typeof dispatchMCP === "function") {
    benchmarkAfter = await runBenchmark({ db, dispatchMCP, suite });
  } else {
    benchmarkAfter = await runBenchmark({ db, dispatchMCP: async () => ({ ok: true, result: {} }), suite });
  }

  const before = row.benchmark_before_json ? JSON.parse(row.benchmark_before_json) : null;
  const afterSummary = benchmarkAfter?.summary || null;
  const beforeRate = before?.passRate ?? 0;
  const afterRate = afterSummary?.passRate ?? 0;
  const improved = afterRate >= beforeRate;
  const noRegression = afterRate >= beforeRate - 0.05;

  return {
    ok: true,
    proposalId,
    benchmarkAfter: afterSummary,
    improved,
    noRegression,
    promote: improved && noRegression && afterSummary?.failed === 0,
  };
}

export function promoteProposal(db, proposalId, benchmarkAfter) {
  if (!db || !tablesReady(db) || !proposalId) return { ok: false, reason: "missing_inputs" };
  const now = Math.floor(Date.now() / 1000);
  try {
    const row = db.prepare(`SELECT * FROM runtime_improvement_proposals WHERE id = ?`).get(proposalId);
    db.prepare(`
      UPDATE runtime_improvement_proposals
      SET status = 'promoted', benchmark_after_json = ?, resolved_at = ?
      WHERE id = ?
    `).run(JSON.stringify(benchmarkAfter), now, proposalId);

    let applied = { ok: false, applied: [] };
    try {
      const weakness = row?.weakness ? JSON.parse(row.weakness) : {};
      const patch = buildPromotionPatch(weakness, row);
      applied = applyImprovementPatch(db, proposalId, patch);
    } catch { /* migration 429 optional */ }

    return { ok: true, proposalId, status: "promoted", applied };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

function buildPromotionPatch(weakness, row) {
  const kind = weakness?.kind || String(row?.weakness || "");
  const patch = {};
  if (kind === "mission_failed" || /recovery/i.test(row?.proposed_fix || "")) {
    patch["recovery.max_attempts"] = { value: 4, reason: "ouroboros_promotion" };
    patch["recovery.timeout_reassign"] = { value: true, reason: "ouroboros_promotion" };
  }
  if (kind === "step_failed" || /critic|verify/i.test(row?.proposed_fix || "")) {
    patch["critic.require_evidence"] = { value: true, reason: "ouroboros_promotion" };
  }
  if (kind === "thrashing") {
    patch["mission.tick_interval_s"] = { value: 120, reason: "ouroboros_promotion" };
  }
  if (!Object.keys(patch).length) {
    patch[`improvement.${proposalIdSlice(row?.id)}`] = {
      weakness: kind,
      fix: row?.proposed_fix,
      promotedAt: Math.floor(Date.now() / 1000),
    };
  }
  return patch;
}

function proposalIdSlice(id) {
  return String(id || "unknown").slice(0, 16);
}

export function rejectProposal(db, proposalId, reason = "benchmark_regression") {
  if (!db || !tablesReady(db) || !proposalId) return { ok: false, reason: "missing_inputs" };
  const now = Math.floor(Date.now() / 1000);
  try {
    db.prepare(`
      UPDATE runtime_improvement_proposals
      SET status = 'rejected', benchmark_after_json = ?, resolved_at = ?
      WHERE id = ?
    `).run(JSON.stringify({ reason }), now, proposalId);
    return { ok: true, proposalId, status: "rejected" };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

/**
 * Process all pending proposals — benchmark gate then promote or reject.
 */
export async function processPendingProposals(db, dispatchMCP, { limit = 3, suite = "dila_core" } = {}) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  if (process.env.CONCORD_SELF_IMPROVE_AUTO === "0") {
    return { ok: true, processed: 0, reason: "disabled" };
  }

  let pending = [];
  try {
    pending = db.prepare(`
      SELECT id FROM runtime_improvement_proposals
      WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?
    `).all(Math.min(limit, 10));
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }

  const results = [];
  for (const { id } of pending) {
    const evalResult = await evaluateProposal(db, id, dispatchMCP, suite);
    if (!evalResult.ok) {
      results.push({ proposalId: id, ok: false, reason: evalResult.reason });
      continue;
    }
    if (evalResult.promote) {
      const promoted = promoteProposal(db, id, evalResult.benchmarkAfter);
      results.push({ proposalId: id, ok: true, action: "promoted", ...promoted });
    } else {
      const rejected = rejectProposal(db, id, evalResult.improved ? "incomplete_pass" : "regression");
      results.push({ proposalId: id, ok: true, action: "rejected", ...rejected });
    }
  }

  return { ok: true, processed: results.length, results };
}

export async function runImprovementCycle({ db, mission, stepLog, dispatchMCP } = {}) {
  const weaknesses = analyzeMissionWeakness(mission, stepLog);
  if (!weaknesses.length) {
    const processed = await processPendingProposals(db, dispatchMCP);
    return { ok: true, proposals: 0, weaknesses: [], processed };
  }

  let benchmarkBefore = null;
  if (typeof dispatchMCP === "function") {
    try {
      benchmarkBefore = await runBenchmark({ db, dispatchMCP, suite: "dila_core" });
    } catch { /* optional */ }
  }

  const proposals = [];
  for (const w of weaknesses.slice(0, 3)) {
    const p = createImprovementProposal(db, {
      missionId: mission?.id,
      weakness: w,
      proposedFix: w.proposedFix,
      benchmarkBefore: benchmarkBefore?.summary,
    });
    if (p.ok) proposals.push(p.proposalId);
  }

  const processed = await processPendingProposals(db, dispatchMCP);

  return {
    ok: true,
    weaknesses,
    proposals,
    benchmarkBefore: benchmarkBefore?.summary,
    processed,
  };
}

export function listImprovementProposals(db, limit = 20) {
  if (!db || !tablesReady(db)) return [];
  try {
    return db.prepare(`
      SELECT id, mission_id, weakness, proposed_fix, status, created_at, resolved_at,
             benchmark_before_json, benchmark_after_json
      FROM runtime_improvement_proposals
      ORDER BY created_at DESC LIMIT ?
    `).all(Math.min(limit, 100));
  } catch {
    return [];
  }
}
