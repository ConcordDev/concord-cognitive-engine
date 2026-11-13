// In-process fan-out of run events, keyed by run id (CKPT-15).
import { scrubUserFacingToolNames } from "../chat/tool-turn-reply.js";
import { getToolSpec } from "./tool-spec.js";

const subs = new Map();

export function subscribeRun(runId, fn) {
  if (!subs.has(runId)) subs.set(runId, new Set());
  subs.get(runId).add(fn);
  return () => {
    const set = subs.get(runId);
    if (!set) return;
    set.delete(fn);
    if (!set.size) subs.delete(runId);
  };
}

const scrubEvent = (e) => {
  const out = { ...e };
  for (const k of ["label", "message", "goal"]) if (typeof out[k] === "string") out[k] = scrubUserFacingToolNames(out[k]);
  return out;
};

export function publishRun(runId, event) {
  try {
    const set = subs.get(runId);
    if (!set) return;
    const e = scrubEvent(event);
    for (const fn of [...set]) { try { fn(e); } catch { /* one listener never breaks the rest */ } }
  } catch { /* publishing never throws */ }
}

export function runEvent(run, steps) {
  const done = steps.filter((s) => s.status === "done").length;
  return { type: "cockpit:run", runId: run.id, status: run.status, statusReason: run.statusReason, done, total: steps.length };
}

export function stepLabel(step) {
  const title = step.tool ? getToolSpec(step.tool)?.title : null;
  return scrubUserFacingToolNames(title || step.goal);
}

export function stepEvent(run, step, total) {
  return { type: "cockpit:step", runId: run.id, seq: step.seq, total, status: step.status, label: stepLabel(step), receiptId: step.receipt ? step.id : null };
}
