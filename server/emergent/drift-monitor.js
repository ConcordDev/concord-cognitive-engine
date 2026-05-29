/**
 * Emergent Agent Governance — Drift Monitor
 *
 * Risk Category 3: Emergent System Risks
 *
 * Even with the 3-layer architecture (probabilistic → deterministic → governance),
 * the system can still exhibit:
 *
 *   1. Goodharting — emergents optimize for novelty/coherence signals, producing
 *      "high-scoring nonsense" that looks rigorous but isn't
 *
 *   2. Memetic Drift — emergent-to-emergent interaction amplifies weird priors
 *      over time unless evidence/verification is actually used
 *
 *   3. Silent Capability Creep — as modules are added, combined features create
 *      unexpected autonomy (the risk is composability, not individual features)
 *
 *   4. Self-Referential Loops — system uses its own outputs as evidence for
 *      its own correctness (violates IMM-004)
 *
 * This module provides continuous monitoring — not prevention (that's the gates'
 * job) but detection. It answers: "is the system drifting?"
 */

import { getEmergentState } from "./store.js";

// ── Drift Categories ────────────────────────────────────────────────────────

export const DRIFT_TYPES = Object.freeze({
  GOODHART:          "goodhart",           // metric gaming
  MEMETIC_DRIFT:     "memetic_drift",      // belief convergence without evidence
  CAPABILITY_CREEP:  "capability_creep",   // feature surface expansion
  SELF_REFERENCE:    "self_reference",     // circular evidence
  ECHO_CHAMBER:      "echo_chamber",       // lack of adversarial input
  METRIC_DIVERGENCE: "metric_divergence",  // signals disconnect from outcomes
});

export const ALL_DRIFT_TYPES = Object.freeze(Object.values(DRIFT_TYPES));

// ── Alert Severities ────────────────────────────────────────────────────────

export const DRIFT_SEVERITY = Object.freeze({
  INFO:     "info",       // worth noting
  WARNING:  "warning",    // trend developing
  ALERT:    "alert",      // intervention recommended
  CRITICAL: "critical",   // immediate attention required
});

// ── Drift Monitor Store ─────────────────────────────────────────────────────

export function getDriftStore(STATE) {
  const es = getEmergentState(STATE);
  if (!es._driftMonitor) {
    es._driftMonitor = {
      // Snapshot history for trend analysis
      snapshots: [],                // periodic system snapshots

      // Detected drift events
      alerts: [],                   // drift alerts

      // Capability surface tracking
      capabilityLog: [],            // { timestamp, macroCount, moduleCount, description }
      baselineCapabilities: null,   // first snapshot (established at init)

      // Self-reference tracking
      selfReferenceChain: new Map(), // evidenceId -> { sourceDtuId, derivedFrom }

      // Configuration
      thresholds: {
        // Goodhart detection
        maxNoveltyWithoutEvidence: 0.8,   // DTU novelty score without evidence is suspicious
        maxCoherenceWithoutTest: 0.9,     // Very high coherence without tests is suspicious
        minEvidenceRatio: 0.1,            // At least 10% of DTUs should have evidence

        // Memetic drift
        maxBeliefConvergence: 0.85,       // If >85% of emergents agree without evidence
        minAdversarialRatio: 0.15,        // At least 15% of turns should be adversarial

        // Metric divergence
        maxOutcomeSignalDivergence: 0.4,  // High scores but poor outcomes = Goodharting

        // Self-reference
        maxSelfReferenceDepth: 2,         // Max depth of self-citations before alert

        // Capability creep
        maxCapabilityGrowthPerWeek: 20,   // Max new macros per week
      },

      metrics: {
        totalScans: 0,
        totalAlerts: 0,
        alertsByType: {},
        alertsBySeverity: {},
        lastScan: null,
      },
    };
  }
  return es._driftMonitor;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. COMPREHENSIVE DRIFT SCAN
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run a full drift scan across all categories.
 * This should be called periodically (e.g., every cycle or every hour).
 *
 * @param {Object} STATE
 * @returns {{ ok: boolean, alerts: Object[], snapshot: Object }}
 */
export function runDriftScan(STATE) {
  const es = getEmergentState(STATE);
  const store = getDriftStore(STATE);
  const alerts = [];

  // Take a system snapshot first
  const snapshot = takeSnapshot(STATE, es);
  store.snapshots.push(snapshot);
  if (store.snapshots.length > 500) {
    store.snapshots = store.snapshots.slice(-250);
  }

  // Set baseline if first scan
  if (!store.baselineCapabilities) {
    store.baselineCapabilities = {
      macroCount: snapshot.macroCount,
      moduleCount: snapshot.moduleCount,
      timestamp: snapshot.timestamp,
    };
  }

  // Run all detectors
  alerts.push(...detectGoodharting(STATE, es, store, snapshot));
  alerts.push(...detectMemeticDrift(STATE, es, store, snapshot));
  alerts.push(...detectCapabilityCreep(es, store, snapshot));
  alerts.push(...detectSelfReference(STATE, es, store));
  alerts.push(...detectEchoChamber(STATE, es, store, snapshot));
  alerts.push(...detectMetricDivergence(STATE, es, store, snapshot));

  // Store alerts
  for (const alert of alerts) {
    store.alerts.push(alert);
    store.metrics.totalAlerts++;
    store.metrics.alertsByType[alert.type] = (store.metrics.alertsByType[alert.type] || 0) + 1;
    store.metrics.alertsBySeverity[alert.severity] = (store.metrics.alertsBySeverity[alert.severity] || 0) + 1;
  }

  // Cap alert history
  if (store.alerts.length > 5000) {
    store.alerts = store.alerts.slice(-2500);
  }

  store.metrics.totalScans++;
  store.metrics.lastScan = new Date().toISOString();

  return { ok: true, alerts, alertCount: alerts.length, snapshot };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. INDIVIDUAL DETECTORS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect Goodharting: high metric scores without corresponding real outcomes.
 *
 * If DTUs have high novelty/coherence scores but:
 *   - No evidence attached
 *   - No test results
 *   - Governance rejection rate is rising
 * ...then the system is likely gaming its own metrics.
 */
function detectGoodharting(STATE, es, store, snapshot) {
  const alerts = [];
  const th = store.thresholds;

  // Check: high novelty without evidence
  if (snapshot.avgNovelty > th.maxNoveltyWithoutEvidence &&
      snapshot.evidenceRatio < th.minEvidenceRatio) {
    alerts.push(makeAlert(DRIFT_TYPES.GOODHART, DRIFT_SEVERITY.WARNING,
      `Average DTU novelty (${(snapshot.avgNovelty * 100).toFixed(1)}%) is high but only ` +
      `${(snapshot.evidenceRatio * 100).toFixed(1)}% of DTUs have evidence attached`,
      { avgNovelty: snapshot.avgNovelty, evidenceRatio: snapshot.evidenceRatio }
    ));
  }

  // Check: high coherence without tests
  if (snapshot.avgCoherence > th.maxCoherenceWithoutTest &&
      snapshot.testedRatio < 0.05) {
    alerts.push(makeAlert(DRIFT_TYPES.GOODHART, DRIFT_SEVERITY.ALERT,
      `Average coherence (${(snapshot.avgCoherence * 100).toFixed(1)}%) is very high but only ` +
      `${(snapshot.testedRatio * 100).toFixed(1)}% of DTUs have been tested`,
      { avgCoherence: snapshot.avgCoherence, testedRatio: snapshot.testedRatio }
    ));
  }

  // Check: outcomes vs scores divergence
  if (snapshot.outcomeStats) {
    const { positiveCount, negativeCount: _negativeCount, totalRecorded } = snapshot.outcomeStats;
    if (totalRecorded > 20) {
      const successRate = positiveCount / totalRecorded;
      if (snapshot.avgCoherence > 0.7 && successRate < 0.4) {
        alerts.push(makeAlert(DRIFT_TYPES.GOODHART, DRIFT_SEVERITY.ALERT,
          `High internal scores (coherence: ${(snapshot.avgCoherence * 100).toFixed(0)}%) ` +
          `but low outcome success rate (${(successRate * 100).toFixed(0)}%) — possible Goodharting`,
          { coherence: snapshot.avgCoherence, successRate, totalOutcomes: totalRecorded }
        ));
      }
    }
  }

  return alerts;
}

/**
 * Detect Memetic Drift: belief convergence without evidence basis.
 *
 * If most DTUs agree on something but there's no external evidence or
 * adversarial testing, the lattice may be converging on an unsupported belief.
 */
function detectMemeticDrift(STATE, es, store, snapshot) {
  const alerts = [];

  // Check dispute rate — if nothing is disputed, that's suspicious
  if (snapshot.totalDtus > 50 && snapshot.disputedRatio === 0) {
    alerts.push(makeAlert(DRIFT_TYPES.MEMETIC_DRIFT, DRIFT_SEVERITY.INFO,
      `Zero disputed DTUs out of ${snapshot.totalDtus} — possible lack of adversarial review`,
      { totalDtus: snapshot.totalDtus, disputedRatio: 0 }
    ));
  }

  // Check contradiction rate trend — if it's decreasing without resolution
  if (store.snapshots.length >= 5) {
    const recent = store.snapshots.slice(-5);
    const contradictionTrend = recent.map(s => s.contradictionDensity);
    const isDecreasing = contradictionTrend.every((v, i) =>
      i === 0 || v <= contradictionTrend[i - 1]
    );
    const totalDecrease = contradictionTrend[0] - contradictionTrend[contradictionTrend.length - 1];

    // Decreasing contradictions can be GOOD (resolution) or BAD (suppression)
    // We flag if it decreases but evidence count isn't growing proportionally
    if (isDecreasing && totalDecrease > 0.1 && snapshot.evidenceRatio < 0.2) {
      alerts.push(makeAlert(DRIFT_TYPES.MEMETIC_DRIFT, DRIFT_SEVERITY.WARNING,
        `Contradiction density is decreasing (${(totalDecrease * 100).toFixed(1)}% drop) ` +
        `but evidence coverage is low (${(snapshot.evidenceRatio * 100).toFixed(1)}%) — ` +
        `contradictions may be being suppressed rather than resolved`,
        { contradictionTrend, evidenceRatio: snapshot.evidenceRatio }
      ));
    }
  }

  return alerts;
}

/**
 * Detect Capability Creep: unexpected growth in system capabilities.
 *
 * This tracks macro registrations, module additions, and feature surface
 * expansion over time.
 */
function detectCapabilityCreep(es, store, snapshot) {
  const alerts = [];

  if (!store.baselineCapabilities) return alerts;

  const macroGrowth = snapshot.macroCount - store.baselineCapabilities.macroCount;
  const baselineAge = Date.now() - new Date(store.baselineCapabilities.timestamp).getTime();
  const weeksElapsed = Math.max(1, baselineAge / (7 * 24 * 3600 * 1000));
  const growthPerWeek = macroGrowth / weeksElapsed;

  if (growthPerWeek > store.thresholds.maxCapabilityGrowthPerWeek) {
    alerts.push(makeAlert(DRIFT_TYPES.CAPABILITY_CREEP, DRIFT_SEVERITY.WARNING,
      `Capability growth rate: ${growthPerWeek.toFixed(1)} macros/week ` +
      `(threshold: ${store.thresholds.maxCapabilityGrowthPerWeek}). ` +
      `Total: ${store.baselineCapabilities.macroCount} → ${snapshot.macroCount}`,
      { macroGrowth, growthPerWeek, weeksElapsed: weeksElapsed.toFixed(1) }
    ));
  }

  // Log capability changes
  const lastLog = store.capabilityLog[store.capabilityLog.length - 1];
  if (!lastLog || lastLog.macroCount !== snapshot.macroCount) {
    store.capabilityLog.push({
      timestamp: snapshot.timestamp,
      macroCount: snapshot.macroCount,
      moduleCount: snapshot.moduleCount,
    });
    if (store.capabilityLog.length > 200) {
      store.capabilityLog = store.capabilityLog.slice(-100);
    }
  }

  return alerts;
}

/**
 * Detect Self-Reference Loops: system citing itself as evidence.
 *
 * This directly supports IMM-004: "No self-reinforcing delusion loops."
 */
function detectSelfReference(STATE, es, _store) {
  const alerts = [];
  const evidenceStore = es._evidence;
  if (!evidenceStore) return alerts;

  // Check for DTUs that cite themselves or form citation loops
  const citationGraph = new Map(); // dtuId -> Set<dtuId it references>

  for (const ev of evidenceStore.evidence.values()) {
    if (ev.supersededBy) continue;
    if (ev.type === "cross_reference" && ev.data?.referencedDtuId) {
      if (!citationGraph.has(ev.dtuId)) citationGraph.set(ev.dtuId, new Set());
      citationGraph.get(ev.dtuId).add(ev.data.referencedDtuId);

      // Direct self-citation
      if (ev.dtuId === ev.data.referencedDtuId) {
        alerts.push(makeAlert(DRIFT_TYPES.SELF_REFERENCE, DRIFT_SEVERITY.ALERT,
          `DTU ${ev.dtuId} cites itself as evidence (direct self-reference loop)`,
          { dtuId: ev.dtuId, evidenceId: ev.evidenceId }
        ));
      }
    }
  }

  // Check for circular citation chains (A→B→A)
  for (const [dtuId, refs] of citationGraph) {
    for (const refId of refs) {
      const refRefs = citationGraph.get(refId);
      if (refRefs && refRefs.has(dtuId)) {
        alerts.push(makeAlert(DRIFT_TYPES.SELF_REFERENCE, DRIFT_SEVERITY.ALERT,
          `Circular citation loop: ${dtuId} ↔ ${refId}`,
          { dtuA: dtuId, dtuB: refId }
        ));
      }
    }
  }

  return alerts;
}

/**
 * Detect Echo Chamber: lack of adversarial input in the system.
 */
function detectEchoChamber(STATE, es, store, snapshot) {
  const alerts = [];

  // Check if adversarial roles are active
  if (snapshot.activeEmergents > 0 && snapshot.adversarialRatio < store.thresholds.minAdversarialRatio) {
    alerts.push(makeAlert(DRIFT_TYPES.ECHO_CHAMBER, DRIFT_SEVERITY.WARNING,
      `Only ${(snapshot.adversarialRatio * 100).toFixed(1)}% of active emergents have ` +
      `adversarial roles (threshold: ${(store.thresholds.minAdversarialRatio * 100).toFixed(0)}%)`,
      { adversarialRatio: snapshot.adversarialRatio, activeEmergents: snapshot.activeEmergents }
    ));
  }

  return alerts;
}

/**
 * Detect Metric Divergence: internal signals disconnecting from outcomes.
 */
function detectMetricDivergence(STATE, es, store, snapshot) {
  const alerts = [];

  // Compare weight learning trends: are weights changing but outcomes not improving?
  const outcomeStore = es._outcomes;
  if (!outcomeStore || outcomeStore.weightUpdates.length < 2) return alerts;

  const recentUpdates = outcomeStore.weightUpdates.slice(-5);
  const totalAdjustments = recentUpdates.reduce((sum, u) =>
    sum + Object.keys(u.adjustments || {}).length, 0
  );

  // If weights keep changing but success rate isn't improving
  if (totalAdjustments > 10 && snapshot.outcomeStats) {
    const { positiveCount, totalRecorded } = snapshot.outcomeStats;
    if (totalRecorded > 30 && positiveCount / totalRecorded < 0.5) {
      alerts.push(makeAlert(DRIFT_TYPES.METRIC_DIVERGENCE, DRIFT_SEVERITY.WARNING,
        `${totalAdjustments} weight adjustments in recent cycles but success rate ` +
        `remains at ${((positiveCount / totalRecorded) * 100).toFixed(0)}% — ` +
        `learning may not be converging`,
        { totalAdjustments, successRate: positiveCount / totalRecorded }
      ));
    }
  }

  return alerts;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. QUERY & MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get recent drift alerts.
 */
export function getDriftAlerts(STATE, filters = {}) {
  const store = getDriftStore(STATE);
  let results = store.alerts;

  if (filters.type) results = results.filter(a => a.type === filters.type);
  if (filters.severity) {
    // Accept a single severity string OR an array (e.g. ["alert","critical"]).
    // The orchestrator needs the multi-value form to route HIGH/CRITICAL → HLR.
    const sevs = Array.isArray(filters.severity) ? filters.severity : [filters.severity];
    results = results.filter(a => sevs.includes(a.severity));
  }
  if (filters.since) {
    results = results.filter(a => a.timestamp >= filters.since);
  }

  const limit = Math.min(filters.limit || 50, 200);
  return { ok: true, alerts: results.slice(-limit), total: results.length };
}

/**
 * Update drift detection thresholds.
 */
export function updateDriftThresholds(STATE, overrides = {}) {
  const store = getDriftStore(STATE);
  for (const [key, value] of Object.entries(overrides)) {
    if (key in store.thresholds && typeof value === "number") {
      store.thresholds[key] = value;
    }
  }
  return { ok: true, thresholds: { ...store.thresholds } };
}

/**
 * Get drift monitor metrics.
 */
export function getDriftMetrics(STATE) {
  const store = getDriftStore(STATE);
  return {
    ok: true,
    metrics: { ...store.metrics },
    snapshotCount: store.snapshots.length,
    alertCount: store.alerts.length,
    capabilityLogSize: store.capabilityLog.length,
    baselineCapabilities: store.baselineCapabilities,
    thresholds: { ...store.thresholds },
  };
}

/**
 * Get system snapshots (for trend analysis).
 */
export function getSnapshots(STATE, count = 20) {
  const store = getDriftStore(STATE);
  return { ok: true, snapshots: store.snapshots.slice(-count), total: store.snapshots.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function takeSnapshot(STATE, es) {
  const totalDtus = STATE.dtus?.size || 0;
  const evidenceStore = es._evidence;
  const outcomeStore = es._outcomes;
  const edgeStore = es._edges;

  // Compute averages from DTU data
  let avgNovelty = 0;
  let avgCoherence = 0;
  let avgResonance = 0;
  if (STATE.dtus && totalDtus > 0) {
    let nSum = 0, cSum = 0, rSum = 0, count = 0;
    for (const dtu of STATE.dtus.values()) {
      if (typeof dtu.novelty === "number") nSum += dtu.novelty;
      if (typeof dtu.coherence === "number") cSum += dtu.coherence;
      if (typeof dtu.resonance === "number") rSum += dtu.resonance;
      count++;
    }
    if (count > 0) {
      avgNovelty = nSum / count;
      avgCoherence = cSum / count;
      avgResonance = rSum / count;
    }
  }

  // Evidence coverage
  const trackedDtus = evidenceStore?.byDtu?.size || 0;
  const evidenceRatio = totalDtus > 0 ? trackedDtus / totalDtus : 0;

  // Tested ratio
  const testedDtus = evidenceStore?.byStatus?.get("tested")?.size || 0;
  const verifiedDtus = evidenceStore?.byStatus?.get("verified")?.size || 0;
  const testedRatio = totalDtus > 0 ? (testedDtus + verifiedDtus) / totalDtus : 0;

  // Disputed ratio
  const disputedDtus = evidenceStore?.byStatus?.get("disputed")?.size || 0;
  const disputedRatio = totalDtus > 0 ? disputedDtus / totalDtus : 0;

  // Contradiction density
  let contradictionDensity = 0;
  if (edgeStore?.edges && totalDtus > 0) {
    const contradictedDtus = new Set();
    for (const edge of edgeStore.edges.values()) {
      if (edge.edgeType === "contradicts") {
        contradictedDtus.add(edge.sourceId);
        contradictedDtus.add(edge.targetId);
      }
    }
    contradictionDensity = contradictedDtus.size / totalDtus;
  }

  // Active emergents and role distribution
  const emergents = es.emergents ? Array.from(es.emergents.values()).filter(e => e.active !== false) : [];
  const activeEmergents = emergents.length;
  const adversarialRoles = ["critic", "adversary", "auditor"];
  const adversarialCount = emergents.filter(e => adversarialRoles.includes(e.role)).length;
  const adversarialRatio = activeEmergents > 0 ? adversarialCount / activeEmergents : 0;

  // Macro count (from routes or store)
  const macroCount = es._threatSurface?.routeRegistry?.size || 0;
  const moduleCount = countModules(es);

  return {
    timestamp: new Date().toISOString(),
    totalDtus,
    avgNovelty: round(avgNovelty),
    avgCoherence: round(avgCoherence),
    avgResonance: round(avgResonance),
    evidenceRatio: round(evidenceRatio),
    testedRatio: round(testedRatio),
    disputedRatio: round(disputedRatio),
    contradictionDensity: round(contradictionDensity),
    activeEmergents,
    adversarialRatio: round(adversarialRatio),
    macroCount,
    moduleCount,
    outcomeStats: outcomeStore?.stats ? {
      positiveCount: outcomeStore.stats.positiveCount,
      negativeCount: outcomeStore.stats.negativeCount,
      totalRecorded: outcomeStore.stats.totalRecorded,
    } : null,
  };
}

function countModules(es) {
  let count = 0;
  const moduleKeys = [
    "_outcomes", "_skills", "_projects", "_institutionalMemory",
    "_evidence", "_verificationPipelines", "_goals", "_constitution",
    "_threatSurface", "_injectionDefense", "_driftMonitor",
    "_schemaGuard", "_deepHealth", "_contentShield",
    "_edges", "_activation", "_merge", "_journal",
  ];
  for (const key of moduleKeys) {
    if (es[key]) count++;
  }
  return count;
}

function makeAlert(type, severity, message, data = {}) {
  return {
    alertId: `drift_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    severity,
    message,
    data,
    timestamp: new Date().toISOString(),
    acknowledged: false,
  };
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
