// server/lib/self-repair-loop.js
//
// ConKay Phase 5 — repair-cortex reinforcement: the closed-loop self-repair
// DECISION ENGINE. The cortex already heals operational faults at runtime
// (Guardian: memory/DB/containers), but cannot fix a logic bug in running code.
// This wires the production-safe path (research-backed: progressive delivery +
// SLO canary + automated rollback; agentic-remediation human-approval-for-
// high-stakes): a fault → ConKay's Phase-3 build loop generates a VERIFIED fix →
// SLO canary evaluation → a policy decides apply / rollback / escalate.
//
// The honesty invariant carries through: NEVER "apply" without a passed verify;
// code-changing repairs ALWAYS require Sovereign approval (escalate) even when the
// canary is green; a failed canary auto-rolls-back. Every decision carries its
// evidence (the audit trail). The zero-downtime reload is the injected `apply`
// (PM2-style in prod); everything here is pure/injected so it's deterministic.

export const FIX_CLASS = Object.freeze({ OPERATIONAL: "operational", CODE_CHANGE: "code_change" });
export const DECISION = Object.freeze({ APPLY: "apply", ROLLBACK: "rollback", ESCALATE: "escalate" });

// Operational heals (state/memory/restart) are low-stakes and can auto-apply;
// code/source/logic changes are high-stakes → Sovereign approval.
export function classifyFix(fix) {
  const explicit = String(fix?.kind || fix?.class || "").toLowerCase();
  if (["code_change", "source", "logic", "patch"].includes(explicit)) return FIX_CLASS.CODE_CHANGE;
  if (["operational", "state", "restart", "gc", "memory"].includes(explicit)) return FIX_CLASS.OPERATIONAL;
  // Infer: a fix carrying code/diff is a code change; otherwise operational.
  return (fix && (fix.code || fix.diff || fix.artifact?.code)) ? FIX_CLASS.CODE_CHANGE : FIX_CLASS.OPERATIONAL;
}

// SLO canary: success rate AND latency (error rate alone misses perf degradation).
export function evaluateCanary(metrics = {}, slo = {}) {
  const successRate = Number.isFinite(metrics.successRate) ? metrics.successRate : 1;
  const errorRate = Number.isFinite(metrics.errorRate) ? metrics.errorRate : 0;
  const p95LatencyMs = Number.isFinite(metrics.p95LatencyMs) ? metrics.p95LatencyMs : 0;
  const { minSuccessRate = 0.99, maxErrorRate = 0.01, maxP95LatencyMs = Infinity } = slo;
  const violations = [];
  if (successRate < minSuccessRate) violations.push(`success_rate ${successRate} < ${minSuccessRate}`);
  if (errorRate > maxErrorRate) violations.push(`error_rate ${errorRate} > ${maxErrorRate}`);
  if (p95LatencyMs > maxP95LatencyMs) violations.push(`p95_latency ${p95LatencyMs}ms > ${maxP95LatencyMs}ms`);
  return { healthy: violations.length === 0, violations, metrics: { successRate, errorRate, p95LatencyMs } };
}

/**
 * The decision policy (pure). Order matters:
 *   1. unverified              → escalate (honesty: never apply unverified)
 *   2. canary unhealthy        → rollback (auto-rollback on SLO violation)
 *   3. code-changing (high-stakes) → escalate (Sovereign approval) even if healthy
 *   4. operational + verified + healthy → apply (autonomous heal)
 */
export function decideRepair({ verify, canary, fixClass } = {}) {
  if (!verify || verify.passed !== true) {
    return { decision: DECISION.ESCALATE, reason: "fix did not pass verification", evidence: { verify } };
  }
  if (!canary || canary.healthy !== true) {
    return { decision: DECISION.ROLLBACK, reason: `canary failed: ${(canary?.violations || []).join("; ") || "unhealthy"}`, evidence: { canary } };
  }
  if (fixClass === FIX_CLASS.CODE_CHANGE) {
    return { decision: DECISION.ESCALATE, reason: "code-changing repair requires Sovereign approval", evidence: { verify, canary } };
  }
  return { decision: DECISION.APPLY, reason: "verified + canary-healthy operational heal", evidence: { verify, canary } };
}

/**
 * Orchestrate one self-repair cycle. All steps injected (Phase-3 build loop as
 * `generateFix`; `canaryEval` returns metrics; `apply`/`rollback`/`escalate` are
 * the effects — in prod: zero-downtime reload / revert / Sovereign queue post).
 * Returns { decision, fixClass, reason, evidence, trail }.
 */
export async function runSelfRepair({ fault, generateFix, verifyFix, canaryEval, slo = {}, apply, rollback, escalate } = {}) {
  if (typeof generateFix !== "function") throw new Error("runSelfRepair: generateFix required");
  const trail = [];
  const record = (step, data) => trail.push({ step, ...data });

  // 1) generate a fix via the build loop (which already ran+lint+verify).
  const fix = await generateFix(fault);
  record("generate", { produced: !!fix, status: fix?.status });
  if (!fix || (fix.status && fix.status !== "done")) {
    const out = { decision: DECISION.ESCALATE, reason: "no verified fix produced", fixClass: null, evidence: { fix } };
    record("decide", out);
    if (escalate) record("escalate", { result: await escalate({ fault, fix, reason: out.reason, evidence: out.evidence }) });
    return { ...out, trail };
  }

  // 2) (re)affirm verification + classify.
  const verify = typeof verifyFix === "function" ? await verifyFix(fix) : { passed: fix.status === "done" || fix?.evidence?.verified === true };
  const fixClass = classifyFix(fix);

  // 3) SLO canary evaluation.
  const metrics = typeof canaryEval === "function" ? await canaryEval(fix) : {};
  const canary = evaluateCanary(metrics, slo);
  record("verify", { passed: verify.passed });
  record("canary", { healthy: canary.healthy, violations: canary.violations, fixClass });

  // 4) decide + act.
  const d = decideRepair({ verify, canary, fixClass });
  record("decide", { decision: d.decision, reason: d.reason });
  if (d.decision === DECISION.APPLY && apply) record("apply", { result: await apply(fix) });
  else if (d.decision === DECISION.ROLLBACK && rollback) record("rollback", { result: await rollback(fix) });
  else if (d.decision === DECISION.ESCALATE && escalate) record("escalate", { result: await escalate({ fault, fix, reason: d.reason, evidence: d.evidence }) });

  return { decision: d.decision, fixClass, reason: d.reason, evidence: d.evidence, trail };
}

export default { FIX_CLASS, DECISION, classifyFix, evaluateCanary, decideRepair, runSelfRepair };
