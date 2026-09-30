// server/lib/pce/quality-score.js
//
// PCE quality score — weighted composite with hard-gate overrides.

export function computeQualityScore({
  structural = 1,
  tests = 0,
  behavioral = 0,
  regression = 0,
  security = 1,
  provenance = 1,
  knownRisk = 0,
} = {}, weights = {}) {
  const w = {
    S: 0.2, T: 0.25, B: 0.15, R: 0.1, C: 0.15, P: 0.1, K: 0.15,
    ...weights,
  };
  const score = (
    w.S * structural
    + w.T * tests
    + w.B * behavioral
    + w.R * regression
    + w.C * security
    + w.P * provenance
    - w.K * knownRisk
  );
  return Math.max(0, Math.min(1, score));
}

export function qualityFromVerification(verification = {}) {
  const gates = verification.gates || [];
  const byName = Object.fromEntries(gates.map((g) => [g.gate, g]));
  return computeQualityScore({
    structural: byName.syntax?.ok && byName.ast_integrity?.ok ? 1 : 0,
    tests: byName.affected_tests?.ok ? 1 : 0,
    behavioral: verification.testsPassed ? 1 : 0,
    regression: byName.test_diff_risk?.ok ? 1 : 0.5,
    security: byName.secret_scan?.ok ? 1 : 0,
    provenance: 1,
    knownRisk: byName.test_diff_risk?.risk > 0.3 ? byName.test_diff_risk.risk : 0,
  });
}
