// server/lib/viability/corpus-tier.js
//
// The corpus seal & tier rule (LOCKED) — the integrity firewall. The published
// 2k splits into:
//   - canon      (textbook-true / verifiable) — safe to teach, safe as a
//                 premise for NPC reasoning (#16) + discovery.
//   - conjecture (unverified)                 — discoverable but SPECULATION:
//                 never taught as truth, never fed to NPC reasoning as a
//                 verified premise.
// The split is free + grounded in a field every DTU already carries: a
// `machine.verifier` is a checkable spec. Verified-corpus inventory confirms
// the boundary — 1,402/2,002 carry a verifier (every `rule`, the verified
// `formal_model`s, `formal_identity`, `predictive_test`); the 520 `first_order`
// claims (+ the unverified formal_models) carry none → conjecture by
// construction. Pure; no DB; no flag (a strictly-correct classification).

/** True iff the DTU carries a checkable verifier spec. */
export function hasVerifier(dtu) {
  const v = dtu?.machine?.verifier;
  if (!v) return false;
  return v.kind === "verifier" || Array.isArray(v.steps) || Array.isArray(v.outputs);
}

/**
 * Tier a single DTU. Verified → canon; otherwise conjecture (speculation).
 * @returns {'canon'|'conjecture'}
 */
export function tierDtu(dtu) {
  return hasVerifier(dtu) ? "canon" : "conjecture";
}

export function isCanon(dtu) { return tierDtu(dtu) === "canon"; }
export function isConjecture(dtu) { return tierDtu(dtu) === "conjecture"; }

function asArray(dtus) {
  if (!dtus) return [];
  if (dtus instanceof Map) return [...dtus.values()];
  if (Array.isArray(dtus)) return dtus;
  if (typeof dtus.values === "function") { try { return [...dtus.values()]; } catch { return []; } }
  return [];
}

/**
 * Tier the whole corpus. Returns counts + a per-kind breakdown (so a future
 * ingestion path can stamp the tier and engines can treat conjecture as
 * speculation, never canon).
 * @returns {{ total:number, canon:number, conjecture:number, byKind:Object }}
 */
export function tierCorpus(dtus) {
  const out = { total: 0, canon: 0, conjecture: 0, byKind: {} };
  for (const d of asArray(dtus)) {
    out.total++;
    const tier = tierDtu(d);
    out[tier]++;
    const kind = d?.machine?.kind || d?.machineKind || "unknown";
    (out.byKind[kind] ||= { canon: 0, conjecture: 0 })[tier]++;
  }
  return out;
}
