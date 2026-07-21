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

export function mountChatAgentStream({ app, auth, runMacro, lensActions }) {
  app.post("/api/chat-agent/stream", auth, async (req, res) => {
    const { message = "", history = [], maxTurns, slot } = req.body || {};
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

    try {
      const result = await runAgentLoop({
        db: req.db || req.app.locals.db,
        userId,
        message,
        runMacro,
        lensActions,
        history,
        opts: { maxTurns, slot },
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
      const answer = String(result.answer || "");
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
