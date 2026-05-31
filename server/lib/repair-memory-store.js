// server/lib/repair-memory-store.js
//
// Maintenance A — durable Repair Memory. The cortex learns in-memory; this
// mirrors each learned pattern into the mig-030 `repair_knowledge` table so the
// learning + audit survive a restart (a cold cache falls back to the DB row).
// Isolated + guarded so it never breaks the in-memory path on a minimal build.

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name); }
  catch { return false; }
}

/** Upsert a learned pattern. key = hashPattern(errorPattern). Best-effort. */
export function persistRepairEntry(db, key, entry) {
  if (!db || !key || !entry) return false;
  if (!tableExists(db, "repair_knowledge")) return false;
  try {
    const fixDesc = typeof entry.fix === "string" ? entry.fix : JSON.stringify(entry.fix ?? null);
    const now = new Date().toISOString();
    const existing = db.prepare(`SELECT id FROM repair_knowledge WHERE id = ?`).get(key);
    if (existing) {
      db.prepare(`
        UPDATE repair_knowledge
           SET success_count = ?, failure_count = ?, fix_description = ?,
               symptoms = ?, last_used_at = ?
         WHERE id = ?
      `).run(
        Number(entry.successes || 0), Number(entry.failures || 0),
        fixDesc, String(entry.pattern || "").slice(0, 2000), now, key,
      );
    } else {
      db.prepare(`
        INSERT INTO repair_knowledge
          (id, category, issue_type, symptoms, fix_description, success_count, failure_count, last_used_at, created_at)
        VALUES (?, 'repair_memory', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        key, String(entry.pattern || "").slice(0, 200), String(entry.pattern || "").slice(0, 2000),
        fixDesc, Number(entry.successes || 0), Number(entry.failures || 0), now, now,
      );
    }
    return true;
  } catch { return false; }
}

/**
 * Load a persisted pattern back into the in-memory entry shape (or null).
 * Used by lookupRepairMemory when the in-memory cache is cold after a restart.
 */
export function loadRepairEntry(db, key) {
  if (!db || !key || !tableExists(db, "repair_knowledge")) return null;
  try {
    const row = db.prepare(`
      SELECT id, issue_type, symptoms, fix_description, success_count, failure_count
      FROM repair_knowledge WHERE id = ?
    `).get(key);
    if (!row) return null;
    const successes = Number(row.success_count || 0);
    const failures = Number(row.failure_count || 0);
    const occurrences = successes + failures || 1;
    const successRate = successes / occurrences;
    let fix = row.fix_description;
    try { fix = JSON.parse(row.fix_description); } catch { /* plain string fix */ }
    return {
      pattern: row.symptoms || row.issue_type,
      fix,
      occurrences,
      successes,
      failures,
      successRate,
      deprecated: successRate < 0.3 && occurrences > 3,
    };
  } catch { return null; }
}
