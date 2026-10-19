// server/emergent/mission-runtime-cycle.js
//
// P0 — Autonomous mission runtime heartbeat. Spawns missions from upstream
// signals, then ticks due missions through F0 dispatchMCP.

import logger from "../logger.js";
import {
  findDueMissions,
  spawnAutonomousMissions,
  tickMission,
} from "../lib/mission-runtime.js";

const MAX_TICK_PER_PASS = Number(process.env.CONCORD_MISSION_MAX_TICK_PER_PASS) || 3;
const SLOW_STEP_MS = 250;

async function timedStep(name, fn) {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const ms = performance.now() - start;
    if (ms > SLOW_STEP_MS) {
      logger.warn("mission-runtime-cycle", "mission_runtime_step_slow", {
        step: name,
        ms: Math.round(ms),
      });
    }
  }
}

export async function runMissionRuntimeCycle({ db } = {}) {
  if (process.env.CONCORD_MISSION_RUNTIME === "0") {
    return { ok: true, reason: "disabled" };
  }

  const database = db || globalThis._concordDB || globalThis.STATE?.db;
  if (!database) return { ok: false, reason: "no_db" };

  let dispatchMCP;
  try {
    const mod = await import("../lib/auth-gate/dispatch.js");
    dispatchMCP = mod.dispatchMCP;
  } catch (e) {
    return { ok: false, reason: "dispatch_unavailable", error: e?.message };
  }

  const spawnResult = await timedStep("spawn_autonomous_missions", () =>
    spawnAutonomousMissions({
      db: database,
      dispatchMCP,
      STATE: globalThis.STATE || null,
    })
  );

  let marathonTick = { ok: true, ticked: 0 };
  try {
    const { tickLinkedMarathons } = await import("../lib/mission-marathon-bridge.js");
    marathonTick = await timedStep("tick_linked_marathons", () =>
      tickLinkedMarathons(database, { limit: 2 })
    );
  } catch { /* optional */ }

  let orgSync = { ok: true };
  try {
    const { syncOrgFromRoster } = await import("../lib/runtime/agent-org.js");
    orgSync = await timedStep("sync_org_from_roster", () => syncOrgFromRoster(database));
  } catch { /* optional */ }

  let repoGraph = { ok: true };
  try {
    const { ensureRepoIndexFresh } = await import("../lib/runtime/repo-graph.js");
    repoGraph = await timedStep("ensure_repo_index_fresh", () =>
      ensureRepoIndexFresh(database)
    );
  } catch { /* optional */ }

  let selfImprove = { ok: true, processed: 0 };
  try {
    const { processPendingProposals } = await import("../lib/runtime/self-improvement.js");
    selfImprove = await timedStep("process_pending_proposals", () =>
      processPendingProposals(database, dispatchMCP, { limit: 1 })
    );
  } catch { /* optional */ }

  const due = await timedStep("find_due_missions", () => findDueMissions(database, MAX_TICK_PER_PASS));
  const tickResults = [];
  for (const mission of due) {
    try {
      const r = await timedStep(`tick_mission:${mission.id}`, () =>
        tickMission({
          db: database,
          missionId: mission.id,
          dispatchMCP,
          STATE: globalThis.STATE || null,
        })
      );
      tickResults.push({ missionId: mission.id, template: mission.template, ...r });
    } catch (e) {
      tickResults.push({ missionId: mission.id, ok: false, error: e?.message || String(e) });
    }
  }

  return {
    ok: true,
    spawned: spawnResult?.spawned ?? 0,
    spawnDetail: spawnResult,
    marathonTick,
    orgSync,
    repoGraph,
    selfImprove,
    ticked: tickResults.length,
    tickResults,
  };
}
