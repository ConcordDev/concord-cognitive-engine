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

import { trustedNote } from "../lib/chat/agent-history-sanitize.js";
import { runAgentLoop } from "../lib/chat-agent.js";
import { brainChat } from "../lib/byo-router.js";
import { notesDirectEligible, answerFromNotes } from "../lib/conkay/notes-answer.js";
import { startSSE } from "../lib/sse.js";
import { conkayTurnPlan, conkayToolPolicy } from "../lib/conkay/agent-turn.js";
import { sourcesFromToolCalls, withSourceLinks, writeReceipt, answerLongTaskRoute } from "../lib/chat/agent-route.js";
import { takePendingLongTaskNotices } from "../lib/long-task.js";
import { resolveAgentMaxTurns } from "../lib/chat-reply-policy.js";

// ConKay used to answer without Concord's DTUs (Ramaj, 2026-10-27): the
// agent loop got no retrieval. retrieveDtuContext is Chat's DTU retrieval
// (hot + archived, megas/hypers first), injected by server.js.
export const CONKAY_DTU_TIMEOUT_MS = 3500;

export function conkayDtuBlock(lines, { strong = false } = {}) {
  const text = String(lines || "").trim();
  if (!text) return "";
  return "CONCORD KNOWLEDGE (retrieved DTUs; MEGA and HYPER entries are consolidated syntheses of many DTUs and are listed first). "
    + "When the question is about Concord's DTUs or one of these answers it, answer from it without web_search and name the DTU title you used. Do not invent DTUs.\n"
    + (strong ? "These notes strongly match the question. Answer from these notes first; only search the web if they don't contain it.\n" : "")
    + text.slice(0, 6000);
}

export function mountChatAgentStream({ app, auth, runMacro, lensActions, retrieveDtuContext = null, brain = brainChat }) {
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
    let extraSystemBlock = typeof persona === "string" && persona.trim()
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
          console.log(`[chat-agent-stream] done surface=${surface} ok=true turns=0 route=${plan.route} error=""`);
          send("done", { ok: true, provider: null, model: null, turns: 0, route: plan.route });
          try { res.end(); } catch { /* noop */ }
          return;
        }
      } catch { /* fall through to the agent loop */ }
    }

    // Remember / recall / "what happened?": answered from the conversation, no model turn.
    if (isConKay && typeof plan?.reply === "string" && plan.reply) {
      const answer = withNotices(plan.reply);
      for (let i = 0; i < answer.length; i += 80) send("token", { chunk: answer.slice(i, i + 80) });
      console.log(`[chat-agent-stream] done surface=${surface} ok=true turns=0 route=${plan.route} error=""`);
      send("done", { ok: true, provider: null, model: null, turns: 0, route: plan.route });
      try { res.end(); } catch { /* noop */ }
      return;
    }

    let dtuNote = null;
    if (isConKay && typeof retrieveDtuContext === "function") {
      try {
        const got = await Promise.race([
          Promise.resolve(retrieveDtuContext(message, userId)),
          new Promise((r) => { setTimeout(() => r(null), CONKAY_DTU_TIMEOUT_MS); }),
        ]);
        const block = conkayDtuBlock(got?.text, { strong: !!got?.strong });
        // As a note next to the question (like Chat's tool route), not deep in
        // the tool-heavy system prompt, where the model skipped it for web_search.
        if (block) dtuNote = trustedNote(block);
        console.log(`[chat-agent-stream] dtu_context surface=${surface} hits=${got?.count ?? 0} consolidated=${got?.consolidated ?? 0} archived=${got?.archived ?? 0} strong=${!!got?.strong}`);
        // Named DTU / strong match on a no-tool question: answer from the notes
        // with no tools; when they lack it, the agent loop below runs as before.
        if (block && notesDirectEligible({ plan, got, message })) {
          const direct = await answerFromNotes({ brain, db, userId, slot, block, message, history });
          console.log(`[chat-agent-stream] notes_direct surface=${surface} answered=${!!direct}`);
          if (direct) {
            const answer = withNotices(direct.answer);
            for (let i = 0; i < answer.length; i += 80) send("token", { chunk: answer.slice(i, i + 80) });
            console.log(`[chat-agent-stream] done surface=${surface} ok=true turns=1 route=notes error=""`);
            send("done", { ok: true, provider: direct.provider || null, model: direct.model || null, turns: 1, route: "notes" });
            try { res.end(); } catch { /* noop */ }
            return;
          }
        }
      } catch { /* retrieval is additive */ }
    }

    try {
      const result = await runAgentLoop({
        db: req.db || req.app.locals.db,
        userId,
        // "Yes run it": the loop gets the confirmation plus what it confirms.
        message: (isConKay && typeof plan?.message === "string" && plan.message) || message,
        runMacro,
        lensActions,
        history: dtuNote ? [...(Array.isArray(history) ? history : []), dtuNote] : history,
        opts: { maxTurns: resolveAgentMaxTurns({ requested: maxTurns }), slot, extraSystemBlock, surface, ...(plan?.fallbackCall ? { fallbackCall: plan.fallbackCall } : {}) },
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

      // Outcome only (no message text, no user id): makes a dead agent loop visible in the backend log.
      console.log(`[chat-agent-stream] done surface=${surface} ok=${!!result.ok} turns=${result.turns ?? "?"} error=${JSON.stringify(String(result.error || "").replace(/\s+/g, " ").slice(0, 160))}`);
      send("done", {
        ok: result.ok,
        provider: result.provider,
        model: result.model,
        turns: result.turns,
        error: result.error,
      });
    } catch (err) {
      console.warn(`[chat-agent-stream] done surface=${surface} ok=false turns=? error=${JSON.stringify(String(err?.message || err).replace(/\s+/g, " ").slice(0, 160))}`);
      send("done", { ok: false, error: err?.message || String(err) });
    }
    try { res.end(); } catch { /* noop */ }
  });
}
