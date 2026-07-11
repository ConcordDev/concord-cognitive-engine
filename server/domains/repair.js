// server/domains/repair.js
//
// Maintenance — the operator surface for the autonomic nervous system. "Query
// what the world repaired while you slept." Reads the Homeostasis ledger
// (health_check_log), the escalation inbox (pending system_repair_escalation
// initiatives — the value/arc calls the cortex refused to make), and the Repair
// Memory learning stats. Powers /lenses/repair-telemetry.
//
// Operator-scoped, and — as of the 2026-07-11 repair-telemetry rebuild —
// ACTUALLY enforced, not just described. `/api/lens/run` has no domain-level
// role gate of its own (only authenticated-vs-anonymous via
// `_lensActionForbiddenForAnon`); every admin-gated domain must enforce its
// own authority in-handler or nobody does (same pattern as
// `server/domains/announcements.js`'s `admin_only` gate). Before this pass
// every repair.* macro was reachable by ANY authenticated user despite the
// lens rendering `<AdminRequiredState>` on a 403 that could never actually
// fire from this path — `health_log` leaks other users' negative wallet
// balances (`negative_balance` findings carry `subject_id` + `balance`), and
// `resolve_escalation` lets any user act on Sovereign-only decisions. Fixed
// by requiring an operator role on every macro in this file.

import { getRepairMemoryStats } from "../emergent/repair-cortex.js";
import { runWorldHealthPass } from "../lib/world-health.js";
import { escalator } from "../emergent/world-health-monitor.js";

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name); }
  catch { return false; }
}

// Real authorization — mirrors the established macro-level admin-gate
// convention (`announcements.js`'s `role !== "admin"` -> `admin_only`; the
// broader `owner`/`sovereign`/`founder` set matches server.js's own
// `requireAdminRole()` for macros registered directly there). Every
// repair.* macro is operator-only: return this from the top of each one.
function requireOperatorRole(ctx) {
  const role = ctx?.actor?.role || "";
  if (["admin", "owner", "sovereign", "founder"].includes(role)) return null;
  return { ok: false, error: "admin_only" };
}

// Operator-triggered manual pass cooldown — the monitor otherwise only runs
// on the ~4h heartbeat cadence (world-health-monitor.js). A manual trigger
// is a legitimate operator need ("did my fix land?"), but an unthrottled
// button would let repeated clicks hammer the DB with full-table scans.
// Module-scoped (not per-user) is intentional: this is a global system pass,
// not a per-user resource. Read fresh per call (not a module-load-time
// const) so tests can toggle CONCORD_REPAIR_RUN_NOW_COOLDOWN_MS per case.
function runNowCooldownMs() {
  // NOT `Number(raw) || 15_000` — that's a falsy-zero footgun: an explicit
  // "0" (no throttling, what tests set) coerces to the numeric 0, and
  // `0 || 15_000` evaluates to 15_000 because 0 is falsy in JS, silently
  // re-enabling the cooldown the caller asked to disable.
  const raw = process.env.CONCORD_REPAIR_RUN_NOW_COOLDOWN_MS;
  if (raw === undefined || raw === "") return 15_000;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 15_000;
}
let _lastRunNowAt = 0;

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
    const denied = requireOperatorRole(ctx); if (denied) return denied;
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
    const denied = requireOperatorRole(ctx); if (denied) return denied;
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
    const denied = requireOperatorRole(ctx); if (denied) return denied;
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
  register("repair", "memory", async (ctx) => {
    const denied = requireOperatorRole(ctx); if (denied) return denied;
    return { ok: true, stats: getRepairMemoryStats() };
  }, { note: "repair-memory learning stats" });

  // Operator-triggered on-demand Homeostasis pass — bypasses the ~4h
  // heartbeat cadence for "did my fix land?" verification. Reuses the exact
  // same detect -> classify -> heal-mechanical / escalate-value pipeline as
  // the heartbeat (server/lib/world-health.js + the shared escalator from
  // server/emergent/world-health-monitor.js) — never a parallel code path.
  // Cooldown-gated (module-scoped, not per-user) to prevent a click-spam
  // full-table-scan DoS; the pass itself never mutates value/arc state.
  register("repair", "run_now", async (ctx) => {
    const denied = requireOperatorRole(ctx); if (denied) return denied;
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (process.env.CONCORD_WORLD_HEALTH === "0") return { ok: false, reason: "disabled" };
    const cooldownMs = runNowCooldownMs();
    const now = Date.now();
    const elapsed = now - _lastRunNowAt;
    if (elapsed < cooldownMs) {
      return { ok: false, reason: "cooldown", retryInMs: cooldownMs - elapsed };
    }
    _lastRunNowAt = now;
    try {
      const result = runWorldHealthPass(db, { escalate: escalator(db) });
      return { ok: result.ok !== false, ...result };
    } catch (e) { return { ok: false, reason: e.message }; }
  }, { note: "operator-triggered on-demand Homeostasis pass (bypasses the ~4h heartbeat cadence); cooldown-gated" });
}

function safeParse(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }
