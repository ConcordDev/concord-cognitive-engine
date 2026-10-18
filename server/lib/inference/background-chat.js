// server/lib/inference/background-chat.js
//
// Single point through which background, non-user-facing LLM calls must pass.
// Every call is admitted by the background governor, counts against the
// correct brain slot, and reports its outcome back so the breaker can react.

import { admitExecution } from "../background-governor.js";
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
export async function governedBackgroundChat(kind, messages, opts = {}) {
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
