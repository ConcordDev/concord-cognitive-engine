// server/emergent/project-continuation-cycle.js
//
// Suggestion-only nudge for HUMAN-owned projects (lib/project-thread.js,
// mig 378): when a project's linked goal tree has a real next actionable
// subgoal (lib/goal-decomposition.js#nextActionable) and no currently-
// `running` marathon session is attached to it, PROPOSE picking it back
// up via the existing lib/initiative-engine.js gating (rate limits, quiet
// hours, backoff, salience threshold) — the SAME mechanism CK1-7's
// proactive suggestions already use (see emergent/initiative-cycle.js).
//
// This module NEVER starts a marathon on its own; it only ever inserts a
// pending `initiatives` row for the user to act on. See
// server/lib/project-continuation-initiative.js for the full contract,
// the candidate-selection query, and the honest "idle" definition.
//
// Mirrors emergent/agent-marathon-cycle.js#reGoalIdleAgents' idle-
// detection SHAPE (a `NOT EXISTS` check against live marathon sessions)
// — but reGoalIdleAgents is for autonomous Concordia NPC world-agents and
// immediately kicks off a brand new marathon session once it forms a new
// goal; nothing analogous existed for human-owned projects until now,
// and this module intentionally never begins a session on its own (nor
// imports the module that owns marathon session lifecycle) — proposal
// only, never auto-start.
//
// Heartbeat contract: always returns { ok, ... }; never throws. scope:
// 'global' (human chat-agent projects, not scoped to any game world).
// Slow cadence. Kill-switch CONCORD_PROJECT_CONTINUATION=0 (checked
// inside the lib module).

import { runProjectContinuationPass } from "../lib/project-continuation-initiative.js";

export function runProjectContinuationCycle({ db, io } = {}) {
  if (!db) return { ok: true, reason: "no_db", evaluated: 0, proposed: 0 };
  try {
    return runProjectContinuationPass(db, { io });
  } catch (err) {
    return { ok: true, reason: `error:${err?.message || "unknown"}`, evaluated: 0, proposed: 0 };
  }
}

export default runProjectContinuationCycle;
