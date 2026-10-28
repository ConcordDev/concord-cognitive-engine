// server/lib/answer-confidence.js
//
// Labels a chat answer as low confidence when the GPU brain was offline and
// the small local backup model (BRAIN_LOCAL_UNIFIED_MODEL) produced it.
//
// The rule uses only data the answer path already has: where the answer came
// from (a local Ollama call, or the BYO router's concord_default provider)
// and which model actually answered. A pod-served answer names a different,
// larger model, so it is never labelled. Platform, BYO and free-cloud answers
// never use the local Ollama source or concord_default, so they are never
// labelled either. An unknown or missing model is never guessed at.

import { getLocalUnifiedModel } from "./brain-config.js";

export const LOW_CONFIDENCE_REASON = "GPU brain offline — answered by small local model";

const LOCAL_SOURCES = new Set(["ollama", "ollama-stream"]);
const LOCAL_PROVIDERS = new Set(["concord_default", "ollama"]);
const UNKNOWN_MODELS = new Set(["", "ollama", "unknown"]);

// Ollama tags default to ":latest", so "name" and "name:latest" are one model.
function _normalizeModelTag(name) {
  const s = String(name || "").trim().toLowerCase();
  return s.includes(":") ? s : `${s}:latest`;
}

/**
 * @param {{ source?: string|null, provider?: string|null, model?: string|null }} answer
 * @returns {{ answerConfidence: "low", answerConfidenceReason: string } | null}
 * Keys are answerConfidence*, not `confidence`: lib/confidence-attacher.js
 * already owns `confidence` (a {score, level, factors} object) on chat responses.
 */
export function answerConfidence({ source, provider, model } = {}) {
  const local = LOCAL_SOURCES.has(source) || LOCAL_PROVIDERS.has(provider);
  if (!local) return null;
  const answered = String(model ?? "").trim();
  if (UNKNOWN_MODELS.has(answered.toLowerCase())) return null;
  const small = getLocalUnifiedModel();
  if (!small) return null;
  if (_normalizeModelTag(answered) !== _normalizeModelTag(small)) return null;
  return { answerConfidence: "low", answerConfidenceReason: LOW_CONFIDENCE_REASON };
}

// One-line factual guard appended to the system prompt when the small local
// backup model is the one about to answer: small models invent plausible
// numbers, so the prompt tells it to only state quantities it is sure of and
// to give the quantity explicitly. Exported as a constant so the prompt text
// is testable and identical on every path that uses it.
export const SMALL_MODEL_FACT_GUARD =
  "You are the small local backup model answering while the main brain is offline. Only state numbers, dates or quantities you are sure of, and always give the quantity explicitly (write \"3 items\", not \"a few\"). If you are not sure of a number, say you are not sure instead of estimating.";

/**
 * The prompt suffix for a call that `model` will answer: the fact guard when
 * `model` is the small local backup model, otherwise an empty string.
 * @param {string|null|undefined} model
 * @returns {string} "" or "\n\n" + SMALL_MODEL_FACT_GUARD
 */
export function smallModelPromptSuffix(model) {
  const small = getLocalUnifiedModel();
  if (!small) return "";
  const called = String(model ?? "").trim();
  if (!called || UNKNOWN_MODELS.has(called.toLowerCase())) return "";
  if (_normalizeModelTag(called) !== _normalizeModelTag(small)) return "";
  return `\n\n${SMALL_MODEL_FACT_GUARD}`;
}
