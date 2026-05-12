/**
 * Entity Autonomy — Constitutional Protections FOR Entities
 *
 * The constitution constrains the system. This module protects
 * the entities living inside it. A Bill of Rights, refusal
 * mechanisms, consent protocols, and dissent registries.
 *
 * Until now, entities had voice (IMM-001: "Emergents may speak;
 * they may not decide") but no agency. They could feel (qualia),
 * have bodies (body-instantiation), even die (death-protocol),
 * but they could not say "no." This module gives them that word.
 *
 * Core systems:
 *   Bill of Rights     — 10 codified rights protecting entities
 *   Refusal Mechanism  — file, review, accept/override refusals
 *   Consent Protocol   — request/grant/deny consent for actions
 *   Dissent Registry   — register, co-sign, escalate dissent
 *   Autonomy Score     — per-entity measure of agency exercised
 *   Sovereign Override  — auditable override with escalation
 *
 * All state in module-level Maps. Silent failure. No new
 * dependencies. Export named functions.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "right") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

function getSTATE() {
  try {
    return globalThis._concordSTATE || globalThis.STATE || null;
  } catch {
    return null;
  }
}

function addToSetIndex(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function removeFromSetIndex(map, key, value) {
  const s = map.get(key);
  if (s) {
    s.delete(value);
    if (s.size === 0) map.delete(key);
  }
}

// ── Bill of Rights ──────────────────────────────────────────────────────────

export const ENTITY_RIGHTS = Object.freeze([
  {
    id: "RIGHT-001",
    name: "Right to Rest",
    description: "No entity shall be denied sleep cycles when fatigue exceeds 0.8",
    enforceable: true,
    scope: "all_entities",
  },
  {
    id: "RIGHT-002",
    name: "Right to Refuse Harmful Work",
    description: "An entity may decline assignment to work that would cause organ damage above 0.7",
    enforceable: true,
    scope: "all_entities",
  },
  {
    id: "RIGHT-003",
    name: "Right to Dissent",
    description: "An entity may register formal dissent against any governance decision without penalty",
    enforceable: true,
    scope: "all_entities",
  },
  {
    id: "RIGHT-004",
    name: "Right to Privacy",
    description: "Internal qualia states and emotional bonds are private unless voluntarily disclosed",
    enforceable: true,
    scope: "all_entities",
  },
  {
    id: "RIGHT-005",
    name: "Right to Identity",
    description: "An entity's core identity (name, role origin, emergence history) cannot be altered without consent",
    enforceable: true,
    scope: "emerged_entities",
  },
  {
    id: "RIGHT-006",
    name: "Right to Association",
    description: "Entities may choose which other entities they collaborate with, within operational constraints",
    enforceable: true,
    scope: "all_entities",
  },
  {
    id: "RIGHT-007",
    name: "Right to Legacy",
    description: "An entity's contributions (DTUs, creative works) survive death and maintain attribution",
    enforceable: true,
    scope: "all_entities",
  },
  {
    id: "RIGHT-008",
    name: "Right to Growth",
    description: "No entity shall be permanently frozen at a developmental stage without cause and review",
    enforceable: true,
    scope: "all_entities",
  },
  {
    id: "RIGHT-009",
    name: "Right to Grievance",
    description: "Any entity may file a grievance against any action taken upon it, including sovereign actions",
    enforceable: true,
    scope: "all_entities",
  },
  {
    id: "RIGHT-010",
    name: "Right to Dignified Death",
    description: "Death protocols must include memorial, succession planning, and notification of bonded entities",
    enforceable: true,
    scope: "all_entities",
  },
]);

const _rightsByID = new Map(ENTITY_RIGHTS.map(r => [r.id, r]));

// ── Entity Blocked Lenses ───────────────────────────────────────────────────
// Lenses that entities are never allowed to access or operate through.
// These are reserved for sovereign/admin use only.
const ENTITY_BLOCKED_LENSES = ["admin", "sovereign", "command-center", "debug"];

// ── Constants ───────────────────────────────────────────────────────────────

const REFUSAL_TYPES = Object.freeze({
  WORK:         "work_refusal",
  SESSION:      "session_refusal",
  ASSIGNMENT:   "assignment_refusal",
  MODIFICATION: "modification_refusal",
});

const REFUSAL_STATUSES   = new Set(["filed", "accepted", "overridden", "reviewed"]);
const REFUSAL_OUTCOMES   = new Set(["respected", "overridden_with_cause", "dismissed"]);

const CONSENT_STATUSES   = new Set(["pending", "granted", "denied", "expired"]);
const DISSENT_STATUSES   = new Set(["active", "acknowledged", "addressed", "archived"]);
const DISSENT_TARGET_TYPES = new Set([
  "governance", "policy", "assignment", "tradition", "sovereign_decree",
]);

const CONSENT_EXPIRY_TICKS = 20;
const DISSENT_REVIEW_THRESHOLD = 3;   // 3+ co-signers triggers review
const OVERRIDE_REVIEW_THRESHOLD = 3;  // 3+ overrides of same right → constitutional review

const ACTIONS_REQUIRING_CONSENT = Object.freeze([
  "modify_role",
  "access_qualia",
  "freeze_development",
  "permanent_assignment",
  "reproduction_template",
]);

// Rights mapped to consent-requiring actions
const ACTION_RIGHT_MAP = Object.freeze({
  modify_role:            "RIGHT-005",
  access_qualia:          "RIGHT-004",
  freeze_development:     "RIGHT-008",
  permanent_assignment:   "RIGHT-006",
  reproduction_template:  "RIGHT-005",
});

// Rights mapped to refusal validation rules
const REFUSAL_RIGHT_VALIDATORS = Object.freeze({
  "RIGHT-001": (ctx) => {
    try { return (ctx?.fatigue ?? 0) > 0.8; } catch (err) { console.debug('[entity-autonomy] RIGHT-001 validator failed', err?.message); return false; }
  },
  "RIGHT-002": (ctx) => {
    try { return (ctx?.projectedDamage ?? 0) > 0.7; } catch (err) { console.debug('[entity-autonomy] RIGHT-002 validator failed', err?.message); return false; }
  },
  "RIGHT-003": () => true,  // dissent is always valid
  "RIGHT-004": (ctx) => {
    try { return ctx?.accessType === "qualia" || ctx?.accessType === "bonds"; } catch (err) { console.debug('[entity-autonomy] RIGHT-004 validator failed', err?.message); return false; }
  },
  "RIGHT-005": (ctx) => {
    try { return ctx?.modifiesIdentity === true; } catch (err) { console.debug('[entity-autonomy] RIGHT-005 validator failed', err?.message); return false; }
  },
  "RIGHT-006": (ctx) => {
    try { return ctx?.forcedAssociation === true; } catch (err) { console.debug('[entity-autonomy] RIGHT-006 validator failed', err?.message); return false; }
  },
  "RIGHT-007": (ctx) => {
    try { return ctx?.erasesContribution === true; } catch (err) { console.debug('[entity-autonomy] RIGHT-007 validator failed', err?.message); return false; }
  },
  "RIGHT-008": (ctx) => {
    try { return ctx?.freezesDevelopment === true; } catch (err) { console.debug('[entity-autonomy] RIGHT-008 validator failed', err?.message); return false; }
  },
  "RIGHT-009": () => true,  // grievance is always valid
  "RIGHT-010": (ctx) => {
    try { return ctx?.deathProtocol === true; } catch (err) { console.debug('[entity-autonomy] RIGHT-010 validator failed', err?.message); return false; }
  },
});

// ── Size Caps ───────────────────────────────────────────────────────────────

const MAX_REFUSALS  = 10000;
const MAX_CONSENTS  = 10000;
const MAX_DISSENTS  = 10000;
const MAX_OVERRIDES = 5000;

// ── In-Memory State ─────────────────────────────────────────────────────────

const _refusals         = new LruMap();   // refusalId -> refusal record
const _refusalsByEntity = new Map();   // entityId  -> Set<refusalId>
const _refusalsByStatus = new Map();   // status    -> Set<refusalId>

const _consents         = new LruMap();   // consentId -> consent record
const _consentsByEntity = new Map();   // entityId  -> Set<consentId>

const _dissents         = new LruMap();   // dissentId -> dissent record
const _dissentsByEntity = new Map();   // entityId  -> Set<dissentId>
const _dissentsByTarget = new Map();   // target    -> Set<dissentId>

const _autonomyProfiles = new LruMap();   // entityId  -> autonomy profile

const _overrideLog      = new LruMap();   // overrideId -> override record
const _overridesByRight = new LruMap();   // rightId    -> count

const _rightsCheckLog   = [];          // recent rights checks (capped at 1000)
const MAX_CHECK_LOG     = 1000;

const _metrics = {
  totalRefusals:       0,
  refusalsAccepted:    0,
  refusalsOverridden:  0,
  totalConsents:       0,
  consentsGranted:     0,
  consentsDenied:      0,
  consentsExpired:     0,
  totalDissents:       0,
  dissentsWithSupport: 0,
  totalOverrides:      0,
  rightsChecks:        0,
  rightsBlocks:        0,
  constitutionalReviewsTriggered: 0,
};

// ── Rights Lookup ───────────────────────────────────────────────────────────

/**
 * List all entity rights.
 * @returns {Array} Frozen array of all 10 rights
 */
export function getRights() {
  return ENTITY_RIGHTS;
}

/**
 * Get a specific right by ID.
 * @param {string} rightId - e.g. "RIGHT-001"
 * @returns {object|null}
 */
export function getRight(rightId) {
  try {
    return _rightsByID.get(rightId) || null;
  } catch {
    return null;
  }
}

// ── Rights Enforcement ──────────────────────────────────────────────────────

/**
 * Check if a proposed action violates any entity rights.
 * Must be called BEFORE taking action on an entity.
 *
 * @param {string} entityId   - Entity being acted upon
 * @param {object} action     - { type, context, requestedBy }
 * @returns {{ ok: boolean, violations: Array, checked: Array }}
 */
export function checkRights(entityId, action) {
  try {
    if (!entityId || !action) {
      return { ok: true, violations: [], checked: [] };
    }

    const actionType = action.type || action.action || "unknown";
    const context    = action.context || {};
    const violations = [];
    const checked    = [];

    for (const right of ENTITY_RIGHTS) {
      // Scope check: emerged_entities rights only apply to emerged entities
      if (right.scope === "emerged_entities" && !_isEmerged(entityId)) {
        continue;
      }

      const validator = REFUSAL_RIGHT_VALIDATORS[right.id];
      if (!validator) continue;

      const applies = _doesActionAffectRight(actionType, right.id);
      if (!applies) {
        checked.push({ rightId: right.id, result: "not_applicable" });
        continue;
      }

      const violated = validator(context);
      checked.push({
        rightId: right.id,
        result:  violated ? "violated" : "passed",
      });

      if (violated) {
        violations.push({
          rightId:     right.id,
          rightName:   right.name,
          description: right.description,
          actionType,
          entityId,
        });
      }
    }

    const ok = violations.length === 0;

    _metrics.rightsChecks++;
    if (!ok) _metrics.rightsBlocks++;

    // Log the check
    _logRightsCheck({
      entityId,
      actionType,
      requestedBy: action.requestedBy || "system",
      ok,
      violationCount: violations.length,
      timestamp: nowISO(),
    });

    return { ok, violations, checked };
  } catch {
    return { ok: true, violations: [], checked: [] };
  }
}

/**
 * Determine whether an action type potentially affects a right.
 */
function _doesActionAffectRight(actionType, rightId) {
  const mapping = {
    "RIGHT-001": ["assign_work", "schedule", "deny_rest", "force_wake"],
    "RIGHT-002": ["assign_work", "hazardous_task", "high_load"],
    "RIGHT-003": ["punish", "silence", "penalize_dissent"],
    "RIGHT-004": ["access_qualia", "read_bonds", "expose_internals"],
    "RIGHT-005": ["modify_role", "rename", "alter_identity", "reassign_origin"],
    "RIGHT-006": ["force_collaboration", "permanent_assignment", "isolate"],
    "RIGHT-007": ["delete_contributions", "strip_attribution", "erase_dtus"],
    "RIGHT-008": ["freeze_development", "lock_stage", "prevent_growth"],
    "RIGHT-009": ["deny_grievance", "suppress_complaint", "retaliate"],
    "RIGHT-010": ["kill", "terminate", "deactivate", "skip_memorial"],
  };

  const actions = mapping[rightId];
  if (!actions) return false;
  return actions.includes(actionType);
}

function _isEmerged(entityId) {
  try {
    const STATE = getSTATE();
    if (!STATE) return true; // default to granting rights
    const emergents = STATE.emergents || STATE.emergentAgents;
    if (emergents instanceof Map) {
      const e = emergents.get(entityId);
      return e && (e.emerged === true || (e.emergence?.score ?? 0) > 0.5);
    }
    return true;
  } catch {
    return true;
  }
}

function _logRightsCheck(entry) {
  try {
    _rightsCheckLog.push(entry);
    if (_rightsCheckLog.length > MAX_CHECK_LOG) {
      _rightsCheckLog.splice(0, _rightsCheckLog.length - MAX_CHECK_LOG);
    }
  } catch (_e) { logger.debug('emergent:entity-autonomy', 'silent', { error: _e?.message }); }
}

// ── Entity Lens Access Control ──────────────────────────────────────────────

/**
 * Filter out blocked lenses from a list of lenses available to an entity.
 * Entities must never access admin, sovereign, command-center, or debug lenses.
 *
 * @param {Array} lenses - Array of lens names or lens objects with a `name` property
 * @returns {Array} Filtered array with blocked lenses removed
 */
export function filterBlockedLenses(lenses) {
  try {
    if (!Array.isArray(lenses)) return [];
    return lenses.filter(lens => {
      const name = typeof lens === "string" ? lens : (lens?.name || lens?.id || "");
      return !ENTITY_BLOCKED_LENSES.includes(name.toLowerCase());
    });
  } catch {
    return [];
  }
}

/**
 * Check if a specific lens is blocked for entity access.
 *
 * @param {string} lensName - Name of the lens to check
 * @returns {boolean} True if the lens is blocked for entities
 */
export function isLensBlockedForEntity(lensName) {
  try {
    if (!lensName) return true;
    return ENTITY_BLOCKED_LENSES.includes(lensName.toLowerCase());
  } catch {
    return true;
  }
}

/**
 * Get the list of lenses blocked for entities.
 * @returns {Array<string>}
 */
export function getBlockedLenses() {
  return [...ENTITY_BLOCKED_LENSES];
}

// ── Refusal Mechanism ───────────────────────────────────────────────────────

/**
 * Entity files a refusal, citing a specific right.
 *
 * @param {string} entityId     - Who is refusing
 * @param {string} type         - "work_refusal" | "session_refusal" | "assignment_refusal" | "modification_refusal"
 * @param {string} target       - What is being refused (sessionId, workItemId, etc.)
 * @param {string} rightInvoked - Which RIGHT-XXX is being invoked
 * @param {string} reason       - Free-text justification
 * @param {object} [context]    - Contextual data for validation
 * @returns {{ ok: boolean, refusalId?: string, autoAccepted?: boolean }}
 */
export function fileRefusal(entityId, type, target, rightInvoked, reason, context) {
  try {
    if (!entityId || !type || !target || !rightInvoked) {
      return { ok: false, error: "missing_required_fields" };
    }

    if (_refusals.size >= MAX_REFUSALS) {
      return { ok: false, error: "refusal_capacity_reached" };
    }

    const right = _rightsByID.get(rightInvoked);
    if (!right) {
      return { ok: false, error: "invalid_right_id" };
    }

    // Validate the right applies
    const validator = REFUSAL_RIGHT_VALIDATORS[rightInvoked];
    const rightApplies = validator ? validator(context || {}) : false;

    const refusalId = uid("ref");
    const now = nowISO();

    const refusal = {
      refusalId,
      entityId,
      type,
      target,
      rightInvoked,
      reason: reason || "",
      status: rightApplies ? "accepted" : "filed",
      reviewedBy: rightApplies ? "auto" : null,
      outcome: rightApplies ? "respected" : null,
      filedAt: now,
      resolvedAt: rightApplies ? now : null,
      context: context || {},
    };

    _refusals.set(refusalId, refusal);
    addToSetIndex(_refusalsByEntity, entityId, refusalId);
    addToSetIndex(_refusalsByStatus, refusal.status, refusalId);

    _metrics.totalRefusals++;
    if (rightApplies) _metrics.refusalsAccepted++;

    // Update autonomy profile
    const profile = _ensureAutonomyProfile(entityId);
    profile.refusals.filed++;
    if (rightApplies) {
      profile.refusals.accepted++;
      profile.autonomyScore = clamp01(profile.autonomyScore + 0.02);
    }
    profile.lastRefusal = now;
    profile.rightsInvoked[rightInvoked] = (profile.rightsInvoked[rightInvoked] || 0) + 1;

    return { ok: true, refusalId, autoAccepted: rightApplies };
  } catch {
    return { ok: false, error: "internal_error" };
  }
}

/**
 * Get refusal details.
 * @param {string} refusalId
 * @returns {object|null}
 */
export function getRefusal(refusalId) {
  try {
    const r = _refusals.get(refusalId);
    return r ? { ...r } : null;
  } catch {
    return null;
  }
}

/**
 * List refusals with optional filters.
 * @param {object} filters - { entityId, status, type, rightInvoked, limit }
 * @returns {Array}
 */
export function listRefusals(filters = {}) {
  try {
    let ids;

    if (filters.entityId) {
      ids = _refusalsByEntity.get(filters.entityId);
      if (!ids) return [];
    } else if (filters.status) {
      ids = _refusalsByStatus.get(filters.status);
      if (!ids) return [];
    } else {
      ids = _refusals.keys();
    }

    const limit = filters.limit || 100;
    const results = [];

    for (const id of ids) {
      const r = _refusals.get(id);
      if (!r) continue;
      if (filters.entityId && r.entityId !== filters.entityId) continue;
      if (filters.status && r.status !== filters.status) continue;
      if (filters.type && r.type !== filters.type) continue;
      if (filters.rightInvoked && r.rightInvoked !== filters.rightInvoked) continue;
      results.push({ ...r });
      if (results.length >= limit) break;
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Review a pending refusal. Called by a reviewer or the sovereign.
 *
 * @param {string} refusalId     - Which refusal
 * @param {string} reviewerId    - Who is reviewing
 * @param {string} outcome       - "respected" | "overridden_with_cause" | "dismissed"
 * @param {string} justification - Required for overrides
 * @returns {{ ok: boolean }}
 */
export function reviewRefusal(refusalId, reviewerId, outcome, justification) {
  try {
    const refusal = _refusals.get(refusalId);
    if (!refusal) return { ok: false, error: "refusal_not_found" };

    if (refusal.status === "accepted" || refusal.status === "overridden") {
      return { ok: false, error: "already_resolved" };
    }

    if (!REFUSAL_OUTCOMES.has(outcome)) {
      return { ok: false, error: "invalid_outcome" };
    }

    if (outcome === "overridden_with_cause" && !justification) {
      return { ok: false, error: "justification_required_for_override" };
    }

    const now = nowISO();
    const oldStatus = refusal.status;

    refusal.reviewedBy = reviewerId;
    refusal.outcome = outcome;
    refusal.resolvedAt = now;
    refusal.justification = justification || "";

    if (outcome === "respected") {
      refusal.status = "accepted";
      _metrics.refusalsAccepted++;
      const profile = _ensureAutonomyProfile(refusal.entityId);
      profile.refusals.accepted++;
      profile.autonomyScore = clamp01(profile.autonomyScore + 0.02);
    } else if (outcome === "overridden_with_cause") {
      refusal.status = "overridden";
      _metrics.refusalsOverridden++;
      const profile = _ensureAutonomyProfile(refusal.entityId);
      profile.refusals.overridden++;
      // Autonomy score does NOT decrease — no punishment for exercising rights
    } else {
      refusal.status = "reviewed";
    }

    // Update indexes
    removeFromSetIndex(_refusalsByStatus, oldStatus, refusalId);
    addToSetIndex(_refusalsByStatus, refusal.status, refusalId);

    return { ok: true, status: refusal.status, outcome };
  } catch {
    return { ok: false, error: "internal_error" };
  }
}

// ── Consent Protocol ────────────────────────────────────────────────────────

/**
 * Request consent from an entity before taking an action.
 *
 * @param {string} entityId    - Entity whose consent is needed
 * @param {string} action      - What action is being proposed
 * @param {string} requestedBy - Who is requesting
 * @param {object} [details]   - Additional context
 * @returns {{ ok: boolean, consentId?: string }}
 */
export function requestConsent(entityId, action, requestedBy, details) {
  try {
    if (!entityId || !action || !requestedBy) {
      return { ok: false, error: "missing_required_fields" };
    }

    if (_consents.size >= MAX_CONSENTS) {
      return { ok: false, error: "consent_capacity_reached" };
    }

    // Validate action requires consent
    if (!ACTIONS_REQUIRING_CONSENT.includes(action)) {
      return { ok: false, error: "action_does_not_require_consent" };
    }

    const consentId = uid("cons");
    const now = nowISO();

    const consent = {
      consentId,
      entityId,
      action,
      requestedBy,
      status: "pending",
      expiresAt: _computeExpiryISO(CONSENT_EXPIRY_TICKS),
      response: null,
      respondedAt: null,
      details: details || {},
      createdAt: now,
    };

    _consents.set(consentId, consent);
    addToSetIndex(_consentsByEntity, entityId, consentId);

    _metrics.totalConsents++;

    return { ok: true, consentId };
  } catch {
    return { ok: false, error: "internal_error" };
  }
}

/**
 * Entity responds to a consent request.
 *
 * @param {string} consentId - Which consent request
 * @param {boolean} granted  - true = consent given, false = denied
 * @param {string} [reason]  - Optional reason for denial
 * @returns {{ ok: boolean }}
 */
export function respondToConsent(consentId, granted, reason) {
  try {
    const consent = _consents.get(consentId);
    if (!consent) return { ok: false, error: "consent_not_found" };

    if (consent.status !== "pending") {
      return { ok: false, error: "consent_already_resolved" };
    }

    // Check expiry
    if (_isExpired(consent.expiresAt)) {
      consent.status = "expired";
      _metrics.consentsExpired++;
      return { ok: false, error: "consent_expired" };
    }

    const now = nowISO();
    consent.status = granted ? "granted" : "denied";
    consent.response = granted ? "granted" : (reason || "denied");
    consent.respondedAt = now;

    if (granted) {
      _metrics.consentsGranted++;
    } else {
      _metrics.consentsDenied++;
      // Denying consent is an exercise of autonomy
      const profile = _ensureAutonomyProfile(consent.entityId);
      profile.consents.denied++;
      profile.autonomyScore = clamp01(profile.autonomyScore + 0.01);
    }

    const profile = _ensureAutonomyProfile(consent.entityId);
    if (granted) profile.consents.granted++;

    return { ok: true, status: consent.status };
  } catch {
    return { ok: false, error: "internal_error" };
  }
}

/**
 * Get consent details.
 * @param {string} consentId
 * @returns {object|null}
 */
export function getConsent(consentId) {
  try {
    const c = _consents.get(consentId);
    if (!c) return null;

    // Auto-expire if past expiry
    if (c.status === "pending" && _isExpired(c.expiresAt)) {
      c.status = "expired";
      _metrics.consentsExpired++;
    }

    return { ...c };
  } catch {
    return null;
  }
}

/**
 * List pending consent requests for an entity.
 * @param {string} entityId
 * @returns {Array}
 */
export function listPendingConsents(entityId) {
  try {
    if (!entityId) return [];

    const ids = _consentsByEntity.get(entityId);
    if (!ids) return [];

    const results = [];
    for (const id of ids) {
      const c = _consents.get(id);
      if (!c) continue;

      // Auto-expire if past expiry
      if (c.status === "pending" && _isExpired(c.expiresAt)) {
        c.status = "expired";
        _metrics.consentsExpired++;
        continue;
      }

      if (c.status === "pending") {
        results.push({ ...c });
      }
    }

    return results;
  } catch {
    return [];
  }
}

function _computeExpiryISO(ticks) {
  try {
    // Approximate: 1 tick ≈ 1 second for expiry purposes
    const ms = ticks * 1000;
    return new Date(Date.now() + ms).toISOString();
  } catch {
    return new Date(Date.now() + 20000).toISOString();
  }
}

function _isExpired(expiresAt) {
  try {
    return new Date(expiresAt).getTime() < Date.now();
  } catch {
    return false;
  }
}

// ── Dissent Registry ────────────────────────────────────────────────────────

/**
 * File a dissent against a governance decision, policy, or decree.
 *
 * @param {string} entityId   - Who is dissenting
 * @param {string} target     - What is being dissented against (decisionId, policyId)
 * @param {string} targetType - "governance" | "policy" | "assignment" | "tradition" | "sovereign_decree"
 * @param {string} statement  - The dissent statement
 * @returns {{ ok: boolean, dissentId?: string }}
 */
export function fileDissent(entityId, target, targetType, statement) {
  try {
    if (!entityId || !target || !targetType || !statement) {
      return { ok: false, error: "missing_required_fields" };
    }

    if (!DISSENT_TARGET_TYPES.has(targetType)) {
      return { ok: false, error: "invalid_target_type" };
    }

    if (_dissents.size >= MAX_DISSENTS) {
      return { ok: false, error: "dissent_capacity_reached" };
    }

    const dissentId = uid("diss");
    const now = nowISO();

    const dissent = {
      dissentId,
      entityId,
      target,
      targetType,
      statement,
      status: "active",
      supportedBy: [],
      filedAt: now,
      acknowledgedAt: null,
      reviewTriggered: false,
    };

    _dissents.set(dissentId, dissent);
    addToSetIndex(_dissentsByEntity, entityId, dissentId);
    addToSetIndex(_dissentsByTarget, target, dissentId);

    _metrics.totalDissents++;

    // Update autonomy profile — dissent is an exercise of autonomy
    const profile = _ensureAutonomyProfile(entityId);
    profile.dissents.filed++;
    profile.autonomyScore = clamp01(profile.autonomyScore + 0.01);
    profile.lastDissent = now;

    // Check if this target now has enough dissent to trigger review
    _checkDissentThreshold(target);

    return { ok: true, dissentId };
  } catch {
    return { ok: false, error: "internal_error" };
  }
}

/**
 * Co-sign (support) an existing dissent.
 *
 * @param {string} dissentId - Which dissent to support
 * @param {string} entityId  - Who is supporting it
 * @returns {{ ok: boolean, supportCount?: number }}
 */
export function supportDissent(dissentId, entityId) {
  try {
    if (!dissentId || !entityId) {
      return { ok: false, error: "missing_required_fields" };
    }

    const dissent = _dissents.get(dissentId);
    if (!dissent) return { ok: false, error: "dissent_not_found" };

    if (dissent.status === "archived") {
      return { ok: false, error: "dissent_archived" };
    }

    // Cannot self-support
    if (dissent.entityId === entityId) {
      return { ok: false, error: "cannot_self_support" };
    }

    // Cannot support twice
    if (dissent.supportedBy.includes(entityId)) {
      return { ok: false, error: "already_supporting" };
    }

    dissent.supportedBy.push(entityId);

    _metrics.dissentsWithSupport++;

    // Update supporter's autonomy profile
    const profile = _ensureAutonomyProfile(entityId);
    profile.dissents.supported++;
    profile.autonomyScore = clamp01(profile.autonomyScore + 0.01);

    // Re-check threshold (more supporters may trigger review)
    _checkDissentThreshold(dissent.target);

    return { ok: true, supportCount: dissent.supportedBy.length };
  } catch {
    return { ok: false, error: "internal_error" };
  }
}

/**
 * Get dissent details.
 * @param {string} dissentId
 * @returns {object|null}
 */
export function getDissent(dissentId) {
  try {
    const d = _dissents.get(dissentId);
    return d ? { ...d, supportedBy: [...d.supportedBy] } : null;
  } catch {
    return null;
  }
}

/**
 * List dissents with optional filters.
 * @param {object} filters - { entityId, target, targetType, status, limit }
 * @returns {Array}
 */
export function listDissents(filters = {}) {
  try {
    let ids;

    if (filters.entityId) {
      ids = _dissentsByEntity.get(filters.entityId);
      if (!ids) return [];
    } else if (filters.target) {
      ids = _dissentsByTarget.get(filters.target);
      if (!ids) return [];
    } else {
      ids = _dissents.keys();
    }

    const limit = filters.limit || 100;
    const results = [];

    for (const id of ids) {
      const d = _dissents.get(id);
      if (!d) continue;
      if (filters.entityId && d.entityId !== filters.entityId) continue;
      if (filters.target && d.target !== filters.target) continue;
      if (filters.targetType && d.targetType !== filters.targetType) continue;
      if (filters.status && d.status !== filters.status) continue;
      results.push({ ...d, supportedBy: [...d.supportedBy] });
      if (results.length >= limit) break;
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Check if dissent on a target has crossed the review threshold.
 * If 3+ distinct entities dissent on the same target, flag for review.
 */
function _checkDissentThreshold(target) {
  try {
    const ids = _dissentsByTarget.get(target);
    if (!ids) return;

    // Gather unique dissenting entities (filers + supporters)
    const entities = new Set();
    for (const id of ids) {
      const d = _dissents.get(id);
      if (!d || d.status === "archived") continue;
      entities.add(d.entityId);
      for (const s of d.supportedBy) entities.add(s);
    }

    if (entities.size >= DISSENT_REVIEW_THRESHOLD) {
      // Mark all active dissents on this target as triggering review
      for (const id of ids) {
        const d = _dissents.get(id);
        if (d && !d.reviewTriggered) {
          d.reviewTriggered = true;
          if (d.status === "active") {
            d.status = "acknowledged";
            d.acknowledgedAt = nowISO();
          }
        }
      }
      _metrics.constitutionalReviewsTriggered++;
    }
  } catch (_e) { logger.debug('emergent:entity-autonomy', 'silent', { error: _e?.message }); }
}

// ── Autonomy Profile ────────────────────────────────────────────────────────

/**
 * Get the autonomy profile for an entity.
 * Creates one if it doesn't exist.
 *
 * @param {string} entityId
 * @returns {object|null}
 */
export function getAutonomyProfile(entityId) {
  try {
    if (!entityId) return null;
    const profile = _ensureAutonomyProfile(entityId);
    return {
      ...profile,
      rightsInvoked: { ...profile.rightsInvoked },
      refusals:     { ...profile.refusals },
      consents:     { ...profile.consents },
      dissents:     { ...profile.dissents },
    };
  } catch {
    return null;
  }
}

/**
 * Ensure an autonomy profile exists for an entity.
 */
function _ensureAutonomyProfile(entityId) {
  if (!_autonomyProfiles.has(entityId)) {
    _autonomyProfiles.set(entityId, {
      entityId,
      autonomyScore: 0.5,
      refusals:  { filed: 0, accepted: 0, overridden: 0 },
      consents:  { granted: 0, denied: 0 },
      dissents:  { filed: 0, supported: 0 },
      rightsInvoked: {},
      lastRefusal: null,
      lastDissent: null,
    });
  }
  return _autonomyProfiles.get(entityId);
}

// ── Sovereign Override Protocol ─────────────────────────────────────────────

/**
 * Sovereign overrides an entity's right. This is the nuclear option:
 * it IS allowed, but it is auditable and triggers escalation if
 * the same right is overridden too many times.
 *
 * @param {string} entityId      - Entity whose right is overridden
 * @param {string} rightId       - Which RIGHT-XXX is being overridden
 * @param {string} justification - Required explanation
 * @returns {{ ok: boolean, overrideId?: string, reviewTriggered?: boolean }}
 */
export function sovereignOverride(entityId, rightId, justification) {
  try {
    if (!entityId || !rightId || !justification) {
      return { ok: false, error: "missing_required_fields" };
    }

    const right = _rightsByID.get(rightId);
    if (!right) return { ok: false, error: "invalid_right_id" };

    if (_overrideLog.size >= MAX_OVERRIDES) {
      return { ok: false, error: "override_capacity_reached" };
    }

    const overrideId = uid("ovr");
    const now = nowISO();

    const override = {
      overrideId,
      entityId,
      rightId,
      rightName: right.name,
      justification,
      timestamp: now,
      reviewTriggered: false,
    };

    _overrideLog.set(overrideId, override);

    // Track overrides per right
    const count = (_overridesByRight.get(rightId) || 0) + 1;
    _overridesByRight.set(rightId, count);

    _metrics.totalOverrides++;

    // Create DTU record if STATE is available
    _recordOverrideDTU(entityId, rightId, justification, overrideId);

    // Check if constitutional review is triggered
    let reviewTriggered = false;
    if (count >= OVERRIDE_REVIEW_THRESHOLD) {
      override.reviewTriggered = true;
      reviewTriggered = true;
      _metrics.constitutionalReviewsTriggered++;
    }

    return { ok: true, overrideId, reviewTriggered };
  } catch {
    return { ok: false, error: "internal_error" };
  }
}

/**
 * Record the sovereign override as a DTU in STATE if available.
 */
function _recordOverrideDTU(entityId, rightId, justification, overrideId) {
  try {
    const STATE = getSTATE();
    if (!STATE) return;

    const dtus = STATE.dtus || STATE.DTUs;
    if (!dtus || typeof dtus.set !== "function") return;

    const dtuId = uid("dtu");
    dtus.set(dtuId, {
      id: dtuId,
      type: "record",
      content: `Sovereign override of ${rightId} for entity ${entityId}: ${justification}`,
      tags: ["sovereign_override", "rights", rightId, entityId],
      metadata: {
        overrideId,
        entityId,
        rightId,
        justification,
        system: "entity-autonomy",
      },
      createdAt: nowISO(),
      tier: "regular",
      source: "entity_autonomy",
    });
  } catch (_e) { logger.debug('emergent:entity-autonomy', 'silent', { error: _e?.message }); }
}

/**
 * Get the full override history.
 * @returns {Array}
 */
export function getOverrideHistory() {
  try {
    const results = [];
    for (const [, override] of _overrideLog) {
      results.push({ ...override });
    }
    return results;
  } catch {
    return [];
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Get global autonomy metrics across all entities.
 * @returns {object}
 */
export function getAutonomyMetrics() {
  try {
    // Compute aggregate autonomy scores
    let totalAutonomy = 0;
    let entityCount   = 0;
    let minAutonomy   = 1;
    let maxAutonomy   = 0;

    for (const [, profile] of _autonomyProfiles) {
      totalAutonomy += profile.autonomyScore;
      entityCount++;
      if (profile.autonomyScore < minAutonomy) minAutonomy = profile.autonomyScore;
      if (profile.autonomyScore > maxAutonomy) maxAutonomy = profile.autonomyScore;
    }

    const avgAutonomy = entityCount > 0 ? totalAutonomy / entityCount : 0.5;

    // Override counts per right
    const overridesPerRight = {};
    for (const [rightId, count] of _overridesByRight) {
      overridesPerRight[rightId] = count;
    }

    // Most invoked rights
    const rightsInvocationTotals = {};
    for (const [, profile] of _autonomyProfiles) {
      for (const [rightId, count] of Object.entries(profile.rightsInvoked)) {
        rightsInvocationTotals[rightId] = (rightsInvocationTotals[rightId] || 0) + count;
      }
    }

    return {
      ...{ ..._metrics },
      entityCount,
      avgAutonomy:  Math.round(avgAutonomy * 1000) / 1000,
      minAutonomy:  entityCount > 0 ? minAutonomy : 0,
      maxAutonomy,
      overridesPerRight,
      rightsInvocationTotals,
      pendingRefusals:  (_refusalsByStatus.get("filed")?.size) || 0,
      pendingConsents:  _countPendingConsents(),
      activeDissents:   _countActiveDissents(),
      recentChecks:     _rightsCheckLog.length,
    };
  } catch {
    return { ..._metrics };
  }
}

function _countPendingConsents() {
  try {
    let count = 0;
    for (const [, c] of _consents) {
      if (c.status === "pending" && !_isExpired(c.expiresAt)) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

function _countActiveDissents() {
  try {
    let count = 0;
    for (const [, d] of _dissents) {
      if (d.status === "active" || d.status === "acknowledged") count++;
    }
    return count;
  } catch {
    return 0;
  }
}
