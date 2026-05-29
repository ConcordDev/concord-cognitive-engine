// server/lib/world-gradient-health.js
//
// WS7 — gradient-health telemetry. Answers the two questions that tell you the
// living world is working:
//   1. Is the hub staying low-level (so new players can grind)?
//   2. Are veterans migrating outward (not silting up the hub)?
//
// Buckets alive entities by danger band and reports the level distribution per
// band plus two health booleans. Read-only + crash-safe.

import {
  gradientConfigFor, hubAnchorFor, dangerBandAt, bandLevelRange, distanceFromHub,
} from "./world-gradient.js";

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name); }
  catch { return false; }
}

/** Per-band level distribution + health flags for one world. */
export function worldGradientHealth(db, worldId, worldRow = null) {
  // Self-sufficient: fetch the world's gradient config when not supplied, so the
  // band math matches what the spawner/migration used (not the bare defaults).
  if (!worldRow && db && worldId && tableExists(db, "worlds")) {
    try { worldRow = db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(worldId); } catch { /* optional */ }
  }
  const cfg = gradientConfigFor(worldRow || null);
  const anchor = hubAnchorFor(db, worldId, cfg);
  const bands = Array.from({ length: cfg.bandCount }, (_, b) => {
    const [lo, hi] = bandLevelRange(cfg, b);
    return { band: b, expectedMin: lo, expectedMax: hi, count: 0, avgLevel: 0, maxLevel: 0, _sum: 0 };
  });

  let rows = [];
  if (db && worldId && tableExists(db, "world_npcs")) {
    try {
      rows = db.prepare(`
        SELECT level, x, z FROM world_npcs
        WHERE world_id = ? AND COALESCE(is_dead, 0) = 0 AND x IS NOT NULL AND z IS NOT NULL
        LIMIT 5000
      `).all(worldId);
    } catch { rows = []; }
  }

  for (const r of rows) {
    const b = dangerBandAt(cfg, anchor, r.x, r.z);
    const slot = bands[b];
    if (!slot) continue;
    const lvl = Number(r.level) || 1;
    slot.count++; slot._sum += lvl; if (lvl > slot.maxLevel) slot.maxLevel = lvl;
  }
  for (const s of bands) { s.avgLevel = s.count ? Math.round((s._sum / s.count) * 10) / 10 : 0; delete s._sum; }

  // Health: the hub band's average level sits in its expected window, and outer
  // bands carry higher average level than inner ones (veterans drifting out).
  const hub = bands[0];
  const outer = bands[bands.length - 1];
  const hubLowLevel = hub.count === 0 || hub.avgLevel <= hub.expectedMax + 2;
  const veteransOutward = rows.length === 0 || outer.avgLevel >= hub.avgLevel;

  return {
    worldId,
    config: { worldRadiusM: cfg.worldRadiusM, hubRadiusM: cfg.hubRadiusM, bandCount: cfg.bandCount, frontierLevel: cfg.frontierLevel },
    anchor: { x: anchor.x, z: anchor.z, radiusM: anchor.radiusM },
    total: rows.length,
    bands,
    health: { hubLowLevel, veteransOutward },
  };
}

/** Aggregate health across all worlds with a presence (bounded). */
export function allWorldsGradientHealth(db, { limit = 24 } = {}) {
  if (!db || !tableExists(db, "world_npcs")) return { ok: true, worlds: [] };
  let ids = [];
  try {
    ids = db.prepare(`
      SELECT DISTINCT world_id FROM world_npcs WHERE COALESCE(is_dead, 0) = 0 LIMIT ?
    `).all(limit).map((r) => r.world_id).filter(Boolean);
  } catch { return { ok: true, worlds: [] }; }

  const worlds = ids.map((id) => {
    let worldRow = null;
    try { worldRow = db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(id); } catch { /* optional */ }
    return worldGradientHealth(db, id, worldRow);
  });
  return { ok: true, worlds };
}

export { distanceFromHub };
