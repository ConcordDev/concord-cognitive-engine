// Write-ahead effect claims: a retry, a resume or a restart never writes twice (CKPT-12).
import { canonicalJson, sha256Hex } from "../receipts/attest.js";

const RESULT_MAX = 16384;

export function effectKey(runId, stepId, tool, args) {
  return sha256Hex(`${runId}|${stepId}|${tool}|${canonicalJson(args ?? {})}`);
}

export function getEffect(db, key) {
  try {
    const r = db.prepare("SELECT * FROM cockpit_effects WHERE idempotency_key = ?").get(key);
    if (!r) return null;
    let result = null;
    try { result = r.result_json ? JSON.parse(r.result_json) : null; } catch { result = null; }
    return { key: r.idempotency_key, runId: r.run_id, stepId: r.step_id, tool: r.tool, argsHash: r.args_hash, status: r.status, result, createdAt: r.created_at, completedAt: r.completed_at };
  } catch { return null; }
}

/** @returns {{ state: "claimed"|"replay"|"in_flight"|"error", key: string, result?: object }} */
export function claimEffect(db, { runId, stepId, tool, args }) {
  const key = effectKey(runId, stepId, tool, args);
  const argsHash = sha256Hex(canonicalJson(args ?? {}));
  try {
    db.prepare("INSERT INTO cockpit_effects (idempotency_key, run_id, step_id, tool, args_hash, status) VALUES (?, ?, ?, ?, ?, 'claimed')")
      .run(key, runId, stepId, tool, argsHash);
    return { state: "claimed", key };
  } catch (e) {
    if (!/constraint/i.test(String(e?.code || e?.message || ""))) return { state: "error", key };
    const row = getEffect(db, key);
    if (row?.status === "completed") return { state: "replay", key, result: row.result };
    return { state: "in_flight", key };
  }
}

export function completeEffect(db, key, result) {
  try {
    let text = JSON.stringify(result ?? null);
    if (Buffer.byteLength(text) > RESULT_MAX) text = JSON.stringify({ ...result, result: { truncated: true } });
    return db.prepare("UPDATE cockpit_effects SET status = 'completed', result_json = ?, completed_at = unixepoch() WHERE idempotency_key = ?").run(text, key).changes === 1;
  } catch { return false; }
}

/** A failed call wrote nothing and may be retried: drop the claim. */
export function failEffect(db, key) {
  try { return db.prepare("DELETE FROM cockpit_effects WHERE idempotency_key = ?").run(key).changes === 1; } catch { return false; }
}

/** The call may or may not have landed (timeout, crash). */
export function markEffectUnknown(db, key) {
  try { return db.prepare("UPDATE cockpit_effects SET status = 'unknown' WHERE idempotency_key = ?").run(key).changes === 1; } catch { return false; }
}
