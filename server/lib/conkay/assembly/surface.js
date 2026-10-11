// server/lib/conkay/assembly/surface.js
//
// Parametric body loft. Stations come from the solved package (wheelbase,
// track, overall length / width / height, ground clearance, cowl, beltline,
// pillar stations, overhangs, Kamm ratio, fastback). Roof, belt, floor and
// plan width are sampled at the key stations, then Gaussian-smoothed along
// the length (the blur is C-infinity; the cabin roof is held at the solved
// height so the head check is not blurred away). Each section is two
// superellipses that meet at the belt with a shared vertical tangent: a
// near-vertical lower body and a tumblehome greenhouse. The wheel arch is a
// recess in that section so the tyre sits proud of the skin. Tessellation is
// capped. This is a viewing surface, not the OpenCascade B-rep.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const round5 = (v) => Math.round(v * 1e5) / 1e5;

export const SURFACE_CAP = Object.freeze({ stations: 40, section: 48 });

function roofAt(s, x) {
  if (x <= s.cowlX) return lerp(s.noseTipZ, s.beltZ + 0.04, smooth((x - s.noseX) / Math.max(1e-6, s.cowlX - s.noseX)));
  if (x <= s.headerX) return lerp(s.beltZ + 0.04, s.roofZ, smooth((x - s.cowlX) / Math.max(1e-6, s.headerX - s.cowlX)));
  if (x <= s.cPillarX) return s.roofZ;
  const span = Math.max(1e-6, s.tailX - s.cPillarX);
  const dist = x - s.cPillarX;
  const drop = Math.tan(((s.fastbackDeg || 18) * Math.PI) / 180) * dist;
  const kammH = Math.sqrt(clamp(s.kammRatio || 0.45, 0.2, 0.8));
  const tailZ = s.floorZ + (s.roofZ - s.floorZ) * kammH;
  const sloped = s.roofZ - drop;
  return Math.max(tailZ, lerp(sloped, tailZ, smooth(Math.min(1, dist / (span * 0.85)))));
}

function floorAt(s, x) {
  const noseT = clamp((s.frontAxleX - x) / Math.max(1e-6, s.frontAxleX - s.noseX), 0, 1);
  const tailT = clamp((x - s.rearAxleX) / Math.max(1e-6, s.tailX - s.rearAxleX), 0, 1);
  return s.floorZ + 0.05 * smooth(noseT) + 0.04 * smooth(tailT);
}

function beltAt(s, x) {
  if (x <= s.cowlX) return lerp(s.noseTipZ * 0.92, s.beltZ, smooth((x - s.noseX) / Math.max(1e-6, s.cowlX - s.noseX)));
  if (x >= s.cPillarX) {
    const t = smooth((x - s.cPillarX) / Math.max(1e-6, s.tailX - s.cPillarX));
    return lerp(s.beltZ, s.floorZ + (s.roofZ - s.floorZ) * 0.38, t);
  }
  return s.beltZ;
}

function widthAt(s, x) {
  const noseEnd = s.frontAxleX - s.tyreRadius * 0.2;
  const tailStart = s.rearAxleX + s.tyreRadius * 0.35;
  // noseShapeExponent below 2 is sharper than an ellipse (CAD_BODY_DEFAULTS).
  const nosePow = 2 / (s.noseExponent || 1.6);
  if (x <= noseEnd) {
    const t = (x - s.noseX) / Math.max(1e-6, noseEnd - s.noseX);
    return Math.max(s.halfWidth * 0.16, s.halfWidth * smooth(t) ** nosePow);
  }
  if (x >= tailStart) {
    const t = (x - tailStart) / Math.max(1e-6, s.tailX - tailStart);
    const kamm = s.halfWidth * Math.sqrt(clamp(s.kammRatio || 0.45, 0.2, 0.8));
    return lerp(s.halfWidth, kamm, smooth(t));
  }
  return s.halfWidth;
}

/** Key stations, metres, each with a role the greenhouse and the drawings share. */
export function bodyStations(spec) {
  const s = spec;
  const keys = [
    ["nose", s.noseX],
    ["front-overhang", lerp(s.noseX, s.frontAxleX, 0.45)],
    ["front-axle", s.frontAxleX],
    ["cowl", s.cowlX],
    ["a-pillar", s.headerX],
    ["b-pillar", s.bPillarX],
    ["c-pillar", s.cPillarX],
    ["rear-axle", s.rearAxleX],
    ["tail", s.tailX],
  ];
  return keys.map(([role, x]) => ({ role, x, roofZ: roofAt(s, x), floorZ: floorAt(s, x), beltZ: beltAt(s, x), halfWidth: widthAt(s, x) }));
}

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1);
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function nearDoorCut(s, x, z) {
  for (const d of s.openings || []) {
    const o = d.outline;
    if (!o || o.length < 2) continue;
    for (let i = 0; i < o.length; i++) {
      const a = o[i], b = o[(i + 1) % o.length];
      if (distToSeg(x, z, a[0], a[1], b[0], b[1]) < 0.012) return true;
    }
  }
  return false;
}

/** Rocker tuck, wheel-arch recess, fender lip, door cutline. */
function shapeY(s, x, z, y, hw, belt) {
  const sign = Math.sign(y || 1);
  let ay = Math.abs(y);
  const span = Math.max(1e-6, belt - (s.floorZ || 0));
  const rocker = Math.min(ay, Math.max(s.track / 2 - s.tyreHalfWidth - 0.045, hw * 0.58));
  const sillTop = (s.floorZ || 0) + span * 0.28;
  if (z <= sillTop) {
    const t = smooth((z - (s.floorZ || 0)) / Math.max(1e-6, sillTop - (s.floorZ || 0)));
    ay = lerp(Math.min(ay, rocker), ay, t);
  }
  const archZ = s.tyreCenterZ || s.tyreRadius;
  const R = s.tyreRadius * 1.02;
  const inner = Math.max(0.05, s.track / 2 - s.tyreHalfWidth - 0.015);
  const cover = Math.min(hw + 0.01, s.track / 2 + s.tyreHalfWidth + (s.fenderCover || 0.02));
  for (const axle of [s.frontAxleX, s.rearAxleX]) {
    const r = Math.hypot(x - axle, z - archZ);
    if (r < R && z < archZ + s.tyreRadius * 0.72) {
      const depth = smooth(clamp((R - r) / (s.tyreRadius * 0.35), 0, 1));
      ay = lerp(ay, Math.min(ay, inner), depth);
    } else if (r < R + 0.07 && z > archZ && z < archZ + s.tyreRadius * 1.05) {
      const t = 1 - (r - R) / 0.07;
      ay = lerp(ay, Math.max(ay, cover), smooth(t));
    }
  }
  if (z <= belt + 0.005 && nearDoorCut(s, x, z)) ay = Math.max(0, ay - 0.008);
  return sign * ay;
}

function sectionYZ(s, x, ang, belt, roof, floor, hw) {
  const a = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const upperH = Math.max(0.008, roof - belt);
  const lowerH = Math.max(0.02, belt - floor);
  const noseT = clamp((s.cowlX - x) / Math.max(1e-6, s.cowlX - s.noseX), 0, 1);
  const lowerE = 2 / lerp(s.lowerExponent || 6.5, s.noseRoundExponent || 2.8, smooth(noseT));
  const upperE = 2 / lerp(s.upperExponent || 2.8, 2.3, smooth(noseT));
  const crownFrac = lerp(0.56, 0.88, smooth(noseT));
  let y;
  let z;
  if (a <= Math.PI / 2) {
    const tuck = 1 - (1 - crownFrac) * Math.cos(a);
    y = hw * tuck * Math.sin(a) ** upperE;
    z = belt + upperH * Math.cos(a) ** upperE;
  } else if (a <= Math.PI) {
    const theta = a - Math.PI / 2;
    y = hw * Math.cos(theta) ** lowerE;
    z = belt - lowerH * Math.sin(theta) ** lowerE;
  } else if (a <= 3 * Math.PI / 2) {
    const theta = a - Math.PI;
    y = -hw * Math.sin(theta) ** lowerE;
    z = belt - lowerH * Math.cos(theta) ** lowerE;
  } else {
    const phi = a - 3 * Math.PI / 2;
    const tuck = 1 - (1 - crownFrac) * Math.sin(phi);
    y = -hw * tuck * Math.cos(phi) ** upperE;
    z = belt + upperH * Math.sin(phi) ** upperE;
  }
  y = shapeY(s, x, z, y, hw, belt);
  return [y, z];
}

function glassAt(s, x, y, z, belt, roof, hw) {
  if (z < belt + 0.018) return false;
  if (z > roof - 0.028 && Math.abs(y) < hw * 0.5) return false;
  const back = s.cPillarX + (s.tailX - s.cPillarX) * 0.4;
  if (x < s.cowlX + 0.015 || x > back) return false;
  if (x < s.headerX && Math.abs(y) > hw * 0.7) return false;
  if (Math.abs(y) > hw * 0.9) return false;
  if (Math.abs(x - s.bPillarX) < 0.05) return false;
  if (Math.abs(x - s.cPillarX) < 0.055) return false;
  return true;
}

function gauss(values, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3));
  return values.map((_, i) => {
    let w = 0, acc = 0;
    for (let k = -r; k <= r; k++) {
      const j = Math.min(values.length - 1, Math.max(0, i + k));
      const g = Math.exp(-0.5 * (k / sigma) ** 2);
      acc += g * values[j];
      w += g;
    }
    return acc / w;
  });
}

function stationXs(spec, n) {
  const keys = [
    spec.noseX,
    lerp(spec.noseX, spec.frontAxleX, 0.45),
    spec.frontAxleX,
    spec.cowlX,
    spec.headerX,
    spec.bPillarX,
    spec.cPillarX,
    spec.rearAxleX,
    spec.tailX,
  ].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const anchors = [];
  for (const x of keys) if (!anchors.length || x - anchors[anchors.length - 1] > 1e-3) anchors.push(x);
  if (anchors.length >= n) {
    const out = [anchors[0]];
    for (let i = 1; i < n - 1; i++) out.push(anchors[Math.round((i * (anchors.length - 1)) / (n - 1))]);
    out.push(anchors[anchors.length - 1]);
    return out;
  }
  const gaps = anchors.slice(1).map((x, i) => x - anchors[i]);
  const counts = gaps.map((g) => Math.floor((n - anchors.length) * (g / (spec.tailX - spec.noseX || 1))));
  let used = counts.reduce((a, b) => a + b, 0);
  const score = gaps.slice();
  while (used < n - anchors.length) {
    let k = 0;
    for (let i = 1; i < score.length; i++) if (score[i] > score[k]) k = i;
    counts[k] += 1;
    score[k] *= 0.55;
    used += 1;
  }
  const xs = new Set(anchors);
  for (let i = 0; i < counts.length; i++) {
    for (let k = 1; k <= counts[i]; k++) xs.add(anchors[i] + (anchors[i + 1] - anchors[i]) * (k / (counts[i] + 1)));
  }
  return [...xs].sort((a, b) => a - b);
}

function profiles(spec, xs) {
  const rows = xs.map((x) => ({ x, roof: roofAt(spec, x), floor: floorAt(spec, x), belt: beltAt(spec, x), hw: widthAt(spec, x) }));
  for (const [key, sigma] of [["roof", 1.05], ["floor", 0.9], ["belt", 0.95], ["hw", 0.75]]) {
    const g = gauss(rows.map((r) => r[key]), sigma);
    g.forEach((v, i) => { rows[i][key] = v; });
  }
  for (const r of rows) {
    if (r.x >= spec.headerX && r.x <= spec.cPillarX) r.roof = Math.max(r.roof, spec.roofZ);
    r.belt = clamp(r.belt, r.floor + 0.035, r.roof - 0.012);
    r.hw = Math.max(0.05, r.hw);
  }
  return rows;
}

function pushTri(idx, a, b, c) { idx.push(a, b, c); }

/**
 * Tessellate. Returns { positions, normals, paint, glass, bounds }.
 * paint and glass are index lists into positions.
 */
export function loftBody(spec, opts = {}) {
  const stations = Math.min(opts.stations || 36, SURFACE_CAP.stations);
  const section = Math.min(opts.section || 40, SURFACE_CAP.section);
  const rows = profiles(spec, stationXs(spec, stations));
  const nS = rows.length;
  const nA = section;
  const positions = [];
  const glassOf = [];
  for (let i = 0; i < nS; i++) {
    const r = rows[i];
    for (let j = 0; j < nA; j++) {
      const ang = (j / nA) * Math.PI * 2;
      const [y, z] = sectionYZ(spec, r.x, ang, r.belt, r.roof, r.floor, r.hw);
      positions.push(r.x, y, z);
      glassOf.push(glassAt(spec, r.x, y, z, r.belt, r.roof, r.hw));
    }
  }
  const vid = (i, j) => i * nA + (j % nA);
  const paint = [];
  const glass = [];
  for (let i = 0; i < nS - 1; i++) {
    for (let j = 0; j < nA; j++) {
      const a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), d = vid(i, j + 1);
      const g = [a, b, c].filter((k) => glassOf[k]).length >= 2;
      pushTri(g ? glass : paint, a, b, c);
      const g2 = [a, c, d].filter((k) => glassOf[k]).length >= 2;
      pushTri(g2 ? glass : paint, a, c, d);
    }
  }
  const noseC = positions.length / 3;
  const nose = rows[0];
  positions.push(nose.x, 0, (nose.roof + nose.floor) / 2);
  glassOf.push(false);
  const tailC = positions.length / 3;
  const tail = rows[nS - 1];
  positions.push(tail.x, 0, (tail.roof + tail.floor) / 2);
  glassOf.push(false);
  for (let j = 0; j < nA; j++) {
    pushTri(paint, noseC, vid(0, j), vid(0, j + 1));
    pushTri(paint, tailC, vid(nS - 1, j), vid(nS - 1, j + 1));
  }
  const normals = new Array(positions.length).fill(0);
  const accum = (indices) => {
    for (let t = 0; t < indices.length; t += 3) {
      const ia = indices[t] * 3, ib = indices[t + 1] * 3, ic = indices[t + 2] * 3;
      const ax = positions[ib] - positions[ia], ay = positions[ib + 1] - positions[ia + 1], az = positions[ib + 2] - positions[ia + 2];
      const bx = positions[ic] - positions[ia], by = positions[ic + 1] - positions[ia + 1], bz = positions[ic + 2] - positions[ia + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      for (const k of [ia, ib, ic]) { normals[k] += nx; normals[k + 1] += ny; normals[k + 2] += nz; }
    }
  };
  accum(paint);
  accum(glass);
  for (let i = 0; i < normals.length; i += 3) {
    const L = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= L; normals[i + 1] /= L; normals[i + 2] /= L;
  }
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
  }
  const round = (arr) => arr.map((v) => round5(v));
  return {
    positions: round(positions), normals: round(normals), paint, glass,
    bounds: { min: round(min), max: round(max) },
    stations: bodyStations(spec).map((st) => ({
      role: st.role, x: Math.round(st.x * 1e4) / 1e4, roofZ: Math.round(st.roofZ * 1e4) / 1e4,
      floorZ: Math.round(st.floorZ * 1e4) / 1e4, beltZ: Math.round(st.beltZ * 1e4) / 1e4, halfWidth: Math.round(st.halfWidth * 1e4) / 1e4,
    })),
    capped: { stations: nS, section: nA },
  };
}

/** A point on the unsmoothed section, for placing lamps on the nose. */
export function sectionPoint(spec, x, ang) {
  const roof = roofAt(spec, x), floor = floorAt(spec, x), belt = clamp(beltAt(spec, x), floor + 0.03, roof - 0.01);
  const hw = widthAt(spec, x);
  const [y, z] = sectionYZ(spec, x, ang, belt, roof, floor, hw);
  return [x, y, z];
}

function push(arr, x, y, z) { arr.push(round5(x), round5(y), round5(z)); }

function addBox(pos, idx, corners) {
  const b = pos.length / 3;
  for (const p of corners) push(pos, p[0], p[1], p[2]);
  const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2]];
  for (const q of faces) idx.push(b + q[0], b + q[1], b + q[2], b + q[0], b + q[2], b + q[3]);
}

function rotY(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

/** One wheel: tyre, multi-spoke rim, disc, caliper. Axle along Y. Instanced four times. */
export function wheelMesh(spec) {
  const R = spec.overallDiameterM / 2;
  const rimR = (spec.rimDiameterM || (R * 0.68)) / 2;
  const side = R - rimR;
  const halfW = spec.sectionWidthM / 2;
  const rimHalf = (spec.rimWidthM || spec.sectionWidthM * 0.7) / 2;
  const rings = 40;
  const profile = [
    [rimR + 0.004, -rimHalf],
    [rimR + side * 0.22, -halfW * 0.9],
    [rimR + side * 0.55, -halfW * 0.98],
    [R - side * 0.08, -halfW * 0.78],
    [R, -halfW * 0.42],
    [R, 0],
    [R, halfW * 0.42],
    [R - side * 0.08, halfW * 0.78],
    [rimR + side * 0.55, halfW * 0.98],
    [rimR + side * 0.22, halfW * 0.9],
    [rimR + 0.004, rimHalf],
  ];
  const tire = [], tireN = [], tireIdx = [];
  const pj = profile.length;
  const cr = rimR + side * 0.45;
  for (let i = 0; i < rings; i++) {
    const a = (i / rings) * Math.PI * 2;
    const sa = Math.sin(a), ca = Math.cos(a);
    for (const p of profile) {
      push(tire, p[0] * sa, p[1], p[0] * ca);
      const nr = p[0] - cr, ny = p[1];
      const L = Math.hypot(nr, ny) || 1;
      push(tireN, (nr / L) * sa, ny / L, (nr / L) * ca);
    }
  }
  const tvid = (i, j) => (i % rings) * pj + j;
  for (let i = 0; i < rings; i++) for (let j = 0; j < pj - 1; j++) {
    const a = tvid(i, j), b = tvid(i + 1, j), c = tvid(i + 1, j + 1), d = tvid(i, j + 1);
    tireIdx.push(a, b, c, a, c, d);
  }

  const spokes = spec.spokes || 10;
  const rim = [], rimIdx = [];
  const face = rimHalf * 0.15;
  const hubR = rimR * 0.22;
  const outer = rimR * 0.96;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + 0.04;
    const w0 = 0.011, w1 = 0.007, t = 0.01;
    const local = [
      [-w0, face - t, hubR], [w0, face - t, hubR], [w0, face + t, hubR], [-w0, face + t, hubR],
      [-w1, face - t * 0.7, outer], [w1, face - t * 0.7, outer], [w1, face + t * 1.3, outer], [-w1, face + t * 1.3, outer],
    ].map((p) => rotY(p, a));
    addBox(rim, rimIdx, local);
  }
  const capSeg = 16;
  const capBase = rim.length / 3;
  for (let i = 0; i <= capSeg; i++) {
    const a = (i / capSeg) * Math.PI * 2;
    push(rim, Math.sin(a) * hubR, face - 0.006, Math.cos(a) * hubR);
    push(rim, Math.sin(a) * hubR * 0.18, face + 0.012, Math.cos(a) * hubR * 0.18);
  }
  for (let i = 0; i < capSeg; i++) {
    const a = capBase + i * 2;
    const b = a + 2;
    rimIdx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const seg = 28;
  const barrelBase = rim.length / 3;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    for (const y of [-rimHalf * 0.85, rimHalf * 0.55]) push(rim, rimR * Math.sin(a), y, rimR * Math.cos(a));
    for (const y of [-rimHalf * 0.95, rimHalf * 0.72]) push(rim, (rimR + 0.008) * Math.sin(a), y, (rimR + 0.008) * Math.cos(a));
  }
  // barrel: pairs at y0,y1 then flange pairs. Layout per i: 4 verts.
  // Simpler barrel only, two radii already pushed as 4 verts per step — index the inner pair.
  for (let i = 0; i < seg; i++) {
    const a = barrelBase + i * 4;
    const b = barrelBase + (i + 1) * 4;
    rimIdx.push(a, b, a + 1, a + 1, b, b + 1);
    rimIdx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
  }

  const discR = rimR * 0.78, discT = 0.014, discY = -halfW * 0.05;
  const disc = [], discIdx = [];
  const inner = discR * 0.38;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    push(disc, discR * Math.sin(a), discY, discR * Math.cos(a));
    push(disc, inner * Math.sin(a), discY, inner * Math.cos(a));
    push(disc, discR * Math.sin(a), discY - discT, discR * Math.cos(a));
    push(disc, inner * Math.sin(a), discY - discT, inner * Math.cos(a));
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 4;
    discIdx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
    discIdx.push(a + 2, a + 3, a + 6, a + 3, a + 7, a + 6);
    discIdx.push(a, a + 2, a + 4, a + 2, a + 6, a + 4);
  }
  const cal = [], calIdx = [];
  const hx = 0.055, hy = 0.018, hz = 0.032;
  const cx = 0, cy = discY + 0.012, cz = discR * 0.82;
  addBox(cal, calIdx, [
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
  ]);
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

/** Slim lens, local frame, centred. half is [depth, width, height] in metres. */
export function lampMesh(half) {
  const hx = half[0], hy = half[1], hz = half[2];
  const pos = [], idx = [];
  const nu = 10, nv = 6;
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const y = -hy + 2 * hy * u;
    const edge = 1 - (Math.abs(y) / hy) ** 2;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      const z = -hz + 2 * hz * v;
      const e2 = edge * (1 - (Math.abs(z) / hz) ** 2);
      const x = -hx * Math.max(0, e2);
      push(pos, x, y, z);
    }
  }
  const vid = (i, j) => i * (nv + 1) + j;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), d = vid(i, j + 1);
    idx.push(a, d, c, a, c, b);
  }
  return { positions: pos, indices: idx };
}

/** Horizontal slats in a frame. half is [depth, halfWidth, halfHeight]. */
export function grilleMesh(half) {
  const hx = Math.max(half[0], 0.008), hy = half[1], hz = half[2];
  const pos = [], idx = [];
  const slats = 5;
  for (let i = 0; i < slats; i++) {
    const z = -hz + (hz * 2) * ((i + 0.5) / slats);
    const th = hz / slats * 0.42;
    addBox(pos, idx, [
      [-hx, -hy, z - th], [hx * 0.3, -hy, z - th], [hx * 0.3, hy, z - th], [-hx, hy, z - th],
      [-hx, -hy, z + th], [hx * 0.3, -hy, z + th], [hx * 0.3, hy, z + th], [-hx, hy, z + th],
    ]);
  }
  const t = Math.min(0.012, hz * 0.18);
  addBox(pos, idx, [
    [-hx, -hy, -hz], [hx * 0.2, -hy, -hz], [hx * 0.2, -hy + t, -hz], [-hx, -hy + t, -hz],
    [-hx, -hy, hz], [hx * 0.2, -hy, hz], [hx * 0.2, -hy + t, hz], [-hx, -hy + t, hz],
  ]);
  addBox(pos, idx, [
    [-hx, hy - t, -hz], [hx * 0.2, hy - t, -hz], [hx * 0.2, hy, -hz], [-hx, hy, -hz],
    [-hx, hy - t, hz], [hx * 0.2, hy - t, hz], [hx * 0.2, hy, hz], [-hx, hy, hz],
  ]);
  return { positions: pos, indices: idx };
}
