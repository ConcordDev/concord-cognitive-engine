// server/lib/conkay/assembly/surface.js
//
// Parametric body. Vertices stay in the vehicle frame (x rearward, y right,
// z up). The viewer converts to three.js Y-up.
//
// The skin is a set of B-spline patches (monotone cubic through the package
// stations) bounded by character curves: hood centre, fender/shoulder, belt,
// rocker, roof rail, kamm edge. Glass is its own patch on those curves, offset
// a few millimetres outboard. Wheel arches are circular cuts with a lip, not
// a recess in the section. Tessellation is adaptive and capped.

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

function uniqKeys(pairs) {
  const s = pairs.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [x, v] of s) {
    if (!out.length || x - out[out.length - 1].x > 1e-3) out.push({ x, v });
    else out[out.length - 1].v = v;
  }
  return out.length ? out : [{ x: 0, v: 0 }];
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
  const kammX = tail - Math.min(0.16, (tail - rx) * 0.25);
  const kY = hw * Math.sqrt(clamp(S.kammRatio, 0.25, 0.75));
  const hoodAxle = Math.min(archTop - 0.035, S.cowlZ - 0.06);
  hit = {
    kammX,
    archTop,
    crown: uniqKeys([
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
    ]),
    shy: uniqKeys([
      [nose, hw * 0.2],
      [lerp(nose, ax, 0.45), hw * 0.62],
      [ax - R * 0.2, hw * 0.98],
      [ax, hw],
      [S.cowlX, hw * 0.995],
      [S.bPillarX, hw * 0.99],
      [rx, hw * 0.985],
      [kammX, kY],
      [tail, kY * 0.94],
    ]),
    shz: uniqKeys([
      [nose, S.noseTipZ + 0.045],
      [ax - R, archTop + 0.008],
      [ax, archTop + 0.014],
      [ax + R, archTop + 0.01],
      [S.cowlX, S.beltZ],
      [S.headerX, S.beltZ],
      [rx, S.beltZ - 0.01],
      [kammX, S.kammZ * 0.78],
      [tail, S.kammZ * 0.62],
    ]),
  };
  keyCache.set(spec, hit);
  return hit;
}

function prof(spec, x) {
  const k = keysOf(spec);
  const crownZ = clamp(pchip(k.crown, x), spec.floorZ + 0.02, spec.roofZ);
  const shoulderY = Math.max(0.05, pchip(k.shy, x));
  let shoulderZ = pchip(k.shz, x);
  shoulderZ = clamp(shoulderZ, spec.floorZ + 0.05, crownZ - 0.008);
  const railY = shoulderY * (x < spec.headerX ? 0.7 : 0.56);
  const railZ = clamp(crownZ - 0.028, shoulderZ + 0.01, crownZ - 0.012);
  const rockerY = clamp(Math.min(shoulderY * 0.7, spec.track / 2 - spec.tyreHalfWidth - 0.04), shoulderY * 0.42, shoulderY * 0.78);
  const rockerZ = spec.floorZ + 0.042;
  return { x, crownZ, shoulderY, shoulderZ, railY, railZ, rockerY, rockerZ, floorZ: spec.floorZ, beltZ: Math.min(spec.beltZ, shoulderZ) };
}

export function crownAt(spec, x) {
  return prof(resolveSpec(spec), x).crownZ;
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
  const crowns = samples.map((xx) => prof(S, xx).crownZ);
  const crownAtCenter = crowns[1];
  if (z > crownAtCenter + tol) return false;
  if (crowns.some((crown) => z + hz > crown + tol)) return false;
  const widthOk = (zz) => Math.abs(y) + hy <= sectionHalfWidth(S, x, clamp(zz, S.floorZ, crownAtCenter)) + tol;
  return widthOk(z) && widthOk(Math.min(z + hz, crownAtCenter));
}

export function pointInsideEnvelope(spec, x, y, z, tol = 0.04) {
  const S = resolveSpec(spec);
  if (x < S.noseX - tol || x > S.tailX + tol) return false;
  const p = prof(S, x);
  if (z > p.crownZ + tol || z < -tol) return false;
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
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = ids[i][j];
    const b = ids[i + 1][j];
    const c = ids[i + 1][j + 1];
    const d = ids[i][j + 1];
    const pa = pts[i][j];
    const pb = pts[i + 1][j];
    const pc = pts[i + 1][j + 1];
    let n = faceN(pa, pb, pc);
    const mid = { x: (pa.x + pc.x) / 2, y: (pa.y + pc.y) / 2, z: (pa.z + pc.z) / 2 };
    if (!outwardish(mid, n, kind)) mesh.tri(a, d, c), mesh.tri(a, c, b);
    else mesh.tri(a, b, c), mesh.tri(a, c, d);
  }
  return mesh;
}

function concat(dst, src) {
  const base = dst.positions.length / 3;
  dst.positions.push(...src.positions);
  dst.normals.push(...src.normals);
  for (const i of src.indices) dst.indices.push(base + i);
}

function samplesBetween(a, b, n, includeEnd) {
  if (!(b > a + 1e-4) || n < 1) return [];
  const out = [];
  const m = includeEnd ? n : n;
  for (let i = 0; i < m; i++) out.push(a + (b - a) * (i / m));
  return out;
}

function sideXs(spec) {
  const R = spec.tyreRadius + spec.archGap;
  const q = spec.quality === "mobile" ? 0.5 : 1;
  const n = (v) => Math.max(4, Math.round(v * q));
  const bits = [
    [spec.noseX, spec.frontAxleX - R - 0.04, n(16)],
    [spec.frontAxleX - R - 0.04, spec.frontAxleX + R + 0.04, n(36)],
    [spec.frontAxleX + R + 0.04, spec.cowlX, n(12)],
    [spec.cowlX, spec.headerX, n(14)],
    [spec.headerX, spec.bPillarX, n(16)],
    [spec.bPillarX, spec.rearAxleX - R - 0.04, n(14)],
    [spec.rearAxleX - R - 0.04, spec.rearAxleX + R + 0.04, n(36)],
    [spec.rearAxleX + R + 0.04, spec.tailX, n(14)],
  ];
  const xs = new Set([spec.noseX, spec.tailX, spec.frontAxleX, spec.rearAxleX, spec.cowlX, spec.headerX, spec.bPillarX, spec.cPillarX]);
  for (const [a, b, n] of bits) for (const x of samplesBetween(Math.min(a, b), Math.max(a, b), n, false)) xs.add(x);
  return [...xs].filter((x) => x >= spec.noseX - 1e-6 && x <= spec.tailX + 1e-6).sort((a, b) => a - b);
}

function sidePoint(spec, x, v, side) {
  const rocker = underPoint(spec, x, 1, side);
  const p = prof(spec, x);
  // Vertical side: the plan width arrives low, then a small tumblehome.
  // A shallow groove at the belt breaks the highlight into a character line.
  const w = v ** 0.28;
  const tumble = Math.sin(v * Math.PI) * 0.008 * p.shoulderY;
  const beltT = clamp((p.beltZ - rocker.z) / (p.shoulderZ - rocker.z || 1), 0.2, 0.92);
  const groove = Math.exp(-((v - beltT) ** 2) / 0.0009) * 0.0045;
  return {
    x,
    y: side * (Math.abs(lerp(rocker.y, side * p.shoulderY, w)) - groove) + side * tumble,
    z: lerp(rocker.z, p.shoulderZ, v),
  };
}

function underPoint(spec, x, v, side) {
  const p = prof(spec, x);
  const y = side * p.rockerY * v;
  const z = p.floorZ + 0.012 * (1 - v) + 0.008 * v;
  const noseT = clamp((spec.frontAxleX - x) / Math.max(1e-3, spec.frontAxleX - spec.noseX), 0, 1);
  const tailT = clamp((x - spec.rearAxleX) / Math.max(1e-3, spec.tailX - spec.rearAxleX), 0, 1);
  return { x, y, z: z + 0.035 * noseT * noseT + 0.03 * tailT * tailT };
}

function hoodPoint(spec, u, t) {
  if (u >= 0.999) return cowlCurve(spec, t);
  const x = lerp(spec.noseX, spec.cowlX, u);
  const p = prof(spec, x);
  const edge = cowlCurve(spec, t);
  const a = Math.abs(t);
  // Flat crown, late turn-down, so the fender edge reads as a line.
  const y = Math.sign(t || 1) * p.shoulderY * (a ** 0.85);
  const z = lerp(p.crownZ, p.shoulderZ, a ** 2.4);
  const w = u ** 2;
  return { x: lerp(x, edge.x, w), y: lerp(y, edge.y, w), z: lerp(z, edge.z, w) };
}

function roofPoint(spec, u, t) {
  if (u <= 0.001) return headerCurve(spec, t);
  const k = keysOf(spec);
  const x = lerp(spec.headerX, k.kammX, u);
  const p = prof(spec, x);
  const edge = headerCurve(spec, t);
  const a = Math.abs(t);
  const y = Math.sign(t || 1) * p.railY * (a ** 0.72);
  const z = lerp(p.crownZ, p.railZ, a ** 2.6);
  const w = (1 - u) ** 2;
  return { x: lerp(x, edge.x, w), y: lerp(y, edge.y, w), z: lerp(z, edge.z, w) };
}

// --- arch clip ----------------------------------------------------------------

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

function addSide(mesh, spec, side) {
  const xs = sideXs(spec);
  const nv = 16;
  const R = spec.tyreRadius + spec.archGap;
  const pts = xs.map((x) => Array.from({ length: nv + 1 }, (_, j) => sidePoint(spec, x, j / nv, side)));
  const ids = pts.map((row, i) => row.map((p, j) => {
    const i1 = Math.min(xs.length - 1, i + 1);
    const i0 = Math.max(0, i - 1);
    const j1 = Math.min(nv, j + 1);
    const j0 = Math.max(0, j - 1);
    let n = cross(sub(pts[i1][j], pts[i0][j]), sub(row[j1], row[j0]));
    if (!outwardish(p, n, "side")) n = { x: -n.x, y: -n.y, z: -n.z };
    return mesh.add(p, n);
  }));
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < nv; j++) {
    const quad = [pts[i][j], pts[i + 1][j], pts[i + 1][j + 1], pts[i][j + 1]];
    const axle = [spec.frontAxleX, spec.rearAxleX].find((ax) => quad.some((p) => Math.hypot(p.x - ax, p.z - spec.tyreCenterZ) < R - 1e-4));
    const a = ids[i][j];
    const b = ids[i + 1][j];
    const c = ids[i + 1][j + 1];
    const d = ids[i][j + 1];
    if (!axle) {
      const n = faceN(quad[0], quad[1], quad[2]);
      if (!outwardish(quad[0], n, "side")) { mesh.tri(a, d, c); mesh.tri(a, c, b); }
      else { mesh.tri(a, b, c); mesh.tri(a, c, d); }
    } else {
      emitPoly(mesh, clipOutsideCircle(quad, axle, spec.tyreCenterZ, R), "side");
    }
  }
}

function patchClipped(nu, nv, sample, kind, spec) {
  const mesh = new Mesh();
  const pts = [];
  const R = spec.tyreRadius + spec.archGap;
  for (let i = 0; i <= nu; i++) {
    pts[i] = [];
    for (let j = 0; j <= nv; j++) pts[i][j] = sample(i / nu, j / nv);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    let poly = [pts[i][j], pts[i + 1][j], pts[i + 1][j + 1], pts[i][j + 1]];
    for (const axle of [spec.frontAxleX, spec.rearAxleX]) {
      if (poly.length < 3) break;
      if (!poly.some((p) => Math.hypot(p.x - axle, p.z - spec.tyreCenterZ) < R - 1e-4)) continue;
      poly = clipOutsideCircle(poly, axle, spec.tyreCenterZ, R);
    }
    emitPoly(mesh, poly, kind);
  }
  return mesh;
}

function addArchLips(mesh, spec) {
  const well = new Mesh();
  const R = spec.tyreRadius + spec.archGap;
  const cz = spec.tyreCenterZ;
  const a0 = Math.PI + 0.55;
  const a1 = -0.35;
  const segs = 56;
  for (const axle of [spec.frontAxleX, spec.rearAxleX]) {
    for (const side of [1, -1]) {
      const rings = [[], [], []];
      for (let i = 0; i <= segs; i++) {
        const ang = a0 + (a1 - a0) * (i / segs);
        const x = axle + R * Math.cos(ang);
        const z = cz + R * Math.sin(ang);
        const p = prof(spec, x);
        const outer = side * Math.min(p.shoulderY, Math.max(p.rockerY + 0.02, sectionHalfWidth(spec, x, z)));
        const y0 = outer;
        const y1 = outer - side * 0.016;
        const y2 = outer - side * 0.07;
        rings[0].push({ x, y: y0, z });
        rings[1].push({ x: x + (axle - x) * 0.015, y: y1, z: z + (cz - z) * 0.02 });
        rings[2].push({ x: x + (axle - x) * 0.1, y: y2, z: Math.max(spec.floorZ + 0.02, z + (cz - z) * 0.16) });
      }
      for (let i = 0; i < segs; i++) {
        emitPoly(mesh, [rings[0][i], rings[0][i + 1], rings[1][i + 1], rings[1][i]], "side");
        emitPoly(well, [rings[1][i], rings[1][i + 1], rings[2][i + 1], rings[2][i]], "side");
      }
    }
  }
  return well;
}

function fasciaPoint(spec, t, v) {
  const hood = hoodPoint(spec, 0, t);
  const p = prof(spec, spec.noseX);
  const a = Math.abs(t);
  const low = { x: spec.noseX + 0.09 * a ** 1.25, y: Math.sign(t || 1) * p.rockerY * a, z: p.floorZ + 0.025 };
  return lerpP(low, hood, v);
}

function inGrille(spec, y, z) {
  const gy = spec.grilleHalfY || spec.halfWidth * 0.28;
  const gz = spec.grilleHalfZ || 0.05;
  const cz = spec.grilleZ || (spec.floorZ + 0.16);
  return (y / gy) ** 2 + ((z - cz) / gz) ** 2 < 1;
}

function grilleHit(a, b, spec) {
  // sample the segment for ellipse crossings
  let prev = inGrille(spec, a.y, a.z);
  const ts = [];
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = lerpP(a, b, t);
    const now = inGrille(spec, p.y, p.z);
    if (now !== prev) ts.push((i - 0.5) / steps);
    prev = now;
  }
  return ts;
}

function clipOutsideGrille(poly, spec) {
  const inside = (p) => inGrille(spec, p.y, p.z);
  if (!poly.some(inside)) return poly;
  if (poly.every(inside)) return [];
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ai = inside(a);
    const bi = inside(b);
    if (!ai && !bi) out.push(b);
    else if (ai !== bi) {
      const ts = grilleHit(a, b, spec);
      const t = ts.length ? ts[0] : 0.5;
      out.push(lerpP(a, b, clamp(t, 0, 1)));
      if (!bi) out.push(b);
    }
  }
  return out;
}

function addFascia(mesh, spec) {
  const nu = 28;
  const nv = 16;
  const pts = [];
  for (let i = 0; i <= nu; i++) {
    pts[i] = [];
    const t = -1 + 2 * (i / nu);
    for (let j = 0; j <= nv; j++) pts[i][j] = fasciaPoint(spec, t, j / nv);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const quad = [pts[i][j], pts[i + 1][j], pts[i + 1][j + 1], pts[i][j + 1]];
    emitPoly(mesh, clipOutsideGrille(quad, spec), "front");
  }
}

function glassPatch(nu, nv, sample) {
  const mesh = patch(nu, nv, (u, v) => {
    const p = sample(u, v);
    const du = 1 / Math.max(8, nu);
    const dv = 1 / Math.max(8, nv);
    const pu = sub(sample(Math.min(1, u + du), v), sample(Math.max(0, u - du), v));
    const pv = sub(sample(u, Math.min(1, v + dv)), sample(u, Math.max(0, v - dv)));
    const n = norm(cross(pu, pv));
    return { x: p.x + n.x * GLASS_OFFSET, y: p.y + n.y * GLASS_OFFSET, z: p.z + n.z * GLASS_OFFSET };
  }, "up");
  return mesh;
}

function buildGlass(spec) {
  const parts = [];
  parts.push(glassPatch(36, 22, (u, v) => {
    const t = -1 + 2 * u;
    return lerpP(cowlCurve(spec, t), headerCurve(spec, t), v);
  }));
  const sideGlass = (sign, u0, u1) => {
    const mesh = new Mesh();
    const nu = 20;
    const nv = 10;
    const sample = (u, v) => {
      const x = lerp(u0(v), u1, u);
      const p = prof(spec, x);
      const z = lerp(p.beltZ + 0.01, p.railZ - 0.012, v);
      const y = sign * lerp(p.shoulderY * 0.992, p.railY * 1.01, v ** 0.9);
      return { x, y, z };
    };
    concat(mesh, patch(nu, nv, (u, v) => {
      const p = sample(u, v);
      const nrm = norm(cross(
        sub(sample(Math.min(1, u + 0.03), v), sample(Math.max(0, u - 0.03), v)),
        sub(sample(u, Math.min(1, v + 0.05)), sample(u, Math.max(0, v - 0.05))),
      ));
      const n = nrm.y * sign < 0 ? { x: -nrm.x, y: -nrm.y, z: -nrm.z } : nrm;
      return { x: p.x + n.x * GLASS_OFFSET, y: p.y + n.y * GLASS_OFFSET, z: p.z + n.z * GLASS_OFFSET };
    }, "side"));
    return mesh;
  };
  const frontU0 = (v) => lerp(spec.cowlX + 0.04, spec.headerX, v);
  const bPost = spec.bPillarX - 0.045;
  const bPost2 = spec.bPillarX + 0.045;
  const cPost = (spec.cPillarX ?? spec.rearAxleX) - 0.02;
  for (const sign of [1, -1]) {
    parts.push(sideGlass(sign, frontU0, bPost));
    parts.push(sideGlass(sign, () => bPost2, cPost));
  }
  const k = keysOf(spec);
  parts.push(glassPatch(28, 14, (u, v) => {
    const t = -1 + 2 * u;
    const x = lerp(spec.roofHoldX + 0.02, k.kammX - 0.02, v);
    const p = prof(spec, x);
    const a = Math.abs(t) * 0.72;
    return { x, y: Math.sign(t || 1) * p.railY * a, z: lerp(p.crownZ - 0.01, lerp(p.crownZ, p.railZ, 0.85), a) };
  }));
  const glass = new Mesh();
  for (const m of parts) concat(glass, m);
  return glass;
}

function grilleMeshWorld(spec) {
  const gy = spec.grilleHalfY || spec.halfWidth * 0.3;
  const gz = spec.grilleHalfZ || 0.05;
  const cz = spec.grilleZ || spec.floorZ + 0.16;
  const slats = 4;
  const mesh = new Mesh();
  for (let i = 0; i < slats; i++) {
    const z = cz - gz + (2 * gz) * ((i + 0.5) / slats);
    const th = (gz * 2) / slats * 0.28;
    const y0 = -gy * 0.92;
    const y1 = gy * 0.92;
    const x0 = spec.noseX + 0.045;
    const x1 = x0 + 0.012;
    const corners = [
      { x: x0, y: y0, z: z - th }, { x: x1, y: y0, z: z - th }, { x: x1, y: y1, z: z - th }, { x: x0, y: y1, z: z - th },
      { x: x0, y: y0, z: z + th }, { x: x1, y: y0, z: z + th }, { x: x1, y: y1, z: z + th }, { x: x0, y: y1, z: z + th },
    ];
    const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]];
    for (const f of faces) emitPoly(mesh, f.map((k) => corners[k]), "front");
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

function pillarStrip(spec, xAt, halfW, sign) {
  return patch(8, 3, (u, v) => {
    const x = xAt + (u - 0.5) * 2 * halfW;
    const p = prof(spec, x);
    return { x, y: sign * lerp(p.shoulderY * 0.998, p.railY, v), z: lerp(p.beltZ, p.railZ, v) };
  }, "side");
}

function buildBody(spec) {
  const mesh = new Mesh();
  const xs = sideXs(spec);
  concat(mesh, patch(Math.max(8, Math.round(xs.length / 6)), 8, (u, v) => underPoint(spec, lerp(spec.noseX, spec.tailX, u), v, 1), "down"));
  concat(mesh, patch(Math.max(8, Math.round(xs.length / 6)), 8, (u, v) => underPoint(spec, lerp(spec.noseX, spec.tailX, u), v, -1), "down"));
  addSide(mesh, spec, 1);
  addSide(mesh, spec, -1);
  concat(mesh, patchClipped(48, 18, (u, v) => hoodPoint(spec, u, -1 + 2 * v), "up", spec));
  concat(mesh, patch(40, 16, (u, v) => roofPoint(spec, u, -1 + 2 * v), "up"));
  addFascia(mesh, spec);
  const archWell = addArchLips(mesh, spec);
  for (const sign of [1, -1]) {
    concat(mesh, patch(12, 3, (u, v) => {
      const base = lerpP(cowlCurve(spec, sign * 0.92), headerCurve(spec, sign * 0.92), v);
      const p = prof(spec, base.x);
      const y = sign * lerp(p.shoulderY, p.railY, v);
      return { x: base.x + (u - 0.15) * 0.045, y, z: base.z };
    }, "side"));
    concat(mesh, pillarStrip(spec, spec.bPillarX, 0.04, sign));
    concat(mesh, pillarStrip(spec, spec.cPillarX ?? spec.rearAxleX, 0.045, sign));
  }
  // Kamm face.
  const k = keysOf(spec);
  concat(mesh, patch(12, 10, (u, v) => {
    const t = -1 + 2 * u;
    const p = prof(spec, k.kammX);
    const a = Math.abs(t);
    const y = Math.sign(t || 1) * p.shoulderY * a * 0.92;
    const z = lerp(spec.floorZ + 0.08, p.crownZ, v);
    const x = lerp(k.kammX, spec.tailX, 0.15 + 0.85 * (a ** 1.3) * (1 - v * 0.3));
    return { x, y, z };
  }, "rear"));
  return { mesh, archWell };
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
  const built = buildBody(spec);
  const body = built.mesh;
  const glass = buildGlass(spec);
  const details = detailList(spec);
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
  const xs = sideXs(spec);
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
    capped: { stations: xs.length, section: 28, triangles: tris, limit: SURFACE_CAP.triangles },
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
  for (let i = 0; i < rings; i++) for (let j = 0; j < pj - 1; j++) {
    const a = tvid(i, j);
    const b = tvid(i + 1, j);
    const c = tvid(i + 1, j + 1);
    const d = tvid(i, j + 1);
    tireIdx.push(a, b, c, a, c, d);
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
