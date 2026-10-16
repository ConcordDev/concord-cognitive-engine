// server/lib/conkay/assembly/surface-overlays.js
//
// Visual polish (b): the cad.design-surface layers drawn ON the analysed
// solid. Door cuts and wheel arches become panel lines, the windscreen,
// backlight and side glass become glass patches, the lamp slots become lamp
// patches. Every point is projected onto the cad.body triangles; nothing here
// trims, cuts or moves the solid (skinTrimmed: false). A point whose
// projection line misses the solid is counted as missed and left out; it is
// never invented.
//
// Projection directions (design frame: x rearward, y left (+) / right (-),
// z up; the L side of the package is +y):
//   - side layers (door cuts, side glass, arches): along y from outside, the
//     outermost surface point on that side;
//   - windscreen and backlight: along the tub glazing quad's outward normal,
//     the outermost surface point on that line;
//   - lamp slots: along x from ahead of the nose, the foremost surface point.
// Each projected point is lifted off the paint along the hit triangle's
// outward normal by a presentation offset (OVERLAY_OFFSET) so it draws over
// the paint instead of z-fighting it. That offset is drawing only: it is not
// a gap, a seal or a panel thickness.


export const SURFACE_OVERLAYS_VERSION = "1.0.0";

export const OVERLAY_OFFSET = Object.freeze({
  lineM: 0.002,
  glassM: 0.004,
  lampM: 0.003,
  basis: "presentation lift off the paint along the surface normal so overlays draw over it (the styling loft's glass used 4 mm the same way). Not a gap, a seal or a thickness.",
});

/** Sampling steps (metres) for lines and patches. */
const LINE_STEP = 0.02;
const PATCH_STEP = 0.025;

const r4 = (v) => Math.round(v * 1e4) / 1e4;

// ---------- projection along a direction ----------

/**
 * Index the triangles for lines parallel to the unit vector dir. Each
 * triangle is expressed in a basis (eu, ev, dir) and binned on (u, v) in
 * square cells. A coordinate axis gives eu, ev as the other two axes, so u, v
 * are plain coordinates.
 */
export function dirIndex(tris, dir, cell = 0.05) {
  const L = Math.hypot(...dir);
  const n = dir.map((c) => c / L);
  const axis = n.findIndex((c) => Math.abs(Math.abs(c) - 1) < 1e-12);
  let eu, ev;
  if (axis >= 0) {
    const [a, b] = [0, 1, 2].filter((k) => k !== axis);
    eu = [0, 0, 0]; eu[a] = 1; ev = [0, 0, 0]; ev[b] = 1;
  } else {
    const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    eu = [n[1] * helper[2] - n[2] * helper[1], n[2] * helper[0] - n[0] * helper[2], n[0] * helper[1] - n[1] * helper[0]];
    const lu = Math.hypot(...eu); eu = eu.map((c) => c / lu);
    ev = [n[1] * eu[2] - n[2] * eu[1], n[2] * eu[0] - n[0] * eu[2], n[0] * eu[1] - n[1] * eu[0]];
  }
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const bins = new Map();
  for (const t of tris) {
    const uvw = t.map((p) => [dot(p, eu), dot(p, ev), dot(p, n)]);
    const area2 = (uvw[1][0] - uvw[0][0]) * (uvw[2][1] - uvw[0][1]) - (uvw[2][0] - uvw[0][0]) * (uvw[1][1] - uvw[0][1]);
    if (Math.abs(area2) < 1e-14) continue; // edge-on along dir: no single crossing
    const us = uvw.map((q) => q[0]), vs = uvw.map((q) => q[1]);
    const a0 = Math.floor(Math.min(...us) / cell), a1 = Math.floor(Math.max(...us) / cell);
    const b0 = Math.floor(Math.min(...vs) / cell), b1 = Math.floor(Math.max(...vs) / cell);
    const rec = { uvw, normal: triNormal(t) };
    for (let a = a0; a <= a1; a++) {for (let b = b0; b <= b1; b++) {
      const kk = `${a},${b}`;
      let list = bins.get(kk);
      if (!list) bins.set(kk, (list = []));
      list.push(rec);
    }}
  }
  return { n, eu, ev, cell, bins, dot };
}

/** A coordinate axis index (k = 0, 1, 2). */
export const axisIndex = (tris, k, cell) => dirIndex(tris, [0, 1, 2].map((i) => (i === k ? 1 : 0)), cell);

function triNormal(t) {
  const [a, b, c] = t;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const L = Math.hypot(...n) || 1;
  return n.map((x) => x / L);
}

/**
 * The surface point on the line {u, v} parallel to the index direction that is
 * furthest along `sign` (+1: the outermost along dir, -1: along -dir), with
 * the triangle's normal turned to face that way. null when the line misses.
 */
export function projectUv(index, u, v, sign) {
  const { n, eu, ev, cell, bins } = index;
  const list = bins.get(`${Math.floor(u / cell)},${Math.floor(v / cell)}`);
  if (!list) return null;
  let best = null, bestRec = null;
  for (const rec of list) {
    const [A, B, C] = rec.uvw;
    const d = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    const l1 = ((B[0] - u) * (C[1] - v) - (C[0] - u) * (B[1] - v)) / d;
    const l2 = ((C[0] - u) * (A[1] - v) - (A[0] - u) * (C[1] - v)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const w = l1 * A[2] + l2 * B[2] + l3 * C[2];
    if (best == null || sign * w > sign * best) { best = w; bestRec = rec; }
  }
  if (best == null) return null;
  const point = [0, 1, 2].map((i) => u * eu[i] + v * ev[i] + best * n[i]);
  let normal = bestRec.normal;
  const along = normal[0] * n[0] + normal[1] * n[1] + normal[2] * n[2];
  if (Math.sign(along) !== Math.sign(sign)) normal = normal.map((x) => -x); // face the side the line came from
  return { point, normal };
}

/** Project a 3D point along the index direction (sign as in projectUv). */
export function projectPoint(index, p, sign) {
  return projectUv(index, index.dot(p, index.eu), index.dot(p, index.ev), sign);
}

/** Axis-index shorthand: line through (u, v) in the other two coordinates, in increasing axis order. */
export const projectAxis = projectUv;

const lift = (hit, d) => hit.point.map((c, i) => r4(c + d * hit.normal[i]));

// ---------- sampling ----------

/** Points along a closed or open polyline, no further apart than step. */
export function resample(poly, step, closed) {
  const out = [];
  const n = poly.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = Math.max(1, Math.ceil(L / step));
    for (let j = 0; j < m; j++) out.push([a[0] + ((b[0] - a[0]) * j) / m, a[1] + ((b[1] - a[1]) * j) / m]);
  }
  if (!closed) out.push(poly[n - 1].slice());
  else out.push(out[0].slice());
  return out;
}

/** Project a sampled polyline; consecutive hits form runs, a miss breaks the run. */
function projectLine(samples, project, offset) {
  const runs = [];
  let run = [];
  let missed = 0;
  for (const s of samples) {
    const hit = project(s);
    if (!hit) {
      missed++;
      if (run.length >= 2) runs.push(run.flat());
      run = [];
      continue;
    }
    run.push(lift(hit, offset));
  }
  if (run.length >= 2) runs.push(run.flat());
  return { polylines: runs, samples: samples.length, missed };
}

/** The z-interval(s) of a closed polygon in (x, z) on the vertical line at x; the widest one. */
export function columnSpan(poly, x) {
  const zs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x)) zs.push(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
  }
  zs.sort((p, q) => p - q);
  let best = null;
  for (let i = 0; i + 1 < zs.length; i += 2) if (!best || zs[i + 1] - zs[i] > best[1] - best[0]) best = [zs[i], zs[i + 1]];
  return best;
}

/**
 * A patch over a grid of parameters: corners(i, j) gives the 2D/3D sample,
 * project() the hit. Quads with a missed corner are dropped.
 */
function projectGrid(cols, rows, sampleAt, project, offset) {
  const idx = new Map();
  const positions = [];
  const indices = [];
  let missed = 0, total = 0;
  const vid = (i, j) => {
    const k = `${i},${j}`;
    if (idx.has(k)) return idx.get(k);
    const s = sampleAt(i, j);
    if (!s) { idx.set(k, -1); return -1; } // no patch there (e.g. the aperture is below the shoulder): not a sample
    total++;
    const hit = project(s);
    if (!hit) { missed++; idx.set(k, -1); return -1; }
    const id = positions.length / 3;
    positions.push(...lift(hit, offset));
    idx.set(k, id);
    return id;
  };
  for (let i = 0; i < cols; i++) {for (let j = 0; j < rows; j++) {
    const a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), d = vid(i, j + 1);
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    indices.push(a, b, c, a, c, d);
  }}
  return { positions, indices, samples: total, missed };
}

// ---------- the solid's shoulder line ----------

/** Within this of the slice's maximum half-width counts as the widest band (a drawing tolerance, not a design value). */
export const SHOULDER_BAND_M = 0.005;

/**
 * The solid's shoulder at each x: the top of the band where the slice is
 * within SHOULDER_BAND_M of its maximum half-width (where the tumblehome
 * starts). The height of the single widest point is ill-conditioned on a
 * near-vertical flank (many heights share nearly the same width), so the
 * top of the band is used. Returns [{ x, z }] (z null where the slice is empty).
 */
export function shoulderLine(solid, xs) {
  return xs.map((x) => {
    const pts = [];
    for (const t of solid.tris) {
      for (let e = 0; e < 3; e++) {
        const a = t[e], b = t[(e + 1) % 3];
        if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
        const s = (x - a[0]) / (b[0] - a[0]);
        pts.push([Math.abs(a[1] + s * (b[1] - a[1])), a[2] + s * (b[2] - a[2])]);
      }
    }
    if (!pts.length) return { x, z: null };
    const half = Math.max(...pts.map((p) => p[0]));
    return { x, z: r4(Math.max(...pts.filter((p) => p[0] >= half - SHOULDER_BAND_M).map((p) => p[1]))) };
  });
}

// ---------- the layers ----------

/**
 * @param {object} layers cad.design-surface layers ({ panelCuts, glazing, lamps, wheelArches })
 * @param {{ tris: number[][][], bounds: { min: number[], max: number[] } }} solid cadSkinSolid() of the analysed body
 * @param {{ conflicts?: object[] }} [opts]
 */
export function surfaceOverlays(layers, solid, opts = {}) {
  if (!layers || !solid?.tris?.length) return null;
  const { min, max } = solid.bounds;
  const sideIdx = axisIndex(solid.tris, 1);
  const noseIdx = axisIndex(solid.tris, 0);
  const sideSign = (side) => (side === "L" ? 1 : -1);
  const onSide = (side) => ([x, z]) => projectAxis(sideIdx, x, z, sideSign(side));

  // the solid's own shoulder line; side glass sits above it. Sampled only over the side glass's x range.
  const sideGlass = (layers.glazing || []).filter((g) => g.outline && g.inDoor);
  const gx0 = sideGlass.length ? Math.min(...sideGlass.flatMap((g) => g.outline.map((p) => p[0]))) : min[0];
  const gx1 = sideGlass.length ? Math.max(...sideGlass.flatMap((g) => g.outline.map((p) => p[0]))) : min[0];
  const SH_STEP = 0.02;
  const xs = [];
  for (let x = gx0; x <= gx1 + SH_STEP; x += SH_STEP) xs.push(x);
  const shoulder = sideGlass.length ? shoulderLine(solid, xs) : [];
  const beltAt = (x) => {
    const i = Math.max(0, Math.min(shoulder.length - 2, Math.floor((x - gx0) / SH_STEP)));
    const a = shoulder[i], b = shoulder[i + 1];
    if (!Number.isFinite(a?.z) || !Number.isFinite(b?.z)) return Number.isFinite(a?.z) ? a.z : b?.z;
    // the higher of the two neighbours: glass never dips below the shoulder between samples
    return Math.max(a.z, b.z);
  };

  const panelLines = [];
  for (const d of layers.panelCuts || []) {
    const r = projectLine(resample(d.outline, LINE_STEP, true), onSide(d.side), OVERLAY_OFFSET.lineM);
    panelLines.push({ id: d.id, kind: "door-cut", side: d.side, ...r });
  }
  for (const a of layers.wheelArches?.arches || []) {
    // the arch's side is the tyre's: L tyres sit at +y
    const side = /_(FL|RL)$|-L$/.test(a.tyre) ? "L" : "R";
    const r = projectLine(resample(a.outline, LINE_STEP, false), onSide(side), OVERLAY_OFFSET.lineM);
    panelLines.push({ id: a.id, kind: "wheel-arch", side, ...r });
  }

  const glass = [];
  for (const g of layers.glazing || []) {
    if (g.outlineXYZ) {
      // windscreen / backlight: bilinear patch over the tub quad, projected along its outward normal
      const [p0, p1, p2, p3] = g.outlineXYZ;
      const centre = [(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2 - 0.2];
      const e1 = p1.map((c, i) => c - p0[i]), e2 = p3.map((c, i) => c - p0[i]);
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const L = Math.hypot(...n) || 1;
      n = n.map((c) => c / L);
      const mid = [0, 1, 2].map((i) => (p0[i] + p1[i] + p2[i] + p3[i]) / 4);
      if ((mid[0] - centre[0]) * n[0] + (mid[1] - centre[1]) * n[1] + (mid[2] - centre[2]) * n[2] < 0) n = n.map((c) => -c);
      const cols = Math.max(2, Math.ceil(Math.hypot(...e1) / PATCH_STEP)), rows = Math.max(2, Math.ceil(Math.hypot(...e2) / PATCH_STEP));
      const at = (i, j) => {
        const s = i / cols, t = j / rows;
        return [0, 1, 2].map((k) => (1 - s) * (1 - t) * p0[k] + s * (1 - t) * p1[k] + s * t * p2[k] + (1 - s) * t * p3[k]);
      };
      const quadIdx = dirIndex(solid.tris, n);
      const r = projectGrid(cols, rows, at, (p) => projectPoint(quadIdx, p, 1), OVERLAY_OFFSET.glassM);
      glass.push({ id: g.id, kind: "glazing", source: "tub glazing quad, projected along its outward normal", ...r });
      continue;
    }
    if (!g.outline || !g.inDoor) continue;
    const side = /-L$/.test(g.inDoor) ? "L" : "R";
    const x0 = Math.min(...g.outline.map((p) => p[0])), x1 = Math.max(...g.outline.map((p) => p[0]));
    const cols = Math.max(2, Math.ceil((x1 - x0) / PATCH_STEP)), rows = 10;
    const span = (i) => {
      const x = x0 + ((x1 - x0) * Math.min(Math.max(i, 0.0001), cols - 0.0001)) / cols;
      const s = columnSpan(g.outline, x);
      const belt = beltAt(x);
      if (!s || !Number.isFinite(belt)) return null;
      const lo = Math.max(s[0], belt), hi = s[1];
      return hi - lo > 1e-3 ? { x, lo, hi } : null;
    };
    const at = (i, j) => { const s = span(i); return s ? [s.x, s.lo + ((s.hi - s.lo) * j) / rows] : null; };
    const r = projectGrid(cols, rows, at, onSide(side), OVERLAY_OFFSET.glassM);
    glass.push({
      id: g.id, kind: "glazing", side, inDoor: g.inDoor, state: g.state,
      source: `the design-surface side-glass outline (${g.state}), above the analysed solid's shoulder line (the top of its widest band at each x, sampled every ${SH_STEP * 1000} mm)`,
      ...r,
    });
  }

  const lamps = [];
  if (layers.lamps?.state === "placed") {
    for (const s of layers.lamps.slots) {
      const ys = s.outlineYZ.map((p) => p[0]), zs = s.outlineYZ.map((p) => p[1]);
      const y0 = Math.min(...ys), y1 = Math.max(...ys), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const cols = Math.max(2, Math.ceil((y1 - y0) / 0.02)), rows = 2;
      const r = projectGrid(cols, rows, (i, j) => [y0 + ((y1 - y0) * i) / cols, z0 + ((z1 - z0) * j) / rows], ([y, z]) => projectAxis(noseIdx, y, z, -1), OVERLAY_OFFSET.lampM);
      lamps.push({ id: s.id, kind: "lamp-aperture", side: s.side, ...r });
    }
  }

  const all = [...panelLines, ...glass, ...lamps];
  return {
    version: SURFACE_OVERLAYS_VERSION,
    source: "cad.design-surface",
    onSolid: "cad.body",
    skinTrimmed: false,
    offset: OVERLAY_OFFSET,
    panelLines,
    glass,
    lamps,
    lampsState: layers.lamps?.state === "placed" ? "placed" : { state: layers.lamps?.state || "absent", reason: layers.lamps?.reason || null },
    coverage: {
      samples: all.reduce((s, o) => s + o.samples, 0),
      missed: all.reduce((s, o) => s + o.missed, 0),
      note: "a missed sample is a point whose projection line does not meet the solid; it is left out, not invented",
    },
    conflicts: opts.conflicts || [],
    notes: [
      "Drawn on the analysed solid; the solid is not trimmed and no aperture is cut (that is a separate step with a physics re-check).",
      "Panel lines are the tub door apertures and the wheel arches, projected sideways onto the skin.",
      "Side glass is the design-surface glass outline above the solid's shoulder line; windscreen and backlight are the tub glazing quads projected onto the skin.",
      "Lamp patches are the design-surface lamp slots projected onto the nose from ahead.",
    ],
  };
}
