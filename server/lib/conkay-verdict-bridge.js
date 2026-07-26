// server/lib/conkay-verdict-bridge.js
//
// R5/E22 — ConKay spatial mode (Godot Hub). Pure derivation only: given a
// completed `/api/lens/run` call's (domain, action, result), decide whether
// it's one of ConKay's two verdict-producing macros and, if so, compute the
// {tier, verdict, confidence} triple server.js should broadcast as
// `conkay:verdict`.
//
// Why this needs to exist at all: ConKayOverlay.tsx already computes a
// CapabilityVerdict client-side (`toCapabilityVerdictClient`) from the HTTP
// response of `reason.verify`/`reason.evaluate_answer` and renders it via
// <CapabilityBadge> — that's real, but it lives entirely inside the browser
// tab that made the call. A separate native Godot client watching the same
// user's `user:<id>` room has no way to observe "what did ConKay's last
// answer's capability tier come out as" unless the SAME fact is emitted as a
// real event. This module is that fact's derivation; server.js's
// `/api/lens/run` handler calls it and, on a non-null result, emits it
// through the exact same userId-scoped `emitMacroLife` helper that already
// emits `macro:started`/`macro:completed` — so it reaches a connected Godot
// client for free via the existing `realtimeEmit(event, payload, {userId})`
// -> `_godotGatewayEmitter.emitToRoom('user:'+userId, ...)` mirror. No new
// transport, no new room grammar — see docs/GODOT_PROTOCOL.md's "PARTIAL"/
// "IMPLEMENTED" framing for why reusing an existing mirrored path beats
// inventing a new one.
//
// Honest by construction: a (domain, action) pair this module doesn't
// recognise, or a result that isn't genuinely `ok:true`, returns null.
// server.js emits nothing in that case — never a guessed/fabricated tier for
// a call that didn't actually produce a verdict.

import { capabilityTierFor } from "./capability-tier.js";
import { toCapabilityVerdict } from "./research/answer-eval.js";

// Only these two macro pairs ever produce a real capability verdict today.
// reason.verify's OWN result shape already IS CapabilityVerdict-shaped
// (server/lib/reason-verify.js#verifyClaim returns {ok, verdict, confidence,
// ...} in the exact vocabulary CapabilityBadge/capabilityTierFor recognise —
// no adapter needed). reason.evaluate_answer uses a DIFFERENT verdict
// vocabulary (grounded/partially_grounded/contradicted/unverified/
// fabricated_citation) and needs the existing toCapabilityVerdict adapter
// (server/lib/research/answer-eval.js) — the SAME adapter
// ConKayOverlay.tsx's toCapabilityVerdictClient mirrors client-side, ported
// here rather than re-derived, per that file's own header comment.
const VERDICT_MACRO_ACTIONS = new Set(["verify", "evaluate_answer"]);

/**
 * @param {string} domain
 * @param {string} action
 * @param {object} result - the raw, unwrapped macro result (as computed by
 *   the /api/lens/run handler BEFORE it is nested under `{ result }` in the
 *   HTTP response body)
 * @returns {{tier: string, verdict: string|null, confidence: number|null}|null}
 */
export function deriveConkayVerdictEmit(domain, action, result) {
  if (domain !== "reason" || !VERDICT_MACRO_ACTIONS.has(action)) return null;

  const cv = action === "evaluate_answer" ? toCapabilityVerdict(result) : result;
  if (!cv || cv.ok !== true) return null; // honest: nothing real to report

  return {
    tier: capabilityTierFor(cv),
    verdict: cv.verdict ?? null,
    confidence: typeof cv.confidence === "number" ? cv.confidence : null,
  };
}

export default { deriveConkayVerdictEmit };
