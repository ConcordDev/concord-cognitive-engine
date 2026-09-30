// server/lib/runtime/execution-ledger.js
//
// Execution-state layer — observed / modified / attempted / verified per mission step.

import crypto from "node:crypto";

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_execution_ledger'`).get();
  } catch {
    return false;
  }
}

export function emptyLedger() {
  return {
    observed: [],
    modified: [],
    attempted: [],
    verified: [],
    failed: [],
    invalidated: [],
    pending: [],
    assumptions: [],
    dependencies: [],
    artifacts: [],
  };
}

export function loadLedger(db, missionId, stepIndex) {
  if (!db || !missionId || !tablesReady(db)) return emptyLedger();
  try {
    const row = db.prepare(`
      SELECT ledger_json FROM runtime_execution_ledger
      WHERE mission_id = ? AND step_index = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(missionId, stepIndex);
    if (!row?.ledger_json) return emptyLedger();
    const parsed = JSON.parse(row.ledger_json);
    return { ...emptyLedger(), ...parsed };
  } catch {
    return emptyLedger();
  }
}

export function saveLedger(db, missionId, stepIndex, ledger, { tickCount } = {}) {
  if (!db || !missionId || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  try {
    db.prepare(`
      INSERT INTO runtime_execution_ledger (mission_id, step_index, tick_count, ledger_json)
      VALUES (?, ?, ?, ?)
    `).run(missionId, stepIndex, tickCount ?? null, JSON.stringify(ledger));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function recordLedgerEvent(ledger, category, entry) {
  const cat = String(category || "observed");
  const bucket = ledger[cat] || ledger.observed;
  if (!Array.isArray(ledger[cat])) ledger[cat] = bucket;
  ledger[cat].push({ ...entry, at: Math.floor(Date.now() / 1000) });
  if (ledger[cat].length > 50) ledger[cat] = ledger[cat].slice(-50);
  return ledger;
}

export function compactLedgerForContext(ledger) {
  const pick = (arr, n = 5) => (Array.isArray(arr) ? arr.slice(-n) : []);
  return {
    observed: pick(ledger.observed, 8),
    attempted: pick(ledger.attempted, 8),
    verified: pick(ledger.verified, 5),
    failed: pick(ledger.failed, 5),
    pending: pick(ledger.pending, 5),
    assumptions: pick(ledger.assumptions, 5),
    artifactCount: (ledger.artifacts || []).length,
  };
}

export function failureSignature({ tool, reason, workerId } = {}) {
  const raw = `${tool || ""}|${reason || ""}|${workerId || ""}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
}
