// server/lib/conkay/iterate/gate.js
//
// Acceptance gate for an iterate-to-physical report. A design is accepted
// for its milestone's SOFTWARE screening only when every requirement run
// passes AND no input claim it rests on is barred by promotionGate (an
// unsupported-as-stated claim, a hypothesis, a contradicted claim...).
// Passing software checks is not physical validation (spec 8 rule 8): the
// gate's answer always carries the physical tests still owed.

import { promotionGate } from "../knowledge/claims.js";

export function acceptanceGate({ report, inputClaims = [], physicalTests = [] }) {
  const blockers = [];
  const reqRuns = report.checks.filter((c) => c.solver === "requirement.check");
  for (const r of reqRuns) if (r.status !== "PASS") blockers.push({ kind: "requirement", runId: r.runId, status: r.status, detail: r.reason || r.failures?.join("; ") || r.margins?.map((m) => m.check).join("; ") });
  for (const c of report.checks) if (c.status === "FAIL" && c.solver !== "requirement.check") blockers.push({ kind: "check", runId: c.runId, status: "FAIL", detail: (c.failures || []).concat((c.margins || []).filter((m) => m.utilization > 1).map((m) => m.check)).join("; ") });
  for (const claim of inputClaims) {
    const g = promotionGate(claim, "acceptance");
    if (!g.allowed) blockers.push({ kind: "claim", claim: claim.id, detail: g.reasons.join("; ") });
  }
  return {
    accepted: blockers.length === 0,
    scope: "software screening only; passing software checks is not physical validation",
    blockers,
    physicalTestsOutstanding: physicalTests,
  };
}
