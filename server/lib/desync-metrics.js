// server/lib/desync-metrics.js
//
// E1 — desync-rate telemetry (the one true ABSENT from the observability audit).
//
// The combat anti-cheat (_validateCombatReach / _validateDamageCap in routes/worlds.js)
// rejects out-of-reach / over-cap attacks per-request, but there was NO aggregate signal —
// so a desync storm or a coordinated exploit attempt was invisible to Prometheus/Grafana.
// These Prometheus counters give a desync-rate a panel + alert can watch.
//
// The counters themselves are declared on the main METRICS.registry in server.js (so they
// export through /api/metrics); this module is the thin, testable increment helper the route
// layer calls. It reads the registry off globalThis (the same handle server.js publishes as
// `globalThis._concordMETRICS`) so routes/worlds.js doesn't have to import the monolith.

const KIND_TO_COUNTER = {
  reach: "combatReachRejected",
  damage: "combatDamageRejected",
};

/**
 * Record a rejected combat action for desync-rate telemetry.
 * Safe to call before metrics init (no-op) — never throws, never blocks the reject path.
 *
 * @param {"reach"|"damage"} kind  which validator rejected
 * @param {string} [worldId]       the world the reject happened in (counter label)
 */
export function recordCombatReject(kind, worldId = "unknown") {
  try {
    const counterKey = KIND_TO_COUNTER[kind];
    if (!counterKey) return false;
    const counter = globalThis._concordMETRICS?.counters?.[counterKey];
    if (!counter || typeof counter.inc !== "function") return false;
    counter.inc({ world: String(worldId || "unknown") });
    return true;
  } catch {
    return false; // telemetry must never break the gameplay path
  }
}

export default recordCombatReject;
