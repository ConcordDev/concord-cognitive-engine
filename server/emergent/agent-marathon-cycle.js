// server/emergent/agent-marathon-cycle.js
//
// Sprint 12 — heartbeat that auto-ticks running marathon sessions
// so they make progress even when the user closes the tab.
//
// Frequency: 12 ticks (~3 min). Per pass: find sessions with
// status='running' AND next_tick_at <= now, tick each up to 5 turns.
// Bounded at MAX_PER_PASS to keep tick cost predictable.

import { findDueMarathons, tickMarathon } from "../lib/agent-marathon.js";
import { loadOrCreate } from "../lib/affect-bridge.js";

const MAX_PER_PASS = 3;

// Wave 7 / E2 — per-session prior affect cache so the salience gate can detect spikes
// across ticks (a sudden FEAR jump = a reason to wake the brain).
const _priorState = new Map();

// Build the B4/B6 salience gate ONLY for autonomous-agent marathons (an agent_identities
// row for the session's owner). Human marathons return null → ungated (always deliberate,
// the prior behaviour). Total/guarded — any failure → null (deliberate normally).
function buildSalienceGate(db, sessionId) {
  try {
    const sess = db.prepare(`SELECT user_id, goal FROM agent_marathon_sessions WHERE id = ?`).get(sessionId);
    if (!sess?.user_id) return null;
    const ident = db.prepare(`SELECT agent_id, world_id, drive_profile_json FROM agent_identities WHERE user_id = ? AND status = 'active' LIMIT 1`).get(sess.user_id);
    if (!ident) return null; // not an autonomous agent → no gate
    const worldId = ident.world_id || "concordia-hub";
    let drives = {};
    try { drives = JSON.parse(ident.drive_profile_json || "{}"); } catch { drives = {}; }
    let affect = { v: 0, a: 0 };
    try { const st = loadOrCreate(db, ident.agent_id, worldId); affect = { v: st?.E?.v ?? 0, a: st?.E?.a ?? 0 }; } catch { /* affect optional */ }

    const prior = _priorState.get(sessionId) || null;
    _priorState.set(sessionId, { affect, drives });

    return {
      agentId: ident.agent_id,
      self: { affect, drives, goal: sess.goal ? { resource: sess.goal } : undefined, worldId },
      world: {},
      others: [],
      prior: prior || {},
      // an agent in a marathon is mid-task: it has a fallback (keep working) and can
      // route around — so only a genuine spike/dilemma wakes the expensive loop.
      opts: { hasRouteAround: true, hasFallbackGoal: true },
    };
  } catch {
    return null;
  }
}

export async function runAgentMarathonCycle({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const runMacro = globalThis.__concordRunMacro;
  const lensActions = globalThis.__concordLensActions || new Map();
  if (!runMacro) return { ok: false, reason: "no_runMacro" };

  let advanced = 0;
  let errors = 0;
  let onInstinct = 0;
  try {
    const due = findDueMarathons(db, { limit: MAX_PER_PASS });
    for (const { id } of due) {
      try {
        // Wave 7 / E2 — "feeling decides when to think" on the LIVE agent tick: a calm
        // agent stays on cheap instinct (no LLM loop); a spike/dilemma wakes it. The
        // gate also drives the B6 awareness loop. Null gate (human marathon) → ungated.
        const salienceGate = buildSalienceGate(db, id);
        const r = await tickMarathon({
          db, sessionId: id, runMacro, lensActions,
          opts: { tickTurns: 3, ...(salienceGate ? { salienceGate } : {}) },
        });
        if (r.ok) advanced++;
        if (r.deliberated === false) onInstinct++;
      } catch {
        errors++;
      }
    }
    return { ok: true, processed: due.length, advanced, onInstinct, errors };
  } catch (err) {
    return { ok: false, reason: "cycle_threw", error: String(err?.message || err) };
  }
}
