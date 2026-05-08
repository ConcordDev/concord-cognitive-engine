// Layer 13 — heartbeat that initiates NPC conversations.
//
// Runs ~ every 2 minutes (frequency 8). For each world with NPCs:
//   1. Sweep expired conversations to closed (GC)
//   2. Try to initiate up to MAX_PER_PASS conversations
//   3. Emit npc:conversation-bid socket event per new conversation so
//      players in the same world see ambient NPC dialogue surface.
//
// Heartbeat-compatible: returns { ok, ... } in all paths, never throws.

import {
  tryInitiateConversation,
  sweepExpiredConversations,
  _internal,
} from "../lib/embodied/npc-dialogue.js";

export async function runNpcConversationInitiator({ db, io } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    // 1. GC — close expired
    const swept = sweepExpiredConversations(db);

    // 2. For each world, try to initiate up to MAX_PER_PASS conversations.
    const worlds = db.prepare(`SELECT DISTINCT world_id FROM world_npcs`).all();
    let opened = 0;
    let attempted = 0;
    for (const { world_id: worldId } of worlds) {
      for (let i = 0; i < _internal.MAX_PER_PASS; i++) {
        attempted++;
        const result = tryInitiateConversation(db, worldId);
        if (!result.ok) break; // no more candidates this pass; move on
        opened++;
        // Emit socket event if io is available (mirrors the routes/worlds
        // pattern of emitting via app.locals.io). Floor-only — emit
        // failures must not stop the cycle.
        try {
          io?.to(`world:${worldId}`)?.emit?.("npc:conversation-bid", {
            id: result.conversationId,
            worldId,
            npcA: result.npcA,
            npcB: result.npcB,
            opener: result.opener,
            expiresAt: result.expiresAt,
          });
        } catch { /* socket emit best-effort */ }
      }
    }

    return {
      ok: true,
      worldsScanned: worlds.length,
      attempted,
      opened,
      closed: swept.closed || 0,
    };
  } catch (e) {
    return { ok: false, reason: "exception", error: String(e?.message || e) };
  }
}
