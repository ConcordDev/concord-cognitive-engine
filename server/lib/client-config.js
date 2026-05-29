// server/lib/client-config.js
//
// E0 — server-rendered client dials. The ~24 frontend POLL_MS / TICK_MS /
// FRAME_THROTTLE_MS constants were hardcoded, so tuning any of them needed a
// full frontend rebuild. This exposes them as env-overridable values the client
// fetches once on load (with a baked-in default fallback, so the app still works
// if the fetch fails). Tuning a poll cadence is now a server env change + a
// client refresh — no rebuild.
//
// These are pure presentation/cadence dials — NOT gameplay or economy
// constants. None are constitutional invariants.

function n(envKey, def) {
  const v = Number(process.env[envKey]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

/**
 * The tunable client dials. Keys are stable contract — the frontend
 * useClientConfig hook merges these over its local DEFAULTS, so adding a key
 * here makes it tunable and removing one safely falls back to the client default.
 */
export function getClientConfig() {
  return {
    poll: {
      hordeWaveMs:        n("CONCORD_POLL_HORDE_MS", 1000),
      mahjongMs:          n("CONCORD_POLL_MAHJONG_MS", 800),
      submarineMs:        n("CONCORD_POLL_SUBMARINE_MS", 1000),
      extractionMs:       n("CONCORD_POLL_EXTRACTION_MS", 2000),
      timeLoopMs:         n("CONCORD_POLL_TIMELOOP_MS", 2000),
      climbingMs:         n("CONCORD_POLL_CLIMBING_MS", 2000),
      horrorRoleMs:       n("CONCORD_POLL_HORROR_MS", 2500),
      restaurantMs:       n("CONCORD_POLL_RESTAURANT_MS", 3000),
      themeParkMs:        n("CONCORD_POLL_THEMEPARK_MS", 3000),
      driftAlertMs:       n("CONCORD_POLL_DRIFT_MS", 15000),
      courtshipMs:        n("CONCORD_POLL_COURTSHIP_MS", 30000),
      footprintMs:        n("CONCORD_POLL_FOOTPRINT_MS", 30000),
      forwardPredMs:      n("CONCORD_POLL_FORWARD_PRED_MS", 300000),
      worldHealthMs:      n("CONCORD_POLL_WORLD_HEALTH_MS", 60000),
      partyCombatTickMs:  n("CONCORD_POLL_PARTY_TICK_MS", 200),
      partyCombatDiscMs:  n("CONCORD_POLL_PARTY_DISCOVERY_MS", 1000),
    },
    throttle: {
      courtshipFrameMs:   n("CONCORD_THROTTLE_COURTSHIP_FRAME_MS", 100),
      footprintFrameMs:   n("CONCORD_THROTTLE_FOOTPRINT_FRAME_MS", 200),
    },
  };
}

export const CLIENT_CONFIG_DEFAULTS = Object.freeze(getClientConfig());
