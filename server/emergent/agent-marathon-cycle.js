// server/emergent/agent-marathon-cycle.js
//
// Sprint 12 — heartbeat that auto-ticks running marathon sessions
// so they make progress even when the user closes the tab.
//
// Frequency: 12 ticks (~3 min). Per pass: find sessions with
// status='running' AND next_tick_at <= now, tick each up to 5 turns.
// Bounded at MAX_PER_PASS to keep tick cost predictable.

import { findDueMarathons, tickMarathon, startMarathon } from "../lib/agent-marathon.js";
import { kickstartLinkedMarathon } from "../lib/mission-marathon-bridge.js";
import { loadOrCreate } from "../lib/affect-bridge.js";
import { formGoalForAgent } from "../lib/agent-goals.js";
import { LruMap } from "../lib/lru-map.js";

const MAX_PER_PASS = 3;
const MAX_REGOAL_PER_PASS = 2;
const TERMINAL_STATUSES = new Set(["completed", "abandoned", "failed", "revoked"]);

// Wave 7 / E2 — per-session prior affect cache so the salience gate can detect spikes
// across ticks (a sudden FEAR jump = a reason to wake the brain). Entries are deleted
// on terminal status below (the real cleanup); the LRU cap is only a backstop for
// sessions that go permanently stale without ever reporting a terminal status (e.g.
// stuck 'paused' and never resumed).
const _priorState = new LruMap(3000);

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

// Wave 7 / B4 — AUTONOMOUS GOAL FORMATION. An active agent with NO running marathon has
// finished (or abandoned) its goal; rather than going inert, it introspects its drives +
// felt-peaks + values and forms a NEW goal, then continues. The agent self-directs, it
// isn't only executed. Bounded + kill-switch CONCORD_AGENT_AUTOGOAL=0. Read→form→start.
function reGoalIdleAgents(db) {
  if (process.env.CONCORD_AGENT_AUTOGOAL === "0") return 0;
  let formed = 0;
  let idle = [];
  try {
    idle = db.prepare(`
      SELECT ai.agent_id, ai.user_id FROM agent_identities ai
      WHERE ai.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM agent_marathon_sessions s
          WHERE s.user_id = ai.user_id AND s.status IN ('running', 'pending', 'paused')
        )
      LIMIT ?
    `).all(MAX_REGOAL_PER_PASS);
  } catch { return 0; } // agent_identities / sessions tables optional
  for (const a of idle) {
    try {
      const proposal = formGoalForAgent(db, a.agent_id);
      if (proposal?.ok && proposal.goal) {
        startMarathon(db, a.user_id, { goal: proposal.goal });
        formed++;
      }
    } catch { /* per-agent skip */ }
  }
  return formed;
}

export async function runAgentMarathonCycle({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const runMacro = globalThis.__concordRunMacro;
  const lensActions = globalThis.__concordLensActions || new Map();
  if (!runMacro) return { ok: false, reason: "no_runMacro" };

  let advanced = 0;
  let errors = 0;
  let onInstinct = 0;
  let kickedPending = 0;
  try {
    let pending = [];
    try {
      pending = db.prepare(`
        SELECT id FROM agent_marathon_sessions
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ?
      `).all(MAX_PER_PASS);
    } catch { /* optional */ }
    for (const { id } of pending) {
      const kick = kickstartLinkedMarathon(db, id);
      if (kick.ok) kickedPending++;
    }

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
        // Real cleanup: once a marathon reaches a terminal status it will
        // never be ticked again (findDueMarathons filters on status='running'),
        // so its prior-affect entry would otherwise sit in the cache forever.
        if (r.alreadyTerminal || TERMINAL_STATUSES.has(r.status)) {
          _priorState.delete(id);
        }
      } catch {
        errors++;
      }
    }
    // B4 — agents that finished their goal form a new one and keep living.
    const reGoaled = reGoalIdleAgents(db);
    return { ok: true, processed: due.length, advanced, onInstinct, errors, reGoaled, kickedPending };
  } catch (err) {
    return { ok: false, reason: "cycle_threw", error: String(err?.message || err) };
  }
}
