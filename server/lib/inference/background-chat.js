// server/lib/inference/background-chat.js
//
// Single point through which background, non-user-facing LLM calls must pass.
// Every call is admitted by the background governor, counts against the
// correct brain slot, and reports its outcome back so the breaker can react.

import fs from "node:fs";
import { isMainThread } from "node:worker_threads";
import { admitExecution, governorConfig, isKilled } from "../background-governor.js";
import { hasBackgroundBrain } from "../brain-config.js";
import { ollamaChat } from "./ollama-client.js";

/**
 * Run a background LLM chat through the governor.
 *
 * @param {string} kind - short execution kind, e.g. "dream", "forward_sim".
 * @param {import("./types.js").Message[]} messages
 * @param {{ agentId?: string, timeoutMs?: number, _admit?: function, _chat?: function, _hasBg?: function|boolean }} opts
 * @returns {Promise<{ok: boolean, text: string, toolCalls: object[], tokensIn: number, tokensOut: number, error?: string, brainUsed?: string, governed: boolean}>}
 */
/**
 * Heartbeat modules flagged worker:true run in worker threads, where this
 * module's governor instance has no signals and a breaker that never opens.
 * There, honour the MAIN thread's governor via its status file (written every
 * 10 s): deny when killed, when the breaker is open/half-open, or when the
 * status is stale/unreadable. Returns a denial reason or null.
 */
export function workerGate({ now = Date.now(), read = (p) => fs.readFileSync(p, "utf8") } = {}) {
  try { if (isKilled()) return "killed"; } catch { /* fall through */ }
  let d;
  try { d = JSON.parse(read(governorConfig().statusFile)); } catch { return "main_status_unreadable"; }
  const at = Date.parse(d?.generatedAt || "");
  if (!Number.isFinite(at) || now - at > 60_000) return "main_status_stale";
  if (d?.mode === "off" || d?.mode === "killed") return "killed";
  const st = d?.breaker?.state;
  if (st && st !== "closed") return `main_breaker_${st}`;
  return null;
}

function _denied(reason) {
  return { ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: `bg_governor_denied:${reason}`, governed: true };
}

export async function governedBackgroundChat(kind, messages, opts = {}) {
  const inWorker = opts._inWorker ?? !isMainThread;
  if (inWorker) {
    const why = (opts._workerGate || workerGate)();
    if (why) return _denied(why);
  }
  const admit = opts._admit || admitExecution;
  const chat = opts._chat || ollamaChat;
  const gate = admit({
    kind,
    agentId: opts.agentId || null,
    enforce: true,
  });

  if (!gate.allow) {
    return {
      ok: false,
      text: "",
      toolCalls: [],
      tokensIn: 0,
      tokensOut: 0,
      error: `bg_governor_denied:${gate.reason}`,
      governed: true,
    };
  }

  const hasBgRaw =
    opts._hasBg !== undefined
      ? typeof opts._hasBg === "function"
        ? opts._hasBg()
        : !!opts._hasBg
      : hasBackgroundBrain();
  const brain = hasBgRaw && process.env.CONCORD_BG_BRAIN !== "0" ? "background" : "subconscious";

  let r;
  try {
    r = await chat(brain, messages, { timeoutMs: opts.timeoutMs });
  } catch (err) {
    r = {
      ok: false,
      text: "",
      toolCalls: [],
      tokensIn: 0,
      tokensOut: 0,
      error: err?.message || String(err),
    };
  } finally {
    gate.release({ ok: !!r?.ok, error: r?.error });
  }

  return {
    ...(r || {
      ok: false,
      text: "",
      toolCalls: [],
      tokensIn: 0,
      tokensOut: 0,
      error: "unknown",
    }),
    brainUsed: brain,
    governed: true,
  };
}
