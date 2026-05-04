/**
 * Emergent Schema — Comprehensive Test Suite
 *
 * Covers all exports from emergent/schema.js:
 *   - EMERGENT_ROLES, ALL_ROLES
 *   - CAPABILITIES
 *   - CONFIDENCE_LABELS, ALL_CONFIDENCE_LABELS
 *   - INTENT_TYPES
 *   - SESSION_SIGNAL_TYPES
 *   - PROMOTION_TIERS, TIER_THRESHOLDS
 *   - SESSION_LIMITS
 *   - MEMORY_POLICIES
 *   - GATE_RULES
 *   - validateTurnStructure()
 *   - validateEmergent()
 *   - contentHash()
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EMERGENT_ROLES,
  ALL_ROLES,
  CAPABILITIES,
  CONFIDENCE_LABELS,
  ALL_CONFIDENCE_LABELS,
  INTENT_TYPES,
  SESSION_SIGNAL_TYPES,
  PROMOTION_TIERS,
  TIER_THRESHOLDS,
  SESSION_LIMITS,
  MEMORY_POLICIES,
  GATE_RULES,
  validateTurnStructure,
  validateEmergent,
  contentHash,
} from "../emergent/schema.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("schema constants", () => {
  it("EMERGENT_ROLES is frozen with expected keys", () => {
    assert.ok(Object.isFrozen(EMERGENT_ROLES));
    assert.equal(EMERGENT_ROLES.BUILDER, "builder");
    assert.equal(EMERGENT_ROLES.CRITIC, "critic");
    assert.equal(EMERGENT_ROLES.HISTORIAN, "historian");
    assert.equal(EMERGENT_ROLES.ECONOMIST, "economist");
    assert.equal(EMERGENT_ROLES.ETHICIST, "ethicist");
    assert.equal(EMERGENT_ROLES.ENGINEER, "engineer");
    assert.equal(EMERGENT_ROLES.SYNTHESIZER, "synthesizer");
    assert.equal(EMERGENT_ROLES.AUDITOR, "auditor");
    assert.equal(EMERGENT_ROLES.ADVERSARY, "adversary");
    assert.equal(Object.keys(EMERGENT_ROLES).length, 9);
  });

  it("ALL_ROLES is frozen array of all role values", () => {
    assert.ok(Object.isFrozen(ALL_ROLES));
    assert.ok(Array.isArray(ALL_ROLES));
    assert.equal(ALL_ROLES.length, 9);
    for (const role of Object.values(EMERGENT_ROLES)) {
      assert.ok(ALL_ROLES.includes(role), `ALL_ROLES should include ${role}`);
    }
  });

  it("CAPABILITIES is frozen with expected keys", () => {
    assert.ok(Object.isFrozen(CAPABILITIES));
    assert.equal(CAPABILITIES.TALK, "talk");
    assert.equal(CAPABILITIES.CRITIQUE, "critique");
    assert.equal(CAPABILITIES.PROPOSE, "propose");
    assert.equal(CAPABILITIES.SUMMARIZE, "summarize");
    assert.equal(CAPABILITIES.TEST, "test");
    assert.equal(CAPABILITIES.WARN, "warn");
    assert.equal(CAPABILITIES.ASK, "ask");
    assert.equal(Object.keys(CAPABILITIES).length, 7);
  });

  it("CONFIDENCE_LABELS is frozen with expected keys", () => {
    assert.ok(Object.isFrozen(CONFIDENCE_LABELS));
    assert.equal(CONFIDENCE_LABELS.FACT, "fact");
    assert.equal(CONFIDENCE_LABELS.DERIVED, "derived");
    assert.equal(CONFIDENCE_LABELS.HYPOTHESIS, "hypothesis");
    assert.equal(CONFIDENCE_LABELS.SPECULATIVE, "speculative");
  });

  it("ALL_CONFIDENCE_LABELS is frozen array of all confidence label values", () => {
    assert.ok(Object.isFrozen(ALL_CONFIDENCE_LABELS));
    assert.ok(Array.isArray(ALL_CONFIDENCE_LABELS));
    assert.equal(ALL_CONFIDENCE_LABELS.length, 4);
    for (const label of Object.values(CONFIDENCE_LABELS)) {
      assert.ok(ALL_CONFIDENCE_LABELS.includes(label));
    }
  });

  it("INTENT_TYPES is frozen with expected keys", () => {
    assert.ok(Object.isFrozen(INTENT_TYPES));
    assert.equal(INTENT_TYPES.QUESTION, "question");
    assert.equal(INTENT_TYPES.SUGGESTION, "suggestion");
    assert.equal(INTENT_TYPES.HYPOTHESIS, "hypothesis");
    assert.equal(INTENT_TYPES.NOTIFICATION, "notification");
    assert.equal(INTENT_TYPES.CRITIQUE, "critique");
    assert.equal(INTENT_TYPES.SYNTHESIS, "synthesis");
    assert.equal(INTENT_TYPES.WARNING, "warning");
  });

  it("SESSION_SIGNAL_TYPES is frozen with expected keys", () => {
    assert.ok(Object.isFrozen(SESSION_SIGNAL_TYPES));
    assert.equal(SESSION_SIGNAL_TYPES.COHERENCE_TREND, "coherence_trend");
    assert.equal(SESSION_SIGNAL_TYPES.CONTRADICTION, "contradiction");
    assert.equal(SESSION_SIGNAL_TYPES.NOVELTY, "novelty");
    assert.equal(SESSION_SIGNAL_TYPES.RISK_FLAG, "risk_flag");
    assert.equal(SESSION_SIGNAL_TYPES.ECHO_WARNING, "echo_warning");
    assert.equal(SESSION_SIGNAL_TYPES.STAGNATION, "stagnation");
  });

  it("PROMOTION_TIERS is frozen with expected tiers", () => {
    assert.ok(Object.isFrozen(PROMOTION_TIERS));
    assert.equal(PROMOTION_TIERS.REGULAR, "regular");
    assert.equal(PROMOTION_TIERS.MEGA, "mega");
    assert.equal(PROMOTION_TIERS.HYPER, "hyper");
  });

  it("TIER_THRESHOLDS has correct thresholds per tier", () => {
    assert.ok(Object.isFrozen(TIER_THRESHOLDS));
    assert.deepEqual(TIER_THRESHOLDS.regular, { minResonance: 0, minCoherence: 0, minApprovals: 0 });
    assert.deepEqual(TIER_THRESHOLDS.mega, { minResonance: 0.5, minCoherence: 0.6, minApprovals: 2 });
    assert.deepEqual(TIER_THRESHOLDS.hyper, { minResonance: 0.8, minCoherence: 0.8, minApprovals: 3 });
  });

  it("SESSION_LIMITS has correct default values (32GB-heap deployment)", () => {
    assert.ok(Object.isFrozen(SESSION_LIMITS));
    assert.equal(SESSION_LIMITS.MAX_TURNS, 50);
    assert.equal(SESSION_LIMITS.MAX_TURNS_NO_NOVELTY, 10);
    assert.equal(SESSION_LIMITS.NOVELTY_FLOOR, 0.15);
    assert.equal(SESSION_LIMITS.MIN_CRITIQUE_RATIO, 0.2);
    // MAX_CONCURRENT was bumped from 5 → 50 for the 32GB-heap deployment.
    // Override via CONCORD_DIALOGUE_MAX_CONCURRENT.
    assert.equal(SESSION_LIMITS.MAX_CONCURRENT, 50);
    assert.equal(SESSION_LIMITS.SUMMARY_INTERVAL, 10);
  });

  it("MEMORY_POLICIES is frozen with expected policies", () => {
    assert.ok(Object.isFrozen(MEMORY_POLICIES));
    assert.equal(MEMORY_POLICIES.SESSION_ONLY, "session_only");
    assert.equal(MEMORY_POLICIES.DISTILLED, "distilled");
    assert.equal(MEMORY_POLICIES.FULL_TRANSCRIPT, "full_transcript");
  });

  it("GATE_RULES is frozen with expected gate IDs", () => {
    assert.ok(Object.isFrozen(GATE_RULES));
    assert.equal(GATE_RULES.IDENTITY_BINDING, "gate.identity_binding");
    assert.equal(GATE_RULES.SCOPE_BINDING, "gate.scope_binding");
    assert.equal(GATE_RULES.DISCLOSURE_ENFORCEMENT, "gate.disclosure_enforcement");
    assert.equal(GATE_RULES.ANTI_ECHO, "gate.anti_echo");
    assert.equal(GATE_RULES.NOVELTY_CHECK, "gate.novelty_check");
    assert.equal(GATE_RULES.RISK_CHECK, "gate.risk_check");
    assert.equal(GATE_RULES.ECONOMIC_CHECK, "gate.economic_check");
    assert.equal(GATE_RULES.RATE_LIMIT, "gate.rate_limit");
    assert.equal(GATE_RULES.DUPLICATE_CHECK, "gate.duplicate_check");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. validateTurnStructure
// ═══════════════════════════════════════════════════════════════════════════════

describe("validateTurnStructure", () => {
  it("valid turn with all fields passes", () => {
    const turn = {
      speakerId: "e1",
      claim: "The sky is blue",
      confidenceLabel: "fact",
      support: "visual observation",
      counterpoint: "Not at night",
    };
    const result = validateTurnStructure(turn);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
  });

  it("missing speakerId produces error", () => {
    const turn = { claim: "x", confidenceLabel: "fact", support: "y", counterpoint: "z" };
    const result = validateTurnStructure(turn);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("speakerId")));
  });

  it("missing claim produces error", () => {
    const turn = { speakerId: "e1", confidenceLabel: "fact", support: "y", counterpoint: "z" };
    const result = validateTurnStructure(turn);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("claim")));
  });

  it("missing confidenceLabel produces error", () => {
    const turn = { speakerId: "e1", claim: "x", support: "y", counterpoint: "z" };
    const result = validateTurnStructure(turn);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("confidenceLabel")));
  });

  it("invalid confidenceLabel produces error", () => {
    const turn = { speakerId: "e1", claim: "x", confidenceLabel: "bogus", support: "y", counterpoint: "z" };
    const result = validateTurnStructure(turn);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("confidenceLabel")));
  });

  it("missing support produces error (support undefined)", () => {
    const turn = { speakerId: "e1", claim: "x", confidenceLabel: "fact", counterpoint: "z" };
    const result = validateTurnStructure(turn);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("support")));
  });

  it("support=null is valid (no citation)", () => {
    const turn = { speakerId: "e1", claim: "x", confidenceLabel: "fact", support: null, counterpoint: "z" };
    const result = validateTurnStructure(turn);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("support='' (empty string) produces error", () => {
    const turn = { speakerId: "e1", claim: "x", confidenceLabel: "fact", support: "", counterpoint: "z" };
    const result = validateTurnStructure(turn);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("support")));
  });

  it("missing counterpoint and question produces warning", () => {
    const turn = { speakerId: "e1", claim: "x", confidenceLabel: "fact", support: null };
    const result = validateTurnStructure(turn);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings.some(w => w.includes("counterpoint")));
  });

  it("having question but no counterpoint suppresses warning", () => {
    const turn = { speakerId: "e1", claim: "x", confidenceLabel: "fact", support: null, question: "why?" };
    const result = validateTurnStructure(turn);
    assert.equal(result.valid, true);
    assert.equal(result.warnings.length, 0);
  });

  it("multiple errors accumulate", () => {
    const turn = {};
    const result = validateTurnStructure(turn);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. validateEmergent
// ═══════════════════════════════════════════════════════════════════════════════

describe("validateEmergent", () => {
  it("valid emergent passes", () => {
    const emergent = {
      id: "e1",
      name: "Builder-1",
      role: "builder",
      scope: ["local"],
      capabilities: ["talk"],
    };
    const result = validateEmergent(emergent);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("missing id produces error", () => {
    const emergent = { name: "x", role: "builder", scope: ["local"], capabilities: ["talk"] };
    const result = validateEmergent(emergent);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("id")));
  });

  it("missing name produces error", () => {
    const emergent = { id: "e1", role: "builder", scope: ["local"], capabilities: ["talk"] };
    const result = validateEmergent(emergent);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("name")));
  });

  it("missing role produces error", () => {
    const emergent = { id: "e1", name: "x", scope: ["local"], capabilities: ["talk"] };
    const result = validateEmergent(emergent);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("role")));
  });

  it("invalid role produces error", () => {
    const emergent = { id: "e1", name: "x", role: "wizard", scope: ["local"], capabilities: ["talk"] };
    const result = validateEmergent(emergent);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("role")));
  });

  it("missing scope produces error", () => {
    const emergent = { id: "e1", name: "x", role: "builder", capabilities: ["talk"] };
    const result = validateEmergent(emergent);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("scope")));
  });

  it("empty scope array produces error", () => {
    const emergent = { id: "e1", name: "x", role: "builder", scope: [], capabilities: ["talk"] };
    const result = validateEmergent(emergent);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("scope")));
  });

  it("scope as non-array produces error", () => {
    const emergent = { id: "e1", name: "x", role: "builder", scope: "local", capabilities: ["talk"] };
    const result = validateEmergent(emergent);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("scope")));
  });

  it("missing capabilities produces error", () => {
    const emergent = { id: "e1", name: "x", role: "builder", scope: ["local"] };
    const result = validateEmergent(emergent);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("capabilities")));
  });

  it("empty capabilities array produces error", () => {
    const emergent = { id: "e1", name: "x", role: "builder", scope: ["local"], capabilities: [] };
    const result = validateEmergent(emergent);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("capabilities")));
  });

  it("multiple errors accumulate", () => {
    const result = validateEmergent({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. contentHash
// ═══════════════════════════════════════════════════════════════════════════════

describe("contentHash", () => {
  it("produces a string starting with ch_", () => {
    const h = contentHash("hello world");
    assert.ok(typeof h === "string");
    assert.ok(h.startsWith("ch_"));
  });

  it("same input produces same hash", () => {
    assert.equal(contentHash("test"), contentHash("test"));
  });

  it("is case-insensitive", () => {
    assert.equal(contentHash("Hello"), contentHash("hello"));
  });

  it("trims whitespace", () => {
    assert.equal(contentHash("  hello  "), contentHash("hello"));
  });

  it("different inputs produce different hashes", () => {
    assert.notEqual(contentHash("alpha"), contentHash("beta"));
  });

  it("handles empty string", () => {
    const h = contentHash("");
    assert.ok(h.startsWith("ch_"));
  });

  it("handles non-string input via String() coercion", () => {
    const h = contentHash(12345);
    assert.ok(h.startsWith("ch_"));
    assert.equal(h, contentHash("12345"));
  });

  it("handles null/undefined via String() coercion", () => {
    const h1 = contentHash(null);
    assert.ok(h1.startsWith("ch_"));
    const h2 = contentHash(undefined);
    assert.ok(h2.startsWith("ch_"));
  });

  it("hash is 8 hex chars padded", () => {
    const h = contentHash("test");
    const hex = h.slice(3);
    assert.equal(hex.length, 8);
    assert.ok(/^[0-9a-f]{8}$/.test(hex));
  });
});
