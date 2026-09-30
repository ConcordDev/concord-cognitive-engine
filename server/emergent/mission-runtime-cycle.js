// server/emergent/mission-runtime-cycle.js
//
// P0 — Autonomous mission runtime heartbeat. Spawns missions from upstream
// signals, then ticks due missions through F0 dispatchMCP.

import {
  findDueMissions,
  spawnAutonomousMissions,
  tickMission,
} from "../lib/mission-runtime.js";

const MAX_TICK_PER_PASS = Number(process.env.CONCORD_MISSION_MAX_TICK_PER_PASS) || 3;

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

  const spawnResult = await spawnAutonomousMissions({
    db: database,
    dispatchMCP,
    STATE: globalThis.STATE || null,
  });

  let marathonTick = { ok: true, ticked: 0 };
  try {
    const { tickLinkedMarathons } = await import("../lib/mission-marathon-bridge.js");
    marathonTick = await tickLinkedMarathons(database, { limit: 2 });
  } catch { /* optional */ }

  let orgSync = { ok: true };
  try {
    const { syncOrgFromRoster } = await import("../lib/runtime/agent-org.js");
    orgSync = await syncOrgFromRoster(database);
  } catch { /* optional */ }

  let repoGraph = { ok: true };
  try {
    const { ensureRepoIndexFresh } = await import("../lib/runtime/repo-graph.js");
    repoGraph = await ensureRepoIndexFresh(database);
  } catch { /* optional */ }

  let selfImprove = { ok: true, processed: 0 };
  try {
    const { processPendingProposals } = await import("../lib/runtime/self-improvement.js");
    selfImprove = await processPendingProposals(database, dispatchMCP, { limit: 1 });
  } catch { /* optional */ }

  const due = findDueMissions(database, MAX_TICK_PER_PASS);
  const tickResults = [];
  for (const mission of due) {
    try {
      const r = await tickMission({
        db: database,
        missionId: mission.id,
        dispatchMCP,
        STATE: globalThis.STATE || null,
      });
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
