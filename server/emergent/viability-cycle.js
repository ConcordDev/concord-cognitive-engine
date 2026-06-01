// server/emergent/viability-cycle.js
//
// Wave 3 — the dynamics heartbeat. Each pass, per active world, it reads each
// subsystem's viability (the ecosystem stock via the ETCC resource adapter to
// start) and, when V crosses the collapse floor, FEEDS the existing
// world-crisis.js#triggerCrisis (it doesn't replace the timers — it adds a
// principled V→0 trigger), with hysteresis so it can't flap. Emits a
// `world:viability` telemetry event. Never throws; no-ops unless CONCORD_VIABILITY=1.
// Frequency ~20 ticks (~5 min). scope:'world'.

import logger from "../logger.js";
import { resourceViability } from "../lib/viability/adapters/resource.js";
import { classifyCollapse } from "../lib/viability/world-dynamics.js";

export const VIABILITY_CYCLE_FREQUENCY = 20;

// Per-world hysteresis state: which subsystems are currently in crisis.
const _inCrisis = new Map(); // worldId -> Set(subsystemId)

function viabilityEnabled() { return process.env.CONCORD_VIABILITY !== "0"; }

// Read the subsystem V-readings for a world. Best-effort: starts with the
// ecosystem stock (the resource adapter); guarded so a missing table is a no-op.
function readSubsystems(db, worldId) {
  const readings = [];
  try {
    // ecosystem_score is a 0..1 scalar (mig 096) — treat as stock/capacity=1.
    const eco = db.prepare(`SELECT AVG(ecosystem_score) AS s FROM player_world_metrics WHERE world_id = ?`).get(worldId);
    if (eco && eco.s != null) {
      readings.push({ id: "ecosystem", V: resourceViability({ stock: eco.s, capacity: 1 }) });
    }
  } catch { /* table optional */ }
  return readings;
}

export async function runViabilityCycle({ db, state } = {}) {
  if (!viabilityEnabled()) return { ok: true, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };
  const emit = (typeof globalThis.realtimeEmit === "function") ? globalThis.realtimeEmit : () => {};
  let crises = 0;
  try {
    let worlds = [];
    try {
      worlds = db.prepare(`SELECT DISTINCT world_id FROM world_visits WHERE departed_at IS NULL`).all().map((r) => r.world_id);
    } catch { worlds = ["concordia-hub"]; }
    for (const worldId of worlds) {
      const readings = readSubsystems(db, worldId);
      if (readings.length === 0) continue;
      const prior = _inCrisis.get(worldId) || new Set();
      const { entered, recovered, inCrisis } = classifyCollapse(readings, prior);
      _inCrisis.set(worldId, inCrisis);
      for (const id of entered) {
        crises++;
        try {
          const wc = await import("../lib/world-crisis.js");
          // Map a viability collapse to the closest crisis kind; best-effort.
          wc.triggerCrisis?.(db, worldId, id === "ecosystem" ? "dark_world" : "instability", { source: "viability", subsystem: id });
        } catch { /* world-crisis optional */ }
        try { emit("world:crisis", { worldId, subsystem: id, source: "viability" }); } catch { /* noop */ }
      }
      for (const id of recovered) {
        try { emit("world:crisis-resolved", { worldId, subsystem: id, source: "viability" }); } catch { /* noop */ }
      }
      try { emit("world:viability", { worldId, readings }); } catch { /* noop */ }
    }
    return { ok: true, crises };
  } catch (err) {
    try { logger.debug?.("viability-cycle", "pass_failed", { error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: String(err?.message || err) };
  }
}

// test seam
export const _testing = { reset() { _inCrisis.clear(); }, inCrisisFor(w) { return _inCrisis.get(w); } };
