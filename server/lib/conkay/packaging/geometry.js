// server/lib/conkay/packaging/geometry.js
//
// Deterministic 3-D envelopes for packaging checks. Everything is an
// oriented box (OBB): a centre, half extents along its own axes, and a pitch
// (rotation about the car's y axis, top tilting rearward when positive) and
// yaw (about z). A cylinder (a tyre) is represented by its bounding box,
// which is conservative. Coordinates: x rearward, y to the right, z up, m.
//
// separation(a, b) is the separating-axis test over the 15 candidate axes:
// the largest gap along any axis. A positive value is a LOWER BOUND on the
// true distance between the boxes (the true distance can be larger when the
// closest features are edges or corners); zero or negative means they
// overlap, the value then being minus the smallest penetration depth.
//
// The body shell is an ellipsoid. Inside a convex region the distance to its
// boundary is a concave function, so over a box its minimum is at a corner:
// checking the 8 corners gives a box's exact minimum clearance to the shell
// (and its exact maximum protrusion when outside).

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const rad = (d) => (d * Math.PI) / 180;

/** An oriented box. half = half extents [hx, hy, hz] along its local axes. */
export function obb({ id, center, half, pitchDeg = 0, yawDeg = 0, ...meta }) {
  const p = rad(pitchDeg), w = rad(yawDeg);
  // Pitch about y (top toward +x when positive), then yaw about z.
  const ex0 = [Math.cos(p), 0, -Math.sin(p)];
  const ez0 = [Math.sin(p), 0, Math.cos(p)];
  const yawv = (v) => [v[0] * Math.cos(w) - v[1] * Math.sin(w), v[0] * Math.sin(w) + v[1] * Math.cos(w), v[2]];
  const axes = [yawv(ex0), yawv([0, 1, 0]), yawv(ez0)];
  return { id, center: [...center], half: [...half], axes, pitchDeg, yawDeg, ...meta };
}

/** Axis-aligned box from min/max corners. */
export function aabb({ id, min, max, ...meta }) {
  return obb({ id, center: [0, 1, 2].map((i) => (min[i] + max[i]) / 2), half: [0, 1, 2].map((i) => (max[i] - min[i]) / 2), ...meta });
}

/** A box spanning a segment from p to q in the x-z plane (side view), with a thickness band and a width. */
export function segmentBox({ id, from, to, below, above, width, y = 0, extendStart = 0, extendEnd = 0, ...meta }) {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  // Local x along the segment; local z its upward normal in side view.
  const nx = -uz, nz = ux;
  const nUp = nz >= 0 ? [nx, nz] : [-nx, -nz];
  const mid = (L + extendEnd - extendStart) / 2;
  const offs = (above - below) / 2;
  const c = [from[0] + ux * mid + nUp[0] * offs, y, from[1] + uz * mid + nUp[1] * offs];
  // Express as an OBB whose local x is the segment direction: pitch such that ex = (cos p, 0, -sin p) = (ux, 0, uz).
  const pitchDeg = (Math.atan2(-uz, ux) * 180) / Math.PI;
  return obb({ id, center: c, half: [(L + extendStart + extendEnd) / 2, width / 2, (above + below) / 2], pitchDeg, ...meta });
}

export function corners(b) {
  const out = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) out.push([0, 1, 2].map((i) => b.center[i] + sx * b.half[0] * b.axes[0][i] + sy * b.half[1] * b.axes[1][i] + sz * b.half[2] * b.axes[2][i]));
    }
  }
  return out;
}

export function bounds(b) {
  const cs = corners(b);
  return { min: [0, 1, 2].map((i) => Math.min(...cs.map((c) => c[i]))), max: [0, 1, 2].map((i) => Math.max(...cs.map((c) => c[i]))) };
}

function project(b, L) {
  const c = dot(b.center, L);
  const r = b.half[0] * Math.abs(dot(b.axes[0], L)) + b.half[1] * Math.abs(dot(b.axes[1], L)) + b.half[2] * Math.abs(dot(b.axes[2], L));
  return [c - r, c + r];
}

/** Separating-axis test. Returns { separation (m), axis }. */
export function separation(a, b) {
  const cand = [...a.axes, ...b.axes];
  for (const u of a.axes) for (const v of b.axes) cand.push(cross(u, v));
  let best = -Infinity, bestAxis = null;
  for (const raw of cand) {
    const n = norm(raw);
    if (n < 1e-9) continue;
    const L = raw.map((x) => x / n);
    const [a0, a1] = project(a, L), [b0, b1] = project(b, L);
    const gap = Math.max(b0 - a1, a0 - b1);
    if (gap > best) { best = gap; bestAxis = L; }
  }
  return { separation: best, axis: bestAxis };
}

/** An ellipsoid by centre and semi-axes (axis-aligned). */
export function ellipsoid({ center, semi }) {
  return { center: [...center], semi: [...semi] };
}

/**
 * Signed distance from p to the ellipsoid surface: positive inside, negative
 * outside (Eberly's bisection on the closest-point parameter).
 */
export function signedDistance(ell, p) {
  const e = ell.semi;
  const y = sub(p, ell.center).map((v) => Math.max(Math.abs(v), 1e-9));
  const F = (t) => e.reduce((s, ei, i) => s + ((ei * y[i]) / (t + ei * ei)) ** 2, 0) - 1;
  const f0 = F(0);
  const inside = f0 < 0;
  const k = e.indexOf(Math.min(...e));
  let lo = -e[k] * e[k] + e[k] * y[k];
  let hi = inside ? 0 : Math.hypot(...e.map((ei, i) => ei * y[i]));
  if (!inside) lo = 0;
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    if (F(m) > 0) lo = m; else hi = m;
  }
  const t = (lo + hi) / 2;
  const x = e.map((ei, i) => (ei * ei * y[i]) / (t + ei * ei));
  const d = Math.hypot(...x.map((xi, i) => xi - y[i]));
  return inside ? d : -d;
}

/** Distance along a ray (unit dir) from an interior point to the ellipsoid. */
export function rayToEllipsoid(ell, origin, dir) {
  const o = sub(origin, ell.center).map((v, i) => v / ell.semi[i]);
  const d = dir.map((v, i) => v / ell.semi[i]);
  const A = dot(d, d), B = 2 * dot(o, d), C = dot(o, o) - 1;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const t = (-B + Math.sqrt(disc)) / (2 * A);
  return t >= 0 ? t : null;
}

/** Full lateral width of the ellipsoid at (x, z), or 0 where it has none. */
export function widthAt(ell, x, z) {
  const [a, b, c] = ell.semi;
  const s = 1 - ((x - ell.center[0]) / a) ** 2 - ((z - ell.center[2]) / c) ** 2;
  return s > 0 ? 2 * b * Math.sqrt(s) : 0;
}

/** Height of the ellipsoid's upper surface at (x, y), or null outside its plan. */
export function topAt(ell, x, y) {
  const [a, b, c] = ell.semi;
  const s = 1 - ((x - ell.center[0]) / a) ** 2 - ((y - ell.center[1]) / b) ** 2;
  return s > 0 ? ell.center[2] + c * Math.sqrt(s) : null;
}

/** Minimum signed clearance of a box to the ellipsoid (corners: exact for a convex region). */
export function boxClearanceToShell(ell, b) {
  let min = Infinity, at = null;
  for (const c of corners(b)) {
    const d = signedDistance(ell, c);
    if (d < min) { min = d; at = c; }
  }
  return { clearance: min, corner: at };
}
