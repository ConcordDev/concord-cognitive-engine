// server/lib/conkay/assembly/surface.js
//
// Parametric body. Vertices stay in the vehicle frame (x rearward, y right,
// z up). The viewer converts to three.js Y-up.
//
// The skin is a low-poly quad cage (shoulder, tumblehome, side crown, fender
// bulge, rocker undercut, wrapped nose), mirrored and welded on y = 0, then
// Catmull–Clark subdivided with semi-sharp creases. Arches, the daylight
// opening and the lower intake are holes in the cage. Glass is its own
// subdivided patch, offset 4 mm along the normal. opencascade.js can boot
// here, but a B-rep boolean is not what the viewer sections; pythonocc-core
// is not installable from pip. The subdivided cage is the solid. It is not
// a manufactured Class-A surface.

import { sampleSpline } from "./style.js";
import { buildCageBody, widthAt } from "./cage.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
export const SURFACE_CAP = Object.freeze({ triangles: 200_000, stations: 320, section: 96 });
const GLASS_OFFSET = 0.004;
const ARCH_GAP = 0.032;

function round5(v) { return Math.round(v * 1e5) / 1e5; }

/** Fritsch–Carlson monotone cubic. keys: [{x, v}] strictly increasing. */
function pchip(keys, x) {
  const n = keys.length;
  if (n === 1 || x <= keys[0].x) return keys[0].v;
  if (x >= keys[n - 1].x) return keys[n - 1].v;
  const h = new Array(n - 1);
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = keys[i + 1].x - keys[i].x || 1e-6;
    d[i] = (keys[i + 1].v - keys[i].v) / h[i];
  }
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) / 2;
  const mi = m.slice();
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-12) { mi[i] = 0; mi[i + 1] = 0; continue; }
    const a = mi[i] / d[i];
    const b = mi[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      mi[i] = t * a * d[i];
      mi[i + 1] = t * b * d[i];
    }
  }
  let i = 0;
  while (i < n - 2 && keys[i + 1].x < x) i++;
  const t = (x - keys[i].x) / h[i];
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * keys[i].v + (t3 - 2 * t2 + t) * h[i] * mi[i]
    + (-2 * t3 + 3 * t2) * keys[i + 1].v + (t3 - t2) * h[i] * mi[i + 1];
}

function mergeMax(pairs) {
  const s = pairs.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [x, v] of s) {
    if (!out.length || x - out[out.length - 1].x > 1e-3) out.push({ x, v });
    else out[out.length - 1].v = Math.max(out[out.length - 1].v, v);
  }
  return out.length ? out : [{ x: 0, v: 0 }];
}

/** Lift a curve up to floorFn(x) without a cliff. Neighbours rise at most maxSlope. */
function raiseCurve(pairs, floorFn, maxSlope) {
  const keys = mergeMax(pairs);
  const x0 = keys[0].x;
  const x1 = keys[keys.length - 1].x;
  const xs = [x0];
  for (let x = x0 + 0.02; x < x1 - 1e-4; x += 0.02) xs.push(x);
  xs.push(x1);
  for (const k of keys) xs.push(k.x);
  xs.sort((a, b) => a - b);
  const uniq = [];
  for (const x of xs) if (!uniq.length || x - uniq[uniq.length - 1] > 5e-4) uniq.push(x);
  const ys = uniq.map((x) => {
    const floor = floorFn(x);
    return Math.max(pchip(keys, x), Number.isFinite(floor) ? floor : -Infinity);
  });
  for (let i = 1; i < ys.length; i++) {
    const dx = uniq[i] - uniq[i - 1];
    ys[i] = Math.max(ys[i], ys[i - 1] - maxSlope * dx);
  }
  for (let i = ys.length - 2; i >= 0; i--) {
    const dx = uniq[i + 1] - uniq[i];
    ys[i] = Math.max(ys[i], ys[i + 1] - maxSlope * dx);
  }
  return uniq.map((x, i) => ({ x, v: ys[i] }));
}

const keyCache = new WeakMap();

export function resolveSpec(input) {
  const roofZ = input.roofZ;
  const floorZ = Math.min(input.floorZ, roofZ - 0.08);
  const beltZ = clamp(input.beltZ, floorZ + 0.1, roofZ - 0.045);
  const cowlZ = clamp(input.cowlZ ?? beltZ - 0.09, floorZ + 0.15, beltZ - 0.025);
  const headerZ = clamp(input.headerZ ?? roofZ - 0.012, cowlZ + 0.05, roofZ - 0.004);
  const archGap = clamp(input.archGap ?? ARCH_GAP, 0.025, 0.04);
  const rise = Math.max(0.05, headerZ - cowlZ);
  const run = rise * Math.tan((60 * Math.PI) / 180);
  const archBack = input.frontAxleX + input.tyreRadius + archGap + 0.05;
  let cowlX = Math.max(archBack, (input.ahpX ?? archBack) - 0.12);
  const latestHeader = Math.min(
    (input.bPillarX ?? cowlX + run) - 0.12,
    input.headX != null ? input.headX - 0.22 : cowlX + run + 1,
  );
  let headerX = cowlX + run;
  if (headerX > latestHeader) {
    headerX = Math.max(cowlX + 0.15, latestHeader);
    cowlX = Math.max(input.noseX + 0.2, headerX - run);
  }
  const rakeDeg = Math.atan((headerX - cowlX) / rise) * 180 / Math.PI;
  const kammZ = clamp(input.kammZ ?? (floorZ + (roofZ - floorZ) * 0.48), floorZ + 0.25, roofZ - 0.08);
  return {
    ...input,
    roofZ, floorZ, beltZ, cowlZ, headerZ, cowlX, headerX, archGap, rakeDeg,
    kammZ, kammRatio: input.kammRatio ?? 0.45,
    roofHoldX: input.roofHoldX ?? input.rearAxleX,
    openings: undefined,
  };
}

function keysOf(spec) {
  let hit = keyCache.get(spec);
  if (hit) return hit;
  const S = spec;
  const nose = S.noseX;
  const tail = S.tailX;
  const ax = S.frontAxleX;
  const rx = S.rearAxleX;
  const R = S.tyreRadius + S.archGap;
  const archTop = S.tyreCenterZ + R;
  const hw = S.halfWidth;
  const kammX = S.kammX || (tail - Math.min(0.16, (tail - rx) * 0.25));
  if (Array.isArray(S.crownKeys) && S.crownKeys.length > 3 && Array.isArray(S.planKeys) && Array.isArray(S.shoulderKeys)) {
    hit = {
      kammX,
      archTop,
      crown: sampleSpline(S.crownKeys, 0.025),
      shy: sampleSpline(S.planKeys, 0.025),
      shz: sampleSpline(S.shoulderKeys, 0.025),
    };
    keyCache.set(spec, hit);
    return hit;
  }
  const kY = hw * Math.sqrt(clamp(S.kammRatio, 0.25, 0.75));
  const hoodAxle = Math.min(archTop - 0.035, S.cowlZ - 0.06);
  const bands = (Array.isArray(S.clearance) ? S.clearance : []).filter((b) => Number.isFinite(b.x0) && Number.isFinite(b.x1) && Number.isFinite(b.z));
  const inBand = (x) => bands.filter((b) => x >= b.x0 && x <= b.x1);
  const crownFloor = (x) => {
    let z = -Infinity;
    for (const b of inBand(x)) z = Math.max(z, b.z + 0.03);
    return z;
  };
  // Fender is full width ahead of the arch so the opening is cut into skin, not a gap.
  const archFront = ax - R;
  const crown = raiseCurve([
    [nose, S.noseTipZ],
    [lerp(nose, ax, 0.35), S.noseTipZ + 0.06],
    [ax, hoodAxle],
    [lerp(ax, S.cowlX, 0.55), lerp(hoodAxle, S.cowlZ, 0.65)],
    [S.cowlX, S.cowlZ],
    [S.headerX, S.roofZ],
    [Math.min(S.roofHoldX, rx), S.roofZ],
    [rx, S.roofZ - 0.01],
    [lerp(rx, kammX, 0.55), lerp(S.roofZ, S.kammZ, 0.62)],
    [kammX, S.kammZ],
    [tail, S.kammZ - 0.015],
  ], crownFloor, 1.55);
  const shy = raiseCurve([
    [nose, hw * 0.22],
    [lerp(nose, archFront, 0.45), hw * 0.55],
    [archFront - 0.04, hw * 0.97],
    [ax, hw],
    [ax + R + 0.02, hw * 0.995],
    [S.cowlX, hw * 0.995],
    [S.bPillarX, hw * 0.99],
    [rx, hw * 0.985],
    [kammX, kY],
    [tail, kY * 0.94],
  ], (x) => {
    let y = -Infinity;
    for (const b of inBand(x)) if (Number.isFinite(b.y)) y = Math.max(y, b.y + 0.06);
    return y;
  }, 2.4);
  const shz = raiseCurve([
    [nose, S.noseTipZ + 0.045],
    [archFront, archTop + 0.012],
    [ax, archTop + 0.016],
    [ax + R, archTop + 0.012],
    [S.cowlX, S.beltZ],
    [S.headerX, S.beltZ],
    [rx, S.beltZ - 0.01],
    [kammX, S.kammZ * 0.78],
    [tail, S.kammZ * 0.62],
  ], (x) => {
    const cap = pchip(crown, x) - 0.03;
    let z = -Infinity;
    for (const b of inBand(x)) z = Math.max(z, b.z + 0.012);
    return Number.isFinite(z) ? Math.min(z, cap) : -Infinity;
  }, 1.55);
  hit = { kammX, archTop, crown, shy, shz };
  keyCache.set(spec, hit);
  return hit;
}

function prof(spec, x) {
  const k = keysOf(spec);
  const cap = spec.roofZ;
  const crownZ = clamp(pchip(k.crown, x), spec.floorZ + 0.02, cap);
  const shoulderY = Math.max(0.05, pchip(k.shy, x));
  let shoulderZ = Math.max(spec.floorZ + 0.05, pchip(k.shz, x));
  const rise = clamp((x - (spec.cowlX || x)) / Math.max(0.4, (spec.rearAxleX || x) - (spec.cowlX || x)), 0, 1);
  const belt = Math.min(spec.beltZ + (spec.beltRiseM ?? 0.032) * rise, Math.max(shoulderZ, crownZ) - 0.01);
  const glassH = Math.max(0, crownZ - belt);
  const tumble = ((spec.tumblehomeDeg ?? 14) * Math.PI) / 180;
  const inset = glassH * Math.tan(tumble);
  const railY = clamp(shoulderY - inset, shoulderY * 0.62, shoulderY * 0.96);
  const railZ = shoulderZ > crownZ + 0.01
    ? lerp(crownZ, shoulderZ, 0.5)
    : clamp(crownZ - Math.min(0.02, glassH * 0.15), Math.min(shoulderZ, belt) + 0.008, crownZ - 0.006);
  const rockerY = clamp(Math.min(shoulderY * 0.72, spec.track / 2 - spec.tyreHalfWidth - 0.03), shoulderY * 0.42, shoulderY * 0.82);
  const rockerZ = spec.floorZ + 0.042;
  return { x, crownZ, shoulderY, shoulderZ, railY, railZ, rockerY, rockerZ, floorZ: spec.floorZ, beltZ: belt };
}

export function crownAt(spec, x) {
  const S = resolveSpec(spec);
  if (Array.isArray(S.limitCrown) && S.limitCrown.length > 3) return pchip(S.limitCrown, x);
  return prof(S, x).crownZ;
}

export function skinApertureTop(spec, x0, x1) {
  const S = resolveSpec(spec);
  let m = -Infinity;
  const a = Math.min(x0, x1);
  const b = Math.max(x0, x1);
  for (let i = 0; i <= 24; i++) m = Math.max(m, prof(S, a + (b - a) * (i / 24)).railZ);
  return m;
}

/** Half-width of the outer envelope at (x, z). Used for containment, not the sheet-metal hole.
 *  Below the rocker the underbody spans the full rocker width. A screening box
 *  that only dips under the floor is not "outside" sideways. */
export function sectionHalfWidth(spec, x, z) {
  const S = resolveSpec(spec);
  if (S.limitWidth?.xs?.length) {
    const y = widthAt(S.limitWidth, x, z);
    if (Number.isFinite(y)) {
      // The floor panel tucks in under the rocker. Below the rocker the
      // envelope is that rocker's limit-surface width, same rule as the
      // spline section: a box in the underbody is not outside sideways.
      const rockerZ = prof(S, x).rockerZ;
      if (z <= rockerZ + 0.01) {
        const rocker = widthAt(S.limitWidth, x, rockerZ);
        if (Number.isFinite(rocker)) return Math.max(y, rocker);
      }
      return y;
    }
  }
  const p = prof(S, x);
  if (z <= p.rockerZ) return p.rockerY;
  if (z <= p.shoulderZ) return lerp(p.rockerY, p.shoulderY, (z - p.rockerZ) / (p.shoulderZ - p.rockerZ || 1));
  if (z <= p.railZ) return lerp(p.shoulderY, p.railY, (z - p.shoulderZ) / (p.railZ - p.shoulderZ || 1));
  return lerp(p.railY, 0.02, clamp((z - p.railZ) / (p.crownZ - p.railZ || 1), 0, 1));
}

/**
 * Screening box vs the loft. The center and the top must sit inside the
 * section; the box may hang below the floor (a manikin half-height is an
 * allowance, not a body under the ground). A top that clears the crown at
 * the box's own x-extent is a real penetration.
 */
export function boxInsideEnvelope(spec, placement, half, tol = 0.05) {
  if (!spec || !placement || !half) return false;
  const S = resolveSpec(spec);
  const x = placement.x;
  const y = placement.y;
  const z = placement.z;
  const hx = half[0];
  const hy = half[1];
  const hz = half[2];
  if (x - hx < S.noseX - tol || x + hx > S.tailX + tol) return false;
  if (z < S.floorZ - 0.08) return false;
  const samples = [x - hx, x, x + hx].map((xx) => clamp(xx, S.noseX, S.tailX));
  const crowns = samples.map((xx) => crownAt(S, xx));
  const crownAtCenter = crowns[1];
  if (z > crownAtCenter + tol) return false;
  if (crowns.some((crown) => z + hz > crown + tol)) return false;
  const widthOk = (zz) => Math.abs(y) + hy <= sectionHalfWidth(S, x, clamp(zz, S.floorZ, crownAtCenter)) + tol;
  return widthOk(z) && widthOk(Math.min(z + hz, crownAtCenter));
}

/** Box test, or a skin-following centreline when the part carries a spine. */
export function partInsideEnvelope(spec, part, tol = 0.05) {
  if (!part) return false;
  if (Array.isArray(part.spine) && part.spine.length) {
    const S = resolveSpec(spec);
    const hy = part.section?.[0] ?? 0.015;
    const hz = part.section?.[1] ?? 0.015;
    for (const pt of part.spine) {
      const x = pt[0];
      const y = pt[1];
      const z = pt[2];
      if (x < S.noseX - tol || x > S.tailX + tol) return false;
      const p = prof(S, x);
      if (z + hz > crownAt(S, x) + tol) return false;
      if (z - hz < S.floorZ - 0.08) return false;
      const zz = clamp(z, S.floorZ, p.crownZ);
      if (Math.abs(y) + hy > sectionHalfWidth(S, x, zz) + tol) return false;
    }
    return true;
  }
  return boxInsideEnvelope(spec, part.placement, part.half, tol);
}

export function pointInsideEnvelope(spec, x, y, z, tol = 0.04) {
  const S = resolveSpec(spec);
  if (x < S.noseX - tol || x > S.tailX + tol) return false;
  const p = prof(S, x);
  if (z > crownAt(S, x) + tol || z < -tol) return false;
  return Math.abs(y) <= sectionHalfWidth(S, x, z) + tol;
}

function cowlCurve(spec, t) {
  const p = prof(spec, spec.cowlX);
  const a = Math.abs(t);
  return { x: spec.cowlX, y: Math.sign(t || 1) * p.shoulderY * a, z: lerp(spec.cowlZ, p.shoulderZ, a ** 1.08) };
}
function headerCurve(spec, t) {
  const p = prof(spec, spec.headerX);
  const a = Math.abs(t);
  return { x: spec.headerX, y: Math.sign(t || 1) * p.railY * a, z: lerp(spec.headerZ, p.railZ, a ** 1.15) };
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function norm(n) {
  const L = Math.hypot(n.x, n.y, n.z) || 1;
  return { x: n.x / L, y: n.y / L, z: n.z / L };
}
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

function faceN(a, b, c) { return cross(sub(b, a), sub(c, a)); }

class Mesh {
  constructor() { this.positions = []; this.normals = []; this.indices = []; }
  add(p, n) {
    const i = this.positions.length / 3;
    this.positions.push(p.x, p.y, p.z);
    const nn = n ? norm(n) : { x: 0, y: 0, z: 1 };
    this.normals.push(nn.x, nn.y, nn.z);
    return i;
  }
  tri(a, b, c) { this.indices.push(a, b, c); }
  get triangles() { return this.indices.length / 3; }
}

function outwardish(p, n, kind) {
  if (kind === "up") return n.z >= 0;
  if (kind === "down") return n.z <= 0;
  if (kind === "rear") return n.x >= 0;
  if (kind === "front") return n.x <= 0;
  if (Math.abs(p.y) < 0.03) return kind === "down" ? n.z <= 0 : n.z >= 0;
  return n.y * p.y > 0;
}

/** Grid patch. sample(u,v) -> point, u and v in 0..1, inclusive vertices nu+1, nv+1. */
function patch(nu, nv, sample, kind) {
  const mesh = new Mesh();
  const ids = [];
  const pts = [];
  for (let i = 0; i <= nu; i++) {
    ids[i] = [];
    pts[i] = [];
    for (let j = 0; j <= nv; j++) {
      const u = i / nu;
      const v = j / nv;
      const du = 1 / nu;
      const dv = 1 / nv;
      const p = sample(u, v);
      const pu = sub(sample(Math.min(1, u + du), v), sample(Math.max(0, u - du), v));
      const pv = sub(sample(u, Math.min(1, v + dv)), sample(u, Math.max(0, v - dv)));
      let n = cross(pu, pv);
      if (!outwardish(p, n, kind)) n = { x: -n.x, y: -n.y, z: -n.z };
      pts[i][j] = p;
      ids[i][j] = mesh.add(p, n);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = ids[i][j];
      const b = ids[i + 1][j];
      const c = ids[i + 1][j + 1];
      const d = ids[i][j + 1];
      const pa = pts[i][j];
      const pb = pts[i + 1][j];
      const pc = pts[i + 1][j + 1];
      let n = faceN(pa, pb, pc);
      const mid = { x: (pa.x + pc.x) / 2, y: (pa.y + pc.y) / 2, z: (pa.z + pc.z) / 2 };
      if (!outwardish(mid, n, kind)) {
        mesh.tri(a, d, c);
        mesh.tri(a, c, b);
      } else {
        mesh.tri(a, b, c);
        mesh.tri(a, c, d);
      }
    }
  }
  return mesh;
}

function concat(dst, src) {
  const base = dst.positions.length / 3;
  dst.positions.push(...src.positions);
  dst.normals.push(...src.normals);
  for (const i of src.indices) dst.indices.push(base + i);
}

function lerpP(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function circleHit(a, b, cx, cz, R) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const fx = a.x - cx;
  const fz = a.z - cz;
  const A = dx * dx + dz * dz;
  if (A < 1e-12) return [];
  const B = 2 * (fx * dx + fz * dz);
  const C = fx * fx + fz * fz - R * R;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)].filter((t) => t >= -1e-4 && t <= 1 + 1e-4).sort((p, q) => p - q);
}

function arcPts(a, b, cx, cz, R) {
  let a0 = Math.atan2(a.z - cz, a.x - cx);
  let a1 = Math.atan2(b.z - cz, b.x - cx);
  let d = a1 - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const n = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 36)));
  const out = [];
  for (let i = 1; i < n; i++) {
    const ang = a0 + d * (i / n);
    const x = cx + R * Math.cos(ang);
    const z = cz + R * Math.sin(ang);
    const t = i / n;
    out.push({ x, y: lerp(a.y, b.y, t), z });
  }
  return out;
}

/** Keep the part of a polygon that lies outside the circle in the x–z plane. */
function clipOutsideCircle(poly, cx, cz, R) {
  const inside = (p) => Math.hypot(p.x - cx, p.z - cz) < R - 1e-5;
  const out = [];
  let enter = null;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ai = inside(a);
    const bi = inside(b);
    const ts = circleHit(a, b, cx, cz, R);
    if (!ai && !bi) out.push(b);
    else if (!ai && bi) {
      const t = ts.length ? ts[0] : 0.5;
      enter = lerpP(a, b, clamp(t, 0, 1));
      out.push(enter);
    } else if (ai && !bi) {
      const t = ts.length ? ts[ts.length - 1] : 0.5;
      const exit = lerpP(a, b, clamp(t, 0, 1));
      if (enter) for (const p of arcPts(enter, exit, cx, cz, R)) out.push(p);
      out.push(exit, b);
      enter = null;
    }
  }
  return out;
}

function emitPoly(mesh, poly, kind) {
  if (poly.length < 3) return;
  const c = poly.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y, z: s.z + p.z }), { x: 0, y: 0, z: 0 });
  c.x /= poly.length; c.y /= poly.length; c.z /= poly.length;
  const ids = poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const r = poly[(i + poly.length - 1) % poly.length];
    let n = cross(sub(q, p), sub(p, r));
    if (!outwardish(p, n, kind)) n = { x: -n.x, y: -n.y, z: -n.z };
    return mesh.add(p, n);
  });
  for (let i = 1; i < ids.length - 1; i++) {
    let n = faceN(poly[0], poly[i], poly[i + 1]);
    if (!outwardish(c, n, kind)) mesh.tri(ids[0], ids[i + 1], ids[i]);
    else mesh.tri(ids[0], ids[i], ids[i + 1]);
  }
}


function sideXs(spec) {
  const R = spec.tyreRadius + spec.archGap;
  const q = spec.quality === "mobile" ? 0.42 : 1;
  const n = (v) => Math.max(3, Math.round(v * q));
  const xs = new Set();
  const add = (x) => {
    if (x >= spec.noseX - 1e-4 && x <= spec.tailX + 1e-4) xs.add(Math.round(clamp(x, spec.noseX, spec.tailX) * 1e4) / 1e4);
  };
  for (const x of [spec.noseX, spec.tailX, spec.frontAxleX, spec.rearAxleX, spec.cowlX, spec.headerX, spec.bPillarX, spec.cPillarX]) add(x);
  const spans = [
    [spec.noseX, spec.frontAxleX - R, n(36)],
    [spec.frontAxleX - R, spec.frontAxleX + R, n(56)],
    [spec.frontAxleX + R, spec.cowlX, n(18)],
    [spec.cowlX, spec.headerX, n(28)],
    [spec.headerX, spec.bPillarX, n(24)],
    [spec.bPillarX, spec.cPillarX || spec.rearAxleX, n(20)],
    [spec.cPillarX || spec.rearAxleX, spec.rearAxleX - R, n(18)],
    [spec.rearAxleX - R, spec.rearAxleX + R, n(48)],
    [spec.rearAxleX + R, spec.tailX, n(26)],
  ];
  for (const [a, b, count] of spans) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let i = 0; i <= count; i++) add(lo + (hi - lo) * (i / Math.max(1, count)));
  }
  for (const axle of [spec.frontAxleX, spec.rearAxleX]) {
    for (let k = 0; k <= 28; k++) {
      const ang = ((18 + 144 * (k / 28)) * Math.PI) / 180;
      add(axle + R * Math.cos(ang));
    }
  }
  const raw = [...xs].sort((a, b) => a - b);
  const out = [];
  for (const x of raw) if (!out.length || x - out[out.length - 1] > 1.2e-3) out.push(x);
  return out;
}

function sectionKnots(spec, x) {
  const p = prof(spec, x);
  const noseT = clamp((spec.frontAxleX - x) / Math.max(1e-3, spec.frontAxleX - spec.noseX), 0, 1);
  const tailT = clamp((x - spec.rearAxleX) / Math.max(1e-3, spec.tailX - spec.rearAxleX), 0, 1);
  const kick = 0.038 * noseT * noseT + 0.028 * tailT * tailT;
  const floorZ = p.floorZ + 0.012 + kick;
  const beltZ = Math.min(p.beltZ, p.shoulderZ - 0.004);
  const railY = Math.min(p.railY, p.shoulderY * 0.98);
  const railZ = Math.min(p.railZ, p.crownZ - 0.004);
  return [
    [0, p.crownZ],
    [railY * 0.4, lerp(p.crownZ, railZ, 0.28)],
    [railY, railZ],
    [lerp(railY, p.shoulderY, 0.62), lerp(railZ, p.shoulderZ, 0.5)],
    [p.shoulderY, p.shoulderZ],
    [p.shoulderY * 0.985, beltZ],
    [lerp(p.shoulderY * 0.97, p.rockerY, 0.5), lerp(beltZ, p.rockerZ, 0.5)],
    [p.rockerY, p.rockerZ],
    [p.rockerY * 0.72, floorZ + 0.016],
    [0, floorZ],
  ];
}

function halfSection(spec, x, s) {
  const knots = sectionKnots(spec, x);
  const seg = [];
  let total = 0;
  for (let i = 0; i < knots.length - 1; i++) {
    const len = Math.hypot(knots[i + 1][0] - knots[i][0], knots[i + 1][1] - knots[i][1]) || 1e-6;
    seg.push(len);
    total += len;
  }
  let remain = clamp(s, 0, 1) * total;
  let i = 0;
  while (i < seg.length - 1 && remain > seg[i]) { remain -= seg[i]; i++; }
  const t = seg[i] > 1e-8 ? remain / seg[i] : 0;
  const sm = t * t * (3 - 2 * t);
  const a = knots[i];
  const b = knots[i + 1];
  return { x, y: lerp(a[0], b[0], sm), z: lerp(a[1], b[1], sm), s: clamp(s, 0, 1) };
}

function v3(mesh, i) {
  return { x: mesh.positions[i * 3], y: mesh.positions[i * 3 + 1], z: mesh.positions[i * 3 + 2] };
}
function n3(mesh, i) {
  return norm({ x: mesh.normals[i * 3], y: mesh.normals[i * 3 + 1], z: mesh.normals[i * 3 + 2] });
}

function makeBuilder() {
  const mesh = new Mesh();
  const map = new Map();
  function addPoint(p) {
    const k = `${Math.round(p.x * 1e5)}|${Math.round(p.y * 1e5)}|${Math.round(p.z * 1e5)}`;
    const hit = map.get(k);
    if (hit != null) return hit;
    const id = mesh.positions.length / 3;
    mesh.positions.push(p.x, p.y, p.z);
    mesh.normals.push(0, 0, 1);
    map.set(k, id);
    return id;
  }
  return { mesh, addPoint };
}

function triOut(mesh, ia, ib, ic, spec) {
  if (ia === ib || ib === ic || ia === ic) return;
  const pa = v3(mesh, ia);
  const pb = v3(mesh, ib);
  const pc = v3(mesh, ic);
  const n = faceN(pa, pb, pc);
  if (Math.hypot(n.x, n.y, n.z) < 1e-12) return;
  const mid = { x: (pa.x + pb.x + pc.x) / 3, y: (pa.y + pb.y + pc.y) / 3, z: (pa.z + pb.z + pc.z) / 3 };
  const c = { x: (spec.noseX + spec.tailX) / 2, y: 0, z: spec.floorZ + (spec.roofZ - spec.floorZ) * 0.38 };
  if (dot(n, sub(mid, c)) < 0) mesh.tri(ia, ic, ib);
  else mesh.tri(ia, ib, ic);
}

function smoothNormals(mesh, spec) {
  const n = mesh.positions.length / 3;
  const acc = new Float64Array(n * 3);
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    const fn = faceN(v3(mesh, a), v3(mesh, b), v3(mesh, c));
    acc[a * 3] += fn.x; acc[a * 3 + 1] += fn.y; acc[a * 3 + 2] += fn.z;
    acc[b * 3] += fn.x; acc[b * 3 + 1] += fn.y; acc[b * 3 + 2] += fn.z;
    acc[c * 3] += fn.x; acc[c * 3 + 1] += fn.y; acc[c * 3 + 2] += fn.z;
  }
  const center = { x: (spec.noseX + spec.tailX) / 2, y: 0, z: spec.floorZ + (spec.roofZ - spec.floorZ) * 0.38 };
  for (let i = 0; i < n; i++) {
    let nx = acc[i * 3];
    let ny = acc[i * 3 + 1];
    let nz = acc[i * 3 + 2];
    const p = v3(mesh, i);
    if (Math.abs(p.y) < 1e-4) ny = 0;
    let L = Math.hypot(nx, ny, nz);
    if (L < 1e-10) {
      const away = sub(p, center);
      L = Math.hypot(away.x, away.y, away.z) || 1;
      nx = away.x / L; ny = Math.abs(p.y) < 1e-4 ? 0 : away.y / L; nz = away.z / L;
      L = 1;
    }
    mesh.normals[i * 3] = nx / L;
    mesh.normals[i * 3 + 1] = ny / L;
    mesh.normals[i * 3 + 2] = nz / L;
  }
}

function archYMin(spec) {
  const track = spec.track || spec.halfWidth * 1.6;
  const half = spec.tyreHalfWidth || 0.12;
  return Math.max(0.5, track / 2 - half - 0.06);
}

function pointInArch(p, spec) {
  if (p.s > 0.88 || Math.abs(p.y) < archYMin(spec)) return false;
  const R = spec.tyreRadius + spec.archGap;
  for (const axle of [spec.frontAxleX, spec.rearAxleX]) {
    if (Math.hypot(p.x - axle, p.z - spec.tyreCenterZ) < R - 1e-4) return true;
  }
  return false;
}

function inGrilleOpening(spec, p) {
  // Lower intake on the nose cap (the forward face). A sleek hood has no
  // vertical bumper in the side loft, so the mouth is not a slot under the hood.
  if (Math.abs(p.x - spec.noseX) > 0.012 || p.z < spec.floorZ + 0.03) return false;
  const pr = prof(spec, spec.noseX);
  const gy = Math.min(spec.grilleHalfY || pr.shoulderY * 0.5, Math.max(0.06, pr.shoulderY * 0.62));
  const gz = Math.max(0.02, spec.grilleHalfZ || 0.04);
  const cz = spec.grilleZ || (pr.floorZ + (pr.crownZ - pr.floorZ) * 0.32);
  if (!(gy > 0.04)) return false;
  return (p.y / gy) ** 2 + ((p.z - cz) / gz) ** 2 < 1;
}

function glassKind(spec, p) {
  const pr = prof(spec, p.x);
  const k = keysOf(spec);
  if (p.x > spec.cowlX && p.x < spec.headerX && p.s < 0.42 && p.z > Math.min(pr.beltZ, pr.shoulderZ) - 0.03) return "ws";
  const onSide = Math.abs(p.y) > pr.railY * 0.5 && p.z > pr.beltZ + 0.004 && p.z < pr.shoulderZ + 0.02;
  if (onSide && p.x > spec.headerX && p.x < spec.bPillarX - 0.03) return "side";
  if (onSide && p.x > spec.bPillarX + 0.03 && p.x < (spec.cPillarX || spec.rearAxleX) - 0.02) return "side";
  const backX = spec.backlightX || Math.max(spec.roofHoldX, (spec.cPillarX || spec.rearAxleX));
  if (p.x > backX && p.x < k.kammX - 0.04 && p.s < 0.22 && p.z > pr.crownZ - 0.09) return "back";
  return "";
}

/** Split a quad on a predicate. Shared edges reuse one cut vertex (cuts map). */
function splitQuad(pts, ids, insideFn, cuts) {
  const n = pts.length;
  const flags = pts.map((p) => insideFn(p));
  const tagged = (p, i) => ({ x: p.x, y: p.y, z: p.z, s: p.s || 0, id: ids[i], inside: flags[i], boundary: false });
  if (flags.every(Boolean)) return { inn: [pts.map(tagged)], out: [] };
  if (flags.every((f) => !f)) return { inn: [], out: [pts.map(tagged)] };
  const loop = [];
  for (let i = 0; i < n; i++) {
    loop.push(tagged(pts[i], i));
    const j = (i + 1) % n;
    if (flags[i] === flags[j]) continue;
    const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
    let cut = cuts.get(key);
    if (!cut) {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 16; k++) {
        const mid = (lo + hi) / 2;
        const p = lerpP(pts[i], pts[j], mid);
        p.s = lerp(pts[i].s || 0, pts[j].s || 0, mid);
        if (insideFn(p) === flags[i]) lo = mid;
        else hi = mid;
      }
      const t = (lo + hi) / 2;
      const p = lerpP(pts[i], pts[j], t);
      p.s = lerp(pts[i].s || 0, pts[j].s || 0, t);
      p.x = Math.round(p.x * 1e5) / 1e5;
      p.y = Math.round(p.y * 1e5) / 1e5;
      p.z = Math.round(p.z * 1e5) / 1e5;
      cut = p;
      cuts.set(key, cut);
    }
    loop.push({ x: cut.x, y: cut.y, z: cut.z, s: cut.s, id: cut.id ?? null, inside: false, boundary: true });
  }
  const take = (wantIn) => {
    const keep = (p) => (wantIn ? (p.inside || p.boundary) : (!p.inside || p.boundary));
    if (loop.every(keep)) return [loop];
    const start = loop.findIndex((p) => !keep(p));
    const polys = [];
    let cur = [];
    for (let k = 1; k <= loop.length; k++) {
      const p = loop[(start + k) % loop.length];
      if (keep(p)) cur.push(p);
      else if (cur.length) {
        if (cur.length >= 3) polys.push(cur);
        cur = [];
      }
    }
    if (cur.length >= 3) polys.push(cur);
    return polys;
  };
  return { inn: take(true), out: take(false) };
}

function fanIds(bld, poly, spec, sink) {
  const ids = poly.map((p) => {
    if (p.id != null) return p.id;
    p.id = bld.addPoint(p);
    return p.id;
  });
  for (let i = 1; i < ids.length - 1; i++) {
    if (sink) sink.push([ids[0], ids[i], ids[i + 1]]);
    else triOut(bld.mesh, ids[0], ids[i], ids[i + 1], spec);
  }
}

function centroidOf(pts) {
  const c = pts.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y, z: s.z + p.z, s: s.s + (p.s || 0) }), { x: 0, y: 0, z: 0, s: 0 });
  const n = pts.length || 1;
  return { x: c.x / n, y: c.y / n, z: c.z / n, s: c.s / n };
}

function addCap(bld, right, left, i, spec, grillePts) {
  const ns = right[i].length - 1;
  const loop = [];
  for (let j = 0; j <= ns; j++) loop.push(right[i][j]);
  for (let j = ns - 1; j >= 1; j--) loop.push(left[i][j]);
  const acc = { x: 0, y: 0, z: 0 };
  for (const id of loop) {
    const p = v3(bld.mesh, id);
    acc.x += p.x; acc.y += p.y; acc.z += p.z;
  }
  const n = loop.length || 1;
  const c = bld.addPoint({ x: acc.x / n, y: acc.y / n, z: acc.z / n });
  const nose = i === 0 && grillePts;
  const cuts = new Map();
  for (let k = 0; k < loop.length; k++) {
    const a = loop[k];
    const b = loop[(k + 1) % loop.length];
    if (!nose) {
      triOut(bld.mesh, c, a, b, spec);
      continue;
    }
    const split = splitQuad(
      [v3(bld.mesh, c), v3(bld.mesh, a), v3(bld.mesh, b)],
      [c, a, b],
      (p) => inGrilleOpening(spec, p),
      cuts,
    );
    for (const poly of split.out) fanIds(bld, poly, spec, null);
    for (const poly of split.inn) for (const p of poly) grillePts.push(p);
  }
}

function boundaryOnce(indices) {
  const map = new Map();
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      const id = key(a, b);
      map.set(id, (map.get(id) || 0) + 1);
    }
  }
  const once = [];
  for (const [id, n] of map) {
    if (n !== 1) continue;
    const [a, b] = id.split("|").map(Number);
    once.push([a, b]);
  }
  return once;
}

function insetArch(p, spec, dist, yIn) {
  const R = spec.tyreRadius + spec.archGap;
  let axle = spec.frontAxleX;
  let best = Infinity;
  for (const ax of [spec.frontAxleX, spec.rearAxleX]) {
    const err = Math.abs(Math.hypot(p.x - ax, p.z - spec.tyreCenterZ) - R);
    if (err < best) { best = err; axle = ax; }
  }
  const dx = p.x - axle;
  const dz = p.z - spec.tyreCenterZ;
  const L = Math.hypot(dx, dz) || 1;
  const side = Math.sign(p.y) || 1;
  return { x: p.x - (dx / L) * dist, y: p.y - side * yIn, z: p.z - (dz / L) * dist };
}

function addArchLips(bld, spec) {
  const mesh = bld.mesh;
  const R = spec.tyreRadius + spec.archGap;
  const edges = boundaryOnce(mesh.indices).filter(([a, b]) => {
    const pa = v3(mesh, a);
    const pb = v3(mesh, b);
    if (Math.abs(pa.y) < archYMin(spec) * 0.85 || Math.abs(pb.y) < archYMin(spec) * 0.85) return false;
    for (const axle of [spec.frontAxleX, spec.rearAxleX]) {
      const da = Math.abs(Math.hypot(pa.x - axle, pa.z - spec.tyreCenterZ) - R);
      const db = Math.abs(Math.hypot(pb.x - axle, pb.z - spec.tyreCenterZ) - R);
      if (da < 0.012 && db < 0.012) return true;
    }
    return false;
  });
  const wellB = makeBuilder();
  for (const [a, b] of edges) {
    const pa = v3(mesh, a);
    const pb = v3(mesh, b);
    const ia = bld.addPoint(insetArch(pa, spec, 0.014, 0.012));
    const ib = bld.addPoint(insetArch(pb, spec, 0.014, 0.012));
    triOut(mesh, a, b, ib, spec);
    triOut(mesh, a, ib, ia, spec);
    const wa = wellB.addPoint(insetArch(pa, spec, 0.014, 0.012));
    const wb = wellB.addPoint(insetArch(pb, spec, 0.014, 0.012));
    const da = wellB.addPoint(insetArch(pa, spec, 0.055, 0.045));
    const db = wellB.addPoint(insetArch(pb, spec, 0.055, 0.045));
    triOut(wellB.mesh, wa, wb, db, spec);
    triOut(wellB.mesh, wa, db, da, spec);
  }
  smoothNormals(wellB.mesh, spec);
  return wellB.mesh;
}

function glassFrom(body, tris, spec) {
  const glass = new Mesh();
  const used = new Set(body.indices);
  const map = new Map();
  const order = [];
  const seen = new Set();
  const take = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (used.has(id)) order.unshift(id);
    else order.push(id);
  };
  for (const t of tris) for (const id of t) if (used.has(id)) take(id);
  for (const t of tris) for (const id of t) take(id);
  const gv = (id) => {
    const hit = map.get(id);
    if (hit != null) return hit;
    const p = v3(body, id);
    const nrm = n3(body, id);
    const gid = glass.add(
      { x: p.x + nrm.x * GLASS_OFFSET, y: p.y + nrm.y * GLASS_OFFSET, z: p.z + nrm.z * GLASS_OFFSET },
      nrm,
    );
    map.set(id, gid);
    return gid;
  };
  for (const id of order) gv(id);
  for (const t of tris) triOut(glass, gv(t[0]), gv(t[1]), gv(t[2]), spec);
  return glass;
}

function buildShell(spec) {
  const xs = sideXs(spec);
  const q = spec.quality === "mobile" ? 0.45 : 1;
  const ns = Math.max(28, Math.round(84 * q));
  const bld = makeBuilder();
  const right = [];
  const left = [];
  const ptsR = [];
  const ptsL = [];
  for (let i = 0; i < xs.length; i++) {
    right[i] = [];
    left[i] = [];
    ptsR[i] = [];
    ptsL[i] = [];
    for (let j = 0; j <= ns; j++) {
      const p = halfSection(spec, xs[i], j / ns);
      ptsR[i][j] = p;
      right[i][j] = bld.addPoint(p);
      if (j === 0 || j === ns) {
        ptsL[i][j] = p;
        left[i][j] = right[i][j];
      } else {
        const m = { x: p.x, y: -p.y, z: p.z, s: p.s };
        ptsL[i][j] = m;
        left[i][j] = bld.addPoint(m);
      }
    }
  }
  const glassTris = [];
  const grillePts = [];
  const cuts = new Map();
  const emitPoly = (poly, sink) => fanIds(bld, poly, spec, sink);
  const emit = (ids, points) => {
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < ns; j++) {
        const quadP = [points[i][j], points[i + 1][j], points[i + 1][j + 1], points[i][j + 1]];
        const quadI = [ids[i][j], ids[i + 1][j], ids[i + 1][j + 1], ids[i][j + 1]];
        const arch = splitQuad(quadP, quadI, (p) => pointInArch(p, spec), cuts);
        if (arch.inn.length) {
          for (const poly of arch.out) emitPoly(poly, null);
          continue;
        }
        const glass = splitQuad(quadP, quadI, (p) => glassKind(spec, p) !== "", cuts);
        if (glass.inn.length) {
          for (const poly of glass.inn) emitPoly(poly, glassTris);
          for (const poly of glass.out) emitPoly(poly, null);
          continue;
        }
        triOut(bld.mesh, quadI[0], quadI[1], quadI[2], spec);
        triOut(bld.mesh, quadI[0], quadI[2], quadI[3], spec);
      }
    }
  };
  emit(right, ptsR);
  emit(left, ptsL);
  addCap(bld, right, left, 0, spec, grillePts);
  addCap(bld, right, left, xs.length - 1, spec, null);
  const archWell = addArchLips(bld, spec);
  smoothNormals(bld.mesh, spec);
  const glass = glassFrom(bld.mesh, glassTris, spec);
  spec.grillePts = grillePts;
  let gx = 0;
  for (const p of grillePts) gx += p.x;
  spec.grilleCutX = grillePts.length ? gx / grillePts.length + 0.012 : spec.noseX + 0.08;
  return { mesh: bld.mesh, archWell, glass, stations: xs.length, section: ns };
}

function grilleMeshWorld(spec) {
  const mesh = new Mesh();
  const pts = spec.grillePts || [];
  if (pts.length < 8) return mesh;
  const zs = pts.map((p) => p.z).sort((a, b) => a - b);
  const z0 = zs[Math.floor(zs.length * 0.12)];
  const z1 = zs[Math.floor(zs.length * 0.88)];
  const slats = 5;
  const span = Math.max(0.02, z1 - z0);
  const xAt = (y, z) => {
    let best = null;
    let bd = Infinity;
    for (const p of pts) {
      const d = (p.y - y) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return (best ? best.x : spec.noseX + 0.08) + 0.012;
  };
  for (let i = 0; i < slats; i++) {
    const z = lerp(z0, z1, (i + 0.5) / slats);
    const band = pts.filter((p) => Math.abs(p.z - z) < span / slats);
    if (band.length < 2) continue;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of band) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const inset = (y1 - y0) * 0.06;
    y0 += inset;
    y1 -= inset;
    const th = span / slats * 0.22;
    const n = 6;
    for (let k = 0; k < n; k++) {
      const ya = lerp(y0, y1, k / n);
      const yb = lerp(y0, y1, (k + 1) / n);
      const xa = xAt(ya, z);
      const xb = xAt(yb, z);
      const corners = [
        { x: xa, y: ya, z: z - th }, { x: xb, y: yb, z: z - th }, { x: xb + 0.008, y: yb, z: z - th }, { x: xa + 0.008, y: ya, z: z - th },
        { x: xa, y: ya, z: z + th }, { x: xb, y: yb, z: z + th }, { x: xb + 0.008, y: yb, z: z + th }, { x: xa + 0.008, y: ya, z: z + th },
      ];
      const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]];
      for (const f of faces) emitPoly(mesh, f.map((t) => corners[t]), "front");
    }
  }
  return mesh;
}

function lampStrip(spec, side, rear) {
  const sample = (u, v) => {
    if (!rear) {
      const x = lerp(spec.noseX + (spec.frontAxleX - spec.noseX) * 0.28, spec.noseX + (spec.frontAxleX - spec.noseX) * 0.7, u);
      const p = prof(spec, x);
      const z = lerp(p.shoulderZ * 0.62, p.shoulderZ * 0.78, v);
      const y = side * lerp(p.shoulderY * 0.32, p.shoulderY * 0.78, u);
      return { x, y: y + side * 0.004, z };
    }
    const k = keysOf(spec);
    const p = prof(spec, k.kammX);
    const z = lerp(spec.kammZ * 0.58, spec.kammZ * 0.8, v);
    const y = side * lerp(p.shoulderY * 0.22, p.shoulderY * 0.72, u);
    return { x: k.kammX + 0.006, y, z };
  };
  return patch(18, 4, sample, rear ? "rear" : "front");
}

function handleBar(spec, side, x) {
  const p = prof(spec, x);
  const y = side * (p.shoulderY + 0.007);
  const z = p.beltZ - 0.018;
  const hx = 0.07;
  const hz = 0.012;
  const mesh = new Mesh();
  const nu = 8;
  const nv = 3;
  concat(mesh, patch(nu, nv, (u, v) => ({
    x: x + (u - 0.5) * 2 * hx,
    y: y + side * Math.sin(v * Math.PI) * 0.006,
    z: z + (v - 0.5) * 2 * hz,
  }), "side"));
  return mesh;
}

function mirrorHousing(spec, side) {
  const x = lerp(spec.cowlX, spec.headerX, 0.42);
  const p = prof(spec, x);
  const y = side * (p.shoulderY + 0.055);
  const z = p.beltZ + 0.055;
  return patch(10, 8, (u, v) => {
    const a = (u - 0.15) * Math.PI * 1.15;
    const b = (v - 0.5) * Math.PI;
    return {
      x: x + Math.cos(a) * 0.09,
      y: y + side * (0.03 + Math.sin(a) * 0.02) + Math.cos(b) * 0.012 * side,
      z: z + Math.sin(b) * 0.035,
    };
  }, "side");
}

function localise(mesh) {
  let cx = 0, cy = 0, cz = 0;
  const n = mesh.positions.length / 3 || 1;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    cx += mesh.positions[i]; cy += mesh.positions[i + 1]; cz += mesh.positions[i + 2];
  }
  cx /= n; cy /= n; cz /= n;
  const pos = mesh.positions.slice();
  for (let i = 0; i < pos.length; i += 3) { pos[i] -= cx; pos[i + 1] -= cy; pos[i + 2] -= cz; }
  let hx = 0, hy = 0, hz = 0;
  for (let i = 0; i < pos.length; i += 3) {
    hx = Math.max(hx, Math.abs(pos[i])); hy = Math.max(hy, Math.abs(pos[i + 1])); hz = Math.max(hz, Math.abs(pos[i + 2]));
  }
  return {
    placement: { x: cx, y: cy, z: cz },
    half: [hx || 0.01, hy || 0.01, hz || 0.01],
    mesh: { positions: pos.map(round5), normals: mesh.normals.map(round5), indices: mesh.indices },
  };
}

function detailList(spec) {
  const out = [];
  const lamp = (id, name, side, rear) => {
    const loc = localise(lampStrip(spec, side, rear));
    out.push({
      id, name, role: "lamp", group: "exterior",
      ...loc,
      material: "lamp",
      note: rear ? "taillamp graphic on the kamm face, offset aft of the skin" : "headlamp graphic on the nose surface, offset outboard of the skin. Not photometry.",
    });
  };
  lamp("LAMP_L", "Headlamp left", -1, false);
  lamp("LAMP_R", "Headlamp right", 1, false);
  lamp("TAIL_L", "Taillamp left", -1, true);
  lamp("TAIL_R", "Taillamp right", 1, true);
  const g = localise(grilleMeshWorld(spec));
  out.push({
    id: "GRILLE", name: "Cooling intake", role: "intake", group: "exterior", ...g, material: "intake",
    note: "lower intake recessed aft of the bumper skin. Width follows the radiator face, clipped to the bumper. Height is an estimated slot, not the full core.",
  });
  const cPost = spec.cPillarX || spec.rearAxleX;
  const doors = [
    ["HANDLE_FL", "Door handle front left", -1, (spec.cowlX + spec.bPillarX) / 2],
    ["HANDLE_FR", "Door handle front right", 1, (spec.cowlX + spec.bPillarX) / 2],
    ["HANDLE_RL", "Door handle rear left", -1, (spec.bPillarX + cPost) / 2],
    ["HANDLE_RR", "Door handle rear right", 1, (spec.bPillarX + cPost) / 2],
  ];
  for (const [id, name, side, x] of doors) {
    const loc = localise(handleBar(spec, side, x));
    out.push({ id, name, role: "handle", group: "exterior", ...loc, material: "trim", note: "flush pull on the beltline, mid-door. Shape is an allowance, not a sourced handle." });
  }
  for (const [id, name, side] of [["MIRROR_L", "Mirror left", -1], ["MIRROR_R", "Mirror right", 1]]) {
    const loc = localise(mirrorHousing(spec, side));
    out.push({
      id, name, role: "mirror", group: "exterior", ...loc, material: "paint",
      note: "housing outboard of the A-pillar, above the belt, so the driver eyellipse looks outboard to it. Mirror glass and the aim are not engineered.",
    });
  }
  return out;
}

function pack(mesh) {
  return {
    positions: mesh.positions.map(round5),
    normals: mesh.normals.map(round5),
    indices: mesh.indices,
  };
}

export function bodyStations(spec) {
  const S = resolveSpec(spec);
  const roles = [
    ["nose", S.noseX], ["front-axle", S.frontAxleX], ["cowl", S.cowlX], ["a-pillar", S.headerX],
    ["b-pillar", S.bPillarX], ["c-pillar", S.cPillarX || S.rearAxleX], ["rear-axle", S.rearAxleX], ["tail", S.tailX],
  ];
  const xs = sideXs(S);
  const wanted = Math.min(18, xs.length);
  const extra = [];
  for (let i = 0; i < wanted; i++) extra.push(xs[Math.round((i * (xs.length - 1)) / (wanted - 1))]);
  const all = new Map();
  for (const [role, x] of roles) all.set(role, x);
  const rows = [...all.entries()].map(([role, x]) => ({ role, ...stationAt(S, x) }));
  // guarantee at least 16 by adding unlabeled samples if the role list is short
  if (rows.length < 16) {
    for (const x of extra) {
      if (rows.length >= 16) break;
      if (rows.some((r) => Math.abs(r.x - x) < 1e-3)) continue;
      rows.push({ role: "station", ...stationAt(S, x) });
    }
  }
  rows.sort((a, b) => a.x - b.x);
  return rows;
}

function stationAt(spec, x) {
  const p = prof(spec, x);
  const r = (v) => Math.round(v * 1e4) / 1e4;
  return { x: r(x), roofZ: r(p.crownZ), floorZ: r(p.floorZ), beltZ: r(Math.min(p.beltZ, p.shoulderZ)), halfWidth: r(p.shoulderY) };
}

export function sectionPoint(spec, x, ang) {
  const S = resolveSpec(spec);
  const p = prof(S, x);
  const a = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const side = a <= Math.PI ? 1 : -1;
  const t = side > 0 ? a / Math.PI : (a - Math.PI) / Math.PI;
  const y = side * p.shoulderY * Math.sin(t * Math.PI);
  const z = lerp(p.crownZ, p.floorZ, t);
  return [x, y, z];
}

export function loftBody(specInput, opts = {}) {
  const spec = resolveSpec(specInput);
  spec.quality = opts.quality === "mobile" ? "mobile" : "full";
  const built = buildCageBody(spec, (x) => prof(spec, x));
  const body = built.mesh;
  const glass = built.glass;
  const details = detailList(spec);
  delete spec.grillePts;
  const tris = body.triangles;
  if (tris > SURFACE_CAP.triangles) {
    // Should not happen at these densities. Kept so a future density bump fails closed.
    throw new Error(`body tessellation ${tris} exceeds ${SURFACE_CAP.triangles}`);
  }
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < body.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], body.positions[i + k]);
      max[k] = Math.max(max[k], body.positions[i + k]);
    }
  }
  const R = spec.tyreRadius + spec.archGap;
  return {
    positions: body.positions.map(round5),
    normals: body.normals.map(round5),
    paint: body.indices,
    glass: pack(glass),
    arch: pack(built.archWell),
    details,
    bounds: { min: min.map(round5), max: max.map(round5) },
    stations: bodyStations(spec),
    capped: { stations: built.stations, section: built.section, triangles: tris, limit: SURFACE_CAP.triangles },
    arches: [spec.frontAxleX, spec.rearAxleX].map((axle) => ({
      x: Math.round(axle * 1e4) / 1e4,
      z: Math.round(spec.tyreCenterZ * 1e4) / 1e4,
      radius: Math.round(R * 1e4) / 1e4,
      gap: spec.archGap,
    })),
    windshield: {
      cowlX: Math.round(spec.cowlX * 1e4) / 1e4,
      headerX: Math.round(spec.headerX * 1e4) / 1e4,
      cowlZ: Math.round(spec.cowlZ * 1e4) / 1e4,
      headerZ: Math.round(spec.headerZ * 1e4) / 1e4,
      rakeFromVerticalDeg: Math.round(spec.rakeDeg * 10) / 10,
    },
    spec,
  };
}

// --- wheel ---------------------------------------------------------------------

function push(arr, x, y, z) { arr.push(round5(x), round5(y), round5(z)); }

/** One wheel, axle along vehicle Y, +Y outboard (right side). Instanced. */
export function wheelMesh(spec) {
  const R = spec.overallDiameterM / 2;
  const rimR = (spec.rimDiameterM || R * 0.7) / 2;
  const side = R - rimR;
  const halfW = spec.sectionWidthM / 2;
  const rimHalf = (spec.rimWidthM || spec.sectionWidthM * 0.7) / 2;
  const rings = 48;
  const profile = [
    [rimR + 0.004, -rimHalf],
    [rimR + side * 0.2, -halfW * 0.92],
    [rimR + side * 0.55, -halfW],
    [R - side * 0.06, -halfW * 0.72],
    [R, -halfW * 0.38],
    [R, 0],
    [R, halfW * 0.38],
    [R - side * 0.06, halfW * 0.72],
    [rimR + side * 0.55, halfW],
    [rimR + side * 0.2, halfW * 0.92],
    [rimR + 0.004, rimHalf],
  ];
  const tire = [];
  const tireN = [];
  const tireIdx = [];
  const pj = profile.length;
  const cr = rimR + side * 0.45;
  for (let i = 0; i < rings; i++) {
    const a = (i / rings) * Math.PI * 2;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    for (const p of profile) {
      push(tire, p[0] * sa, p[1], p[0] * ca);
      const nr = p[0] - cr;
      const ny = p[1];
      const L = Math.hypot(nr, ny) || 1;
      push(tireN, (nr / L) * sa, ny / L, (nr / L) * ca);
    }
  }
  const tvid = (i, j) => (i % rings) * pj + j;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < pj - 1; j++) {
      const a = tvid(i, j);
      const b = tvid(i + 1, j);
      const c = tvid(i + 1, j + 1);
      const d = tvid(i, j + 1);
      tireIdx.push(a, b, c, a, c, d);
    }
  }

  const spokes = spec.spokes || 10;
  const rim = [];
  const rimIdx = [];
  const face = rimHalf * 0.2;
  const hubR = rimR * 0.18;
  const outer = rimR * 0.94;
  const steps = 6;
  for (let s = 0; s < spokes; s++) {
    const ang = (s / spokes) * Math.PI * 2;
    const base = rim.length / 3;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const rad = lerp(hubR, outer, t);
      const w = lerp(0.02, 0.008, t);
      const th = lerp(0.016, 0.007, t);
      const dish = lerp(0.004, 0.02, t);
      const y = face + dish;
      const c = Math.cos(ang);
      const si = Math.sin(ang);
      for (const [tw, ty] of [[w, -th], [-w, -th], [-w, th], [w, th]]) {
        push(rim, si * rad - c * tw, y + ty, c * rad + si * tw);
      }
    }
    for (let i = 0; i < steps; i++) {
      const a = base + i * 4;
      const b = a + 4;
      rimIdx.push(a, b, b + 1, a, b + 1, a + 1);
      rimIdx.push(a + 3, b + 2, b + 3, a + 3, a + 2, b + 2);
      rimIdx.push(a, a + 3, b + 3, a, b + 3, b);
      rimIdx.push(a + 1, b + 1, b + 2, a + 1, b + 2, a + 2);
    }
  }
  // hub cap
  const capSeg = 18;
  const capBase = rim.length / 3;
  for (let i = 0; i <= capSeg; i++) {
    const a = (i / capSeg) * Math.PI * 2;
    push(rim, Math.sin(a) * hubR, face, Math.cos(a) * hubR);
    push(rim, Math.sin(a) * hubR * 0.15, face + 0.018, Math.cos(a) * hubR * 0.15);
  }
  for (let i = 0; i < capSeg; i++) {
    const a = capBase + i * 2;
    rimIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  // barrel
  const seg = 32;
  const barrel = rim.length / 3;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    push(rim, rimR * Math.sin(a), -rimHalf * 0.7, rimR * Math.cos(a));
    push(rim, rimR * Math.sin(a), rimHalf * 0.45, rimR * Math.cos(a));
  }
  for (let i = 0; i < seg; i++) {
    const a = barrel + i * 2;
    rimIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }

  // disc with a hat, plus a U caliper (bridge + two pads), not a box.
  const discR = rimR * 0.86;
  const inner = discR * 0.42;
  const discY = -halfW * 0.02;
  const disc = [];
  const discIdx = [];
  const dSeg = 36;
  for (let i = 0; i <= dSeg; i++) {
    const a = (i / dSeg) * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    push(disc, discR * s, discY, discR * c);
    push(disc, inner * s, discY + 0.01, inner * c);
    push(disc, discR * s, discY - 0.012, discR * c);
    push(disc, inner * s, discY - 0.004, inner * c);
  }
  for (let i = 0; i < dSeg; i++) {
    const a = i * 4;
    discIdx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
    discIdx.push(a + 2, a + 3, a + 6, a + 3, a + 7, a + 6);
    discIdx.push(a, a + 2, a + 4, a + 2, a + 6, a + 4);
    discIdx.push(a + 1, a + 5, a + 3, a + 3, a + 5, a + 7);
  }
  const cal = [];
  const calIdx = [];
  const addRing = (y0, y1, r0, r1, z0, z1) => {
    const b = cal.length / 3;
    push(cal, -r0, y0, z0); push(cal, r0, y0, z0); push(cal, r0, y1, z0); push(cal, -r0, y1, z0);
    push(cal, -r1, y0, z1); push(cal, r1, y0, z1); push(cal, r1, y1, z1); push(cal, -r1, y1, z1);
    const f = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]];
    for (const q of f) calIdx.push(b + q[0], b + q[1], b + q[2], b + q[0], b + q[2], b + q[3]);
  };
  // Pads either side of the disc and a bridge over the crown. A U, not one box.
  const top = discR * 0.78;
  addRing(discY + 0.003, discY + 0.014, 0.02, 0.02, top - 0.028, top + 0.02);
  addRing(discY - 0.02, discY - 0.006, 0.02, 0.02, top - 0.028, top + 0.02);
  const bseg = 10;
  const b0 = cal.length / 3;
  const yOut = discY + 0.014;
  const yIn = discY - 0.02;
  for (let i = 0; i <= bseg; i++) {
    const ang = Math.PI / 2 + lerp(-0.7, 0.7, i / bseg);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const r0 = discR + 0.006;
    const r1 = discR + 0.02;
    push(cal, c * r0, yOut, s * r0);
    push(cal, c * r0, yIn, s * r0);
    push(cal, c * r1, yIn, s * r1);
    push(cal, c * r1, yOut, s * r1);
  }
  for (let i = 0; i < bseg; i++) {
    const a = b0 + i * 4;
    const b = a + 4;
    calIdx.push(a, b, a + 1, a + 1, b, b + 1);
    calIdx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    calIdx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
    calIdx.push(a + 3, b + 3, a, a, b + 3, b);
  }
  return {
    tire: { positions: tire, normals: tireN, indices: tireIdx },
    rim: { positions: rim, indices: rimIdx },
    disc: { positions: disc, indices: discIdx },
    caliper: { positions: cal, indices: calIdx },
    spec: {
      overallDiameterM: spec.overallDiameterM, sectionWidthM: spec.sectionWidthM,
      rimDiameterM: rimR * 2, rimWidthM: rimHalf * 2, spokes, sidewallM: side,
    },
  };
}

export function lampMesh() { return { positions: [], indices: [] }; }
export function grilleMesh() { return { positions: [], indices: [] }; }
