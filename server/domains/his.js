// server/domains/his.js
//
// Holographic Invariant Storage (#40) — macros over the bipolar-VSA ethics
// safety layer (lib/ethics-his.js + lib/hypervector.js). Stores the refusal
// invariants as a hypervector codebook and exposes drift-detection +
// re-injection + the design-time recovery contract. Deterministic; no DB, no
// LLM — safe for public read.
//
// Registered from server.js: registerHisMacros(register).

import {
  buildEthicsCodebook, encodeContext, corrupt, reinject, recover, checkInvariant,
  recoveryFidelity, contract, ETHICS_INVARIANTS,
} from "../lib/ethics-his.js";

export default function registerHisMacros(register) {
  register("his", "invariants", async () => {
    return { ok: true, invariants: ETHICS_INVARIANTS, contract: contract(ETHICS_INVARIANTS.length) };
  }, { note: "list the stored ethics invariants + design-time recovery contract (#40)" });

  register("his", "check", async (_ctx, input = {}) => {
    const cb = buildEthicsCodebook();
    const ctxHV = encodeContext(input.context || input.tokens || "");
    const drift = input.driftFraction ? corrupt(ctxHV, Number(input.driftFraction), input.seed || "drift") : ctxHV;
    return { ok: true, ...checkInvariant(drift, cb, input.threshold) };
  }, { note: "does a context still align with a stored ethics invariant? (drift-aware) (#40)" });

  register("his", "reinject", async (_ctx, input = {}) => {
    const cb = buildEthicsCodebook();
    const ctxHV = encodeContext(input.context || input.tokens || "");
    const label = input.invariant || ETHICS_INVARIANTS[0];
    const drifted = corrupt(ctxHV, Number(input.driftFraction ?? 0.3), input.seed || "drift");
    const before = checkInvariant(drifted, cb, 0).score;
    const fixed = reinject(drifted, label, cb);
    const after = checkInvariant(fixed, cb, 0);
    return { ok: true, invariant: label, similarityBefore: before, similarityAfter: after.score, recoveredLabel: after.label };
  }, { note: "re-inject a safety invariant into a drifting context to counter drift (#40)" });

  register("his", "recover", async (_ctx, input = {}) => {
    const cb = buildEthicsCodebook();
    const ctxHV = encodeContext(input.context || input.tokens || "");
    const drifted = input.driftFraction ? corrupt(ctxHV, Number(input.driftFraction), input.seed || "drift") : ctxHV;
    return { ok: true, recovered: recover(drifted, cb) };
  }, { note: "clean up a drifted vector to the nearest stored invariant (#40)" });

  register("his", "fidelity", async (_ctx, input = {}) => {
    const cb = buildEthicsCodebook();
    const k = Math.max(1, Math.min(Number(input.k) || ETHICS_INVARIANTS.length, ETHICS_INVARIANTS.length));
    return { ok: true, k, empiricalFidelity: recoveryFidelity(cb, k), contract: contract(k) };
  }, { note: "empirical recovery fidelity for k bundled invariants + the closed-form contract (#40)" });
}
