/**
 * Atlas Scope State — shared accessor module
 *
 * Extracted from atlas-scope-router.js to break the import cycle:
 *   atlas-scope-router → atlas-rights → atlas-scope-router (via getDtuScope)
 *
 * Both modules now import the scope-state accessors from here, leaving
 * atlas-scope-router as a leaf consumer of these primitives.
 *
 * State shape: STATE._scopes = {
 *   dtuScope:  Map<dtuId, scope>,
 *   submissions: Map<submissionId, SubmissionArtifact>,
 *   metrics: { localWrites, globalWrites, marketWrites, … },
 * }
 */

import { SCOPES } from "./atlas-config.js";

/**
 * Lazy-initialise the scope state on STATE._scopes. Idempotent — safe to
 * call multiple times.
 */
export function initScopeState(STATE) {
  if (!STATE._scopes) {
    STATE._scopes = {
      // Per-scope DTU index (dtuId → scope)
      dtuScope: new Map(),

      // Submission queue (cross-lane artifacts)
      submissions: new Map(),

      // Scope metrics
      metrics: {
        localWrites: 0,
        globalWrites: 0,
        marketWrites: 0,
        submissionsCreated: 0,
        submissionsApproved: 0,
        submissionsRejected: 0,
        crossScopeBlocked: 0,
      },
    };
  }
  return STATE._scopes;
}

/** Returns the scope-state object, lazily initialising if needed. */
export function getScopeState(STATE) {
  if (!STATE._scopes) initScopeState(STATE);
  return STATE._scopes;
}

/**
 * Look up the scope of a single DTU. Falls back to SCOPES.LOCAL when the
 * DTU has never been routed.
 */
export function getDtuScope(STATE, dtuId) {
  const scopeState = getScopeState(STATE);
  return scopeState.dtuScope.get(dtuId) || SCOPES.LOCAL;
}
