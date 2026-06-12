// server/domains/reason.js
//
// Verification macros — the "is this actually true?" layer for ConKay and any
// lens. reason.verify judges a claim against its cited DTUs: a deterministic
// citation-resolution floor (catches fabricated citations with no brains) plus
// the multi-brain council as the semantic judge when the brains are up.

import { verifyClaim } from "../lib/reason-verify.js";
import { proveClaim, classifyAmenable } from "../lib/proof-gate.js";

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
      useProof: input.useProof !== false,
    });
  }, {
    note: "verify a claim against its cited DTUs — deterministic citation floor + multi-brain council judge + (for math/logic claims) a sound Z3 proof gate",
    llmHint: true,
  });

  // Direct formal-proof check — answers "is this claim mathematically VALID?"
  // (orthogonal to citation grounding). The subconscious brain formalises the
  // claim into refutation-style SMT-LIB; Z3 rules proven/refuted/unknown. No-op
  // (verdict:"unavailable") when Z3 isn't installed — sound or silent, never faked.
  register("reason", "prove", async (ctx, input = {}) => {
    const db = ctx?.db;
    const claim = String(input.claim || "").trim();
    if (!claim) return { ok: false, reason: "no_claim" };
    if (!classifyAmenable(claim).amenable) {
      return { ok: true, verdict: "not_amenable", amenable: false, claim };
    }
    let brainFn = null;
    try {
      const { brainChat } = await import("../lib/byo-router.js");
      brainFn = async (messages) => {
        const r = await brainChat({ db, userId: ctx?.actor?.userId || null, slot: "subconscious", messages });
        return { text: r?.text || "" };
      };
    } catch { brainFn = null; }
    const result = await proveClaim({ claim, brainFn });
    return { ok: true, claim, ...result };
  }, {
    note: "formally check whether a math/logic claim is valid via the subconscious brain → SMT-LIB → Z3 (sound when Z3 is installed; degrades to verdict:'unavailable')",
    llmHint: true,
  });
}
