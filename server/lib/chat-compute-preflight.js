// server/lib/chat-compute-preflight.js
//
// Auto-route plain chat questions through the compute-registry BEFORE
// the conscious brain sees them. Catches the math/probability/physics
// queries that don't trip the Oracle Engine's keyword gate but still
// have a real numerical answer behind a `sim.monteCarlo` / `math.stats`
// / `physics.kinematics` / etc.
//
// Why this exists: the Oracle path triggers on "derive", "prove",
// "monte carlo", "bayesian", and other research-grade signals. A user
// who asks "what's the std deviation of these numbers?" or "convert
// 100kg to lbs" doesn't hit any of those — they go straight to chat
// and the LLM guesses, sometimes wrong. The fix is a tight, cheap
// pre-flight: keyword-score the message against the 21 compute caps,
// run the top 1-2 matches under a hard timeout, and prepend the
// results to the user's prompt as authoritative ground truth.
//
// Cost discipline:
//   - matchCapabilities is pure string-matching (microseconds)
//   - Only run executeBatch if at least one cap scores ≥ THRESHOLD
//   - Hard 2.5s timeout per cap so a bad handler never blocks chat
//   - Cap to 2 capabilities max per message
//   - Returns null on any failure — chat path proceeds unchanged
//
// Wire-up: server.js chat path, immediately before buildConsciousPrompt.

import { matchCapabilities, executeBatch, COMPUTE_CAPABILITIES } from "./compute-registry.js";

const DEFAULT_THRESHOLD = 0.4;   // higher than Oracle's 0.15 — chat is broader
const MAX_CAPS_PER_MESSAGE = 2;
const PER_CAP_TIMEOUT_MS = 2500;

/**
 * Try to compute ground truth for a chat message.
 *
 * @param {string} message  - The user's chat prompt.
 * @param {object} opts
 * @param {object} [opts.domainHandlers]  - The bag passed to executeBatch.
 * @param {object} [opts.ctx]             - Forwarded to handlers.
 * @param {number} [opts.threshold]       - Min match score (default 0.4).
 * @param {number} [opts.limit]           - Max caps to execute (default 2).
 * @param {number} [opts.timeoutMs]       - Per-cap timeout (default 2500).
 * @returns {Promise<null | {
 *   groundTruthBlock: string,
 *   capabilities: Array<{key:string,score:number,description:string}>,
 *   results: Array<object>,
 * }>}
 */
export async function runChatComputePreflight(message, opts = {}) {
  if (!message || typeof message !== "string") return null;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const limit = opts.limit ?? MAX_CAPS_PER_MESSAGE;
  const timeoutMs = opts.timeoutMs ?? PER_CAP_TIMEOUT_MS;
  const domainHandlers = opts.domainHandlers || {};
  const ctx = opts.ctx || {};

  let matches;
  try {
    matches = matchCapabilities(message, { threshold, limit });
  } catch {
    return null;
  }
  if (!matches || matches.length === 0) return null;

  // Don't fire compute if there's no handler for ANY of the matches —
  // it's just wasted setup and a guaranteed batch failure.
  const reachable = matches.filter(m => {
    const cap = COMPUTE_CAPABILITIES[m.key];
    if (!cap) return false;
    const dh = domainHandlers[cap.domain];
    return !!dh; // shallow check; executeBatch does the real resolution
  });
  if (reachable.length === 0) return null;

  let batch;
  try {
    batch = await executeBatch(
      reachable.map(m => m.key),
      { params: { query: message } },
      { domainHandlers, ctx, timeoutMs }
    );
  } catch {
    return null;
  }

  const successes = (batch?.results || []).filter(r => r.ok);
  if (successes.length === 0) return null;

  // Render a compact ground-truth block. Keep it terse — the brain
  // narrates around it. Don't dump full JSON unless the result is
  // small enough to be readable.
  const lines = ["[GROUND TRUTH from real compute engines — these values are authoritative, never contradict them]"];
  for (const r of successes) {
    const cap = r.capability || COMPUTE_CAPABILITIES[r.key] || {};
    const desc = cap.description || r.key;
    const summary = summariseResult(r.result);
    lines.push(`- ${r.key} (${desc}): ${summary}`);
  }
  return {
    groundTruthBlock: lines.join("\n"),
    capabilities: reachable.map(m => ({
      key: m.key,
      score: m.score,
      description: COMPUTE_CAPABILITIES[m.key]?.description || "",
    })),
    results: successes,
  };
}

function summariseResult(result) {
  if (result === null || result === undefined) return "(no value)";
  if (typeof result !== "object") return String(result).slice(0, 280);

  // Many handlers return { ok, ...payload }. Strip ok flag, then look
  // for a "summary" / "value" / "result" field. Otherwise stringify
  // (and truncate) the rest.
  const { ok: _ok, error: _err, ...payload } = result;
  if (typeof payload.summary === "string") return payload.summary.slice(0, 280);
  if (payload.value !== undefined) return JSON.stringify(payload.value).slice(0, 280);
  if (payload.result !== undefined) return JSON.stringify(payload.result).slice(0, 280);
  try {
    return JSON.stringify(payload).slice(0, 280);
  } catch {
    return "(unserialisable)";
  }
}

export const CHAT_COMPUTE_DEFAULTS = Object.freeze({
  THRESHOLD: DEFAULT_THRESHOLD,
  MAX_CAPS_PER_MESSAGE,
  PER_CAP_TIMEOUT_MS,
});
