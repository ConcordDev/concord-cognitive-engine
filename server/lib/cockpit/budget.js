// Run budgets (CKPT-14). A run that reaches one pauses; it never fails for it.

const HARD = Object.freeze({ maxSteps: 200, maxToolCalls: 400 });

/** @returns {{ ok: true } | { ok: false, reason: "steps"|"tool_calls"|"model_calls"|"tokens"|"wall", resumable: boolean }} */
export function checkBudget(run, steps, nowMs = Date.now()) {
  const b = run.budget || {};
  const u = run.usage || {};
  const done = (steps || []).filter((s) => s.status === "done").length;
  if (b.maxSteps !== undefined && done >= b.maxSteps) return { ok: false, reason: "steps", resumable: true };
  if (b.maxToolCalls !== undefined && (u.toolCalls || 0) >= b.maxToolCalls) return { ok: false, reason: "tool_calls", resumable: true };
  if (b.maxModelCalls !== undefined && (u.modelCalls || 0) >= b.maxModelCalls) return { ok: false, reason: "model_calls", resumable: true };
  if (b.maxTokensIn !== undefined && (u.tokensIn || 0) >= b.maxTokensIn) return { ok: false, reason: "tokens", resumable: true };
  if (b.wallMs !== undefined && run.createdAt && nowMs - run.createdAt * 1000 >= b.wallMs) return { ok: false, reason: "wall", resumable: true };
  return { ok: true };
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : null; };

/** Budget overrides from the environment; only keys that are set are returned. */
export function budgetFromEnv(env = process.env) {
  const out = {};
  const steps = num(env.CONCORD_COCKPIT_MAX_STEPS);
  if (steps) out.maxSteps = Math.min(HARD.maxSteps, steps);
  const tools = num(env.CONCORD_COCKPIT_MAX_TOOL_CALLS);
  if (tools) out.maxToolCalls = Math.min(HARD.maxToolCalls, tools);
  const models = num(env.CONCORD_COCKPIT_MAX_MODEL_CALLS);
  if (models) out.maxModelCalls = models;
  const stepWall = num(env.CONCORD_COCKPIT_STEP_WALL_MS);
  if (stepWall) out.stepWallMs = stepWall;
  const runWall = num(env.CONCORD_COCKPIT_RUN_WALL_MS);
  if (runWall) out.wallMs = runWall;
  return out;
}

/** CONCORD_COCKPIT_MAX_ACTIVE, default 2, clamp 1..10. */
export function maxActiveRuns(env = process.env) {
  const n = num(env.CONCORD_COCKPIT_MAX_ACTIVE);
  return n ? Math.max(1, Math.min(10, n)) : 2;
}

/** Seconds to wait after a rate-limit failure result. */
export function retryAfterSec(result) {
  const n = Number(result?.retryAfter ?? result?.retry_after);
  return Number.isFinite(n) && n > 0 ? Math.max(30, Math.min(3600, Math.floor(n))) : 600;
}

/** Raise exhausted budgets by their default once, never above the hard caps. */
export function raiseBudget(run, stepsDone, defaults) {
  const b = { ...run.budget };
  const u = run.usage || {};
  if (stepsDone >= b.maxSteps) b.maxSteps = Math.min(HARD.maxSteps, b.maxSteps + defaults.maxSteps);
  if ((u.toolCalls || 0) >= b.maxToolCalls) b.maxToolCalls = Math.min(HARD.maxToolCalls, b.maxToolCalls + defaults.maxToolCalls);
  if ((u.modelCalls || 0) >= b.maxModelCalls) b.maxModelCalls = b.maxModelCalls + defaults.maxModelCalls;
  if ((u.tokensIn || 0) >= b.maxTokensIn) b.maxTokensIn = b.maxTokensIn + defaults.maxTokensIn;
  if (run.createdAt && Date.now() - run.createdAt * 1000 >= b.wallMs) b.wallMs = Math.floor((Date.now() - run.createdAt * 1000) + defaults.wallMs);
  return b;
}
