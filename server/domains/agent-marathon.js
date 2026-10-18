// server/domains/agent-marathon.js
//
// Sprint 12 — macros for marathon agent sessions.

import {
  startMarathon, listMarathons, getMarathon,
  tickMarathon, pauseMarathon, abandonMarathon, revokeMarathon,
} from "../lib/agent-marathon.js";
import { buildMarathonDigest } from "../lib/marathon-digest.js";

// Owner gate for every per-session macro. The caller must be signed in and
// own the session; an anonymous caller or another user gets the same
// not_found / not_owner answer (no "exists but not yours" leak beyond the
// historical not_owner reason). System paths (heartbeat, long-task pump)
// call lib/agent-marathon.js directly, not these macros.
function ownedSession(ctx, input) {
  const db = ctx?.db;
  if (!db || !input?.sessionId) return { err: { ok: false, reason: "missing_inputs" } };
  const userId = ctx?.actor?.userId;
  if (!userId) return { err: { ok: false, reason: "no_actor" } };
  const session = getMarathon(db, String(input.sessionId));
  if (!session) return { err: { ok: false, reason: "not_found" } };
  if (session.user_id !== userId) return { err: { ok: false, reason: "not_owner" } };
  return { db, session, userId };
}

export default function registerAgentMarathonMacros(register) {
  register("agent_marathon", "start", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    // `input` is forwarded whole, so the mig-379 governance fields
    // (allowedDomains: string[], budgetCap: number) already flow straight
    // through to startMarathon — no extra destructuring needed here.
    return startMarathon(db, userId, input);
  }, { note: "Start a long-running marathon session — agent works toward goal across many turns over hours/days. Optional allowedDomains (string[]) + budgetCap (number) set the enforced governance envelope." });

  register("agent_marathon", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    return { ok: true, sessions: listMarathons(db, userId, input) };
  }, { note: "List the user's marathon sessions." });

  register("agent_marathon", "get", async (ctx, input = {}) => {
    const o = ownedSession(ctx, input);
    if (o.err) return o.err;
    return { ok: true, session: o.session };
  }, { note: "Get marathon session detail with all turns + tool calls + artifacts." });

  register("agent_marathon", "tick", async (ctx, input = {}) => {
    const o = ownedSession(ctx, input);
    if (o.err) return o.err;
    const runMacro = ctx?.runMacro || globalThis.__concordRunMacro;
    const lensActions = ctx?.lensActions || globalThis.__concordLensActions || new Map();
    return tickMarathon({
      db: o.db, sessionId: o.session.id, runMacro, lensActions,
      opts: { tickTurns: input.tickTurns, slot: input.slot },
    });
  }, { note: "Advance a marathon session by N turns (default 5). Same tool surface as chat_agent.do." });

  register("agent_marathon", "pause", async (ctx, input = {}) => {
    const o = ownedSession(ctx, input);
    if (o.err) return o.err;
    return pauseMarathon(o.db, o.session.id);
  }, { note: "Pause a running marathon. Resume by calling agent_marathon.tick again." });

  register("agent_marathon", "abandon", async (ctx, input = {}) => {
    const o = ownedSession(ctx, input);
    if (o.err) return o.err;
    return abandonMarathon(o.db, o.session.id);
  }, { note: "Abandon a marathon (terminal — cannot be resumed)." });

  register("agent_marathon", "digest", async (ctx, input = {}) => {
    const o = ownedSession(ctx, input);
    if (o.err) return o.err;
    return buildMarathonDigest(o.db, o.session.id);
  }, { note: "Deterministic, non-LLM human-legible progress digest for a marathon session — built only from real turns/tool_calls_json/artifacts_json, never a fabricated summary." });

  register("agent_marathon", "revoke", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId || !input?.sessionId) return { ok: false, reason: "missing_inputs" };
    return revokeMarathon(db, input.sessionId, userId);
  }, { note: "Owner-only, real-time stop — enforced inside the very next tool-call gate check even if a tick is already mid-flight, not just before the next scheduled tick." });
}
