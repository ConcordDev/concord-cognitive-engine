// server/lib/world-health.js
//
// Maintenance — Homeostasis loop (the new organ). Cheap world-pathology reads,
// each classified by the ONE boundary that must hold: the cortex tends the
// MECHANICAL (restore known-good state) and auto-heals it; anything that touches
// VALUE or an ARC is a design call and is ESCALATED, never auto-mutated.
//
//   economy  (negative balance, dupe citation)  -> escalate (never touch value)
//   liveness (stuck scheduler)                   -> heal (re-tick the overdue job)
//   arc      (society/arc gone static)           -> escalate (could be intended)
//
// Pure detection + classification; the pass orchestrates heal/escalate via
// injected callbacks so it's testable without the initiative engine. Never throws.

const STUCK_SCHEDULER_GRACE_S = Number(process.env.CONCORD_HEALTH_STUCK_GRACE_S) || 86400; // 24h overdue

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name); }
  catch { return false; }
}

/**
 * Detect current pathologies. Each read is guarded (minimal builds lack tables)
 * and bounded. Returns [{ pathology, category, subjectId, detail }].
 */
export function detectPathologies(db, nowS = Math.floor(Date.now() / 1000)) {
  const out = [];
  if (!db) return out;

  // ── economy: negative wallet balances (value corruption — ESCALATE) ──
  if (tableExists(db, "user_wallets")) {
    try {
      for (const r of db.prepare(`SELECT id AS user_id, concordia_credits AS balance FROM users WHERE concordia_credits < 0 LIMIT 50`).all()) {
        out.push({ pathology: "negative_balance", category: "economy", subjectId: r.user_id, detail: { balance: r.balance } });
      }
    } catch { /* schema variant */ }
  }

  // ── economy: duplicate citation edges (royalty double-count — ESCALATE) ──
  if (tableExists(db, "royalty_lineage")) {
    try {
      for (const r of db.prepare(`
        SELECT child_id, parent_id, COUNT(*) AS n FROM royalty_lineage
        GROUP BY child_id, parent_id HAVING n > 1 LIMIT 50
      `).all()) {
        out.push({ pathology: "dupe_citation", category: "economy", subjectId: `${r.child_id}:${r.parent_id}`, detail: { count: r.n } });
      }
    } catch { /* schema variant */ }
  }

  // ── liveness: a faction scheduler whose next move is long overdue (MECHANICAL
  //    — the dispatcher missed it; re-tick by resetting next_move_at to now). ──
  if (tableExists(db, "faction_strategy_state")) {
    try {
      for (const r of db.prepare(`
        SELECT faction_id, next_move_at FROM faction_strategy_state
        WHERE next_move_at > 0 AND next_move_at < ? LIMIT 50
      `).all(nowS - STUCK_SCHEDULER_GRACE_S)) {
        out.push({ pathology: "stuck_scheduler", category: "liveness", subjectId: r.faction_id, detail: { overdue_s: nowS - r.next_move_at } });
      }
    } catch { /* schema variant */ }
  }

  return out;
}

/**
 * The boundary: mechanical → healed, value/arc → escalated. PURE.
 */
export function classifyDisposition(pathology) {
  switch (pathology) {
    case "stuck_scheduler": return "healed";       // mechanical: restore known-good state
    case "negative_balance":
    case "dupe_citation":   return "escalated";     // value: never auto-mutate
    case "static_arc":      return "escalated";     // design call
    default:                return "noted";
  }
}

/** Mechanical auto-heal. Only ever restores known-good state — never touches value. */
function healMechanical(db, finding, nowS) {
  if (finding.pathology === "stuck_scheduler") {
    try {
      db.prepare(`UPDATE faction_strategy_state SET next_move_at = ? WHERE faction_id = ?`).run(nowS, finding.subjectId);
      return true;
    } catch { return false; }
  }
  return false;
}

/**
 * Run one homeostasis pass. Never throws.
 * @param {object} args { db, escalate?, log?, now? }
 *   escalate(finding) — called for value/arc findings (e.g. -> initiatives).
 * @returns {{ ok, checked, healed, escalated, findings }}
 */
export function runWorldHealthPass(db, { escalate = null, log = null, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!db) return { ok: false, reason: "no_db", checked: 0, healed: 0, escalated: 0, findings: [] };
  let healed = 0, escalated = 0;
  let findings = [];
  try {
    findings = detectPathologies(db, now);
    const hasLog = tableExists(db, "health_check_log");
    for (const f of findings) {
      const disposition = classifyDisposition(f.pathology);
      if (disposition === "healed") {
        if (healMechanical(db, f, now)) healed++;
      } else if (disposition === "escalated") {
        escalated++;
        try { escalate?.(f); } catch { /* escalation best-effort */ }
      }
      if (hasLog) {
        try {
          db.prepare(`
            INSERT INTO health_check_log (id, pathology, category, disposition, subject_id, detail_json, checked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            `hcl_${now}_${Math.random().toString(36).slice(2, 9)}`,
            f.pathology, f.category, disposition, String(f.subjectId ?? ""),
            JSON.stringify(f.detail || {}), now,
          );
        } catch { /* log best-effort */ }
      }
      try { log?.(f, disposition); } catch { /* noop */ }
    }
  } catch (err) {
    return { ok: false, reason: err.message, checked: findings.length, healed, escalated, findings };
  }
  return { ok: true, checked: findings.length, healed, escalated, findings };
}
