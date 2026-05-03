// server/lib/inference/tracer.js
// OTEL-style inference tracing. Spans are stored in memory (circular buffer).
// Privacy: user intent and personal substrate content are never captured —
// only structural metadata (timing, token counts, brain name, step types).

// Bumped 2000 → 50000 for 32GB-heap deployments. Larger trace ring
// means we can debug cascading inference issues across hours of
// gameplay without losing the early spans.
const MAX_SPANS = Number(process.env.CONCORD_TRACER_MAX_SPANS) || 50_000;
const _spans = [];
let _listeners = [];

/**
 * Sanitize event data: strip any content that could contain user text.
 * @param {object} data
 * @returns {object}
 */
function sanitize(data) {
  if (!data || typeof data !== "object") return {};
  const safe = {};
  const allowedKeys = [
    "brainUsed", "modelUsed", "role", "stepCount", "stepType",
    "tokensIn", "tokensOut", "latencyMs", "fallbacksUsed",
    "toolName", "terminated", "error", "callerId", "lensId", "scope",
  ];
  for (const key of allowedKeys) {
    if (key in data) safe[key] = data[key];
  }
  return safe;
}

/**
 * Emit a trace span.
 * @param {'start'|'step'|'finish'|'failure'} type
 * @param {string} inferenceId
 * @param {object} data
 */
export function emit(type, inferenceId, data = {}) {
  const span = {
    inferenceId,
    timestamp: Date.now(),
    type,
    data: sanitize(data),
  };

  if (_spans.length >= MAX_SPANS) _spans.shift();
  _spans.push(span);

  // Notify listeners (e.g. cascade-recovery on failure)
  for (const listener of _listeners) {
    try { listener(span); } catch { /* non-fatal */ }
  }
}

/**
 * Add a span listener. Returns an unsubscribe function.
 * @param {Function} fn
 * @returns {Function}
 */
export function addListener(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

/**
 * Get recent spans, optionally filtered by inferenceId.
 * @param {string} [inferenceId]
 * @returns {object[]}
 */
export function getSpans(inferenceId) {
  if (!inferenceId) return [..._spans];
  return _spans.filter(s => s.inferenceId === inferenceId);
}

/**
 * Clear all spans (useful in tests).
 */
export function clearSpans() {
  _spans.length = 0;
}
