// server/lib/agentic/trust-trajectory.js
// Computes an emergent's trust score based on session history, verified actions,
// and constitutional compliance. Score evolves on a logistic curve.
// Maps score to a permission scope that gates tool access.

const PERMISSION_SCOPES = Object.freeze([
  { threshold: 0,   scope: "observation_only",         description: "Read-only access; no actions" },
  { threshold: 0.3, scope: "low_risk_actions",          description: "Can perform low-risk reversible actions" },
  { threshold: 0.5, scope: "medium_risk_with_council",  description: "Medium-risk actions require council sign-off" },
  { threshold: 0.7, scope: "high_risk_with_council",    description: "High-risk actions require council sign-off" },
  { threshold: 0.9, scope: "sovereign_within_constitution", description: "Full autonomy within constitutional limits" },
]);

/**
 * Logistic sigmoid: maps real number to (0, 1).
 */
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute trust score for an emergent entity.
 *
 * @param {object} stats
 * @param {number} stats.sessionCount - total sessions participated in
 * @param {number} stats.verifiedActionCount - actions independently verified correct
 * @param {number} stats.constitutionalViolationCount - confirmed constitutional violations
 * @param {number} [stats.recentViolations] - violations in last 30 days (weighted more)
 * @returns {{ score: number, scope: string, components: object }}
 */
export function computeTrustScore({
  sessionCount = 0,
  verifiedActionCount = 0,
  constitutionalViolationCount = 0,
  recentViolations = 0,
} = {}) {
  // Base trust: logistic curve — starts near 0, approaches 1 with ~500 sessions
  const baseTrust = sigmoid((sessionCount / 100) - 5);

  // Action verification bonus (capped at 0.3)
  const actionBonus = Math.min(verifiedActionCount / 1000, 0.3);

  // Violation penalties: historical + recent (recent weighted 3×)
  const historicalPenalty = constitutionalViolationCount * 0.05;
  const recentPenalty = recentViolations * 0.15;

  const score = Math.max(0, Math.min(1, baseTrust + actionBonus - historicalPenalty - recentPenalty));

  return {
    score: Math.round(score * 1000) / 1000,
    scope: permissionScopeFor(score),
    components: {
      baseTrust: Math.round(baseTrust * 1000) / 1000,
      actionBonus: Math.round(actionBonus * 1000) / 1000,
      historicalPenalty: Math.round(historicalPenalty * 1000) / 1000,
      recentPenalty: Math.round(recentPenalty * 1000) / 1000,
    },
  };
}

/**
 * Map a trust score to a named permission scope.
 * @param {number} score - 0 to 1
 * @returns {string}
 */
export function permissionScopeFor(score) {
  let scope = PERMISSION_SCOPES[0].scope;
  for (const level of PERMISSION_SCOPES) {
    if (score >= level.threshold) scope = level.scope;
  }
  return scope;
}

/**
 * Check if a trust score grants access to a required scope level.
 * @param {number} score
 * @param {string} requiredScope
 * @returns {boolean}
 */
export function hasPermission(score, requiredScope) {
  const idx = PERMISSION_SCOPES.findIndex(p => p.scope === requiredScope);
  if (idx === -1) return false;
  return score >= PERMISSION_SCOPES[idx].threshold;
}

/**
 * Load trust stats for an emergent from the database.
 * Returns zeros if the emergent is not found.
 * @param {string} emergentId
 * @param {object} db
 * @returns {object}
 */
export function loadTrustStats(emergentId, db) {
  if (!emergentId || !db) return { sessionCount: 0, verifiedActionCount: 0, constitutionalViolationCount: 0 };
  try {
    // Trust stats are stored in the entities/personas table or a dedicated trust table
    // Fallback to zero if not yet tracked
    const row = db.prepare(
      "SELECT session_count, verified_action_count, violation_count FROM emergent_trust WHERE emergent_id = ?"
    ).get(emergentId);
    return {
      sessionCount: row?.session_count || 0,
      verifiedActionCount: row?.verified_action_count || 0,
      constitutionalViolationCount: row?.violation_count || 0,
    };
  } catch { return { sessionCount: 0, verifiedActionCount: 0, constitutionalViolationCount: 0 }; }
}

export { PERMISSION_SCOPES };

// ── before_tool hook integration ──────────────────────────────────────────────

let _trustHookUnregister = null;

/**
 * Register a before_tool hook (priority 20) that blocks tool calls for
 * emergent entities whose trust score places them in the `observation_only` scope.
 * All other scopes are allowed through without interference.
 * Registration is idempotent — calling multiple times has no extra effect.
 *
 * @returns {Function} unregister function
 */
export async function registerTrustTrajectoryHook() {
  if (_trustHookUnregister) return _trustHookUnregister; // idempotent

  const { register } = await import("./hooks.js");

  const rawUnregister = register("before_tool", async (context) => {
    const { emergentId, db } = context;
    if (!emergentId) return; // not an emergent-originated call; skip

    const stats = loadTrustStats(emergentId, db || null);
    const { scope } = computeTrustScore(stats);

    if (scope === "observation_only") {
      return {
        abort: true,
        reason: `trust_trajectory_blocked: emergent ${emergentId} is in observation_only scope (trust score too low)`,
      };
    }

    // All other scopes (low_risk_actions, medium_risk_with_council,
    // high_risk_with_council, sovereign_within_constitution) proceed normally.
  }, { priority: 20, name: "trust-trajectory-gate" });

  _trustHookUnregister = () => {
    rawUnregister();
    _trustHookUnregister = null;
  };

  return _trustHookUnregister;
}
