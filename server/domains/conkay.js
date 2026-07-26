// server/domains/conkay.js
//
// ConKay Voice + Affect fusion (#15) — macros over lib/conkay-affect.js. Tracks
// a persistent per-user affect state from real VAD analysis of the user's words,
// exposes the TTS prosody it implies, and a one-line persona note. The actual
// speech I/O is the existing real voice adapter (voice-tts.synthesize) — these
// macros produce the affect + prosody it consumes.
//
// Beyond-Denial unit #2 (2026-07-23) also adds thin memory_list/memory_pin/
// memory_forget wrappers over the REAL cross-session memory substrate:
// `lib/conversation-memory.js#compressRollingWindow` writes structured
// `conversation_memory` (and consolidated `conversation_memory_mega` /
// `conversation_memory_hyper`) DTUs into `ctx.state.dtus` (the write-through
// DTU store — SQLite is the source of truth, see `lib/dtu-store.js`). Nothing
// here re-implements that pipeline; these macros only expose real list/pin/
// forget on the DTUs it already produced.
//
// Ownership scoping is deliberately honest and narrow: only
// `conversation_memory` and `conversation_memory_hyper` DTUs carry a real
// `machine.userId` stamp (see `buildConversationMemoryDTU` /
// `checkTopicConsolidation`'s hyper branch), so those are the only two kinds
// surfaced, pin-able, and forget-able here. `conversation_memory_mega` DTUs
// have no per-user attribution in the substrate today (they're keyed by
// topic + `sessionIds`, not `userId`) — rather than guess an owner, they are
// left out of this surface entirely. That's a scoping gap, not a fabrication.
//
// Registered from server.js: registerConkayMacros(register).

import { observeTurn, getAffectState, prosodyParams, affectNote, analyzeAffect } from "../lib/conkay-affect.js";

const OWNED_MEMORY_KINDS = new Set(["conversation_memory", "conversation_memory_hyper"]);

function _memoryDtuBelongsTo(dtu, userId) {
  return !!dtu && OWNED_MEMORY_KINDS.has(dtu.machine?.kind) && dtu.machine?.userId === userId;
}

function _summarizeMemoryDtu(dtu) {
  const m = dtu.machine || {};
  return {
    id: dtu.id,
    kind: m.kind,
    title: dtu.title || null,
    tier: dtu.tier || "regular",
    topics: Array.isArray(m.topics) ? m.topics : [],
    insights: Array.isArray(m.insights) ? m.insights.slice(0, 5) : [],
    sessionId: m.sessionId || null,
    messageCount: m.messageCount || null,
    megaCount: m.megaCount || null,
    pinned: !!dtu.meta?.pinned,
    createdAt: dtu.createdAt || null,
    updatedAt: dtu.updatedAt || null,
  };
}

export default function registerConkayMacros(register) {
  register("conkay", "observe", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const state = observeTurn(db, userId, input.text || "");
    return { ok: true, state, prosody: prosodyParams(state), note: affectNote(state) };
  }, { note: "update ConKay's affect state from a user turn (real VAD) + derive prosody (#15)" });

  register("conkay", "affect_state", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const state = getAffectState(db, userId);
    return { ok: true, state, prosody: prosodyParams(state), note: affectNote(state) };
  }, { note: "current ConKay affect state + prosody + persona note (#15)" });

  register("conkay", "analyze", async (_ctx, input = {}) => {
    return { ok: true, vad: analyzeAffect(input.text || "") };
  }, { note: "analyze the VAD affect of a piece of text (real lexicon) (#15)" });

  register("conkay", "memory_list", async (ctx, input = {}) => {
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const dtus = ctx?.state?.dtus;
    if (!dtus || typeof dtus.values !== "function") return { ok: false, reason: "no_state" };

    const limit = Math.min(Math.max(parseInt(input.limit) || 100, 1), 500);
    const memories = [];
    for (const dtu of dtus.values()) {
      if (_memoryDtuBelongsTo(dtu, userId)) memories.push(_summarizeMemoryDtu(dtu));
    }
    memories.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

    return { ok: true, memories: memories.slice(0, limit), count: memories.length };
  }, { note: "list this user's real conversation-memory DTUs (conversation_memory + conversation_memory_hyper) for cross-session recall (#2 Beyond-Denial)" });

  register("conkay", "memory_pin", async (ctx, input = {}) => {
    const userId = input.userId || ctx?.actor?.userId;
    const dtuId = input.dtuId || input.id;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!dtuId) return { ok: false, reason: "no_dtu_id" };
    const dtus = ctx?.state?.dtus;
    if (!dtus || typeof dtus.get !== "function") return { ok: false, reason: "no_state" };

    const dtu = dtus.get(dtuId);
    if (!dtu) return { ok: false, reason: "not_found" };
    if (!_memoryDtuBelongsTo(dtu, userId)) return { ok: false, reason: "not_owned" };

    const nextPinned = input.pinned !== undefined ? !!input.pinned : !dtu.meta?.pinned;
    dtu.meta = { ...(dtu.meta || {}), pinned: nextPinned };
    dtu.updatedAt = new Date().toISOString();
    dtus.set(dtuId, dtu);

    return { ok: true, dtuId, pinned: nextPinned };
  }, { note: "pin/unpin a real conversation-memory DTU so it survives consolidation sweeps as user-flagged (#2 Beyond-Denial)" });

  register("conkay", "memory_forget", async (ctx, input = {}) => {
    const userId = input.userId || ctx?.actor?.userId;
    const dtuId = input.dtuId || input.id;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!dtuId) return { ok: false, reason: "no_dtu_id" };
    const dtus = ctx?.state?.dtus;
    if (!dtus || typeof dtus.get !== "function") return { ok: false, reason: "no_state" };

    const dtu = dtus.get(dtuId);
    if (!dtu) return { ok: false, reason: "not_found" };
    if (!_memoryDtuBelongsTo(dtu, userId)) return { ok: false, reason: "not_owned" };

    dtus.delete(dtuId);
    return { ok: true, dtuId, forgotten: true };
  }, { note: "permanently delete a real conversation-memory DTU on user request — a real destructive write, not a soft flag (#2 Beyond-Denial)" });
}
