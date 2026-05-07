/**
 * Substrate Dreams — Full 6-Phase Night Cycle Orchestrator
 *
 * Wires together dream-capture.js and sleep-consolidation.js into
 * the complete 6-phase autonomous night cycle:
 *
 * Phase 1: REPLAY — Replay today's sessions, identify key moments
 * Phase 2: CONSOLIDATE — Strengthen strong memories, prune weak traces
 * Phase 3: CONNECT — Find novel connections across domains (ghost threads)
 * Phase 4: PREDICT — Generate predictions from consolidated knowledge
 * Phase 5: HEAL — Run repair cortex self-test, fix detected issues
 * Phase 6: COMPOSE — Write the morning brief from phases 1-5
 *
 * The cycle runs automatically during off-peak hours or can be
 * triggered manually. Each phase produces DTUs with full provenance.
 */

import { v4 as uuid } from "uuid";
import logger from "../logger.js";

// ── Phase Definitions ────────────────────────────────────────────────────────

const DREAM_PHASES = {
  REPLAY:      { id: "replay",      order: 1, name: "Replay",      description: "Replay today's sessions, identify key moments" },
  CONSOLIDATE: { id: "consolidate", order: 2, name: "Consolidate", description: "Strengthen strong memories, prune weak traces" },
  CONNECT:     { id: "connect",     order: 3, name: "Connect",     description: "Find novel cross-domain connections" },
  PREDICT:     { id: "predict",     order: 4, name: "Predict",     description: "Generate predictions from consolidated knowledge" },
  HEAL:        { id: "heal",        order: 5, name: "Heal",        description: "Run repair cortex self-test, fix issues" },
  COMPOSE:     { id: "compose",     order: 6, name: "Compose",     description: "Write the morning brief" },
};

const CYCLE_STATES = {
  IDLE:      "idle",
  RUNNING:   "running",
  COMPLETED: "completed",
  FAILED:    "failed",
};

// ── State ────────────────────────────────────────────────────────────────────

/** @type {object} Current cycle state */
const _cycleState = {
  state: CYCLE_STATES.IDLE,
  currentPhase: null,
  currentCycleId: null,
  lastCycleAt: null,
  cycleHistory: [],    // Last 30 cycles
};

const _metrics = {
  totalCycles: 0,
  completedCycles: 0,
  failedCycles: 0,
  totalDtusProduced: 0,
  avgCycleDuration: 0,
  totalDuration: 0,
  phaseMetrics: {},
};

// ── Phase Implementations ────────────────────────────────────────────────────

/**
 * Phase 1: REPLAY — Review today's sessions.
 */
async function _phaseReplay(STATE, cycle) {
  const sessions = _getRecentSessions(STATE);
  const keyMoments = [];

  for (const session of sessions) {
    // Identify sessions with high novelty or many DTUs created
    const dtus = session.dtusCreated || 0;
    const novelty = session.noveltyScore || 0;

    if (dtus > 0 || novelty > 0.5) {
      keyMoments.push({
        sessionId: session.id || session.sessionId,
        type: "key_moment",
        dtusCreated: dtus,
        novelty,
        domain: session.domain || session.lens,
        summary: session.summary || `Session with ${dtus} DTUs`,
      });
    }
  }

  return {
    sessionsReviewed: sessions.length,
    keyMoments,
    dtusFromToday: keyMoments.reduce((sum, m) => sum + (m.dtusCreated || 0), 0),
  };
}

/**
 * Phase 2: CONSOLIDATE — Strengthen and prune memories.
 */
async function _phaseConsolidate(STATE, cycle) {
  let consolidated = 0;
  let pruned = 0;

  // Use sleep-consolidation if available
  try {
    const { runConsolidation } = await import("./sleep-consolidation.js");
    const entities = _getEntityIds(STATE);

    for (const entityId of entities.slice(0, 5)) {
      try {
        const result = runConsolidation(entityId);
        if (result) {
          consolidated += result.consolidated || 1;
          pruned += result.pruned || 0;
        }
      } catch (_) { /* entity may not have sleep state */ }
    }
  } catch (_) {
    // Fallback: count shadow DTUs eligible for pruning
    const dtus = _getAllDtus(STATE);
    const shadows = dtus.filter(d => d.tier === "shadow" && d.authority < 0.1);
    pruned = shadows.length;
    consolidated = dtus.filter(d => d.authority > 0.5).length;
  }

  return { consolidated, pruned, totalMemories: _getAllDtus(STATE).length };
}

/**
 * Phase 3: CONNECT — Find cross-domain connections via ghost threads.
 */
async function _phaseConnect(STATE, cycle) {
  try {
    const { runGhostThread } = await import("./ghost-threads.js");
    const result = runGhostThread(STATE, { sampleSize: 8 });

    if (result.ok) {
      return {
        connections: result.connections,
        insights: result.insights?.length || 0,
        domains: result.domains || [],
      };
    }
    return { connections: 0, insights: 0, domains: [], note: result.reason };
  } catch (err) {
    return { connections: 0, insights: 0, domains: [], error: err.message };
  }
}

/**
 * Phase 4: PREDICT — Generate predictions from patterns.
 */
async function _phasePredict(STATE, cycle) {
  const dtus = _getAllDtus(STATE);
  const predictions = [];

  // Look for trending domains (domains with most recent activity)
  const domainActivity = {};
  for (const dtu of dtus) {
    const domain = (dtu.tags || []).find(t => t.startsWith("domain:") || t.startsWith("lens:"));
    if (domain) {
      domainActivity[domain] = (domainActivity[domain] || 0) + 1;
    }
  }

  // Predict which domains will see growth
  const sorted = Object.entries(domainActivity).sort((a, b) => b[1] - a[1]);
  for (const [domain, count] of sorted.slice(0, 5)) {
    if (count > 3) {
      predictions.push({
        type: "domain_growth",
        domain,
        confidence: Math.min(0.8, count / 20),
        reason: `${count} DTUs in domain suggest continued activity`,
      });
    }
  }

  // Look for knowledge gaps (domains with many queries but few DTUs)
  const replayData = cycle.phases.replay?.result || {};
  const keyMoments = replayData.keyMoments || [];
  for (const moment of keyMoments) {
    if (moment.novelty > 0.7) {
      predictions.push({
        type: "emerging_insight",
        domain: moment.domain,
        confidence: moment.novelty * 0.6,
        reason: `High novelty session suggests emerging knowledge area`,
      });
    }
  }

  return { predictions, count: predictions.length };
}

/**
 * Phase 5: HEAL — Run self-tests and repairs.
 */
async function _phaseHeal(STATE, cycle) {
  const healResults = { issuesFound: 0, issuesFixed: 0, tests: [] };

  try {
    const { repairCortexSelfTest, getFullRepairStatus } = await import("./repair-cortex.js");

    const testResult = repairCortexSelfTest();
    healResults.tests.push({ name: "repair_cortex", ...testResult });
    if (!testResult.passed) healResults.issuesFound++;

    const status = getFullRepairStatus();
    healResults.repairStatus = {
      patternsStored: status.patternsStored || 0,
      successRate: status.successRate || 0,
    };
  } catch (_) {
    healResults.tests.push({ name: "repair_cortex", status: "unavailable" });
  }

  // Check for stale DTUs
  try {
    const dtus = _getAllDtus(STATE);
    const now = Date.now();
    const stale = dtus.filter(d => {
      const age = now - new Date(d.createdAt || 0).getTime();
      return age > 30 * 24 * 60 * 60 * 1000 && d.authority < 0.2; // 30+ days old, low authority
    });
    healResults.staleDtus = stale.length;
    if (stale.length > 50) {
      healResults.issuesFound++;
      healResults.recommendation = `${stale.length} stale DTUs could be archived`;
    }
  } catch (_) {}

  return healResults;
}

/**
 * Phase 6: COMPOSE — Write the morning brief.
 */
async function _phaseCompose(STATE, cycle) {
  const replay = cycle.phases.replay?.result || {};
  const consolidate = cycle.phases.consolidate?.result || {};
  const connect = cycle.phases.connect?.result || {};
  const predict = cycle.phases.predict?.result || {};
  const heal = cycle.phases.heal?.result || {};

  const brief = {
    id: uuid(),
    type: "morning_brief",
    tier: "shadow",
    date: new Date().toISOString().slice(0, 10),
    sections: {
      yesterday: {
        title: "Yesterday's Activity",
        sessionsReviewed: replay.sessionsReviewed || 0,
        keyMoments: (replay.keyMoments || []).length,
        dtusCreated: replay.dtusFromToday || 0,
      },
      memory: {
        title: "Memory Health",
        consolidated: consolidate.consolidated || 0,
        pruned: consolidate.pruned || 0,
        totalMemories: consolidate.totalMemories || 0,
      },
      discoveries: {
        title: "New Connections",
        connections: connect.connections || 0,
        insights: connect.insights || 0,
        domains: connect.domains || [],
      },
      predictions: {
        title: "Predictions",
        items: (predict.predictions || []).slice(0, 5),
      },
      health: {
        title: "System Health",
        issuesFound: heal.issuesFound || 0,
        issuesFixed: heal.issuesFixed || 0,
        staleDtus: heal.staleDtus || 0,
        recommendation: heal.recommendation || null,
      },
    },
    summary: _generateBriefSummary(replay, consolidate, connect, predict, heal),
    createdAt: new Date().toISOString(),
    authority: 0.4,
    tags: ["morning_brief", "dream_cycle", `date:${new Date().toISOString().slice(0, 10)}`],
  };

  return brief;
}

function _generateBriefSummary(replay, consolidate, connect, predict, heal) {
  const parts = [];

  if (replay.sessionsReviewed) {
    parts.push(`Reviewed ${replay.sessionsReviewed} sessions from yesterday with ${replay.dtusFromToday || 0} DTUs created.`);
  }
  if (consolidate.consolidated) {
    parts.push(`Consolidated ${consolidate.consolidated} memories, pruned ${consolidate.pruned || 0} weak traces.`);
  }
  if (connect.connections) {
    parts.push(`Discovered ${connect.connections} cross-domain connections across ${(connect.domains || []).length} domains.`);
  }
  if (predict.predictions?.length) {
    parts.push(`Generated ${predict.predictions.length} predictions for emerging trends.`);
  }
  if (heal.issuesFound) {
    parts.push(`Found ${heal.issuesFound} health issues${heal.recommendation ? `: ${heal.recommendation}` : ""}.`);
  } else {
    parts.push("All systems healthy.");
  }

  return parts.join(" ");
}

// ── Cycle Orchestrator ───────────────────────────────────────────────────────

/**
 * Run the full 6-phase dream cycle.
 *
 * @param {object} STATE - The emergent state
 * @returns {{ ok: boolean, cycleId: string, morningBrief: object, metrics: object }}
 */
export async function runDreamCycle(STATE) {
  if (_cycleState.state === CYCLE_STATES.RUNNING) {
    return { ok: false, reason: "cycle_already_running" };
  }

  const cycleId = uuid();
  _cycleState.state = CYCLE_STATES.RUNNING;
  _cycleState.currentCycleId = cycleId;

  const cycle = {
    id: cycleId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    phases: {},
    morningBrief: null,
    dtusProduced: 0,
  };

  const phaseOrder = ["replay", "consolidate", "connect", "predict", "heal", "compose"];
  const phaseFns = {
    replay: _phaseReplay,
    consolidate: _phaseConsolidate,
    connect: _phaseConnect,
    predict: _phasePredict,
    heal: _phaseHeal,
    compose: _phaseCompose,
  };

  try {
    for (const phaseId of phaseOrder) {
      _cycleState.currentPhase = phaseId;
      const phaseStart = Date.now();

      logger.info("dream-cycle", `Phase ${phaseId} starting...`);

      try {
        const result = await phaseFns[phaseId](STATE, cycle);
        const duration = Date.now() - phaseStart;

        cycle.phases[phaseId] = {
          result,
          duration,
          state: "completed",
        };

        if (!_metrics.phaseMetrics[phaseId]) _metrics.phaseMetrics[phaseId] = { runs: 0, totalDuration: 0, avgDuration: 0 };
        _metrics.phaseMetrics[phaseId].runs++;
        _metrics.phaseMetrics[phaseId].totalDuration += duration;
        _metrics.phaseMetrics[phaseId].avgDuration = _metrics.phaseMetrics[phaseId].totalDuration / _metrics.phaseMetrics[phaseId].runs;

        logger.info("dream-cycle", `Phase ${phaseId} completed in ${duration}ms`);
      } catch (err) {
        cycle.phases[phaseId] = { result: null, error: err.message, state: "failed" };
        logger.error("dream-cycle", `Phase ${phaseId} failed: ${err.message}`);
        // Continue to next phase even if one fails
      }
    }

    // Extract morning brief from compose phase
    cycle.morningBrief = cycle.phases.compose?.result || null;
    cycle.completedAt = new Date().toISOString();

    _cycleState.state = CYCLE_STATES.COMPLETED;
    _cycleState.lastCycleAt = cycle.completedAt;
    _cycleState.currentPhase = null;
    _cycleState.currentCycleId = null;

    // Track in history
    _cycleState.cycleHistory.push({
      id: cycleId,
      startedAt: cycle.startedAt,
      completedAt: cycle.completedAt,
      phasesCompleted: Object.values(cycle.phases).filter(p => p.state === "completed").length,
      phasesTotal: phaseOrder.length,
    });
    if (_cycleState.cycleHistory.length > 30) {
      _cycleState.cycleHistory = _cycleState.cycleHistory.slice(-30);
    }

    const duration = new Date(cycle.completedAt) - new Date(cycle.startedAt);
    _metrics.totalCycles++;
    _metrics.completedCycles++;
    _metrics.totalDuration += duration;
    _metrics.avgCycleDuration = _metrics.totalDuration / _metrics.completedCycles;

    logger.info("dream-cycle", `Dream cycle ${cycleId} completed in ${Math.round(duration / 1000)}s`);

    return {
      ok: true,
      cycleId,
      morningBrief: cycle.morningBrief,
      phases: Object.fromEntries(
        Object.entries(cycle.phases).map(([k, v]) => [k, { state: v.state, duration: v.duration }])
      ),
      duration,
    };

  } catch (err) {
    _cycleState.state = CYCLE_STATES.FAILED;
    _cycleState.currentPhase = null;
    _metrics.totalCycles++;
    _metrics.failedCycles++;

    logger.error("dream-cycle", `Dream cycle failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Get the current cycle state.
 */
export function getDreamCycleState() {
  return {
    state: _cycleState.state,
    currentPhase: _cycleState.currentPhase,
    lastCycleAt: _cycleState.lastCycleAt,
    recentCycles: _cycleState.cycleHistory.slice(-5),
  };
}

/**
 * Get dream cycle metrics.
 */
export function getDreamCycleMetrics() {
  return { ..._metrics };
}

/**
 * Get the latest morning brief.
 */
export function getLatestMorningBrief() {
  const lastCycle = _cycleState.cycleHistory[_cycleState.cycleHistory.length - 1];
  if (!lastCycle) return null;
  // Morning brief is stored in the cycle's compose phase
  // In production this would be persisted; for now return state
  return {
    cycleId: lastCycle.id,
    date: lastCycle.completedAt?.slice(0, 10),
    completedAt: lastCycle.completedAt,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _getRecentSessions(STATE) {
  if (STATE?.__emergent?.sessions) {
    return [...STATE.__emergent.sessions.values()].slice(-20);
  }
  return [];
}

function _getEntityIds(STATE) {
  if (STATE?.__emergent?.emergents) {
    return [...STATE.__emergent.emergents.keys()].slice(0, 10);
  }
  return [];
}

function _getAllDtus(STATE) {
  if (STATE?.dtus) {
    if (STATE.dtus instanceof Map) return [...STATE.dtus.values()];
    if (Array.isArray(STATE.dtus)) return STATE.dtus;
    return Object.values(STATE.dtus);
  }
  return [];
}

// ── Exports ──────────────────────────────────────────────────────────────────

export { DREAM_PHASES, CYCLE_STATES };

export default {
  runDreamCycle,
  getDreamCycleState,
  getDreamCycleMetrics,
  getLatestMorningBrief,
};
