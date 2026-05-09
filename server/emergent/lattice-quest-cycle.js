// server/emergent/lattice-quest-cycle.js
//
// Phase 4c heartbeat — surface drift findings as procedural quests.
//
// Frequency: 180 ticks (~45 min, staggered well behind the lattice
// drift-scan at frequency 60 so fresh alerts have time to settle).
//
// Per pass:
//   1. Pull the most recent drift alerts from STATE.driftStore (or skip
//      if the store isn't initialised).
//   2. For each warning+/critical alert that hasn't been converted yet
//      (signature lookup), spawnQuestFromAlert() which composes,
//      picks a host NPC, persists, and emits a `quest:lattice-born`
//      socket event.
//
// Bounded MAX_QUESTS_PER_PASS to avoid flooding players.
// Kill-switch: CONCORD_LATTICE_QUESTS=0.
//
// Returns { ok, scanned, spawned, skipped, reason? } never throws.

import logger from "../logger.js";
import { spawnQuestFromAlert, alertSignature } from "../lib/lattice-quest-composer.js";
import { generateRegionFromAlert } from "../lib/procgen-regions.js";

const MAX_QUESTS_PER_PASS = 6;
const ELIGIBLE_SEVERITIES = new Set(["warning", "alert", "critical"]);

export async function runLatticeQuestCycle({ db, state, tickCount: _t } = {}) {
  if (process.env.CONCORD_LATTICE_QUESTS === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  // Discover alerts from STATE.driftStore. Drift-monitor populates it on
  // each runDriftScan. If STATE isn't passed (test contexts), fall back
  // to an injected alerts array on opts (debug only).
  const driftStore = state?.driftStore || state?.drift?.store || null;
  let alerts = [];
  if (driftStore) {
    try {
      // Drift-monitor exposes alerts as a circular buffer of recent
      // findings. Newest first.
      alerts = (driftStore.alerts || []).slice(-50).reverse();
    } catch { /* ignore */ }
  }

  if (alerts.length === 0) return { ok: true, scanned: 0, spawned: 0 };

  // Discover active worlds — quests are world-scoped.
  let worlds = [];
  try {
    worlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_visits
      WHERE departed_at IS NULL LIMIT 5
    `).all().map(r => r.world_id).filter(Boolean);
  } catch { /* world_visits optional */ }
  if (worlds.length === 0) {
    try {
      worlds = db.prepare(`
        SELECT DISTINCT world_id FROM world_npcs
        WHERE COALESCE(is_dead, 0) = 0 LIMIT 3
      `).all().map(r => r.world_id).filter(Boolean);
    } catch { return { ok: true, scanned: alerts.length, spawned: 0, reason: "no_worlds" }; }
  }
  if (worlds.length === 0) return { ok: true, scanned: alerts.length, spawned: 0 };
  const worldId = worlds[0]; // primary world for now; multi-world fanout is future work

  let spawned = 0;
  let skipped = 0;
  for (const alert of alerts) {
    if (spawned >= MAX_QUESTS_PER_PASS) break;
    if (!ELIGIBLE_SEVERITIES.has(String(alert?.severity))) { skipped++; continue; }
    try {
      const r = await spawnQuestFromAlert(db, alert, worldId);
      if (r?.ok) {
        if (r.action === "inserted") {
          spawned++;
          // Phase 5e: also spawn a procgen region. Best-effort; idempotent
          // by signature so re-running won't duplicate.
          try {
            const sig = alertSignature(alert);
            generateRegionFromAlert(db, { worldId, alert, signature: sig });
          } catch { /* region spawn is best-effort */ }
          // Emit so the EmergentEventFeed can show it.
          try {
            if (globalThis?.__CONCORD_REALTIME__?.io) {
              globalThis.__CONCORD_REALTIME__.io.to(`world:${worldId}`).emit("quest:lattice-born", {
                questId: r.questId,
                hostNpcId: r.hostNpcId,
                title: r.title,
                driftType: alert.type,
                driftSeverity: alert.severity,
                ts: Date.now(),
              });
            }
          } catch { /* socket emit best-effort */ }
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    } catch (err) {
      try { logger.debug?.("lattice-quest-cycle", "spawn_failed", { error: err?.message }); }
      catch { /* ignore */ }
      skipped++;
    }
  }

  return { ok: true, scanned: alerts.length, spawned, skipped };
}
