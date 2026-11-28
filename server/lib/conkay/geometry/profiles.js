// server/lib/conkay/geometry/profiles.js
//
// Exact plane geometry for ConKay's profile shapes (owner, 2026-11-27: a cup,
// a lamp, a plane, a car — real shapes, with verifiable math).
//
//   extrude  a closed profile (with holes and filleted corners) pushed along an axis
//   revolve  a closed profile in (r, z), or an open outline with a wall, turned about z
//   loft     sections (rectangle, ellipse, NACA 4-digit airfoil) blended along an axis
//
// Everything here is in SI (metres). What is exact and what is not:
//   - polygon area, centroid and second moments: exact (Green's theorem);
//   - circular holes: exact (analytic, not from their tessellation);
//   - fillet arcs and circles drawn as polygons: chord error bounded by
//     ARC_STEP (each arc segment spans ≤ 2°, so a fillet's area is low by at
//     most (1 − sin θ/θ) ≈ θ²/6 = 2.0e-4 of the arc's own sector, far below any
//     manufacturing tolerance) — stated in the shape's notes;
//   - revolve volume: Pappus, V = 2π · A · r̄, exact for the polygon;
//   - loft volume: sections linearly blended point-to-point, A(t) is quadratic
//     in t, so V = Δ · (A0/3 + (B01 + B10)/6 + A1/3) is exact for the ruled loft.

const TAU = 2 * Math.PI;
export const ARC_STEP = (2 * Math.PI) / 180; // 2° per arc segment

// ── polygon basics ────────────────────────────────────────────────────────────
export function signedArea(p) {
  let s = 0;
  for (let i = 0, n = p.length; i < n; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % n]; s += x0 * y1 - x1 * y0; }
  return s / 2;
}
const ccw = (p) => (signedArea(p) < 0 ? p.slice().reverse() : p);

/** Area, centroid and second moments (about the origin) of a simple polygon, CCW-normalised. */
export function polygonMoments(poly) {
  const p = ccw(poly);
  let A = 0, Sx = 0, Sy = 0, Ixx = 0, Iyy = 0, Ixy = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % n];
    const c = x0 * y1 - x1 * y0;
    A += c / 2;
    Sx += (x0 + x1) * c / 6;              // ∫x dA
    Sy += (y0 + y1) * c / 6;              // ∫y dA
    Iyy += (x0 * x0 + x0 * x1 + x1 * x1) * c / 12; // ∫x² dA
    Ixx += (y0 * y0 + y0 * y1 + y1 * y1) * c / 12; // ∫y² dA
    Ixy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c / 24; // ∫xy dA
  }
  return { A, Sx, Sy, Ixx, Iyy, Ixy };
}

/** A circle's moments about the origin (exact). */
export function circleMoments(cx, cy, d) {
  const r = d / 2, A = Math.PI * r * r, I0 = Math.PI * r ** 4 / 4;
  return { A, Sx: A * cx, Sy: A * cy, Ixx: I0 + A * cy * cy, Iyy: I0 + A * cx * cx, Ixy: A * cx * cy };
}

export function circlePoints(cx, cy, d, n = 96) {
  return Array.from({ length: n }, (_, i) => [cx + (d / 2) * Math.cos((TAU * i) / n), cy + (d / 2) * Math.sin((TAU * i) / n)]);
}

// ── fillets ───────────────────────────────────────────────────────────────────
/**
 * Round every corner of a closed polygon with radius r (tangent arcs).
 * Throws when a corner's tangent length exceeds half an adjacent edge.
 */
export function filletPolygon(poly, r) {
  if (!(r > 0)) return poly;
  const p = ccw(poly), n = p.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    const u = norm([a[0] - b[0], a[1] - b[1]]), v = norm([c[0] - b[0], c[1] - b[1]]);
    const cosT = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]));
    const theta = Math.acos(cosT); // angle between the two edges at b
    if (theta < 1e-9 || Math.PI - theta < 1e-9) { out.push(b); continue; }
    const t = r / Math.tan(theta / 2);
    const la = Math.hypot(a[0] - b[0], a[1] - b[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (t > la / 2 + 1e-12 || t > lc / 2 + 1e-12) throw new Error(`fillet radius ${(r * 1000).toPrecision(3)} mm is too large for the corner at (${(b[0] * 1000).toPrecision(4)}, ${(b[1] * 1000).toPrecision(4)}) mm`);
    const p1 = [b[0] + u[0] * t, b[1] + u[1] * t], p2 = [b[0] + v[0] * t, b[1] + v[1] * t];
    const bis = norm([u[0] + v[0], u[1] + v[1]]);
    const dist = r / Math.sin(theta / 2);
    const cx = b[0] + bis[0] * dist, cy = b[1] + bis[1] * dist;
    let a1 = Math.atan2(p1[1] - cy, p1[0] - cx), a2 = Math.atan2(p2[1] - cy, p2[0] - cx);
    // convex corner (left turn on a CCW polygon) sweeps CCW from p1 to p2; reflex sweeps CW
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    let sweep = a2 - a1;
    if (cross > 0) { while (sweep <= 0) sweep += TAU; } else { while (sweep >= 0) sweep -= TAU; }
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP));
    for (let k = 0; k <= steps; k++) { const ang = a1 + (sweep * k) / steps; out.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]); }
  }
  return out;
}
function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

// ── open-outline offset (a cup's wall from its outer surface) ────────────────
/**
 * Offset an open polyline by w to its left (the inside of a profile drawn
 * outward from the axis then up), with mitred joins. Returns the offset points.
 */
export function offsetPolylineLeft(pts, w) {
  const n = pts.length;
  const seg = [];
  for (let i = 0; i < n - 1; i++) {
    const d = norm([pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]]);
    const nl = [-d[1], d[0]];
    seg.push({ p: [pts[i][0] + nl[0] * w, pts[i][1] + nl[1] * w], q: [pts[i + 1][0] + nl[0] * w, pts[i + 1][1] + nl[1] * w] });
  }
  const out = [seg[0].p];
  for (let i = 0; i < seg.length - 1; i++) {
    const x = lineIntersect(seg[i].p, seg[i].q, seg[i + 1].p, seg[i + 1].q);
    out.push(x || seg[i].q);
  }
  out.push(seg[seg.length - 1].q);
  return out;
}
function lineIntersect(p1, p2, p3, p4) {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  if (Math.abs(d) < 1e-15) return null;
  const t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / d;
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
}

// ── sections for lofts ───────────────────────────────────────────────────────
/** NACA 4-digit airfoil ("2412"), chord c, closed trailing edge, cosine spacing; N points around. */
export function nacaPoints(code, c, n = 120) {
  const s = String(code).padStart(4, "0");
  if (!/^\d{4}$/.test(s)) throw new Error(`NACA code must be 4 digits, got "${code}"`);
  const m = Number(s[0]) / 100, p = Number(s[1]) / 10, t = Number(s.slice(2)) / 100;
  if (!(t > 0)) throw new Error("NACA thickness must be more than 00");
  const half = n / 2;
  const xs = Array.from({ length: half + 1 }, (_, i) => (1 - Math.cos((Math.PI * i) / half)) / 2);
  const surf = (x, up) => {
    // closed trailing edge (−0.1036): Abbott & von Doenhoff, Theory of Wing Sections (1959), §6.4
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    let yc = 0, dyc = 0;
    if (m > 0 && p > 0) {
      if (x < p) { yc = (m / (p * p)) * (2 * p * x - x * x); dyc = ((2 * m) / (p * p)) * (p - x); }
      else { yc = (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x); dyc = ((2 * m) / ((1 - p) ** 2)) * (p - x); }
    }
    const th = Math.atan(dyc);
    return up ? [(x - yt * Math.sin(th)) * c, (yc + yt * Math.cos(th)) * c] : [(x + yt * Math.sin(th)) * c, (yc - yt * Math.cos(th)) * c];
  };
  const upper = xs.slice().reverse().map((x) => surf(x, true)); // TE → LE over the top
  const lower = xs.slice(1, -1).map((x) => surf(x, false));      // LE → TE underneath
  return [...upper, ...lower];
}

/** Resample a closed polygon to n points evenly by perimeter, starting at its first point. */
export function resample(poly, n) {
  const L = [0];
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; L.push(L[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = L[L.length - 1], out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (total * k) / n;
    while (L[j + 1] < s) j++;
    const a = poly[j], b = poly[(j + 1) % poly.length], f = (s - L[j]) / ((L[j + 1] - L[j]) || 1);
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

export const LOFT_POINTS = 96;
/** A loft section's points (chordwise a, thickness b), centred as given. */
export function sectionPoints(sec) {
  const n = LOFT_POINTS;
  const off = [sec.offsetA || 0, sec.offsetB || 0];
  const shift = (pts) => pts.map(([a, b]) => [a + off[0], b + off[1]]);
  if (sec.shape === "rect") {
    const w = sec.width / 2, h = sec.height / 2;
    return shift(resample([[w, 0], [w, h], [-w, h], [-w, -h], [w, -h]], n));
  }
  if (sec.shape === "ellipse") return shift(Array.from({ length: n }, (_, i) => [(sec.width / 2) * Math.cos((TAU * i) / n), (sec.height / 2) * Math.sin((TAU * i) / n)]));
  if (sec.shape === "naca") {
    const pts = nacaPoints(sec.naca, sec.chord, n).map(([a, b]) => [a - sec.chord / 4, b]); // quarter chord on the axis
    const tw = ((sec.twist || 0) * Math.PI) / 180;
    return shift(pts.map(([a, b]) => [a * Math.cos(tw) + b * Math.sin(tw), -a * Math.sin(tw) + b * Math.cos(tw)]));
  }
  throw new Error(`unknown section shape "${sec.shape}" (rect, ellipse or naca)`);
}

/** Bilinear shoelace B(P, Q) = ½ Σ (P_i × Q_{i+1}); B(P, P) is P's area. */
function bilinear(P, Q) {
  let s = 0;
  for (let i = 0, n = P.length; i < n; i++) { const j = (i + 1) % n; s += P[i][0] * Q[j][1] - Q[j][0] * P[i][1]; }
  return s / 2;
}
/** Exact volume of a ruled loft between sections (points already corresponded). */
export function loftVolume(stations) {
  let V = 0;
  for (let k = 0; k < stations.length - 1; k++) {
    const P = ccwPair(stations[k].pts), Q = ccwPair(stations[k + 1].pts);
    const dx = Math.abs(stations[k + 1].at - stations[k].at);
    V += dx * (bilinear(P, P) / 3 + (bilinear(P, Q) + bilinear(Q, P)) / 6 + bilinear(Q, Q) / 3);
  }
  return Math.abs(V);
}
const ccwPair = (p) => (signedArea(p) < 0 ? p.slice().reverse() : p);

// ── triangulation (ear clipping, holes bridged in) ───────────────────────────
/** Triangulate a polygon with holes; returns { points, triangles: [i,j,k][] } over the merged ring. */
export function triangulate(outer, holes = []) {
  let ring = ccw(outer).map((p) => [p[0], p[1]]);
  const hs = holes.map((h) => (signedArea(h) > 0 ? h.slice().reverse() : h)).sort((a, b) => maxX(b) - maxX(a));
  for (const h of hs) ring = bridge(ring, h);
  const idx = ring.map((_, i) => i);
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = ring[i0], b = ring[i1], c = ring[i2];
      if (cross3(a, b, c) <= 1e-18) continue; // reflex or degenerate
      let inside = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        const q = ring[j];
        if ((q[0] === a[0] && q[1] === a[1]) || (q[0] === b[0] && q[1] === b[1]) || (q[0] === c[0] && q[1] === c[1])) continue;
        if (pointInTri(q, a, b, c)) { inside = true; break; }
      }
      if (inside) continue;
      tris.push([i0, i1, i2]); idx.splice(k, 1); cut = true; break;
    }
    if (!cut) { // numerically stuck: fan the rest (still covers the area for display)
      for (let k = 1; k < idx.length - 1; k++) tris.push([idx[0], idx[k], idx[k + 1]]);
      break;
    }
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return { points: ring, triangles: tris };
}
const maxX = (h) => Math.max(...h.map((p) => p[0]));
const cross3 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function pointInTri(p, a, b, c) {
  const d1 = cross3(a, b, p), d2 = cross3(b, c, p), d3 = cross3(c, a, p);
  return d1 >= -1e-18 && d2 >= -1e-18 && d3 >= -1e-18;
}
/** Join a hole (CW) into the ring (CCW) through its right-most vertex and a visible ring vertex. */
function bridge(ring, hole) {
  let hi = 0;
  for (let i = 1; i < hole.length; i++) if (hole[i][0] > hole[hi][0]) hi = i;
  const h = hole[hi];
  let best = -1, bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const r = ring[i];
    if (r[0] < h[0]) continue;
    const d = (r[0] - h[0]) ** 2 + (r[1] - h[1]) ** 2;
    if (d < bestD && visible(ring, hole, h, r)) { bestD = d; best = i; }
  }
  if (best < 0) for (let i = 0; i < ring.length; i++) { const r = ring[i]; const d = (r[0] - h[0]) ** 2 + (r[1] - h[1]) ** 2; if (d < bestD) { bestD = d; best = i; } }
  const hr = [...hole.slice(hi), ...hole.slice(0, hi), hole[hi]];
  return [...ring.slice(0, best + 1), ...hr, ring[best], ...ring.slice(best + 1)];
}
function visible(ring, hole, a, b) {
  const segs = [ring, hole];
  for (const poly of segs) {for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    if (p === a || q === a || p === b || q === b) continue;
    if (segCross(a, b, p, q)) return false;
  }}
  return true;
}
function segCross(a, b, c, d) {
  const d1 = cross3(c, d, a), d2 = cross3(c, d, b), d3 = cross3(a, b, c), d4 = cross3(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
