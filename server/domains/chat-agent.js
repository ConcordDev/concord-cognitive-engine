// server/domains/chat-agent.js
//
// Sprint 11 — Agent Mode macro. Wraps lib/chat-agent.runAgentLoop with
// the runMacro + LENS_ACTIONS injection that ctx provides at runtime.

import { runAgentLoop } from "../lib/chat-agent.js";
import { resolveAgentMaxTurns } from "../lib/chat-reply-policy.js";
import { isServerRouteHint } from "../lib/chat/agent-route.js";
import { COMPACT_VOICE } from "../prompts/voice.js";

/** Prefer message; accept task as alias (ActionPanel fleet convention). */
export function resolveAgentMessage(input = {}) {
  const message = input?.message;
  const task = input?.task;
  return message || task || null;
}

/**
 * System addendum for one chat_agent.do call. The optional voice block
 * (prompts/voice.js, sent by lib/chat/agent-route.js) goes first; the route
 * hint (which tool, cite only what it returned) goes last so grounding is the
 * final word. "" when neither is given.
 *
 * chat_agent.do is client-reachable, so these fields are allowlisted: only a
 * voice block from prompts/voice.js or a route hint from agent-route.js's
 * ROUTE_HINT table reaches the system prompt. Any other text (a client's
 * "system" override, fake tool markers) is dropped.
 */
const _SERVER_VOICES = new Set(Object.values(COMPACT_VOICE).map((v) => String(v).trim()));
export function agentExtraSystemBlock(input = {}) {
  const rawVoice = typeof input?.voiceBlock === "string" ? input.voiceBlock.trim() : "";
  const rawHint = typeof input?.routeHint === "string" ? input.routeHint.trim() : "";
  const voice = rawVoice && _SERVER_VOICES.has(rawVoice) ? rawVoice.slice(0, 2000) : "";
  const hint = rawHint && isServerRouteHint(rawHint) ? rawHint.slice(0, 600) : "";
  return [voice, hint].filter(Boolean).map((b) => `\n\n${b}`).join("");
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
      opts: {
        maxTurns: resolveAgentMaxTurns({ requested: maxTurns }),
        slot,
        // chat.respond's agent route (lib/chat/agent-route.js) says which
        // tool the request needs; a short system addendum, length-capped.
        // Voice block first, route hint (grounding) last: agentExtraSystemBlock.
        ...(agentExtraSystemBlock(input) ? { extraSystemBlock: agentExtraSystemBlock(input) } : {}),
        ...(input.sessionId ? { sessionId: String(input.sessionId) } : {}),
        // Self-continuation per-request switch (lib/chat/self-continuation.js; only matters when the
        // CONCORD_CHAT_SELF_CONTINUE env is "1" or "optin").
        ...(typeof input.selfContinue === "boolean" ? { selfContinue: input.selfContinue } : {}),
        // Which surface asked (chat | conkay | agent): start_long_task posts its result back there.
        ...(["chat", "conkay", "agent"].includes(input.surface) ? { surface: input.surface } : {}),
        // Chat turn deadline (lib/chat/gen-budget.js); runAgentLoop ignores
        // anything that is not a near-future epoch ms. JSON is the default
        // when a deadline arrives without a transport. Stream design turns
        // pass "sse" so the layout reserve still applies.
        ...(Number(input.deadlineMs) > 0 ? { deadlineMs: Number(input.deadlineMs) } : {}),
        ...((input.chatTransport === "json" || input.chatTransport === "sse" || input.chatTransport === "socket")
          ? { chatTransport: input.chatTransport }
          : (Number(input.deadlineMs) > 0 ? { chatTransport: "json" } : {})),
      },
    });
  }, { note: "Agent Mode — runs an agentic tool-use loop with web search, compute, browse_url, run_lens_action (any of 200+ lens domain actions), create_dtu, expert_mode. Routes through Sprint 10 BYO router so user's API key kicks in. Returns answer + toolCalls + artifacts + provenance. Accepts input.message or input.task (alias)." });
}
