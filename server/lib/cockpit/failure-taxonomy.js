// One named class per failed tool call. Every later cockpit retry rule keys off it.
import { HARD_ERROR_RE } from "../chat/tool-turn-reply.js";

export const FAILURE_CLASSES = Object.freeze([
  "bad_args", "unknown_tool", "unsupported_input", "not_found", "external", "disabled_tool",
  "tool_error", "scope_denied", "rate_limited", "timeout", "model_empty", "model_malformed",
  "verify_failed", "fake_success", "looped", "hard_stop", "needs_confirm",
]);

/**
 * @param {object} result  a tool result as returned by executeToolCall
 * @returns {{ class: string, hard: boolean, retryable: boolean }}
 */
export function classifyFailure(result) {
  const r = result && typeof result === "object" ? result : {};
  if (r.ok === true) return { class: "ok", hard: false, retryable: false };
  const text = String(r.error || r.reason || "");
  const done = (cls) => ({
    class: cls,
    hard: cls === "hard_stop",
    retryable: cls !== "hard_stop" && cls !== "scope_denied" && cls !== "needs_confirm",
  });
  if (r.reason === "scope_denied" || /scope .* required/i.test(text)) return done("scope_denied");
  if (r.reason === "rate_limited" || /rate.?limit|\b429\b|quota_exhausted/i.test(text)) return done("rate_limited");
  if (r.reason === "approval_required") return done("needs_confirm");
  if (HARD_ERROR_RE.test(text) && !/code_exec_forbidden/.test(text)) return done("hard_stop");
  if (r.unknownTool === true || /unknown tool|not registered/i.test(text) || r.reason === "not_registered") return done("unknown_tool");
  if (/code_exec_forbidden|not available in this session|is disabled|not connected/i.test(text)) return done("disabled_tool");
  if (r.reason === "timeout" || /timed? ?out|ETIMEDOUT|aborted/i.test(text)) return done("timeout");
  if (
    Array.isArray(r.missing) || r.validKeys || r.validActions ||
    /missing required|required param|invalid_input|unknown compute function|requires "module\.function"|expected_|must be/i.test(text)
  ) return done("bad_args");
  if (/unsupported part|unsupported|no span|cannot handle/i.test(text)) return done("unsupported_input");
  if (/not[ _]found|no such|does not exist|fk_not_found/i.test(text)) return done("not_found");
  if (/HTTP (4\d\d|5\d\d)|ECONNREFUSED|ENOTFOUND|fetch failed|upstream/i.test(text)) return done("external");
  if (r.reason === "handler_threw" || /handler_error|lens action error|compute error/i.test(text)) return done("tool_error");
  return done("tool_error");
}
