// server/emergent/lattice-orchestrator.js
//
// Layer 12 — wire-the-unwired.
//
// The corpus already contains four production-grade emergent engines
// that were never put on a heartbeat:
//
//   1. drift-monitor.js (566 lines) — `runDriftScan(STATE)` for
//      goodharting / memetic drift / capability creep / self-reference
//      / echo chamber / metric divergence detection. This IS the
//      contradiction-detection-across-corpus primitive the day-5 vision
//      asked for. Wired here at frequency 60 (~15 min).
//
//   2. breakthrough-clusters.js (446 lines) — cross-domain synthesis
//      research clusters with `triggerClusterResearch(clusterId)`,
//      `listClusters`, `getBreakthroughMetrics`. The synthesis-engine
//      primitive. Wired here at frequency 240 (~60 min) — runs research
//      passes on every active cluster.
//
//   3. cnet-federation.js (890 lines) — `initFederation`, `pollGlobal`,
//      `subscribeDomain`, `registerPeer`. Federation peer-discovery +
//      DTU-flow protocol. Wired here at frequency 120 (~30 min) for
//      the poll loop.
//
//   4. hlr-engine.js (1733 lines) — already has macros via ghost fleet
//      but no scheduled run. Drift findings are routed through
//      `runHLR(input)` here so resolution attempts get auto-recorded
//      as reasoning traces.
//
// All four wires are best-effort — if STATE / a module / a downstream
// table isn't there, the handler short-circuits with reason. No
// exceptions reach the heartbeat-registry.

import logger from "../logger.js";

let _STATE_REF = null;

/**
 * Initialise with a STATE reference. Called from server.js once during
 * boot (after STATE is constructed). The orchestrator doesn't need
 * STATE for every handler but drift-monitor + hlr-engine read it.
 */
export function initLatticeOrchestrator(STATE) {
  _STATE_REF = STATE;
}

// ── Periodic drift scan ────────────────────────────────────────────────────

export async function runPeriodicDriftScan({ db: _db, state: _state, tickCount: _t } = {}) {
  if (!_STATE_REF) return { ok: false, reason: "state_not_initialised" };
  let mod;
  try { mod = await import("./drift-monitor.js"); }
  catch (err) { return { ok: false, reason: "drift_monitor_unavailable", error: err?.message }; }
  if (typeof mod.runDriftScan !== "function") return { ok: false, reason: "no_runDriftScan" };

  let scan;
  try {
    scan = mod.runDriftScan(_STATE_REF);
  } catch (err) {
    try { logger.warn("lattice-orchestrator", "drift_scan_failed", { error: err?.message }); } catch { /* ignore */ }
    return { ok: false, reason: "scan_threw", error: err?.message };
  }

  // Bridge: route HIGH/CRITICAL findings to HLR for a resolution attempt.
  try {
    const alerts = typeof mod.getDriftAlerts === "function"
      ? mod.getDriftAlerts(_STATE_REF, { severity: "high" })
      : [];
    if (Array.isArray(alerts) && alerts.length > 0) {
      const hlr = await import("./hlr-engine.js").catch(() => null);
      if (hlr?.runHLR) {
        for (const a of alerts.slice(0, 3)) {
          try {
            hlr.runHLR({
              input: `Drift alert: ${a.kind ?? a.type ?? "unknown"}. ${a.summary ?? a.message ?? ""}`,
              mode: "constraint_check",
              tags: ["drift_resolution"],
            });
          } catch (err) {
            try { logger.debug("lattice-orchestrator", "hlr_route_failed", { error: err?.message }); } catch { /* ignore */ }
          }
        }
      }
    }
  } catch { /* bridge best-effort */ }

  return { ok: true, scan };
}

// ── Breakthrough cluster research pass ─────────────────────────────────────

export async function runBreakthroughResearchPass({ db: _db, state: _state, tickCount: _t } = {}) {
  let mod;
  try { mod = await import("./breakthrough-clusters.js"); }
  catch (err) { return { ok: false, reason: "breakthrough_unavailable", error: err?.message }; }
  if (typeof mod.listClusters !== "function" || typeof mod.triggerClusterResearch !== "function") {
    return { ok: false, reason: "missing_exports" };
  }

  let clusters;
  try {
    clusters = mod.listClusters();
  } catch {
    clusters = [];
  }
  if (!Array.isArray(clusters) || clusters.length === 0) {
    return { ok: true, clusters: 0, advanced: 0 };
  }

  let advanced = 0;
  for (const c of clusters) {
    if (!c?.id) continue;
    try {
      mod.triggerClusterResearch(c.id);
      advanced++;
    } catch (err) {
      try { logger.warn("lattice-orchestrator", "cluster_research_failed", { clusterId: c.id, error: err?.message }); } catch { /* ignore */ }
    }
  }
  return { ok: true, clusters: clusters.length, advanced };
}

// ── Federation poll ────────────────────────────────────────────────────────

export async function runFederationPoll({ db: _db, state: _state, tickCount: _t } = {}) {
  let mod;
  try { mod = await import("./cnet-federation.js"); }
  catch (err) { return { ok: false, reason: "federation_unavailable", error: err?.message }; }
  if (typeof mod.pollGlobal !== "function") return { ok: false, reason: "no_pollGlobal" };

  try {
    const r = mod.pollGlobal();
    return { ok: true, ...r };
  } catch (err) {
    try { logger.warn("lattice-orchestrator", "federation_poll_failed", { error: err?.message }); } catch { /* ignore */ }
    return { ok: false, reason: "poll_threw", error: err?.message };
  }
}
