/**
 * Concord ATS — Policy Mapping
 * Maps affective state E → AffectPolicy (OS control signals).
 * Pure function: deterministic, no side effects.
 */

import { clamp } from "./schema.js";

/**
 * Compute the AffectPolicy from current affective state.
 *
 * @param {object} E - Current affective state vector
 * @returns {object} AffectPolicy with style, cognition, memory, safety
 */
export function getAffectPolicy(E) {
  const { v, a, s, c, g, t, f } = E;

  return {
    style: computeStyle(v, a, s, c, g, t, f),
    cognition: computeCognition(v, a, s, c, g, t, f),
    memory: computeMemory(v, a, s, c, g, t, f),
    safety: computeSafety(v, a, s, c, g, t, f),
  };
}

function computeStyle(v, a, s, c, g, t, f) {
  // High arousal + low coherence → increase directness, decrease verbosity
  // High trust + high coherence → increase warmth + creativity
  // Low agency → increase guidance emphasis
  return {
    verbosity: clamp(
      0.5 + (c - 0.5) * 0.3 - a * 0.2 - f * 0.15,
      0, 1
    ),
    directness: clamp(
      0.5 + a * 0.25 - c * 0.15 + (1 - s) * 0.1,
      0, 1
    ),
    warmth: clamp(
      0.4 + v * 0.3 + t * 0.2 - f * 0.1,
      0, 1
    ),
    creativity: clamp(
      0.3 + v * 0.2 + c * 0.2 + g * 0.15 - f * 0.2,
      0, 1
    ),
    caution: clamp(
      0.3 + (1 - t) * 0.25 + (1 - s) * 0.2 + a * 0.1 - c * 0.1,
      0, 1
    ),
  };
}

function computeCognition(v, a, s, c, g, t, f) {
  // Higher fatigue → lower depth, higher caution
  // Higher agency → more exploration
  // Higher trust + coherence → deeper reasoning
  return {
    exploration: clamp(
      0.3 + g * 0.3 + v * 0.15 - f * 0.2 - (1 - s) * 0.1,
      0, 1
    ),
    riskBudget: clamp(
      0.4 + t * 0.25 + s * 0.15 - f * 0.2 - (1 - c) * 0.1,
      0, 1
    ),
    depthBudget: clamp(
      0.5 + c * 0.2 + t * 0.15 - f * 0.25 - a * 0.1,
      0, 1
    ),
    latencyBudgetMs: Math.round(clamp(
      3000 + (1 - f) * 7000 + c * 3000 - a * 2000,
      1000, 15000
    )),
    toolUseBias: clamp(
      0.5 + g * 0.2 + t * 0.15 - f * 0.15 - (1 - s) * 0.1,
      0, 1
    ),
  };
}

function computeMemory(v, a, s, c, g, t, f) {
  // High arousal + low fatigue → stronger writes (salient events)
  // High coherence → more concise summaries
  // High trust → higher retention (less forgetting)
  return {
    writeStrength: clamp(
      0.4 + a * 0.25 + (1 - f) * 0.2 + v * 0.1,
      0, 1
    ),
    summarizeBias: clamp(
      0.4 + c * 0.25 + (1 - a) * 0.15 + s * 0.1,
      0, 1
    ),
    retentionBias: clamp(
      0.5 + t * 0.2 + s * 0.15 + (1 - f) * 0.1,
      0, 1
    ),
  };
}

/**
 * Human-readable derivation of every policy signal — the receipt the
 * Policy surface prints under each value (S-AFF-4 / F5: the numbers
 * were bare floats with no stated derivation). These strings are the
 * formulas in the compute* functions below, written with dimension
 * NAMES. tests/affect-policy-derivations.test.js pins that every
 * signal getAffectPolicy returns has an entry here, and that
 * spot-checked entries agree numerically with the code.
 * Every signal is clamped to [0, 1] except latencyBudgetMs.
 */
export const POLICY_DERIVATIONS = {
  style: {
    verbosity: "0.5 + (coherence − 0.5) × 0.3 − arousal × 0.2 − fatigue × 0.15",
    directness: "0.5 + arousal × 0.25 − coherence × 0.15 + (1 − stability) × 0.1",
    warmth: "0.4 + valence × 0.3 + trust × 0.2 − fatigue × 0.1",
    creativity: "0.3 + valence × 0.2 + coherence × 0.2 + agency × 0.15 − fatigue × 0.2",
    caution: "0.3 + (1 − trust) × 0.25 + (1 − stability) × 0.2 + arousal × 0.1 − coherence × 0.1",
  },
  cognition: {
    exploration: "0.3 + agency × 0.3 + valence × 0.15 − fatigue × 0.2 − (1 − stability) × 0.1",
    riskBudget: "0.4 + trust × 0.25 + stability × 0.15 − fatigue × 0.2 − (1 − coherence) × 0.1",
    depthBudget: "0.5 + coherence × 0.2 + trust × 0.15 − fatigue × 0.25 − arousal × 0.1",
    latencyBudgetMs: "round(3000 + (1 − fatigue) × 7000 + coherence × 3000 − arousal × 2000), clamped to 1,000–15,000",
    toolUseBias: "0.5 + agency × 0.2 + trust × 0.15 − fatigue × 0.15 − (1 − stability) × 0.1",
  },
  memory: {
    writeStrength: "0.4 + arousal × 0.25 + (1 − fatigue) × 0.2 + valence × 0.1",
    summarizeBias: "0.4 + coherence × 0.25 + (1 − arousal) × 0.15 + stability × 0.1",
    retentionBias: "0.5 + trust × 0.2 + stability × 0.15 + (1 − fatigue) × 0.1",
  },
  safety: {
    strictness: "0.4 + (1 − trust) × 0.25 + (1 − stability) × 0.15 + fatigue × 0.1 + (1 − coherence) × 0.1",
    refuseThreshold: "0.3 + (1 − trust) × 0.3 + (1 − stability) × 0.2 + fatigue × 0.1",
  },
};

function computeSafety(v, a, s, c, g, t, f) {
  // Lower trust → stricter safety
  // Lower stability → higher refusal threshold
  // High fatigue → more conservative
  return {
    strictness: clamp(
      0.4 + (1 - t) * 0.25 + (1 - s) * 0.15 + f * 0.1 + (1 - c) * 0.1,
      0, 1
    ),
    refuseThreshold: clamp(
      0.3 + (1 - t) * 0.3 + (1 - s) * 0.2 + f * 0.1,
      0, 1
    ),
  };
}
