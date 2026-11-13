// Class-based retry and fallback (CKPT-05). The table is ARCHITECTURE.md section 8.
import { classifyFailure } from "./failure-taxonomy.js";
import { validateAndRepair } from "./validate-repair.js";
import { cockpitAgentToolIds, getToolSpec } from "./tool-spec.js";

export const MAX_STEP_ATTEMPTS = 4;

// Cell shorthand: "fb|ask" = fallback_tool or ask_user, "fb|end" = fallback_tool or end, "end" = end.
const TABLE = {
  bad_args:          ["repair", "reask", "fb|end", "end"],
  unknown_tool:      ["repair", "reask", "fb|end", "end"],
  unsupported_input: ["fb|ask", "ask_user", "end", "end"],
  not_found:         ["reask", "fb|ask", "end", "end"],
  external:          ["retry:1000", "retry:2000", "fb|end", "end"],
  disabled_tool:     ["fb|ask", "end", "end", "end"],
  tool_error:        ["retry:1000", "fb|ask", "end", "end"],
  timeout:           ["retry:0", "slot_change", "fb|end", "end"],
  model_empty:       ["retry:0", "slot_change", "reask", "end"],
  model_malformed:   ["retry:0", "slot_change", "reask", "end"],
  verify_failed:     ["reask", "fb|ask", "end", "end"],
  fake_success:      ["reask", "fb|ask", "end", "end"],
  rate_limited:      ["pause", "pause", "pause", "pause"],
  scope_denied:      ["ask_user", "ask_user", "ask_user", "ask_user"],
  looped:            ["reask", "ask_user", "end", "end"],
  hard_stop:         ["stop_run", "stop_run", "stop_run", "stop_run"],
  in_flight:         ["ask_user", "ask_user", "ask_user", "ask_user"],
  needs_confirm:     ["ask_user", "ask_user", "ask_user", "ask_user"],
};
const FIXED = new Set(["hard_stop", "rate_limited", "scope_denied", "in_flight", "needs_confirm"]);

/**
 * @param {{ errorClass: string, attempt: number, required: boolean, spec: object|null, triedTools: string[] }} s
 * @returns {{ kind: string, delayMs?: number, tool?: string }}
 */
export function nextAction(s) {
  const end = () => (s.required ? { kind: "ask_user" } : { kind: "skip" });
  const attempt = Math.max(1, Number(s.attempt) || 1);
  const row = TABLE[s.errorClass] || TABLE.tool_error;
  if (attempt > MAX_STEP_ATTEMPTS && !FIXED.has(s.errorClass)) return end();
  const cell = row[Math.min(attempt, MAX_STEP_ATTEMPTS) - 1];
  const tried = new Set(s.triedTools || []);
  const fb = (s.spec?.fallbacks || []).find((f) => !tried.has(f)) || null;
  if (cell === "end") return end();
  if (cell === "fb|end") return fb ? { kind: "fallback_tool", tool: fb } : end();
  if (cell === "fb|ask") return fb ? { kind: "fallback_tool", tool: fb } : { kind: "ask_user" };
  if (cell.startsWith("retry:")) return { kind: "retry", delayMs: Number(cell.slice(6)) };
  return { kind: cell };
}

const defaultSleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Run one call with in-place retries for classes that need no model.
 * @param {(call: object) => Promise<object>} exec
 * @param {object} call  { tool, params }
 * @param {{ getSpec?: (id:string)=>object|null, sleep?: (ms:number)=>Promise<void>, maxAttempts?: number, required?: boolean }} o
 */
export async function runWithRetry(exec, call, o = {}) {
  const getSpec = o.getSpec || ((id) => getToolSpec(id));
  const sleep = o.sleep || defaultSleep;
  const max = o.maxAttempts ?? MAX_STEP_ATTEMPTS;
  const required = o.required !== false;
  const actions = [];
  const tried = [];
  let cur = call;
  let result = null;
  for (let attempt = 1; attempt <= max; attempt++) {
    result = await exec(cur);
    if (result?.ok) return { result, attempts: attempt, actions };
    const cls = classifyFailure(result);
    const spec = getSpec(cur.tool);
    tried.push(cur.tool);
    const act = nextAction({ errorClass: cls.class, attempt, required, spec, triedTools: tried });
    let next = null;
    if (act.kind === "retry" && spec?.idempotent === true) {
      next = cur;
      await sleep(act.delayMs || 0);
    } else if (act.kind === "fallback_tool" && act.tool) {
      const fbSpec = getSpec(act.tool);
      if (fbSpec?.idempotent === true) {
        const vr = validateAndRepair({ tool: act.tool, args: { ...(cur.params || {}) } }, { menuIds: cockpitAgentToolIds(), getSpec });
        if (vr.ok) next = { ...cur, tool: vr.call.tool, params: vr.call.args };
      }
      if (!next) {
        const end = required ? { kind: "ask_user" } : { kind: "skip" };
        return { result: { ...result, errorClass: cls.class, nextAction: end }, attempts: attempt, actions };
      }
    }
    if (!next || attempt === max) {
      const final = next ? act : (act.kind === "retry" ? (required ? { kind: "ask_user" } : { kind: "skip" }) : act);
      return { result: { ...result, errorClass: cls.class, nextAction: final }, attempts: attempt, actions };
    }
    actions.push(act);
    cur = next;
  }
  return { result: { ...result, errorClass: classifyFailure(result).class }, attempts: max, actions };
}

/** One bounded agent-loop pass that retries a failed plain-chat tool round. */
export async function chatAgentRecoveryTurn({ runMacro, ctx, prompt, failed, lensActions }) {
  const hints = failed.map((r) => `- ${r.tool}: ${String(r.error || "").slice(0, 200)}${r.retryHint ? ` | ${String(r.retryHint).slice(0, 300)}` : ""}`).join("\n");
  return runMacro("chat_agent", "do", {
    message: `${String(prompt).slice(0, 2000)}\n\n(These tool calls just failed. Do the task another way; do not repeat a failed call.)\n${hints}`,
    maxTurns: 4, surface: "chat", sessionId: ctx?.reqMeta?.sessionId || undefined,
  }, ctx);
}
