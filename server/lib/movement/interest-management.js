// server/lib/movement/interest-management.js
//
// Speedster S3 — the networking half. Fast movement is solved by INTEREST
// MANAGEMENT, not accurate transport. Three pure mechanisms (wired into
// city-presence, gated by CONCORD_SPEED_AOI; off → fixed 500m radius, no preload):
//
//  1. speed-scaled interest radius — a fast mover sees/is-seen farther ahead so
//     100m-chunk boundary crossings smooth out instead of thrashing subscribe/
//     unsubscribe every ~0.67s (the established "sniper-lens" technique).
//  2. predictive chunk preload — pre-subscribe the chunks speed×T ahead of
//     heading so terrain/NPC/asset streaming arrives BEFORE the player (the fix
//     for outrunning the world into ungenerated void).
//  3. departing-vector on AoI-exit — ship one final {position,velocity} so a slow
//     observer extrapolates a fast mover off-screen instead of freezing on a
//     stale position; reconcile on re-entry.
//
// Pure functions (no globals/DB) → unit-testable headless. Constants are
// CONCORD_AOI_* env dials.

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const dial = (name, def) => num(process.env[name], def);

/**
 * Interest radius (m) for a mover at speedMps: clamp(BASE + k·speed, BASE, MAX).
 * A 16 m/s runner at k=10 → 660m; a 120 m/s speedster → capped at R_MAX.
 */
export function speedScaledRadius(speedMps, { base, k, rMax } = {}) {
  const B = num(base, dial("CONCORD_AOI_BASE_M", 500));
  const K = num(k, dial("CONCORD_AOI_K", 10));
  const M = num(rMax, dial("CONCORD_AOI_MAX_M", 1500));
  const r = B + Math.max(0, num(speedMps, 0)) * K;
  return Math.round(Math.max(B, Math.min(M, r)));
}

/**
 * Chunk coords to PRE-subscribe along the velocity heading, out to
 * speed×lookahead metres ahead. Returns [{cx,cz}] (dedup'd, includes the
 * current chunk). Empty velocity → just the current chunk.
 */
export function predictiveChunks(pos, vel, { lookaheadS, chunkSize, maxChunks } = {}) {
  const T = num(lookaheadS, dial("CONCORD_AOI_LOOKAHEAD_S", 2.0));
  const CS = num(chunkSize, 100);
  const cap = num(maxChunks, dial("CONCORD_AOI_MAX_PRELOAD", 8));
  const x = num(pos?.x, 0), z = num(pos?.z, 0);
  const vx = num(vel?.vx, 0), vz = num(vel?.vz, 0);
  const cur = { cx: Math.floor(x / CS), cz: Math.floor(z / CS) };
  const out = new Map([[`${cur.cx}:${cur.cz}`, cur]]);
  const speed = Math.hypot(vx, vz);
  if (speed < 1e-6) return [...out.values()];
  const reach = speed * T;                       // metres ahead
  const steps = Math.min(cap, Math.max(1, Math.ceil(reach / CS)));
  const ux = vx / speed, uz = vz / speed;        // unit heading
  for (let i = 1; i <= steps; i++) {
    const px = x + ux * i * CS;
    const pz = z + uz * i * CS;
    const c = { cx: Math.floor(px / CS), cz: Math.floor(pz / CS) };
    out.set(`${c.cx}:${c.cz}`, c);
  }
  return [...out.values()];
}

/**
 * The off-screen extrapolation snapshot for an observer losing this mover from
 * their AoI: current position + the velocity to dead-reckon along, so the
 * observer animates it leaving rather than freezing it mid-stride.
 */
export function departingVector(prev, cur, dtMs) {
  const dt = num(dtMs, 0) / 1000;
  const vx = dt > 0 ? (num(cur?.x, 0) - num(prev?.x, 0)) / dt : 0;
  const vy = dt > 0 ? (num(cur?.y, 0) - num(prev?.y, 0)) / dt : 0;
  const vz = dt > 0 ? (num(cur?.z, 0) - num(prev?.z, 0)) / dt : 0;
  return {
    position: { x: num(cur?.x, 0), y: num(cur?.y, 0), z: num(cur?.z, 0) },
    velocity: { vx, vy, vz },
    extrapolate: Math.hypot(vx, vy, vz) > 0.5,   // only worth it if actually moving
  };
}

export default speedScaledRadius;
