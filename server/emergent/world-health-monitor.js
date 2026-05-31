// server/emergent/world-health-monitor.js
//
// Maintenance — the Homeostasis heartbeat (loop 3 of the autonomic nervous
// system). Runs the world-health pass on a slow cadence: auto-heals mechanical
// pathologies (a stuck scheduler), and ESCALATES value/arc ones into the
// Sovereign's initiative inbox (the cortex never makes a design call). Wrapped
// to never throw — a monitor crash must never stop the tick.
//
// KS CONCORD_WORLD_HEALTH=0. Registered scope:'global' (cross-world infra).

import { runWorldHealthPass } from "../lib/world-health.js";
import { createInitiativeEngine } from "../lib/initiative-engine.js";

let _engine = null;
function escalator(db) {
  // Lazy, best-effort bridge to the Sovereign initiative inbox. The escalation
  // carries the pathology + subject so the operator can act; rate-limit/backoff
  // is the initiative engine's job. Disabled-safe.
  return (finding) => {
    try {
      if (!_engine) _engine = createInitiativeEngine(db);
      const sovereign = process.env.CONCORD_SOVEREIGN_USER_ID || "operator";
      _engine.createInitiative(
        sovereign,
        "system_repair_escalation",
        `World-health: ${finding.pathology} on ${finding.subjectId} (${finding.category}) needs a decision — the cortex will not auto-mutate value/arc state.`,
        { priority: finding.category === "economy" ? "high" : "normal", context: finding },
      );
    } catch { /* escalation best-effort — never blocks the pass */ }
  };
}

/**
 * Heartbeat handler. Never throws; returns a plain summary object.
 */
export function runWorldHealthMonitor({ db } = {}) {
  if (process.env.CONCORD_WORLD_HEALTH === "0") return { ok: true, skipped: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };
  try {
    return runWorldHealthPass(db, { escalate: escalator(db) });
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}

/**
 * Register on the heartbeat registry. freq 960 (~4h), scope global (cross-world).
 */
export function registerWorldHealthMonitor(registerHeartbeat, db) {
  if (typeof registerHeartbeat !== "function") return;
  registerHeartbeat("world-health-monitor", {
    frequency: 960,
    scope: "global",
    handler: () => runWorldHealthMonitor({ db }),
  });
}
