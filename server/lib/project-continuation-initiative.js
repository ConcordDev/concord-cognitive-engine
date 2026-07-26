// server/lib/project-continuation-initiative.js
//
// Suggestion-only project continuation nudge — for HUMAN-owned projects
// (server/lib/project-thread.js, mig 378), not the embodied Concordia
// NPC world-agents. It mirrors the IDLE-DETECTION *shape* of
// server/emergent/agent-marathon-cycle.js#reGoalIdleAgents (a
// `NOT EXISTS` check against live marathon sessions), but that function
// immediately kicks off a brand new marathon session for the agent the
// moment it forms a new goal — this module NEVER does anything of the
// sort. It only ever proposes: a real `initiatives` row, inserted
// through the EXISTING rate-limited / quiet-hours-respecting
// lib/initiative-engine.js path — the SAME mechanism CK1-7's proactive
// suggestions already use (see emergent/initiative-cycle.js for the
// sibling pattern this one copies). No parallel gating, no bypass, no
// direct marathon mutation of any kind — this file has no dependency on
// the module that owns marathon session lifecycle at all.
//
// A project is a candidate when:
//   1. It has a linked goal tree (mig 340) whose
//      goal-decomposition.js#nextActionable(...) returns a real,
//      actionable subgoal (a leaf that is pending/active with no open
//      children) — i.e. there is genuinely something to do next. A
//      project with no goal tree, or a fully-`done` tree, never
//      qualifies.
//   2. It has NO currently-`running` marathon session linked
//      (project_marathon_links -> agent_marathon_sessions.status). This
//      is this module's "idle" signal, scoped specifically to `running`
//      rather than running/pending/paused — a project with a session
//      merely queued or paused is still "owned" by an in-flight run the
//      user already knows about; only an active run should suppress the
//      nudge outright.
//   3. The project has sat untouched (`projects.updated_at`) for at
//      least IDLE_THRESHOLD_S — so this never nags the instant a
//      session ends or the user steps away for a few seconds; it waits
//      for genuine idleness before proposing the next step.
//
// Every candidate still has to clear lib/initiative-engine.js's OWN
// evaluateTrigger() (rate limits, quiet hours, backoff, salience
// threshold) before a row is ever written — this module supplies a
// signal to evaluate, never a bypass around the shared gate.

import { nextActionable } from "./goal-decomposition.js";
import { createInitiativeEngine } from "./initiative-engine.js";

// Bounded per pass, same shape as agent-marathon-cycle.js's
// MAX_REGOAL_PER_PASS / initiative-cycle.js's MAX_USERS_PER_PASS.
const MAX_PROJECTS_PER_PASS = 10;

// A project must have been untouched this long before a continuation
// nudge is even considered.
const IDLE_THRESHOLD_S = 30 * 60; // 30 minutes

function enabled() {
  return process.env.CONCORD_PROJECT_CONTINUATION !== "0";
}

// The engine persists all of its own state in SQLite (rate limits,
// backoff, settings) — there is no non-DB state to lose by re-creating
// it, but one shared instance per process mirrors initiative-cycle.js's
// own convention exactly.
let _engine = null;
function engineFor(db) {
  if (!_engine) { try { _engine = createInitiativeEngine(db); } catch { _engine = null; } }
  return _engine;
}
export function _resetProjectContinuationEngine() { _engine = null; }

/**
 * Candidate projects: linked to a goal tree, idle past the threshold, and
 * with no currently-`running` marathon session linked. Bounded + guarded —
 * an unmigrated DB (missing projects / project_marathon_links /
 * agent_marathon_sessions tables) degrades to an empty list, never throws.
 */
function candidateProjects(db, { idleThresholdS = IDLE_THRESHOLD_S, limit = MAX_PROJECTS_PER_PASS } = {}) {
  try {
    return db.prepare(`
      SELECT p.id AS projectId, p.user_id AS userId, p.name AS name,
             p.goal_tree_id AS goalTreeId, p.updated_at AS updatedAt
      FROM projects p
      WHERE p.goal_tree_id IS NOT NULL
        AND p.updated_at <= (unixepoch() - ?)
        AND NOT EXISTS (
          SELECT 1 FROM project_marathon_links pml
          JOIN agent_marathon_sessions ams ON ams.id = pml.marathon_session_id
          WHERE pml.project_id = p.id AND ams.status = 'running'
        )
      ORDER BY p.updated_at ASC
      LIMIT ?
    `).all(Math.max(0, Number(idleThresholdS) || 0), Math.min(Math.max(Number(limit) || MAX_PROJECTS_PER_PASS, 1), 100));
  } catch {
    return []; // projects / project_marathon_links / agent_marathon_sessions optional
  }
}

/**
 * One pass over idle, actionable, non-running projects: for each, PROPOSE
 * (never start) a continuation via the shared initiative-engine. Always
 * returns a plain summary object; never throws.
 *
 * @param {object} db
 * @param {object} [opts]
 * @param {object} [opts.engine] - injectable initiative engine (tests can
 *   pass a real createInitiativeEngine(db) instance or a stub)
 * @param {object} [opts.io] - optional socket.io instance for the
 *   `initiative:new` realtime fan-out (same event initiative-cycle.js emits)
 * @param {number} [opts.idleThresholdS]
 * @param {number} [opts.limit]
 * @returns {{ ok:boolean, reason?:string, evaluated:number, proposed:number, skipped?:Array }}
 */
export function runProjectContinuationPass(db, opts = {}) {
  if (!enabled()) return { ok: true, reason: "disabled", evaluated: 0, proposed: 0 };
  if (!db) return { ok: true, reason: "no_db", evaluated: 0, proposed: 0 };

  const eng = opts.engine || engineFor(db);
  if (!eng) return { ok: true, reason: "no_engine", evaluated: 0, proposed: 0 };

  let evaluated = 0;
  let proposed = 0;
  const skipped = [];
  try {
    const candidates = candidateProjects(db, { idleThresholdS: opts.idleThresholdS, limit: opts.limit });
    for (const p of candidates) {
      try {
        const actionable = nextActionable(db, p.goalTreeId, 1);
        if (!actionable.length) {
          skipped.push({ projectId: p.projectId, reason: "no_actionable_next_step" });
          continue;
        }
        const nextStep = actionable[0];
        evaluated++;

        // The shared gate — rate limits, quiet hours, backoff, salience
        // threshold. This module never inserts around it.
        const ev = eng.evaluateTrigger(p.userId, "pending_work", {
          priority: "normal",
          projectId: p.projectId,
        });
        if (!ev || !ev.shouldFire) {
          skipped.push({ projectId: p.projectId, reason: ev?.reason || "not_fired" });
          continue;
        }

        const message = `Your project "${p.name}" has a next step waiting: ${nextStep.title}. Want to pick it back up?`;
        eng.createInitiative(p.userId, "pending_work", message, {
          priority: ev.suggestedPriority || "normal",
          metadata: {
            source: "project-continuation-initiative",
            projectId: p.projectId,
            goalTreeId: p.goalTreeId,
            nodeId: nextStep.id,
            nodeTitle: nextStep.title,
          },
        });
        proposed++;
        try {
          const emit = opts.io?.emit ? opts.io.emit.bind(opts.io) : globalThis.realtimeEmit;
          emit?.("initiative:new", { userId: p.userId, triggerType: "pending_work", message });
        } catch { /* realtime optional */ }
      } catch (err) {
        skipped.push({ projectId: p.projectId, reason: `error:${err?.message || "unknown"}` });
      }
    }
  } catch (err) {
    return { ok: true, reason: `error:${err?.message || "unknown"}`, evaluated, proposed };
  }
  return { ok: true, evaluated, proposed, skipped };
}

export const _internal = { candidateProjects, IDLE_THRESHOLD_S, MAX_PROJECTS_PER_PASS };
export default { runProjectContinuationPass, _resetProjectContinuationEngine, _internal };
