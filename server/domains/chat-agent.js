// server/domains/chat-agent.js
//
// Sprint 11 — Agent Mode macro. Wraps lib/chat-agent.runAgentLoop with
// the runMacro + LENS_ACTIONS injection that ctx provides at runtime.

import { runAgentLoop } from "../lib/chat-agent.js";

/** Prefer message; accept task as alias (ActionPanel fleet convention). */
export function resolveAgentMessage(input = {}) {
  const message = input?.message;
  const task = input?.task;
  return message || task || null;
}

export default function registerChatAgentMacros(register) {
  register("chat_agent", "do", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const { history = [], maxTurns, slot } = input || {};
    // Many ActionPanels (kingdoms Realm Council, studio, travel, …) post
    // `task` while the handler historically required `message`. Accept
    // task as an alias so those controls don't 422; prefer message when both set.
    const resolvedMessage = resolveAgentMessage(input);
    if (!resolvedMessage) return { ok: false, reason: "missing_message" };

    // ctx provides runMacro indirectly via the broader macro registry —
    // we synthesize it here from the registry the server keeps.
    const runMacroFn = ctx?.runMacro || (typeof globalThis.__concordRunMacro === "function" ? globalThis.__concordRunMacro : null);
    const lensActions = ctx?.lensActions || globalThis.__concordLensActions || new Map();

    return runAgentLoop({
      db, userId, message: resolvedMessage, history,
      runMacro: runMacroFn,
      lensActions,
      opts: { maxTurns: Math.min(8, maxTurns || 5), slot },
    });
  }, { note: "Agent Mode — runs an agentic tool-use loop with web search, compute, browse_url, run_lens_action (any of 200+ lens domain actions), create_dtu, expert_mode. Routes through Sprint 10 BYO router so user's API key kicks in. Returns answer + toolCalls + artifacts + provenance. Accepts input.message or input.task (alias)." });
}
