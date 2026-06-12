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
  // Also emits a `world:drift-alert` socket event so the frontend
  // moodboard tints the world based on the drift level (Phase 2 idea
  // #33 + idea #8 lattice-quest world-aware reframe). REALTIME exists
  // when the realtime emitter has been bootstrapped — guarded with
  // optional chaining so the orchestrator stays drop-in for tests.
  try {
    // DRIFT_SEVERITY enum is info|warning|alert|critical — there is no "high".
    // The prior { severity: "high" } filter matched NOTHING, so HIGH/CRITICAL
    // findings never reached HLR and never emitted world:drift-alert. Route the
    // two actionable tiers (alert + critical) instead.
    const alertsResult = typeof mod.getDriftAlerts === "function"
      ? mod.getDriftAlerts(_STATE_REF, { severity: ["alert", "critical"] })
      : { alerts: [] };
    const alerts = Array.isArray(alertsResult) ? alertsResult : (alertsResult.alerts || []);
    if (Array.isArray(alerts) && alerts.length > 0) {
      // Emit moodboard-tinting alerts before HLR so the UI gets the
      // signal even when HLR is degraded.
      try {
        const realtimeMod = await import("./realtime.js").catch(() => null);
        const emit = realtimeMod?.realtimeEmit || globalThis.REALTIME?.io?.emit?.bind(globalThis.REALTIME.io);
        for (const a of alerts.slice(0, 5)) {
          try {
            emit?.("world:drift-alert", {
              kind: a.kind ?? a.type ?? "unknown",
              severity: a.severity ?? "high",
              summary: a.summary ?? a.message ?? "",
              detectedAt: Date.now(),
            });
          } catch { /* per-alert emit best-effort */ }
        }
      } catch { /* realtime module optional */ }

      const hlr = await import("./hlr-engine.js").catch(() => null);
      if (hlr?.runHLR) {
        const conclusions = [];
        for (const a of alerts.slice(0, 3)) {
          try {
            const r = hlr.runHLR({
              input: `Drift alert: ${a.kind ?? a.type ?? "unknown"}. ${a.summary ?? a.message ?? ""}`,
              mode: "constraint_check",
              tags: ["drift_resolution"],
            });
            // Collect the chain conclusions + the synthesised conclusion so the
            // autonomous reasoning can be FORMALLY self-checked below.
            for (const ch of (r?.chains || [])) if (ch?.conclusion) conclusions.push(ch.conclusion);
            const synth = r?.output?.synthesizedConclusion;
            if (synth) conclusions.push(synth);
          } catch (err) {
            try { logger.debug("lattice-orchestrator", "hlr_route_failed", { error: err?.message }); } catch { /* ignore */ }
          }
        }

        // Autonomous formal-proof pass — the continuous analogue to MOTO's
        // "verify the research". Proof-amenable conclusions go through the Z3 gate
        // (subconscious brain formaliser); a sound proven/refuted is recorded +
        // surfaced. Best-effort, bounded, near-free when Z3 isn't installed.
        try {
          const { verifyConclusions } = await import("../lib/proof-gate.js");
          let brainFn = null;
          try {
            const { brainChat } = await import("../lib/byo-router.js");
            const db = _STATE_REF?.db || globalThis.__concordDb || null;
            brainFn = async (messages) => {
              const rr = await brainChat({ db, userId: null, slot: "subconscious", messages });
              return { text: rr?.text || "" };
            };
          } catch { brainFn = null; }
          const proof = await verifyConclusions(conclusions, { brainFn, max: 3 });
          if (scan && typeof scan === "object") scan.proof = proof;
          if (proof.checked > 0) {
            try {
              const realtimeMod = await import("./realtime.js").catch(() => null);
              const emit = realtimeMod?.realtimeEmit || globalThis.REALTIME?.io?.emit?.bind(globalThis.REALTIME.io);
              for (const res of proof.results) {
                emit?.("lattice:claim-verified", { verdict: res.verdict, claim: res.claim.slice(0, 200), at: Date.now() });
              }
              logger.info?.("lattice-orchestrator", "autonomous_proof_pass", { checked: proof.checked, proven: proof.proven, refuted: proof.refuted });
            } catch { /* surfacing best-effort */ }
          }
        } catch (err) {
          try { logger.debug("lattice-orchestrator", "proof_pass_unavailable", { error: err?.message }); } catch { /* ignore */ }
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

// ── Culture-layer drift pass ───────────────────────────────────────────────
// Phase 3 wire-the-Lost #4: culture-layer was loaded into Ghost Fleet with
// 16 macros registered but never tick-scheduled. checkTraditionEmergence
// + getCulturalGuidance run periodically so cultural drift accumulates
// in the substrate even when nobody's looking.

export async function runCultureDriftPass({ db: _db, state: _state, tickCount: _t } = {}) {
  let mod;
  try { mod = await import("./culture-layer.js"); }
  catch (err) { return { ok: false, reason: "culture_layer_unavailable", error: err?.message }; }

  let emergence = null;
  let cohort = null;
  try {
    if (typeof mod.checkTraditionEmergence === "function") {
      emergence = mod.checkTraditionEmergence();
    }
  } catch (err) {
    try { logger.warn("lattice-orchestrator", "culture_emergence_failed", { error: err?.message }); } catch { /* ignore */ }
  }
  try {
    if (typeof mod.listTraditions === "function") {
      cohort = mod.listTraditions({ status: "active" });
    }
  } catch { /* non-fatal */ }
  return {
    ok: true,
    emergedTraditions: emergence?.emerged?.length ?? 0,
    activeTraditions: cohort?.length ?? 0,
  };
}

// ── Forgetting-engine cadence pass ─────────────────────────────────────────
// Phase 3 wire-the-Lost #1: forgetting-engine has 7 macros registered and
// already runs inside governorTick on TICK_FREQUENCIES.FORGETTING. Adding
// it to the lattice-orchestrator heartbeat as well gives a frontend-visible
// "memory pass" event with reportable counts (candidates, forgotten, history).

export async function runForgettingHealthCheck({ db: _db, state: _state, tickCount: _t } = {}) {
  let mod;
  try { mod = await import("./forgetting-engine.js"); }
  catch (err) { return { ok: false, reason: "forgetting_engine_unavailable", error: err?.message }; }

  try {
    const status = mod.getStatus?.() ?? null;
    const candidates = mod.getCandidates?.() ?? null;
    return {
      ok: true,
      candidateCount: Array.isArray(candidates) ? candidates.length : 0,
      lastRunAt: status?.lastRunAt ?? null,
      threshold: status?.threshold ?? null,
    };
  } catch (err) {
    try { logger.warn("lattice-orchestrator", "forgetting_status_failed", { error: err?.message }); } catch { /* ignore */ }
    return { ok: false, reason: "status_threw", error: err?.message };
  }
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
