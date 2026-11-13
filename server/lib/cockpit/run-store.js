// Persistence for cockpit runs, steps and write effects (CKPT-08).
// Status values are validated here, not by CHECK constraints in the schema.
import crypto from "node:crypto";

export const RUN_STATUSES = Object.freeze(["planned", "running", "awaiting_confirm", "verifying", "paused", "done", "failed", "cancelled"]);
export const STEP_STATUSES = Object.freeze(["pending", "ready", "running", "awaiting_confirm", "verifying", "done", "failed", "skipped"]);
export const DEFAULT_BUDGET = Object.freeze({ maxSteps: 60, maxToolCalls: 120, maxModelCalls: 150, maxTokensIn: 400000, wallMs: 3600000, stepWallMs: 120000 });
export const RESULT_JSON_MAX = 16384;
const ACTIVE = ["planned", "running", "awaiting_confirm", "verifying", "paused"];

const nowSec = () => Math.floor(Date.now() / 1000);
const hex = () => crypto.randomBytes(8).toString("hex");

function safeParse(text, fallback) {
  if (text === null || text === undefined || text === "") return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

export function tablesReady(db) {
  try { db.prepare("SELECT 1 FROM cockpit_runs LIMIT 1").get(); return true; } catch { return false; }
}
export function newRunId() { return `run_${hex()}`; }
export function newStepId() { return `stp_${hex()}`; }

function rowToRun(r) {
  if (!r) return null;
  return {
    id: r.id, userId: r.user_id, surface: r.surface, chatSessionId: r.chat_session_id, lensContext: r.lens_context,
    goal: r.goal, status: r.status, statusReason: r.status_reason, planVersion: r.plan_version, cursor: r.cursor,
    budget: safeParse(r.budget_json, { ...DEFAULT_BUDGET }), usage: safeParse(r.usage_json, {}),
    modelProfile: r.model_profile, resumeAt: r.resume_at, leaseOwner: r.lease_owner, leaseUntil: r.lease_until,
    createdAt: r.created_at, updatedAt: r.updated_at, finishedAt: r.finished_at,
  };
}

function rowToStep(r) {
  if (!r) return null;
  return {
    id: r.id, runId: r.run_id, seq: r.seq, planVersion: r.plan_version, goal: r.goal, tool: r.tool,
    args: safeParse(r.args_json, null), expects: safeParse(r.expects_json, []), dependsOn: safeParse(r.depends_on_json, []),
    required: !!r.required, status: r.status, attempts: r.attempts, resultRef: r.result_ref,
    result: safeParse(r.result_json, null), resultSummary: safeParse(r.result_summary_json, null),
    receipt: safeParse(r.receipt_json, null), receiptId: safeParse(r.receipt_json, null)?.stepId || null,
    idempotencyKey: r.idempotency_key, errorClass: r.error_class, errorText: r.error_text,
    repairs: safeParse(r.repairs_json, []), fallbackTool: r.fallback_tool, startedAt: r.started_at, finishedAt: r.finished_at,
  };
}

/** @returns {{ ok: true, run: object } | { ok: false, reason: string }} */
export function createRun(db, { userId, surface, goal, chatSessionId = null, lensContext = null, modelProfile = "local-2b", budget = {} } = {}) {
  if (!userId || !goal || !surface) return { ok: false, reason: "invalid_input" };
  if (!tablesReady(db)) return { ok: false, reason: "no_table" };
  try {
    const id = newRunId();
    const merged = { ...DEFAULT_BUDGET, ...budget };
    merged.maxSteps = Math.min(200, merged.maxSteps);
    const usage = { toolCalls: 0, modelCalls: 0, tokensIn: 0, tokensOut: 0, humanInterventions: 0 };
    db.prepare(
      `INSERT INTO cockpit_runs (id, user_id, surface, chat_session_id, lens_context, goal, budget_json, usage_json, model_profile)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, String(userId), String(surface), chatSessionId, lensContext, String(goal).slice(0, 2000), JSON.stringify(merged), JSON.stringify(usage), modelProfile);
    return { ok: true, run: getRun(db, id) };
  } catch (e) {
    return { ok: false, reason: "db_error", error: String(e?.message || e) };
  }
}

/** Insert steps for a plan version. Steps get seq 1..n in array order. Returns the stored steps. */
export function insertSteps(db, runId, planVersion, steps) {
  try {
    const ins = db.prepare(
      `INSERT INTO cockpit_steps (id, run_id, seq, plan_version, goal, tool, args_json, expects_json, depends_on_json, required, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = db.transaction((list) => {
      list.forEach((s, i) => {
        ins.run(s.id || newStepId(), runId, i + 1, planVersion, String(s.goal || "").slice(0, 200), s.tool || null,
          s.args === null || s.args === undefined ? null : JSON.stringify(s.args),
          JSON.stringify(s.expects || []), JSON.stringify(s.dependsOn || []), s.required === false ? 0 : 1, s.status || "pending");
      });
    });
    tx(steps);
    return listSteps(db, runId, planVersion);
  } catch { return []; }
}

export function getRun(db, runId) {
  try { return rowToRun(db.prepare("SELECT * FROM cockpit_runs WHERE id = ?").get(runId)); } catch { return null; }
}
export function getRunForUser(db, runId, userId) {
  const run = getRun(db, runId);
  return run && run.userId === String(userId) ? run : null;
}
export function listSteps(db, runId, planVersion = null) {
  try {
    const pv = planVersion ?? db.prepare("SELECT plan_version FROM cockpit_runs WHERE id = ?").get(runId)?.plan_version ?? 1;
    return db.prepare("SELECT * FROM cockpit_steps WHERE run_id = ? AND plan_version = ? ORDER BY seq ASC").all(runId, pv).map(rowToStep);
  } catch { return []; }
}
export function getStep(db, stepId) {
  try { return rowToStep(db.prepare("SELECT * FROM cockpit_steps WHERE id = ?").get(stepId)); } catch { return null; }
}
export function listRunsForUser(db, userId, { limit = 20, status = null } = {}) {
  try {
    const rows = status
      ? db.prepare("SELECT * FROM cockpit_runs WHERE user_id = ? AND status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(userId, status, limit)
      : db.prepare("SELECT * FROM cockpit_runs WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(userId, limit);
    return rows.map(rowToRun);
  } catch { return []; }
}
export function findWaitingRun(db, userId, chatSessionId) {
  try {
    return rowToRun(db.prepare(
      "SELECT * FROM cockpit_runs WHERE user_id = ? AND chat_session_id = ? AND status = 'awaiting_confirm' ORDER BY updated_at DESC, rowid DESC LIMIT 1",
    ).get(userId, chatSessionId));
  } catch { return null; }
}
export function countActiveRuns(db, userId) {
  try {
    const q = `SELECT COUNT(*) c FROM cockpit_runs WHERE user_id = ? AND status IN (${ACTIVE.map(() => "?").join(",")})`;
    return db.prepare(q).get(userId, ...ACTIVE).c;
  } catch { return 0; }
}

const RUN_COLS = {
  status: "status", statusReason: "status_reason", planVersion: "plan_version", cursor: "cursor",
  modelProfile: "model_profile", resumeAt: "resume_at", finishedAt: "finished_at", chatSessionId: "chat_session_id",
};

/** Change run fields. Refuses an unknown status. Always sets updated_at. */
export function updateRun(db, runId, patch = {}) {
  try {
    if (patch.status !== undefined && !RUN_STATUSES.includes(patch.status)) return false;
    const sets = []; const vals = [];
    for (const [k, col] of Object.entries(RUN_COLS)) {
      if (patch[k] !== undefined) { sets.push(`${col} = ?`); vals.push(patch[k]); }
    }
    if (patch.budget !== undefined) { sets.push("budget_json = ?"); vals.push(JSON.stringify(patch.budget)); }
    if (patch.usage !== undefined) { sets.push("usage_json = ?"); vals.push(JSON.stringify(patch.usage)); }
    sets.push("updated_at = ?"); vals.push(nowSec());
    const info = db.prepare(`UPDATE cockpit_runs SET ${sets.join(", ")} WHERE id = ?`).run(...vals, runId);
    return info.changes === 1;
  } catch { return false; }
}

const STEP_COLS = {
  status: "status", attempts: "attempts", errorClass: "error_class", errorText: "error_text",
  fallbackTool: "fallback_tool", startedAt: "started_at", finishedAt: "finished_at", tool: "tool",
  idempotencyKey: "idempotency_key", resultRef: "result_ref",
};

/** Change step fields. Refuses an unknown status. */
export function updateStep(db, stepId, patch = {}) {
  try {
    if (patch.status !== undefined && !STEP_STATUSES.includes(patch.status)) return false;
    const sets = []; const vals = [];
    for (const [k, col] of Object.entries(STEP_COLS)) {
      if (patch[k] !== undefined) { sets.push(`${col} = ?`); vals.push(patch[k]); }
    }
    if (patch.args !== undefined) { sets.push("args_json = ?"); vals.push(patch.args === null ? null : JSON.stringify(patch.args)); }
    if (patch.resultSummary !== undefined) { sets.push("result_summary_json = ?"); vals.push(JSON.stringify(patch.resultSummary)); }
    if (patch.receipt !== undefined) { sets.push("receipt_json = ?"); vals.push(JSON.stringify(patch.receipt)); }
    if (patch.repairs !== undefined) { sets.push("repairs_json = ?"); vals.push(JSON.stringify(patch.repairs)); }
    if (patch.expects !== undefined) { sets.push("expects_json = ?"); vals.push(JSON.stringify(patch.expects)); }
    if (patch.result !== undefined) {
      const text = JSON.stringify(patch.result);
      if (text !== undefined && Buffer.byteLength(text) <= RESULT_JSON_MAX) {
        sets.push("result_json = ?", "result_ref = ?"); vals.push(text, "inline");
      } else {
        sets.push("result_json = ?", "result_ref = ?");
        vals.push(JSON.stringify({ truncated: true, summary: patch.resultSummary?.text || "" }), "inline-truncated");
      }
    }
    if (!sets.length) return false;
    const info = db.prepare(`UPDATE cockpit_steps SET ${sets.join(", ")} WHERE id = ?`).run(...vals, stepId);
    return info.changes === 1;
  } catch { return false; }
}

export function addUsage(db, runId, delta = {}) {
  try {
    const tx = db.transaction(() => {
      const row = db.prepare("SELECT usage_json FROM cockpit_runs WHERE id = ?").get(runId);
      if (!row) return false;
      const usage = safeParse(row.usage_json, {});
      for (const [k, v] of Object.entries(delta)) usage[k] = (Number(usage[k]) || 0) + (Number(v) || 0);
      db.prepare("UPDATE cockpit_runs SET usage_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(usage), nowSec(), runId);
      return true;
    });
    return tx();
  } catch { return false; }
}

/** Lease. Returns true when this owner now holds the run. */
export function acquireLease(db, runId, owner, ttlSec = 90, now = nowSec()) {
  try {
    const info = db.prepare(
      "UPDATE cockpit_runs SET lease_owner = ?, lease_until = ? WHERE id = ? AND (lease_owner IS NULL OR lease_owner = ? OR lease_until < ?)",
    ).run(owner, now + ttlSec, runId, owner, now);
    return info.changes === 1;
  } catch { return false; }
}
export function releaseLease(db, runId, owner) {
  try {
    return db.prepare("UPDATE cockpit_runs SET lease_owner = NULL, lease_until = NULL WHERE id = ? AND lease_owner = ?").run(runId, owner).changes === 1;
  } catch { return false; }
}
/** Test only: make the current lease look dead, as a crashed owner's would. */
export function expireLeaseForTest(db, runId) {
  try { return db.prepare("UPDATE cockpit_runs SET lease_until = 0 WHERE id = ?").run(runId).changes === 1; } catch { return false; }
}
export function findDueRuns(db, now = nowSec(), limit = 5) {
  try {
    return db.prepare(
      `SELECT id FROM cockpit_runs
       WHERE ((status IN ('running','verifying','planned') AND (lease_until IS NULL OR lease_until < :now))
           OR (status = 'paused' AND resume_at IS NOT NULL AND resume_at <= :now))
       ORDER BY updated_at ASC LIMIT :limit`,
    ).all({ now, limit }).map((r) => r.id);
  } catch { return []; }
}

/** Approvals live in the run's usage_json under `approvals`. */
export function getApprovals(run) {
  return Array.isArray(run?.usage?.approvals) ? run.usage.approvals : [];
}
export function addApproval(db, runId, approval) {
  try {
    const tx = db.transaction(() => {
      const row = db.prepare("SELECT usage_json FROM cockpit_runs WHERE id = ?").get(runId);
      if (!row) return false;
      const usage = safeParse(row.usage_json, {});
      usage.approvals = [...(Array.isArray(usage.approvals) ? usage.approvals : []), approval];
      db.prepare("UPDATE cockpit_runs SET usage_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(usage), nowSec(), runId);
      return true;
    });
    return tx();
  } catch { return false; }
}
