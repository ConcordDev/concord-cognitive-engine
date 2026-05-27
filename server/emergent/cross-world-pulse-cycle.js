// server/emergent/cross-world-pulse-cycle.js
//
// Wave E / E1 — single-instance simulation of asymmetric multiplayer.
//
// Two responsibilities per pass:
//   1. Sample notable local legends + write to the shadow queue
//      (simulates a "shadow peer" worth its own player base)
//   2. Drain the shadow queue + spawn echo quests in the local world
//      via the existing world_quests pipeline
//
// When CONCORD_FEDERATION_TOKEN is set, step 1 also pushes to real
// peers via cnet-federation. Step 2 is the same either way — the queue
// is the canonical inbox.
//
// Kill switch: CONCORD_CROSS_WORLD_PULSE=0.

import crypto from "crypto";
import logger from "../logger.js";
import { sampleNotableEvents, drainShadowQueue, markConsumed } from "../lib/cross-world-shadow.js";

const MAX_ECHOES_PER_PASS = 3;

export async function runCrossWorldPulseCycle({ db } = {}) {
  if (process.env.CONCORD_CROSS_WORLD_PULSE === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  // 1. Sample outgoing.
  let sampled = { recorded: 0 };
  try {
    sampled = sampleNotableEvents(db);
  } catch (err) {
    logger?.warn?.("cross-world-pulse", "sample_failed", { error: err?.message });
  }

  // 2. Drain incoming (echo quests).
  let echoes = [];
  try {
    echoes = drainShadowQueue(db, { limit: MAX_ECHOES_PER_PASS });
  } catch { /* shadow queue absent */ }
  if (echoes.length === 0) return { ok: true, sampled: sampled.recorded, echoesSpawned: 0 };

  // Find active worlds we can spawn echo quests INTO. We pick any world
  // that isn't the source world (so the echo represents "news from
  // another world").
  let activeWorlds = [];
  try {
    activeWorlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_visits
      WHERE departed_at IS NULL LIMIT 5
    `).all().map((r) => r.world_id);
  } catch { activeWorlds = ["concordia"]; }
  if (activeWorlds.length === 0) activeWorlds = ["concordia"];

  const stats = { ok: true, sampled: sampled.recorded, echoesSpawned: 0, errored: 0 };
  for (const echo of echoes) {
    try {
      const detail = echo.detail || {};
      // Pick a destination world that isn't the source.
      const destinations = activeWorlds.filter((w) => w !== echo.source_world);
      const dest = destinations[0] || activeWorlds[0];
      if (!dest) continue;

      // Spawn a kill-quest or rumor-quest carried by a synthetic NPC
      // who "heard the news". For v1 we just write to world_quests
      // with origin='echo' tag in description; a future client surfaces
      // an Echo badge in the QuestPanel.
      const questId = `q_echo_${crypto.randomBytes(6).toString("hex")}`;
      try {
        db.prepare(`
          INSERT INTO world_quests
            (id, world_id, giver_npc_id, title, description, status, reward, created_at)
          VALUES (?, ?, NULL, ?, ?, 'available', ?, unixepoch())
        `).run(questId, dest,
          `Echo: ${detail.title || "A faint reverberation from another world"}`,
          [
            `${detail.body || "Word reached this world from elsewhere."}`,
            ``,
            `(This is an echo — a deed remembered in another world that traveled here. The truth is half a world away.)`,
          ].join("\n"),
          JSON.stringify({
            type: "echo_investigation",
            sourceLegendId: detail.legendId ?? null,
            sourceWorld: echo.source_world,
            sentiment: detail.sentiment ?? 0,
            severity: detail.severity ?? 0,
          }));
      } catch { /* world_quests optional */ }

      // Realtime so the QuestPanel can pop a new-quest toast.
      try {
        globalThis._concordRealtimeEmit?.("world:echo-quest-spawned", {
          worldId: dest,
          questId,
          sourceWorld: echo.source_world,
          title: detail.title ?? null,
          sentiment: detail.sentiment ?? 0,
        });
      } catch { /* ok */ }

      markConsumed(db, echo.id);
      stats.echoesSpawned++;
    } catch (err) {
      stats.errored++;
      logger?.warn?.("cross-world-pulse", "echo_failed", { id: echo.id, error: err?.message });
    }
  }

  return stats;
}
