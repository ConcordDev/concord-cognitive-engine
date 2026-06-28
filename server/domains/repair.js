// server/domains/repair.js
//
// Maintenance — the operator surface for the autonomic nervous system. "Query
// what the world repaired while you slept." Reads the Homeostasis ledger
// (health_check_log), the escalation inbox (pending system_repair_escalation
// initiatives — the value/arc calls the cortex refused to make), and the Repair
// Memory learning stats. Powers /lenses/repair-telemetry.
//
// Operator-scoped (requires auth); not public-read.

import { getRepairMemoryStats } from "../emergent/repair-cortex.js";

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name); }
  catch { return false; }
}

// Fail-CLOSED numeric guard (copied from server/domains/literary.js). Returns
// the first poisoned key (NaN/Infinity/negative/absurd) so the caller can
// reject before touching the DB — never silently coerce a hostile number.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

export default function registerRepairMacros(register) {
  // The Homeostasis ledger — what the monitor found + how it dispositioned it.
  register("repair", "health_log", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const badNum = badNumericField(input, ["limit"]);
    if (badNum) return { ok: false, reason: `invalid_${badNum}` };
    if (!tableExists(db, "health_check_log")) return { ok: true, entries: [] };
    const limit = Math.min(Number(input.limit) || 50, 200);
    const where = input.disposition ? "WHERE disposition = ?" : "";
    const args = input.disposition ? [input.disposition, limit] : [limit];
    const entries = db.prepare(`
      SELECT id, pathology, category, disposition, subject_id, detail_json, checked_at
      FROM health_check_log ${where} ORDER BY checked_at DESC LIMIT ?
    `).all(...args).map((r) => ({ ...r, detail: safeParse(r.detail_json) }));
    return { ok: true, entries };
  }, { note: "recent world-health monitor findings (healed / escalated / noted)" });

  // The escalation inbox — value/arc pathologies the cortex would not auto-heal.
  register("repair", "escalations", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!tableExists(db, "initiatives")) return { ok: true, escalations: [] };
    const status = input.status || "pending";
    const escalations = db.prepare(`
      SELECT id, message, priority, status, created_at
      FROM initiatives
      WHERE trigger_type = 'system_repair_escalation' AND status = ?
      ORDER BY created_at DESC LIMIT 100
    `).all(status);
    return { ok: true, escalations };
  }, { note: "pending repair escalations in the Sovereign inbox" });

  // Approve/dismiss an escalation (operator decision).
  register("repair", "resolve_escalation", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    if (!input.id) return { ok: false, reason: "missing_id" };
    const resolution = input.resolution === "approved" ? "approved" : "dismissed";
    if (!tableExists(db, "initiatives")) return { ok: false, reason: "no_table" };
    try {
      const r = db.prepare(`
        UPDATE initiatives SET status = ?
        WHERE id = ? AND trigger_type = 'system_repair_escalation'
      `).run(resolution === "approved" ? "acted" : "dismissed", input.id);
      return { ok: r.changes > 0, resolution };
    } catch (e) { return { ok: false, reason: e.message }; }
  }, { note: "operator approves/dismisses a repair escalation" });

  // Repair Memory learning stats (top patterns, success rates) — in-memory.
  register("repair", "memory", async () => {
    return { ok: true, stats: getRepairMemoryStats() };
  }, { note: "repair-memory learning stats" });
}

function safeParse(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }
