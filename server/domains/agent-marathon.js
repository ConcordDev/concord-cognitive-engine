// server/domains/agent-marathon.js
//
// Sprint 12 — macros for marathon agent sessions.

import {
  startMarathon, listMarathons, getMarathon,
  tickMarathon, pauseMarathon, abandonMarathon,
} from "../lib/agent-marathon.js";

export default function registerAgentMarathonMacros(register) {
  register("agent_marathon", "start", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    return startMarathon(db, userId, input);
  }, { note: "Start a long-running marathon session — agent works toward goal across many turns over hours/days." });

  register("agent_marathon", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    return { ok: true, sessions: listMarathons(db, userId, input) };
  }, { note: "List the user's marathon sessions." });

  register("agent_marathon", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.sessionId) return { ok: false, reason: "missing_inputs" };
    const session = getMarathon(db, input.sessionId);
    if (!session) return { ok: false, reason: "not_found" };
    if (ctx?.actor?.userId && session.user_id !== ctx.actor.userId) {
      return { ok: false, reason: "not_owner" };
    }
    return { ok: true, session };
  }, { note: "Get marathon session detail with all turns + tool calls + artifacts." });

  register("agent_marathon", "tick", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.sessionId) return { ok: false, reason: "missing_inputs" };
    const runMacro = ctx?.runMacro || globalThis.__concordRunMacro;
    const lensActions = ctx?.lensActions || globalThis.__concordLensActions || new Map();
    return tickMarathon({
      db, sessionId: input.sessionId, runMacro, lensActions,
      opts: { tickTurns: input.tickTurns, slot: input.slot },
    });
  }, { note: "Advance a marathon session by N turns (default 5). Same tool surface as chat_agent.do." });

  register("agent_marathon", "pause", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.sessionId) return { ok: false, reason: "missing_inputs" };
    return pauseMarathon(db, input.sessionId);
  }, { note: "Pause a running marathon. Resume by calling agent_marathon.tick again." });

  register("agent_marathon", "abandon", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input?.sessionId) return { ok: false, reason: "missing_inputs" };
    return abandonMarathon(db, input.sessionId);
  }, { note: "Abandon a marathon (terminal — cannot be resumed)." });
}
