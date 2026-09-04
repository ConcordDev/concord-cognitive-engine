// server/lib/runtime/soak-harness.js
//
// Long-horizon mission soak — compressed virtual days with checkpoint coherence.

import crypto from "node:crypto";
import { createMission, tickMission, getMission } from "../mission-runtime.js";
import { saveCheckpoint, loadLatestCheckpoint } from "./agent-loop.js";

function soakId() {
  return `soak_${crypto.randomUUID().slice(0, 12)}`;
}

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_soak_runs'`).get();
  } catch {
    return false;
  }
}

/**
 * Simulate N virtual days of mission operation (compressed wall-clock).
 * Each day: checkpoint → ticks → verify objective + step coherence.
 */
export async function runSoakSimulation({
  db,
  dispatchMCP,
  days = 7,
  ticksPerDay = 3,
  goal = "maintain fleet health audit and research opportunities across virtual days",
} = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const id = soakId();
  const virtualDays = Math.min(Math.max(days, 1), 30);
  const ticks = Math.min(Math.max(ticksPerDay, 1), 10);

  if (tablesReady(db)) {
    try {
      db.prepare(`
        INSERT INTO runtime_soak_runs (id, virtual_days, ticks_per_day, status)
        VALUES (?, ?, ?, 'running')
      `).run(id, virtualDays, ticks);
    } catch { /* optional */ }
  }

  const created = createMission(db, {
    template: "fleet_health",
    source: "heartbeat",
    asDila: true,
    goal,
  });
  if (!created.ok) return { ok: false, reason: created.reason || "create_failed" };

  const dayResults = [];
  let coherent = true;
  let lastObjective = goal;

  for (let day = 1; day <= virtualDays; day++) {
    saveCheckpoint(db, created.missionId, {
      stepIndex: day - 1,
      loopPhase: "continue",
      state: { virtualDay: day, objective: lastObjective, note: `day_${day}_start` },
    });

    let dayTicks = 0;
    let dayFailed = false;
    for (let t = 0; t < ticks; t++) {
      const tick = await tickMission({
        db,
        missionId: created.missionId,
        dispatchMCP,
      });
      dayTicks++;
      if (tick.status === "failed") {
        dayFailed = true;
        break;
      }
      if (tick.status === "completed") break;
    }

    const mission = getMission(db, created.missionId);
    const cp = loadLatestCheckpoint(db, created.missionId);
    const objectiveStable = !cp?.state?.objective || cp.state.objective === lastObjective;
    const notRegressed = mission.status !== "failed";
    const dayOk = notRegressed && objectiveStable;

    if (!dayOk) coherent = false;

    dayResults.push({
      day,
      status: mission?.status,
      ticks: dayTicks,
      step: mission?.current_step,
      checkpointPhase: cp?.loop_phase,
      coherent: dayOk,
      failed: dayFailed,
    });

    if (mission?.status === "completed" || mission?.status === "failed") break;
  }

  const finalMission = getMission(db, created.missionId);
  const summary = {
    virtualDays,
    ticksPerDay: ticks,
    daysSimulated: dayResults.length,
    coherentDays: dayResults.filter((d) => d.coherent).length,
    finalStatus: finalMission?.status,
    finalStep: finalMission?.current_step,
    pass: coherent && finalMission?.status !== "failed",
  };

  if (tablesReady(db)) {
    try {
      db.prepare(`
        UPDATE runtime_soak_runs
        SET mission_id = ?, status = ?, coherence_json = ?, summary_json = ?, completed_at = ?
        WHERE id = ?
      `).run(
        created.missionId,
        summary.pass ? "completed" : "failed",
        JSON.stringify(dayResults),
        JSON.stringify(summary),
        Math.floor(Date.now() / 1000),
        id,
      );
    } catch { /* optional */ }
  }

  return {
    ok: true,
    soakId: id,
    missionId: created.missionId,
    summary,
    dayResults,
  };
}

export function listSoakRuns(db, limit = 10) {
  if (!db || !tablesReady(db)) return [];
  try {
    return db.prepare(`
      SELECT id, mission_id, virtual_days, status, summary_json, started_at, completed_at
      FROM runtime_soak_runs ORDER BY started_at DESC LIMIT ?
    `).all(Math.min(limit, 50)).map((r) => ({
      ...r,
      summary: r.summary_json ? JSON.parse(r.summary_json) : null,
    }));
  } catch {
    return [];
  }
}
