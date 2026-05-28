// Phase E7 — brawl-queue heartbeat.
//
// Pops pairs from the in-memory matchmaking queue every minute. The
// queue is in `server/lib/brawl.js`; this module just calls popPair().
// On a successful pair, the invite is fanned out via realtime so both
// players get the brawl-invited socket event their HUD already listens
// for.

import { popPair } from "../lib/brawl.js";

export async function runBrawlQueueCycle({ realtimeEmit } = {}) {
  try {
    // Drain the queue: pop as many pairs as exist on this tick.
    let paired = 0;
    for (let i = 0; i < 16; i++) {
      const r = popPair();
      if (!r.ok || !r.paired) break;
      paired++;
      // Realtime fan-out: both players get the invite via the existing
      // user channel; the BrawlInviteToast component picks it up.
      try {
        if (typeof realtimeEmit === "function") {
          realtimeEmit(`user:${r.paired.a}`, "brawl-invited", {
            inviteId: r.paired.inviteId,
            from: r.paired.b,
            fromUserName: null,
            via: "matchmaking",
          });
          realtimeEmit(`user:${r.paired.b}`, "brawl-invited", {
            inviteId: r.paired.inviteId,
            from: r.paired.a,
            fromUserName: null,
            via: "matchmaking",
          });
        }
      } catch { /* best-effort emit */ }
    }
    return { ok: true, paired };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}
