// server/lib/runtime/mission-priority.js
//
// Priority queue for autonomous mission spawn — incident > opportunity > predict > initiative.

import { pickPackForSignal, expandDomainPack } from "./domain-packs.js";

const SOURCE_WEIGHT = Object.freeze({
  incident: 0.95,
  opportunity: 0.85,
  predict: 0.75,
  initiative: 0.70,
  proactive: 0.65,
  research: 0.60,
  coding: 0.55,
  sentinel: 0.50,
  scheduled: 0.45,
  default: 0.40,
});

const TEMPLATE_BY_SOURCE = Object.freeze({
  incident: "watch_detect",
  opportunity: "opportunity_pipeline",
  proactive: "proactive_research",
  predict: "proactive_research",
  initiative: "initiative_monitor",
  sentinel: "watch_detect",
  scheduled: "fleet_health",
  coding: "coding_loop_closed",
});

export function scoreCandidate(candidate = {}) {
  const src = String(candidate.source || candidate.kind || "default").toLowerCase();
  const base = SOURCE_WEIGHT[src] ?? SOURCE_WEIGHT.default;
  const severity = Number(candidate.severity || 0);
  const confidence = Number(candidate.confidence ?? 0.5);
  const urgency = Number(candidate.urgency ?? 0);
  const score = base + severity * 0.05 + confidence * 0.1 + urgency * 0.08;
  return Math.min(1, Math.max(0, score));
}

export function rankSpawnCandidates(candidates = []) {
  return [...candidates]
    .map((c) => ({ ...c, priority_score: scoreCandidate(c) }))
    .sort((a, b) => b.priority_score - a.priority_score);
}

export function pickTopCandidates(candidates, limit = 3) {
  return rankSpawnCandidates(candidates).slice(0, limit);
}

function resolveTemplate(candidate) {
  if (candidate.template) return candidate.template;
  const packId = pickPackForSignal({
    type: candidate.signal || candidate.kind || candidate.source,
    level: candidate.level,
  });
  const expanded = expandDomainPack(packId, {
    template: TEMPLATE_BY_SOURCE[candidate.source],
    spawnContext: candidate.spawnContext || {},
  });
  return expanded?.template || TEMPLATE_BY_SOURCE[candidate.source] || "fleet_health";
}

/**
 * Spawn missions from ranked candidates with domain pack selection.
 */
export async function spawnFromPriorityQueue(db, candidates = [], {
  limit = 2,
  recentMissionExists,
} = {}) {
  const { createMission } = await import("../mission-runtime.js");
  const top = pickTopCandidates(candidates, limit);
  const spawned = [];

  for (const c of top) {
    const template = resolveTemplate(c);
    const ref = c.sourceRef || c.ref || `${c.source}_${Date.now()}`;
    if (typeof recentMissionExists === "function"
      && recentMissionExists(db, c.source, ref, template, c.dedupeWindowSec || 3600)) {
      continue;
    }

    const r = createMission(db, {
      title: c.title || `Autonomous: ${c.source}`,
      goal: c.goal || c.title,
      template,
      source: c.source || "autonomous",
      sourceRef: ref,
      userId: "system",
      spawnContext: c.spawnContext,
      priority_score: c.priority_score,
    });

    if (r.ok) {
      try {
        db.prepare(`UPDATE mission_tasks SET priority_score = ? WHERE id = ?`)
          .run(c.priority_score, r.missionId);
      } catch { /* column optional pre-migration */ }
      spawned.push({
        template,
        missionId: r.missionId,
        trigger: c.source,
        priority_score: c.priority_score,
      });
    }
  }

  return { ok: true, spawned, considered: top.length };
}

export function orderDueMissions(rows = []) {
  return [...rows].sort((a, b) => {
    const ps = (b.priority_score ?? 0.5) - (a.priority_score ?? 0.5);
    if (ps !== 0) return ps;
    return (a.next_tick_at || 0) - (b.next_tick_at || 0);
  });
}
