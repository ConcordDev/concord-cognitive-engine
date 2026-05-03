/**
 * Emergent Agent Governance — Schema & Constants
 *
 * Defines all roles, capabilities, confidence labels, intent types,
 * and validation helpers for the emergent system.
 *
 * Non-negotiable invariants:
 *   1. Emergents may speak; they may not decide.
 *   2. All growth is gated (deterministic rules + governance).
 *   3. Every growth artifact has provenance.
 *   4. No self-reinforcing delusion loops.
 *   5. Everything is replayable.
 */

// ── Emergent Roles ──────────────────────────────────────────────────────────

export const EMERGENT_ROLES = Object.freeze({
  BUILDER:      "builder",       // constructs proposals, DTUs, artifacts
  CRITIC:       "critic",        // attacks, finds flaws, demands falsifiability
  HISTORIAN:    "historian",     // provides temporal/archival context
  ECONOMIST:    "economist",     // evaluates economic / incentive implications
  ETHICIST:     "ethicist",      // evaluates normative / ethical implications
  ENGINEER:     "engineer",      // evaluates technical feasibility
  SYNTHESIZER:  "synthesizer",   // integrates across perspectives, resolves tensions
  AUDITOR:      "auditor",       // verifies provenance, scope, compliance
  ADVERSARY:    "adversary",     // red-team / adversarial pressure
});

export const ALL_ROLES = Object.freeze(Object.values(EMERGENT_ROLES));

// ── Capabilities ────────────────────────────────────────────────────────────

export const CAPABILITIES = Object.freeze({
  TALK:       "talk",        // participate in dialogue
  CRITIQUE:   "critique",    // challenge claims
  PROPOSE:    "propose",     // propose DTUs, edits, tests
  SUMMARIZE:  "summarize",   // distill sessions into summaries
  TEST:       "test",        // propose falsifiability tests
  WARN:       "warn",        // raise risk flags
  ASK:        "ask",         // ask users for clarification
});

// ── Confidence Labels (mandatory on every claim) ────────────────────────────

export const CONFIDENCE_LABELS = Object.freeze({
  FACT:        "fact",         // verifiable, cited, confirmed
  DERIVED:     "derived",      // logically derived from cited facts
  HYPOTHESIS:  "hypothesis",   // testable but unconfirmed
  SPECULATIVE: "speculative",  // exploratory, low confidence
});

export const ALL_CONFIDENCE_LABELS = Object.freeze(Object.values(CONFIDENCE_LABELS));

// ── Intent Classification ───────────────────────────────────────────────────

export const INTENT_TYPES = Object.freeze({
  QUESTION:      "question",
  SUGGESTION:    "suggestion",
  HYPOTHESIS:    "hypothesis",
  NOTIFICATION:  "notification",
  CRITIQUE:      "critique",
  SYNTHESIS:     "synthesis",
  WARNING:       "warning",
});

// ── Session Signals ─────────────────────────────────────────────────────────

export const SESSION_SIGNAL_TYPES = Object.freeze({
  COHERENCE_TREND:    "coherence_trend",
  CONTRADICTION:      "contradiction",
  NOVELTY:            "novelty",
  RISK_FLAG:          "risk_flag",
  ECHO_WARNING:       "echo_warning",
  STAGNATION:         "stagnation",
});

// ── Promotion Tiers ─────────────────────────────────────────────────────────

export const PROMOTION_TIERS = Object.freeze({
  REGULAR: "regular",
  MEGA:    "mega",
  HYPER:   "hyper",
});

export const TIER_THRESHOLDS = Object.freeze({
  regular: { minResonance: 0, minCoherence: 0, minApprovals: 0 },
  mega:    { minResonance: 0.5, minCoherence: 0.6, minApprovals: 2 },
  hyper:   { minResonance: 0.8, minCoherence: 0.8, minApprovals: 3 },
});

// ── Session Limits ──────────────────────────────────────────────────────────

export const SESSION_LIMITS = Object.freeze({
  MAX_TURNS:            50,     // hard cap per dialogue session
  MAX_TURNS_NO_NOVELTY: 10,     // stop if novelty stays below threshold for N turns
  NOVELTY_FLOOR:        0.15,   // minimum novelty score to continue
  MIN_CRITIQUE_RATIO:   0.2,    // at least 20% of turns must be critique
  MAX_CONCURRENT:       Number(process.env.CONCORD_DIALOGUE_MAX_CONCURRENT) || 50, // bumped 5→50 for 32GB-heap deployments
  SUMMARY_INTERVAL:     10,     // emit summary every N turns
});

// ── Memory Policies ─────────────────────────────────────────────────────────

export const MEMORY_POLICIES = Object.freeze({
  SESSION_ONLY:    "session_only",     // cleared when session ends
  DISTILLED:       "distilled",        // distilled to DTUs, transcript discarded
  FULL_TRANSCRIPT: "full_transcript",  // full transcript retained (auditor/historian)
});

// ── Gate Rule IDs ───────────────────────────────────────────────────────────

export const GATE_RULES = Object.freeze({
  IDENTITY_BINDING:       "gate.identity_binding",
  SCOPE_BINDING:          "gate.scope_binding",
  DISCLOSURE_ENFORCEMENT: "gate.disclosure_enforcement",
  ANTI_ECHO:              "gate.anti_echo",
  NOVELTY_CHECK:          "gate.novelty_check",
  RISK_CHECK:             "gate.risk_check",
  ECONOMIC_CHECK:         "gate.economic_check",
  RATE_LIMIT:             "gate.rate_limit",
  DUPLICATE_CHECK:        "gate.duplicate_check",
});

// ── Validation Helpers ──────────────────────────────────────────────────────

/**
 * Validate that a turn has required structure.
 * Every turn must have: claim, support, confidenceLabel, counterpoint/question.
 */
export function validateTurnStructure(turn) {
  const errors = [];
  const warnings = [];

  if (!turn.speakerId)      errors.push("missing speakerId");
  if (!turn.claim)          errors.push("missing claim");
  if (!turn.confidenceLabel || !ALL_CONFIDENCE_LABELS.includes(turn.confidenceLabel)) {
    errors.push(`invalid or missing confidenceLabel: ${turn.confidenceLabel}`);
  }
  if (!turn.support && turn.support !== null) {
    // support can be null (explicitly "no cite") but must be present
    errors.push("missing support (use null for 'no citation')");
  }
  // counterpoint or question is recommended but not blocking
  if (!turn.counterpoint && !turn.question) {
    warnings.push("missing counterpoint or question (recommended)");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate emergent definition.
 */
export function validateEmergent(emergent) {
  const errors = [];

  if (!emergent.id)   errors.push("missing id");
  if (!emergent.name) errors.push("missing name");
  if (!emergent.role || !ALL_ROLES.includes(emergent.role)) {
    errors.push(`invalid role: ${emergent.role}`);
  }
  if (!Array.isArray(emergent.scope) || emergent.scope.length === 0) {
    errors.push("scope must be a non-empty array");
  }
  if (!Array.isArray(emergent.capabilities) || emergent.capabilities.length === 0) {
    errors.push("capabilities must be a non-empty array");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Compute a simple content hash for duplicate detection.
 */
export function contentHash(text) {
  let hash = 0;
  const str = String(text).trim().toLowerCase();
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `ch_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
