// Confirmation gate: write and high-risk steps pause for the person; only the person approves (CKPT-13).
import { canonicalJson, sha256Hex } from "../receipts/attest.js";
import { scrubUserFacingToolNames } from "../chat/tool-turn-reply.js";
import { getRun, getStep, updateRun, updateStep, addUsage, addApproval, getApprovals } from "./run-store.js";
import { effectiveSpec, getToolSpec } from "./tool-spec.js";
import { validateAndRepair } from "./validate-repair.js";
import { failEffect } from "./idempotency.js";

/** @returns {"none"|"once"|"always"} */
export function confirmPolicy(risk) { return risk === "high" ? "always" : risk === "write" ? "once" : "none"; }

export const argsHashOf = (args) => sha256Hex(canonicalJson(args ?? {}));

/**
 * @param {{ run: object, step: object, call: {tool:string,args:object}, spec: object, approvals: object[] }} a
 * @returns {{ needed: boolean, reason?: "write"|"high" }}
 */
export function needsConfirm(a) {
  const policy = confirmPolicy(a.spec?.risk);
  if (policy === "none") return { needed: false };
  const hash = argsHashOf(a.call.args);
  const list = Array.isArray(a.approvals) ? a.approvals : [];
  const stepOk = list.some((x) => x.scope === "step" && x.stepId === a.step.id && x.argsHash === hash);
  if (stepOk) return { needed: false };
  if (policy === "once" && list.some((x) => x.scope === "run_tool" && x.tool === a.call.tool)) return { needed: false };
  return { needed: true, reason: a.spec.risk };
}

const humanize = (key) => {
  const t = String(key).replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Plain-language card. */
export function buildConfirmCard({ step, call, spec }) {
  const clean = (t) => scrubUserFacingToolNames(String(t));
  const args = [];
  for (const [k, v] of Object.entries(call.args || {})) {
    if (/token|secret|password/i.test(k)) continue;
    if (args.length >= 12) break;
    const value = v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);
    args.push({ name: clean(humanize(k)), value: clean(value.slice(0, 200)) });
  }
  return {
    kind: "confirm",
    stepId: step.id,
    label: clean(spec.title),
    goal: clean(step.goal),
    risk: spec.risk,
    changes: [spec.risk === "high" ? "This cannot be undone or spends money." : "This saves or changes something in your account."],
    args,
  };
}

/**
 * Record the person's answer.
 * decision: approve | reject | answer | mark_done | run_again
 */
export function applyDecision(db, { run, step, userId, decision, editedArgs = null, dontAskAgain = false, answer = null, lensActions = null }) {
  const r = getRun(db, run.id);
  const st = getStep(db, step.id);
  if (!r || !st || r.userId !== String(userId) || st.status !== "awaiting_confirm" || r.status !== "awaiting_confirm") {
    return { ok: false, reason: "not_waiting" };
  }
  const now = Date.now();
  if (decision === "approve") {
    let args = st.args || {};
    if (editedArgs && typeof editedArgs === "object") {
      const vr = validateAndRepair({ tool: st.tool, args: editedArgs }, { menuIds: [st.tool], getSpec: (id) => getToolSpec(id, { lensActions }) });
      if (!vr.ok) return { ok: false, reason: "invalid_edit", errors: vr.errors };
      args = vr.call.args;
    }
    const eff = effectiveSpec({ tool: st.tool, args }, { lensActions });
    const hash = argsHashOf(args);
    updateStep(db, st.id, { args });
    addApproval(db, r.id, { stepId: st.id, tool: st.tool, argsHash: hash, scope: "step", userId: String(userId), at: now });
    if (dontAskAgain && eff?.risk === "write") {
      addApproval(db, r.id, { stepId: null, tool: st.tool, argsHash: null, scope: "run_tool", userId: String(userId), at: now });
    }
    updateStep(db, st.id, { status: "ready", errorClass: null, errorText: null });
    updateRun(db, r.id, { status: "running", statusReason: null });
    addUsage(db, r.id, { humanInterventions: 1 });
    return { ok: true };
  }
  if (decision === "reject") {
    updateStep(db, st.id, { status: st.required ? "failed" : "skipped", errorClass: "rejected_by_user", finishedAt: Math.floor(now / 1000) });
    updateRun(db, r.id, st.required
      ? { status: "failed", statusReason: "rejected_by_user", finishedAt: Math.floor(now / 1000) }
      : { status: "running", statusReason: null });
    addUsage(db, r.id, { humanInterventions: 1 });
    return { ok: true };
  }
  if (decision === "answer") {
    const args = { ...(st.args || {}), __userAnswer: String(answer ?? "").slice(0, 1000) };
    updateStep(db, st.id, { args, status: "ready", attempts: 0, errorClass: null, errorText: null });
    updateRun(db, r.id, { status: "running", statusReason: null });
    addUsage(db, r.id, { humanInterventions: 1 });
    return { ok: true };
  }
  if (decision === "mark_done") {
    updateStep(db, st.id, { status: "done", resultSummary: { values: { confirmedByUser: true }, text: "confirmedByUser=true" }, finishedAt: Math.floor(now / 1000), errorClass: null });
    updateRun(db, r.id, { status: "running", statusReason: null });
    addUsage(db, r.id, { humanInterventions: 1 });
    return { ok: true };
  }
  if (decision === "run_again") {
    if (st.idempotencyKey) failEffect(db, st.idempotencyKey);
    updateStep(db, st.id, { status: "ready", idempotencyKey: null, errorClass: null, errorText: null });
    updateRun(db, r.id, { status: "running", statusReason: null });
    addUsage(db, r.id, { humanInterventions: 1 });
    return { ok: true };
  }
  return { ok: false, reason: "unknown_decision" };
}

export { getApprovals };
