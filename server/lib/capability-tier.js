// server/lib/capability-tier.js
//
// R5/E22 — ConKay spatial mode (Godot Hub). This is a canonical SERVER-SIDE
// port of concord-frontend/components/common/CapabilityBadge.tsx's pure
// `capabilityTierFor` classifier — the SAME four-tier collapse of a
// `reason.verify` (or `reason.evaluate_answer`, via
// server/lib/research/answer-eval.js#toCapabilityVerdict) result onto
// "proven" / "flagged" / "reasoned" / "unverified" that the web ConKay
// surface already renders per-message via <CapabilityBadge>.
//
// Why this exists server-side now: nothing server-side needed to CLASSIFY a
// verdict into a tier before this unit — the classification only ever
// happened in the browser, after the HTTP response landed. A native Godot
// client has no browser to run that classification in, so if ConKay's
// spatial presence in the Godot Hub is going to show the same honest
// "Proven/Reasoned/Unverified" fact the widget shows, something server-side
// has to compute it once and broadcast it. See
// server/lib/conkay-verdict-bridge.js for the caller that uses this.
//
// Pure, deterministic, no I/O. Kept byte-for-byte in step with the frontend
// classifier (same two Sets, same fallback rule) — if CapabilityBadge.tsx's
// mapping ever changes, update this one too. A verdict object that isn't
// `{ok:true, verdict:<string>}` always classifies as "unverified" — this
// function never fabricates a stronger tier for an absent/malformed result.

const PROVEN_VERDICTS = new Set(["proven", "grounded"]);
const FLAGGED_VERDICTS = new Set(["refuted", "fabricated_citation"]);

/**
 * @param {{ok?: boolean, verdict?: string|null}|null|undefined} verdict
 * @returns {"proven"|"flagged"|"reasoned"|"unverified"}
 */
export function capabilityTierFor(verdict) {
  if (!verdict || verdict.ok !== true || !verdict.verdict) return "unverified";
  const v = String(verdict.verdict);
  if (PROVEN_VERDICTS.has(v)) return "proven";
  if (FLAGGED_VERDICTS.has(v)) return "flagged";
  return "reasoned"; // citations_resolve | unsupported | unverified(string) | anything unrecognized
}

export default { capabilityTierFor };
