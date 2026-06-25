// server/lib/signal-tomography.js
//
// Signal Tomography / Mesh CT (#23) — reconstructs a spatial field from the REAL
// per-cell sensor readings in embodied_signal_log (lib/embodied/signals.js).
// For a channel, it takes the latest value at each occupied 50m cell, lays them
// on a dense grid spanning their bounding box, and bilinearly fills interior
// gaps from occupied neighbours — a CT-style reconstruction of the actual sensed
// field. Multiple channels stack as layers (the 3rd/voxel dimension). Reads real
// rows only; interpolated cells are flagged so nothing is presented as measured
// when it was inferred.

const MAX_ROWS = 20000; // bound the scan

/** Latest value per (cell_x, cell_z) for a channel, from real non-decayed rows. */
function latestPerCell(db, worldId, channel, nowTs) {
  const rows = db.prepare(`
    SELECT cell_x AS cx, cell_z AS cz, value, observed_at AS at
    FROM embodied_signal_log
    WHERE world_id = ? AND channel = ? AND (decay_at IS NULL OR decay_at >= ?)
    ORDER BY observed_at ASC, rowid ASC LIMIT ?
  `).all(worldId, channel, nowTs, MAX_ROWS);
  const latest = new Map(); // "cx,cz" -> {cx,cz,value}
  for (const r of rows) latest.set(`${r.cx},${r.cz}`, { cx: r.cx, cz: r.cz, value: r.value });
  return [...latest.values()];
}

/** Bounding box of occupied cells. */
function bboxOf(cells) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of cells) {
    if (c.cx < minX) minX = c.cx; if (c.cx > maxX) maxX = c.cx;
    if (c.cz < minZ) minZ = c.cz; if (c.cz > maxZ) maxZ = c.cz;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Inverse-distance-weighted fill for an empty grid cell from the K nearest
 * occupied cells (Shepard interpolation — a standard tomographic gap-fill).
 */
function idwValue(cx, cz, occupied, k = 4) {
  const dists = occupied.map((o) => ({ o, d2: (o.cx - cx) ** 2 + (o.cz - cz) ** 2 })).sort((a, b) => a.d2 - b.d2).slice(0, k);
  let wsum = 0, vsum = 0;
  for (const { o, d2 } of dists) {
    if (d2 === 0) return o.value;
    const w = 1 / d2;
    wsum += w; vsum += w * o.value;
  }
  return wsum ? vsum / wsum : 0;
}

/**
 * Reconstruct one channel into a dense voxel slice. Returns
 * { ok, channel, bbox, voxels:[{cx,cz,value,measured}], summary }.
 */
export function reconstructChannel(db, worldId, channel, { nowTs = null } = {}) {
  if (!db || !worldId || !channel) return { ok: false, reason: "missing_args" };
  const now = Number(nowTs) || Math.floor(Date.now() / 1000);
  const occupied = latestPerCell(db, worldId, channel, now);
  if (!occupied.length) return { ok: true, channel, bbox: null, voxels: [], summary: { measured: 0, interpolated: 0 } };

  const bbox = bboxOf(occupied);
  const occMap = new Map(occupied.map((o) => [`${o.cx},${o.cz}`, o.value]));
  const voxels = [];
  let measured = 0, interpolated = 0, min = Infinity, max = -Infinity, sum = 0;
  for (let cz = bbox.minZ; cz <= bbox.maxZ; cz++) {
    for (let cx = bbox.minX; cx <= bbox.maxX; cx++) {
      const key = `${cx},${cz}`;
      let value, isMeasured;
      if (occMap.has(key)) { value = occMap.get(key); isMeasured = true; measured++; }
      else { value = idwValue(cx, cz, occupied); isMeasured = false; interpolated++; }
      value = Math.round(value * 10000) / 10000;
      voxels.push({ cx, cz, value, measured: isMeasured });
      if (value < min) min = value; if (value > max) max = value; sum += value;
    }
  }
  return {
    ok: true, channel, bbox, voxels,
    summary: { measured, interpolated, min: round(min), max: round(max), mean: round(sum / voxels.length) },
  };
}

/**
 * Reconstruct several channels as stacked layers (the voxel/3rd dimension).
 * Returns { ok, worldId, layers:[{layer, ...reconstructChannel}] }.
 */
export function reconstructVoxels(db, worldId, { channels = null, nowTs = null } = {}) {
  if (!db || !worldId) return { ok: false, reason: "missing_world" };
  let chans = channels;
  if (!chans) {
    chans = db.prepare(`SELECT DISTINCT channel FROM embodied_signal_log WHERE world_id = ? LIMIT 32`).all(worldId).map((r) => r.channel);
  }
  const layers = chans.map((channel, layer) => ({ layer, ...reconstructChannel(db, worldId, channel, { nowTs }) }));
  return { ok: true, worldId, channels: chans, layers };
}

function round(v) { return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : 0; }

export default { reconstructChannel, reconstructVoxels };
