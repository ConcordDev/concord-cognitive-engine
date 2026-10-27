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
