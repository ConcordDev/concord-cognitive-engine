// server/domains/reason.js
//
// Verification macros — the "is this actually true?" layer for ConKay and any
// lens. reason.verify judges a claim against its cited DTUs: a deterministic
// citation-resolution floor (catches fabricated citations with no brains) plus
// the multi-brain council as the semantic judge when the brains are up.

import { verifyClaim } from "../lib/reason-verify.js";

export default function registerReasonMacros(register) {
  register("reason", "verify", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const citationIds = input.citations || input.citationIds || input.dtuIds || [];
    return verifyClaim(db, {
      claim: input.claim,
      citationIds: Array.isArray(citationIds)
        ? citationIds.map((c) => (typeof c === "object" && c ? c.id : c))
        : [],
      requesterId: ctx?.actor?.userId || null,
      useCouncil: input.useCouncil !== false,
    });
  }, {
    note: "verify a claim against its cited DTUs — deterministic citation-resolution floor + multi-brain council judge when brains are up",
    llmHint: true,
  });
}
