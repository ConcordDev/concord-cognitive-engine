// server/lib/self-repair-orchestrator.js
//
// Item 4 — wire the Phase-5 self-repair decision engine (self-repair-loop.js) to
// the REAL escalation surface: the Sovereign governance queue
// (governance/auto-proposal.js#postAutoProposal). A code-changing repair is never
// auto-applied — it always lands as a council proposal for Sovereign approval;
// operational heals that pass verify + canary "apply"; a failed canary rolls back.
//
// generateFix / verifyFix / canaryEval are injected so this is deterministic +
// testable offline. In production: generateFix = repair-cortex runProphet/runSurgeon
// or the Phase-3 code.build loop; canaryEval = Guardian health signals; the `apply`
// effect (zero-downtime reload) is deploy infra — until it exists, an operational
// "apply" is an HONEST recorded no-op, never a claimed reload.

import { runSelfRepair, DECISION, FIX_CLASS } from "./self-repair-loop.js";
import { postAutoProposal } from "./governance/auto-proposal.js";

/** Default escalate → a Sovereign council proposal (the existing reflex queue). */
function defaultEscalate(db) {
  return async ({ fault, fix, reason, evidence }) => {
    const faultMsg = fault?.message || fault?.error || (typeof fault === "string" ? fault : JSON.stringify(fault || {}).slice(0, 200));
    return postAutoProposal({
      db,
      kind: "invariant_violation", // critical: a code/logic repair awaiting approval
      title: `[self-repair] ${reason}`.slice(0, 160),
      body: `Fault: ${faultMsg}\nReason: ${reason}\nFix class: ${fix ? (fix.code || fix.diff ? "code_change" : (fix.kind || "operational")) : "none"}\nFix status: ${fix?.status || "n/a"}\n\nA candidate fix awaits Sovereign approval — code-changing repairs are never auto-applied.`,
      evidence: { fault: faultMsg, fixStatus: fix?.status, ...(evidence || {}) },
      suggestedAction: fix?.code ? "review + apply the candidate patch (verify+canary already passed where applicable)" : "review",
    });
  };
}

/** Default apply — honest no-op until zero-downtime reload infra exists. */
function defaultApply() {
  return async (fix) => ({ ok: true, applied: false, note: "operational heal recorded; runtime reload requires deploy infra (PM2 cluster reload)", fixKind: fix?.kind || null });
}

/**
 * Run one self-repair cycle with the real Sovereign-queue escalation wired in.
 * @returns the runSelfRepair result { decision, fixClass, reason, evidence, trail }.
 */
export async function orchestrateRepair({ db, fault, generateFix, verifyFix, canaryEval, slo, apply, rollback, escalate } = {}) {
  return runSelfRepair({
    fault,
    generateFix,
    verifyFix,
    canaryEval,
    slo,
    apply: apply || defaultApply(),
    rollback: rollback || (async (fix) => ({ ok: true, rolledBack: true, fixKind: fix?.kind || null })),
    escalate: escalate || defaultEscalate(db),
  });
}

/**
 * Convenience generateFix adapter that drives the Phase-3 build loop (code.build)
 * to produce a verified logic-bug fix. `runMacro` is the real dispatcher.
 */
export function buildLoopGenerateFix(runMacro, { userId = "system", projectId = "self-repair" } = {}) {
  return async (fault) => {
    const request = `Fix this fault and return a corrected program:\n${fault?.message || fault?.error || JSON.stringify(fault)}`;
    const res = await runMacro("code", "build", { request, projectId, language: "javascript" }, { actor: { userId }, userId });
    const r = res?.result || res;
    return { status: r?.status || "unverified", code: r?.artifact?.code || null, kind: "code_change", evidence: r?.evidence };
  };
}

export { DECISION, FIX_CLASS };
export default { orchestrateRepair, buildLoopGenerateFix };
