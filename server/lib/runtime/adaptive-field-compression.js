// server/lib/runtime/adaptive-field-compression.js
//
// Adaptive Field Compression (inventory name) — thin facade over the DHTP
// field-level policy learner. Per-field compression levels (verbatim/compact/
// hash/…) are recorded into dhtp_field_outcomes and promoted into
// dhtp_learned_policies when empirically safe.
//
// This is NOT a second compression stack. It names and exports the existing
// observe→learn→apply loop so the ecosystem inventory has a real module.

export {
  recordFieldOutcomes,
  learnDhtpPolicies,
  getLearnedPolicies,
  runDhtpPolicyLearningCycle,
} from "./dhtp-policy-learner.js";

export {
  applyCompressionGovernor,
  promotePolicyFromCounterfactual,
  recordGovernorOutcome,
} from "./compression-governor.js";

/**
 * Status probe for honesty audits / kitchen certificates.
 */
export function adaptiveFieldCompressionStatus(db) {
  const count = (table) => {
    try {
      return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;
    } catch {
      return 0;
    }
  };
  const outcomes = count("dhtp_field_outcomes");
  const policies = count("dhtp_learned_policies");
  return {
    name: "Adaptive Field Compression",
    module: "server/lib/runtime/adaptive-field-compression.js",
    implementation: "dhtp-policy-learner + compression-governor",
    fieldOutcomes: outcomes,
    learnedPolicies: policies,
    status: outcomes > 0 || policies > 0 ? "LIVE" : "WIRED_IDLE",
    note: "LIVE once compile/delta paths record field outcomes; WIRED_IDLE if tables empty",
  };
}
