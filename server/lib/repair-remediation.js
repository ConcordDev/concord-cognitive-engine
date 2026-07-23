// server/lib/repair-remediation.js
//
// OP1 (Repair Cortex operator console, R7 self-host proof) — the governed
// APPLY half of the console. `server/lib/maker-checker.js` is this
// codebase's real propose→check→apply discipline (structured returns, no
// placeholder proposals, honest degradation over fabrication); this module
// follows the same discipline for ONE specific, safe, reversible finding
// type instead of inventing a generic "apply any fix" button.
//
// Scope, deliberately narrow: `heartbeat-monitor` (a real, already-running
// detector — see `lib/detectors/heartbeat-monitor.js`) tags a finding with
// `fixHint: "restart_heartbeat_module"` when a registered heartbeat module
// has either failed repeatedly (`heartbeat_failing`) or gone stale by wall
// clock (`heartbeat_stale_run`). The one safe, well-understood remediation
// for both is exactly what the existing Heartbeat Monitor lens's admin
// "trigger" control already does on a single click
// (`tick.heartbeatControl`, op:'trigger' → `runHeartbeatModuleNow`): run
// the module immediately, out of band from its normal tick cadence. That
// primitive already ships with try/catch + a hard timeout (see
// `emergent/heartbeat-registry.js#_runOne`), so re-running it can never
// hang or crash the caller — reversible in the sense that matters here:
// it does not mutate anything the module itself doesn't already own, and
// re-running a heartbeat module out of cadence is exactly the tolerance
// CLAUDE.md's "a module crash must never stop the tick" invariant already
// assumes is safe.
//
// This module does NOT fabricate a remediation for any other finding
// shape. `listCandidates()` only ever surfaces findings a detector already
// tagged with a KNOWN_ACTIONS-listed `fixHint` — no other finding, however
// severe, produces a queue entry, so the console has an honest empty state
// instead of a fake "apply" button when nothing safe is wireable yet.

const KNOWN_ACTIONS = new Set(["restart_heartbeat_module"]);

/** @type {Map<string, RemediationEntry>} */
const _queue = new Map();

/**
 * @typedef {Object} RemediationEntry
 * @property {string} id             stable key: `${detectorId}:${findingId}:${moduleId}`
 * @property {string} action         one of KNOWN_ACTIONS
 * @property {string} moduleId       the heartbeat module this remediation targets
 * @property {string} detectorId     which detector raised the underlying finding
 * @property {string} findingId      the detector finding's own `id` (rule key)
 * @property {string} severity
 * @property {string} message
 * @property {"proposed"|"approved"|"rejected"|"applied"|"apply_failed"} status
 * @property {string} proposedAt     ISO
 * @property {string} [approvedAt]
 * @property {string} [approvedBy]
 * @property {string} [rejectedAt]
 * @property {string} [rejectedBy]
 * @property {string} [rejectReason]
 * @property {string} [appliedAt]
 * @property {object} [appliedResult]
 */

function nowISO() { return new Date().toISOString(); }

function keyFor(detectorId, findingId, moduleId) {
  return `${detectorId}:${findingId}:${moduleId}`;
}

/**
 * Real candidates ONLY — read from the actual latest detector sweep the
 * live `detectors-sweep` heartbeat stashes at
 * `globalThis.__CONCORD_DETECTORS__.latestReport` (server.js). Nothing here
 * invents a finding; a fresh boot with no sweep yet correctly returns an
 * empty list rather than a fabricated one.
 *
 * @param {object} [report] optional injected report (tests only) — falls
 *   back to the real global stash.
 */
export function listCandidates(report) {
  const r = report || globalThis.__CONCORD_DETECTORS__?.latestReport;
  if (!r || !Array.isArray(r.reports)) return [];
  const out = [];
  for (const detectorReport of r.reports) {
    for (const f of (detectorReport.findings || [])) {
      if (!f || !KNOWN_ACTIONS.has(f.fixHint)) continue;
      const moduleId = f.subject?.kind === "heartbeat" ? f.subject.id : null;
      if (!moduleId) continue; // no addressable target — honestly skip, don't guess
      out.push({
        id: keyFor(detectorReport.id, f.id, moduleId),
        action: f.fixHint,
        moduleId,
        detectorId: detectorReport.id,
        findingId: f.id,
        severity: f.severity || "info",
        message: f.message || "",
      });
    }
  }
  return out;
}

/**
 * Merge real candidates into the queue (adds new `proposed` entries; never
 * touches an entry already past `proposed`) and return the full queue,
 * newest-proposed first. This is the "propose" step — driven entirely by
 * real detector output, not an operator action.
 */
export function syncAndListQueue(report) {
  const candidates = listCandidates(report);
  for (const c of candidates) {
    if (_queue.has(c.id)) continue;
    _queue.set(c.id, {
      ...c,
      status: "proposed",
      proposedAt: nowISO(),
    });
  }
  return Array.from(_queue.values()).sort((a, b) => (b.proposedAt || "").localeCompare(a.proposedAt || ""));
}

/** Read-only queue snapshot, no re-sync (used by apply/approve/reject to look an entry up). */
export function getEntry(id) {
  return _queue.get(id) || null;
}

/**
 * Admin approves a proposed remediation. Approval alone never runs
 * anything — it only authorizes a subsequent `apply` call, keeping
 * propose / approve / apply as three distinct, auditable steps.
 */
export function approve(id, approverId) {
  const entry = _queue.get(id);
  if (!entry) return { ok: false, error: "not_found" };
  if (entry.status !== "proposed") {
    return { ok: false, error: "wrong_state", status: entry.status };
  }
  entry.status = "approved";
  entry.approvedAt = nowISO();
  entry.approvedBy = approverId || null;
  return { ok: true, entry };
}

/** Admin rejects a proposed or approved remediation — never applied. */
export function reject(id, approverId, reason) {
  const entry = _queue.get(id);
  if (!entry) return { ok: false, error: "not_found" };
  if (entry.status !== "proposed" && entry.status !== "approved") {
    return { ok: false, error: "wrong_state", status: entry.status };
  }
  entry.status = "rejected";
  entry.rejectedAt = nowISO();
  entry.rejectedBy = approverId || null;
  entry.rejectReason = typeof reason === "string" ? reason.slice(0, 500) : null;
  return { ok: true, entry };
}

/**
 * Apply an approved remediation. This is the ONLY function that performs a
 * real side effect, and it only runs a KNOWN, already-existing, already
 * try/catch + timeout-guarded primitive
 * (`runHeartbeatModuleNow` in emergent/heartbeat-registry.js) — the exact
 * function the Heartbeat Monitor lens's admin "trigger" control already
 * calls. Never fabricates success: the real return value from
 * `runHeartbeatModuleNow` is stamped onto the entry, and a thrown/failed
 * run is recorded as `apply_failed`, not silently swallowed.
 */
export async function apply(id, { state, db } = {}) {
  const entry = _queue.get(id);
  if (!entry) return { ok: false, error: "not_found" };
  if (entry.status !== "approved") {
    return { ok: false, error: "wrong_state", status: entry.status };
  }
  if (entry.action !== "restart_heartbeat_module") {
    // Defensive — KNOWN_ACTIONS already gates listCandidates, but never
    // execute an action this module doesn't have a real handler for.
    return { ok: false, error: "unsupported_action", action: entry.action };
  }
  let result;
  try {
    const { runHeartbeatModuleNow } = await import("../emergent/heartbeat-registry.js");
    result = await runHeartbeatModuleNow(entry.moduleId, { state, db, reason: "repair-remediation-apply" });
  } catch (err) {
    result = { ok: false, error: String(err?.message || err) };
  }
  entry.appliedAt = nowISO();
  entry.appliedResult = result;
  entry.status = result?.ok ? "applied" : "apply_failed";
  return { ok: true, entry, applyResult: result };
}

/** Test-only: clear the in-memory queue between test cases. */
export function _resetRemediationQueue() {
  _queue.clear();
}

export default {
  listCandidates,
  syncAndListQueue,
  getEntry,
  approve,
  reject,
  apply,
  _resetRemediationQueue,
};
