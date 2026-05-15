// server/lib/agentic/council.js
// Council pattern: parallel sub-cognition explorations synthesized by a critic.
// Used for decisions above the uncertainty threshold. Sub-cognitions use subconscious/utility;
// the critic synthesis uses the best available brain (never blocks conscious chat).

import { spawnSubCognition } from "./sub-cognition.js";
import { TASK_PROMPTS } from "../prompt-registry.js";

const DEFAULT_UNCERTAINTY_THRESHOLD = 0.6;
const DEFAULT_EXPLORE_COUNT = 3;
const CONFIDENCE_PATTERN = /\b(confidence|certainty|sure|certain)[:\s]+([0-9]+\.?[0-9]*)/i;

/**
 * Parse a confidence score from a brain's text response (0–1 float).
 */
function parseConfidence(text) {
  const match = text?.match(CONFIDENCE_PATTERN);
  if (match) {
    const val = parseFloat(match[2]);
    return val > 1 ? val / 100 : val;
  }
  // Heuristic: look for numeric 0-1 value or percentage
  const numMatch = text?.match(/\b(0\.\d+|1\.0|100%|\d{1,2}%)/)?.[0];
  if (numMatch) {
    return numMatch.includes("%")
      ? parseFloat(numMatch) / 100
      : parseFloat(numMatch);
  }
  return 0.5; // default to uncertain if not parseable
}

/**
 * Run a council decision process.
 *
 * 1. Quickly assess confidence via utility brain.
 * 2. If high confidence: single subconscious response.
 * 3. If low confidence: parallel explorations + critic synthesis.
 *
 * @param {object} opts
 * @param {string} opts.question
 * @param {string} opts.parentInferenceId
 * @param {number} [opts.exploreCount=3]
 * @param {'subconscious'|'utility'} [opts.brainRole='subconscious']
 * @param {number} [opts.uncertaintyThreshold=0.6]
 * @param {object} [opts.db]
 * @returns {Promise<{decision: string, explorations?: string[], confidence: number, councilUsed: boolean}>}
 */
export async function councilDecision({
  question,
  parentInferenceId,
  exploreCount = DEFAULT_EXPLORE_COUNT,
  brainRole = "subconscious",
  uncertaintyThreshold = DEFAULT_UNCERTAINTY_THRESHOLD,
  db,
}) {
  // Step 1: quick confidence assessment via utility brain
  const assessment = await spawnSubCognition({
    task: `Assess your confidence (0.0–1.0) in answering this question accurately:\n\n${question}\n\nReply with only: "confidence: X.XX" and one sentence explaining why.`,
    parentInferenceId,
    brainRole: "utility",
    maxSteps: 1,
    timeoutMs: 15000,
    db,
  });

  const confidence = parseConfidence(assessment.distilledOutput);

  // Step 2: high confidence — single response
  if (confidence > uncertaintyThreshold) {
    const direct = await spawnSubCognition({
      task: question,
      parentInferenceId,
      brainRole,
      maxSteps: 5,
      db,
    });
    return {
      decision: direct.distilledOutput,
      confidence,
      councilUsed: false,
    };
  }

  // Step 3: low confidence — parallel explorations
  const explorations = await Promise.all(
    Array.from({ length: exploreCount }, (_, i) =>
      spawnSubCognition({
        task: question,
        parentInferenceId,
        brainRole,
        maxSteps: 5,
        timeoutMs: 45000,
        db,
      })
    )
  );

  // Step 4: critic synthesis (use subconscious for synthesis, not conscious — that's for chat)
  const explorationsText = explorations
    .map((e, i) => `Exploration ${i + 1}:\n${e.distilledOutput}`)
    .join("\n\n");

  const synthesis = await spawnSubCognition({
    task: TASK_PROMPTS.councilSynthesis({ exploreCount, question, explorationsText }),
    parentInferenceId,
    brainRole: "subconscious", // synthesis uses subconscious, not conscious
    maxSteps: 5,
    timeoutMs: 60000,
    db,
  });

  return {
    decision: synthesis.distilledOutput,
    explorations: explorations.map(e => e.distilledOutput),
    confidence,
    councilUsed: true,
    exploreCount,
  };
}
