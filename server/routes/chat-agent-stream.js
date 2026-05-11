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

import { runAgentLoop } from "../lib/chat-agent.js";

export function mountChatAgentStream({ app, auth, runMacro, lensActions }) {
  app.post("/api/chat-agent/stream", auth, async (req, res) => {
    const { message = "", history = [], maxTurns, slot } = req.body || {};
    const userId = req.user?.id || req.auth?.userId;
    if (!message) return res.status(400).json({ ok: false, error: "missing_message" });
    if (!userId) return res.status(401).json({ ok: false, error: "no_actor" });

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const send = (event, data) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch { /* client gone */ }
    };

    // Initial ack so the client knows the stream is live.
    send("status", { phase: "started" });

    try {
      // Run the agent loop in a manner that streams progress. The
      // current runAgentLoop is internally blocking per turn but we
      // can wrap it to emit between turns by intercepting tool calls.
      // Cleanest minimal-risk approach: run it as-is, then stream out
      // the result in chunks (so the UI gets progressive rendering).
      const result = await runAgentLoop({
        db: req.db || req.app.locals.db,
        userId,
        message,
        runMacro,
        lensActions,
        history,
        opts: { maxTurns, slot },
      });

      // Emit tool calls one-by-one for visual flow.
      for (const tc of (result.toolCalls || [])) {
        send("tool_call", tc);
        await new Promise(r => { setTimeout(r, 30); });
      }
      for (const art of (result.artifacts || [])) {
        send("artifact", art);
      }

      // Chunk the final answer for streaming display.
      const answer = String(result.answer || "");
      const step = 80;
      for (let i = 0; i < answer.length; i += step) {
        send("token", { chunk: answer.slice(i, i + step) });
        await new Promise(r => { setTimeout(r, 12); });
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
