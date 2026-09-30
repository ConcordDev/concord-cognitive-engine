// server/lib/mission-marathon-bridge.js
//
// P7/P8 — Bridge durable organ-step missions to LLM marathon sessions.

import { startMarathon, getMarathon } from "./agent-marathon.js";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function linksReady(db) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='mission_marathon_links'`).get();
  } catch {
    return false;
  }
}

export function linkMissionMarathon(db, missionId, marathonId) {
  if (!db || !missionId || !marathonId) return { ok: false, reason: "missing_inputs" };
  if (!linksReady(db)) return { ok: false, reason: "migration_required" };
  try {
    db.prepare(`
      INSERT OR REPLACE INTO mission_marathon_links (mission_id, marathon_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(missionId, marathonId, nowSec(), nowSec());
    return { ok: true, missionId, marathonId };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function getMissionMarathonLink(db, missionId) {
  if (!db || !missionId || !linksReady(db)) return null;
  try {
    return db.prepare(`SELECT * FROM mission_marathon_links WHERE mission_id = ?`).get(missionId) || null;
  } catch {
    return null;
  }
}

export function getMarathonMissionLink(db, marathonId) {
  if (!db || !marathonId || !linksReady(db)) return null;
  try {
    return db.prepare(`SELECT * FROM mission_marathon_links WHERE marathon_id = ?`).get(marathonId) || null;
  } catch {
    return null;
  }
}

/**
 * Spawn a marathon session for a mission goal and persist the link.
 */
export function spawnMarathonForMission(db, mission, opts = {}) {
  if (!db || !mission) return { ok: false, reason: "missing_inputs" };
  const userId = mission.user_id || opts.userId || "system";
  const r = startMarathon(db, userId, {
    goal: mission.goal || mission.title,
    title: opts.title || `Mission: ${mission.title}`,
    maxTurns: opts.maxTurns || 100,
    budgetCap: opts.budgetCap || 2000,
    allowedDomains: opts.allowedDomains,
  });
  if (!r.ok) return r;
  const link = linkMissionMarathon(db, mission.id, r.sessionId);
  if (!link.ok) return link;

  kickstartLinkedMarathon(db, r.sessionId);

  try {
    db.prepare(`
      UPDATE runtime_tier_state
      SET marathons_spawned = marathons_spawned + 1, updated_at = ?
      WHERE id = 1
    `).run(nowSec());
  } catch { /* optional */ }

  return { ok: true, missionId: mission.id, sessionId: r.sessionId, marathonId: r.sessionId };
}

/**
 * Transition pending marathon → running and optionally tick once.
 */
export function kickstartLinkedMarathon(db, marathonId) {
  if (!db || !marathonId) return { ok: false, reason: "missing_inputs" };
  try {
    db.prepare(`
      UPDATE agent_marathon_sessions
      SET status = 'running', next_tick_at = unixepoch(), updated_at = unixepoch()
      WHERE id = ? AND status = 'pending'
    `).run(marathonId);
    return { ok: true, marathonId, kicked: true };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export async function kickstartAndTickMarathon(db, marathonId) {
  const kick = kickstartLinkedMarathon(db, marathonId);
  if (!kick.ok) return kick;
  const runMacro = globalThis.__concordRunMacro;
  if (typeof runMacro !== "function") return { ok: true, ...kick, ticked: false, reason: "no_runMacro" };
  try {
    const { tickMarathon } = await import("./agent-marathon.js");
    const r = await tickMarathon({
      db,
      sessionId: marathonId,
      runMacro,
      lensActions: globalThis.__concordLensActions || new Map(),
      opts: { tickTurns: 1 },
    });
    return { ok: true, ...kick, ticked: true, tick: r };
  } catch (e) {
    return { ok: true, ...kick, ticked: false, error: e?.message || String(e) };
  }
}

export function checkMarathonMissionProgress(db, missionId) {
  const link = getMissionMarathonLink(db, missionId);
  if (!link) return { ok: false, reason: "no_link" };
  const marathon = getMarathon(db, link.marathon_id);
  if (!marathon) return { ok: false, reason: "marathon_not_found" };
  const terminal = ["completed", "paused", "abandoned"].includes(marathon.status);
  return {
    ok: true,
    missionId,
    marathonId: link.marathon_id,
    status: marathon.status,
    totalTurns: marathon.total_turns,
    terminal,
    completed: marathon.status === "completed",
    blocked: marathon.status === "paused",
  };
}

export function listLinkedMarathons(db, limit = 20) {
  if (!db || !linksReady(db)) return [];
  try {
    return db.prepare(`
      SELECT l.mission_id, l.marathon_id, l.created_at, l.updated_at,
             m.title AS mission_title, m.status AS mission_status,
             a.title AS marathon_title, a.status AS marathon_status, a.total_turns
      FROM mission_marathon_links l
      LEFT JOIN mission_tasks m ON m.id = l.mission_id
      LEFT JOIN agent_marathon_sessions a ON a.id = l.marathon_id
      ORDER BY l.updated_at DESC
      LIMIT ?
    `).all(Math.min(limit, 100));
  } catch {
    return [];
  }
}

export function bridgeOverview(db) {
  if (!db || !linksReady(db)) return { ok: false, reason: "migration_required" };
  try {
    const total = db.prepare(`SELECT COUNT(*) AS c FROM mission_marathon_links`).get()?.c || 0;
    const active = db.prepare(`
      SELECT COUNT(*) AS c FROM mission_marathon_links l
      JOIN agent_marathon_sessions a ON a.id = l.marathon_id
      WHERE a.status IN ('pending', 'running')
    `).get()?.c || 0;
    return { ok: true, totalLinks: total, activeMarathons: active };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

/**
 * Advance linked marathons that are still pending/running (mission-runtime heartbeat).
 */
export async function tickLinkedMarathons(db, opts = {}) {
  if (!db || !linksReady(db)) return { ok: false, reason: "migration_required" };
  const limit = Math.min(Math.max(opts.limit || 2, 1), 5);
  const runMacro = globalThis.__concordRunMacro;
  if (typeof runMacro !== "function") return { ok: false, reason: "no_runMacro" };

  let due = [];
  try {
    due = db.prepare(`
      SELECT l.marathon_id
      FROM mission_marathon_links l
      JOIN agent_marathon_sessions a ON a.id = l.marathon_id
      WHERE a.status IN ('pending', 'running')
      ORDER BY a.next_tick_at ASC
      LIMIT ?
    `).all(limit);
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }

  const { tickMarathon } = await import("./agent-marathon.js");
  const lensActions = globalThis.__concordLensActions || new Map();
  const results = [];
  for (const row of due) {
    try {
      kickstartLinkedMarathon(db, row.marathon_id);
      const r = await tickMarathon({
        db,
        sessionId: row.marathon_id,
        runMacro,
        lensActions,
        opts: { tickTurns: 1 },
      });
      results.push({ marathonId: row.marathon_id, ok: r?.ok !== false, status: r?.status });
    } catch (e) {
      results.push({ marathonId: row.marathon_id, ok: false, error: e?.message || String(e) });
    }
  }
  return { ok: true, ticked: results.length, results };
}
