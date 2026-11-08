/**
 * Concord ATS — Affective Translation Spine
 *
 * First-class subsystem that:
 *   1. Maintains a bounded affective state vector over time
 *   2. Enforces invariants/constraints (safety rails)
 *   3. Translates affect → OS control signals
 *   4. Provides projection into human-facing labels/tone
 *
 * Usage:
 *   import { emitAffectEvent, getAffectState, getAffectPolicy } from "./affect/index.js";
 *   const { E, policy } = emitAffectEvent(sessionId, event);
 */

import { applyEvent, tick } from "./engine.js";
import { getAffectPolicy, POLICY_DERIVATIONS } from "./policy.js";
import { projectLabel, projectToneTags, projectSummary } from "./projection.js";
import { validateEvent, validateSessionId } from "./schema.js";
import { getSession, logEvent, getEvents, resetSession, deleteSession, listSessions, sessionCount, serializeAll, restoreAll } from "./store.js";
import { BASELINE, DIMS, BOUNDS } from "./defaults.js";

/**
 * Emit an affect event for a session. This is the primary integration point.
 *
 * @param {string} sessionId
 * @param {object} rawEvent - Raw event data (will be validated)
 * @returns {{ ok: boolean, E?: object, policy?: object, label?: string, error?: string }}
 */
export function emitAffectEvent(sessionId, rawEvent) {
  if (!validateSessionId(sessionId)) {
    return { ok: false, error: "Invalid session ID" };
  }

  const validation = validateEvent(rawEvent);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const event = validation.event;
  const session = getSession(sessionId);

  // Apply event to state
  const { E, delta } = applyEvent(session.E, session.M, event);

  // Log event
  logEvent(sessionId, { ...event, delta });

  // Compute policy
  const policy = getAffectPolicy(E);
  const label = projectLabel(E);

  return {
    ok: true,
    E: { ...E },
    policy,
    label,
    delta,
  };
}

/**
 * Get current affective state for a session.
 * Runs a decay tick to bring state up to date.
 */
export function getAffectState(sessionId) {
  if (!validateSessionId(sessionId)) return null;

  const session = getSession(sessionId);
  tick(session.E, session.M);

  return {
    ...session.E,
    label: projectLabel(session.E),
    tags: projectToneTags(session.E),
    summary: projectSummary(session.E),
  };
}

/**
 * Get current policy for a session.
 * Runs a decay tick first.
 */
export function getSessionPolicy(sessionId) {
  if (!validateSessionId(sessionId)) return null;

  const session = getSession(sessionId);
  tick(session.E, session.M);

  return getAffectPolicy(session.E);
}

/**
 * Reset a session's state.
 */
export function resetAffect(sessionId, mode = "baseline") {
  if (!validateSessionId(sessionId)) {
    return { ok: false, error: "Invalid session ID" };
  }
  const { E } = resetSession(sessionId, mode);
  return {
    ok: true,
    E,
    policy: getAffectPolicy(E),
    label: projectLabel(E),
  };
}

/**
 * Get recent events for a session.
 */
export function getAffectEvents(sessionId, limit = 50) {
  return getEvents(sessionId, limit);
}

// Re-export for direct access
export {
  getAffectPolicy,
  POLICY_DERIVATIONS,
  projectLabel,
  projectToneTags,
  projectSummary,
  validateEvent,
  validateSessionId,
  listSessions,
  sessionCount,
  deleteSession,
  serializeAll,
  restoreAll,
  BASELINE,
  DIMS,
  BOUNDS,
};
