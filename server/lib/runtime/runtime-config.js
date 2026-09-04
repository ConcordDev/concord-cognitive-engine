// server/lib/runtime/runtime-config.js
//
// Runtime config KV — Ouroboros promotions apply here.

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_config_kv'`).get();
  } catch {
    return false;
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function getConfig(db, key, fallback = null) {
  if (!db || !key || !tablesReady(db)) return fallback;
  try {
    const row = db.prepare(`SELECT value_json FROM runtime_config_kv WHERE key = ?`).get(key);
    if (!row) return fallback;
    return JSON.parse(row.value_json);
  } catch {
    return fallback;
  }
}

export function setConfig(db, key, value, { source = "system", proposalId = null } = {}) {
  if (!db || !key || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  const ts = nowSec();
  try {
    db.prepare(`
      INSERT INTO runtime_config_kv (key, value_json, source, proposal_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        source = excluded.source,
        proposal_id = excluded.proposal_id,
        updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), source, proposalId, ts, ts);
    return { ok: true, key };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function listConfig(db, prefix = "") {
  if (!db || !tablesReady(db)) return [];
  try {
    if (prefix) {
      return db.prepare(`
        SELECT key, value_json, source, proposal_id, updated_at
        FROM runtime_config_kv WHERE key LIKE ? ORDER BY key
      `).all(`${prefix}%`);
    }
    return db.prepare(`SELECT key, value_json, source, proposal_id, updated_at FROM runtime_config_kv ORDER BY key`).all();
  } catch {
    return [];
  }
}

export function applyImprovementPatch(db, proposalId, patch = {}) {
  const applied = [];
  for (const [key, value] of Object.entries(patch)) {
    const r = setConfig(db, key, value, { source: "ouroboros", proposalId });
    if (r.ok) applied.push(key);
  }
  return { ok: applied.length > 0, applied };
}
