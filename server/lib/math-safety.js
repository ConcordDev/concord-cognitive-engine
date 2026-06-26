// server/lib/math-safety.js
//
// Adversarial-hardening: vector / position safety on the hot movement path.
//
// A client (or a memory-injected cheat tool) can ship a position with NaN,
// Infinity, or an absurd out-of-bounds coordinate. If that value lands in the
// presence map it poisons every downstream consumer: spatial chunk keys become
// NaN (Map lookups silently miss), distance maths return NaN (anti-cheat speed
// checks compare NaN > max → false → bypassed), and physics integrators
// propagate the Infinity into every interacting entity. These helpers are the
// cheap, pure, never-throwing guard applied to incoming positions BEFORE they
// are stored.
//
//   sanitizeVector(v, fallback)        -> { x, y, z } with finite components
//   clampToWorldBounds({ x, y, z })    -> { pos, recovered }
//
// Both are pure + total. Velocity-zeroing on recovery is the caller's job —
// these only return the corrected coordinates.

/**
 * Coerce a vector to one with finite x/y/z. Any NaN / Infinity / -Infinity /
 * non-numeric component becomes `fallback`. Never throws.
 *
 * @param {*} v          { x?, y?, z? } (or anything — defends against null)
 * @param {number} [fallback=0]  value substituted for any non-finite component
 * @returns {{ x:number, y:number, z:number }}
 */
export function sanitizeVector(v, fallback = 0) {
  const safeFallback = Number.isFinite(fallback) ? fallback : 0;
  const src = (v && typeof v === "object") ? v : {};
  const fix = (n) => {
    const num = Number(n);
    return Number.isFinite(num) ? num : safeFallback;
  };
  return { x: fix(src.x), y: fix(src.y), z: fix(src.z) };
}

// World extent. Concordia worlds are ~2km square (WORLD_SIZE in
// world-gathering.js); we allow a generous horizontal envelope and a floor
// below which a player has clearly fallen through the terrain heightfield.
export const WORLD_BOUNDS = Object.freeze({
  HORIZONTAL: 1000, // |x|, |z| ceiling (metres from origin)
  FLOOR_Y: -50,     // anything below this has fallen out of the world
  // Safe respawn-ish position when a coordinate escapes the envelope. Near
  // origin so the player lands somewhere valid; the caller is expected to
  // zero velocity so they don't keep flying.
  RESPAWN: Object.freeze({ x: 0, y: 0, z: 0 }),
});

/**
 * Clamp a (already-sanitized) position into the world envelope. If any axis is
 * out of bounds, return a safe respawn position and flag `recovered:true`. A
 * valid position passes straight through with `recovered:false`.
 *
 * NOTE: pass a sanitized vector — a NaN here would make every comparison false
 * and slip through. Callers should `clampToWorldBounds(sanitizeVector(v))`.
 *
 * @param {{ x:number, y:number, z:number }} pos
 * @returns {{ pos:{ x:number, y:number, z:number }, recovered:boolean }}
 */
export function clampToWorldBounds(pos) {
  const p = (pos && typeof pos === "object") ? pos : {};
  const x = Number(p.x), y = Number(p.y), z = Number(p.z);
  const outOfBounds =
    !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) ||
    Math.abs(x) > WORLD_BOUNDS.HORIZONTAL ||
    Math.abs(z) > WORLD_BOUNDS.HORIZONTAL ||
    y < WORLD_BOUNDS.FLOOR_Y;

  if (outOfBounds) {
    return { pos: { ...WORLD_BOUNDS.RESPAWN }, recovered: true };
  }
  return { pos: { x, y, z }, recovered: false };
}

/**
 * Convenience: sanitize then clamp in one call. Returns the corrected position
 * plus whether either stage had to step in.
 *
 * @param {*} v
 * @param {number} [fallback=0]
 * @returns {{ pos:{x,y,z}, recovered:boolean }}
 */
export function safePosition(v, fallback = 0) {
  return clampToWorldBounds(sanitizeVector(v, fallback));
}
