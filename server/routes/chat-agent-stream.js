// server/routes/chat-agent-stream.js
//
// Sprint 14 — SSE streaming for chat_agent.do. The chat_agent.do macro
// is blocking — runs the full agent loop and returns the final result.
// This route runs the same loop but streams each turn's brain reply +
// tool-call events as they happen, so the AgentModePanel can render
// the agent thinking step-by-step instead of waiting for the whole
// loop to finish.
//
// The /api/chat/stream endpoint already exists for the regular chat
// path; this is the agent-loop equivalent at /api/chat-agent/stream.
//
// Browser-perf / agent-pipeline audit (2026-07-20) — this route used to
// run the ENTIRE agent loop to completion first (every turn, every tool
// call, fully blocking), then "stream" by replaying the already-known
// tool_call/token events afterward with artificial setTimeout(30ms/12ms)
// delays — simulated streaming, not real-time. The user stared at nothing
// for the full loop duration (which can be several LLM round-trips + real
// tool executions — seconds, not milliseconds) and then watched a fake
// fast-forward that added latency without reducing it. Fixed by threading
// runAgentLoop's new `onEvent` callback straight through to SSE `send()` —
// tool_call/turn_end events now fire the INSTANT they actually happen. The
// final answer is still sent in chunks (frontend AgentModePanel compat —
// unchanged wire shape) but with the artificial per-chunk delay removed:
// once the full answer is known, holding data the client already needs is
// pure added latency, not a real streaming benefit — any typewriter-style
// reveal pacing belongs client-side, not as a server-side sleep.

import { runAgentLoop } from "../lib/chat-agent.js";
import { startSSE } from "../lib/sse.js";
import { conkayTurnPlan, conkayToolPolicy } from "../lib/conkay/agent-turn.js";
import { sourcesFromToolCalls, withSourceLinks, writeReceipt, answerLongTaskRoute } from "../lib/chat/agent-route.js";
import { takePendingLongTaskNotices } from "../lib/long-task.js";

export function mountChatAgentStream({ app, auth, runMacro, lensActions }) {
  app.post("/api/chat-agent/stream", auth, async (req, res) => {
    // `persona` — an OPTIONAL client-supplied system-prompt addendum. Added
    // for ConKay: its free-form chat path (ConKayOverlay.tsx#chatWithBrain)
    // routes through this same agent loop every other caller (e.g.
    // LensAgentPanel.tsx's generic per-lens agent) uses, but was never
    // sending its own persona (components/conkay/conkay-persona.ts's
    // CONKAY_PERSONA_PROMPT) — so every ConKay conversation was actually
    // running as the generic, personality-less "Agent Mode" identity, not
    // Kay. Threaded straight into runAgentLoop's existing opts.extraSystemBlock
    // hook (already used by agent-marathon.js for the same purpose), so a
    // caller that doesn't send it (every other caller, unchanged) behaves
    // byte-identically to before. Length-capped defensively since this rides
    // straight into a system-role LLM message.
    const { message = "", history = [], maxTurns, slot, persona } = req.body || {};
    // ConKay (the persona names her): tools are the default. The route hint
    // says which tool this ask needs and the fallback call runs it if the
    // model answers from memory (lib/conkay/agent-turn.js).
    const isConKay = typeof persona === "string" && /\bConKay\b/.test(persona);
    let plan = null;
    if (isConKay) { try { plan = conkayTurnPlan(message, Array.isArray(history) ? history : []); } catch { plan = null; } }
    const extraSystemBlock = typeof persona === "string" && persona.trim()
      ? `\n\n${persona.trim().slice(0, 4000)}${isConKay ? `\n\n${conkayToolPolicy()}` : ""}${plan?.hint ? `\n\n${plan.hint}` : ""}`
      : undefined;
    const userId = req.user?.id || req.auth?.userId;
    if (!message) return res.status(400).json({ ok: false, error: "missing_message" });
    if (!userId) return res.status(401).json({ ok: false, error: "no_actor" });

    startSSE(res);

    const send = (event, data) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch { /* client gone */ }
    };

    // Initial ack so the client knows the stream is live.
    send("status", { phase: "started" });

    const surface = isConKay ? "conkay" : "agent";
    const db = req.db || req.app.locals.db;
    // Finished background jobs this surface hasn't shown yet (ConKay keeps its
    // history in the browser, so a job's result is announced on the next reply).
    let notices = [];
    try { notices = takePendingLongTaskNotices(db, userId, { surface }); } catch { notices = []; }
    const withNotices = (answer) => notices.length
      ? `${notices.map((n) => n.text).join("\n\n---\n\n")}\n\n---\n\n${answer}`
      : answer;

    // ConKay background jobs: start or report without a model turn.
    if (isConKay && (plan?.route === "long" || plan?.route === "jobs")) {
      try {
        const out = answerLongTaskRoute({ runMacro, ctx: { db, actor: { userId } }, prompt: message, route: plan.route, lensActions, surface });
        if (out) {
          for (const tc of out.toolCalls || []) send("tool_call", tc);
          const answer = withNotices(String(out.reply || ""));
          for (let i = 0; i < answer.length; i += 80) send("token", { chunk: answer.slice(i, i + 80) });
          send("done", { ok: true, provider: null, model: null, turns: 0, route: plan.route });
          try { res.end(); } catch { /* noop */ }
          return;
        }
      } catch { /* fall through to the agent loop */ }
    }

    try {
      const result = await runAgentLoop({
        db: req.db || req.app.locals.db,
        userId,
        message,
        runMacro,
        lensActions,
        history,
        opts: { maxTurns, slot, extraSystemBlock, surface, ...(plan?.fallbackCall ? { fallbackCall: plan.fallbackCall } : {}) },
        // Real-time bridge — fires as each turn/tool call actually
        // completes inside the loop, not after the whole thing finishes.
        onEvent: (type, payload) => {
          if (type === "turn_start") send("status", { phase: "turn_start", turn: payload.turn });
          else if (type === "tool_call") send("tool_call", payload);
          else if (type === "turn_end") send("status", { phase: "turn_end", turn: payload.turn, willCallTools: payload.willCallTools });
        },
      });

      for (const art of (result.artifacts || [])) {
        send("artifact", art);
      }

      // Chunked for AgentModePanel wire-shape compatibility (unchanged),
      // but sent back-to-back with no artificial delay — the answer is
      // already fully known at this point, so pacing it out server-side
      // only adds latency. Any typing-effect animation the UI wants is a
      // client-side concern, not something the server should sleep for.
      let answer = String(result.answer || "");
      if (isConKay && result.ok) {
        // A lens write reports what was stored, not the model's paraphrase
        // (live: an invented "due Friday, October 22"); web answers carry
        // their links.
        if (plan?.route === "action") {
          const receipt = writeReceipt(result.toolCalls || []);
          if (receipt) answer = receipt;
        }
        answer = withSourceLinks(answer, sourcesFromToolCalls(result.toolCalls || []));
      }
      if (notices.length) answer = withNotices(answer);
      const step = 80;
      for (let i = 0; i < answer.length; i += step) {
        send("token", { chunk: answer.slice(i, i + step) });
      }

      send("done", {
        ok: result.ok,
        provider: result.provider,
        model: result.model,
        turns: result.turns,
        error: result.error,
      });
    } catch (err) {
      send("done", { ok: false, error: err?.message || String(err) });
    }
    try { res.end(); } catch { /* noop */ }
  });
}
