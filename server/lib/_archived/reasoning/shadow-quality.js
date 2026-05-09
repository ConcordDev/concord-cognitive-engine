/**
 * server/lib/reasoning/shadow-quality.js
 *
 * Quality gates for shadow DTUs.
 * Ensures shadows preserve enough of the original reasoning to be useful for continuation.
 */

import logger from '../../logger.js';

const INSIGHT_PRESERVATION_THRESHOLD = 0.80;
const MAX_REGENERATION_ATTEMPTS = 3;

/**
 * Extract key phrases from a block of text (simple keyword extraction).
 * @param {string} text
 * @returns {string[]}
 */
function extractKeyPhrases(text) {
  if (!text) return [];
  // Extract noun phrases and key terms (simple heuristic)
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4);

  // Deduplicate and return top terms
  return [...new Set(words)].slice(0, 30);
}

/**
 * Calculate overlap ratio between two phrase sets.
 * @param {string[]} original
 * @param {string[]} shadow
 * @returns {number} 0.0–1.0
 */
function phraseOverlapRatio(original, shadow) {
  if (original.length === 0) return 1.0;
  const shadowSet = new Set(shadow);
  const preserved = original.filter(p => shadowSet.has(p));
  return preserved.length / original.length;
}

/**
 * Check if a shadow DTU preserves sufficient information from the original reasoning.
 *
 * @param {object} shadowDTU
 * @param {string} originalReasoningText
 * @returns {{ passed: boolean, score: number, failures: string[] }}
 */
export function validateShadowQuality(shadowDTU, originalReasoningText) {
  const failures = [];

  const shadowText = [
    shadowDTU.human?.summary || '',
    ...(shadowDTU.core?.invariants || []),
    ...(shadowDTU.human?.bullets || []),
  ].join(' ');

  // Check 1: Key phrase preservation
  const originalPhrases = extractKeyPhrases(originalReasoningText);
  const shadowPhrases = extractKeyPhrases(shadowText);
  const preservationRatio = phraseOverlapRatio(originalPhrases, shadowPhrases);

  if (preservationRatio < INSIGHT_PRESERVATION_THRESHOLD) {
    failures.push(`low_preservation: ${(preservationRatio * 100).toFixed(0)}% < ${(INSIGHT_PRESERVATION_THRESHOLD * 100)}%`);
  }

  // Check 2: Shadow has non-empty content
  if (!shadowText.trim() || shadowText.length < 50) {
    failures.push('empty_shadow_content');
  }

  // Check 3: Has at least one insight
  const insights = shadowDTU.core?.invariants || shadowDTU.human?.bullets || [];
  if (insights.length === 0) {
    failures.push('no_insights_captured');
  }

  const passed = failures.length === 0;
  const score = preservationRatio;

  if (!passed) {
    logger.debug('reasoning:shadow-quality', 'Shadow quality check failed', {
      shadowId: shadowDTU.id,
      failures,
      score,
    });
  }

  return { passed, score, failures };
}

/**
 * Build a stricter regeneration prompt when a shadow fails quality checks.
 * @param {string[]} failures
 * @returns {string}
 */
export function buildStricterSummaryPrompt(failures) {
  const instructions = [];

  if (failures.some(f => f.includes('low_preservation'))) {
    instructions.push('Include MORE specific terms, names, and values from the reasoning — preserve technical vocabulary exactly');
  }
  if (failures.includes('no_insights_captured')) {
    instructions.push('You MUST list at least 3 specific key insights under KEY INSIGHTS:');
  }
  if (failures.includes('empty_shadow_content')) {
    instructions.push('The summary must be at least 100 words — be thorough, not minimal');
  }

  return instructions.length
    ? `IMPORTANT quality requirements for this shadow:\n${instructions.map(i => `• ${i}`).join('\n')}\n\n`
    : '';
}

/**
 * Attempt shadow regeneration if quality check fails.
 * Returns the best shadow (original or regenerated).
 *
 * @param {object} opts
 * @param {object} shadowDTU - Initial shadow (may have failed quality)
 * @param {string} originalReasoningText
 * @param {Function} regenerateFn - async () => object — recreates the shadow DTU
 * @returns {Promise<{ dtu: object, qualityPassed: boolean, attempts: number }>}
 */
export async function ensureShadowQuality(shadowDTU, originalReasoningText, regenerateFn) {
  let current = shadowDTU;
  let attempts = 0;

  for (let i = 0; i < MAX_REGENERATION_ATTEMPTS; i++) {
    attempts++;
    const check = validateShadowQuality(current, originalReasoningText);
    if (check.passed) {
      return { dtu: current, qualityPassed: true, attempts };
    }

    logger.debug('reasoning:shadow-quality', `Regenerating shadow (attempt ${attempts})`, {
      shadowId: current.id,
      failures: check.failures,
    });

    try {
      current = await regenerateFn(buildStricterSummaryPrompt(check.failures));
    } catch (err) {
      logger.warn('reasoning:shadow-quality', 'Regeneration failed', { error: err?.message });
      break;
    }
  }

  // Return best available even if quality not perfect
  return { dtu: current, qualityPassed: false, attempts };
}
