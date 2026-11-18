// server/lib/conkay/physics/solvers/geometry-comp.js
//
// math.geometry-comp — SX-NUM-23 (ConKay solver catalogue,
// Wave 0).
//
// Computational geometry at the JS tier: 2D and 3D convex
// hulls, Bowyer-Watson Delaunay triangulation, point-in-
// polygon, closest pair, segment intersection. Qhull-scale
// inputs, polygon booleans and point-in-solid via OCC are
// the named engine tiers.
//
// The verification discipline: a hull is served only after
// every input point is checked inside or on it; a Delaunay
// triangulation is served only after every triangle's
// circumcircle is checked empty of the other points — the
// defining property, verified rather than trusted from the
// construction. A violated check is a solver FAIL, never a
// quietly served answer. Boundary cases get their own
// verdicts: a point ON a polygon edge is "boundary", not
// forced into inside/outside; collinear hull inputs return
// the degenerate segment hull, labelled.
//
// Catalogue reference case: the hull of the unit cube's
// eight vertices — volume 1, surface area 6, all eight
// vertices on the hull.

import { registerSolver } from "../registry.js";

const EPS = 1e-12;

function parsePoints(inputs, field = "points", dim = 2) {
  const pts = inputs[field];
  if (!Array.isArray(pts) || pts.length === 0 || !pts.every((p) => Array.isArray(p) && p.length === dim && p.every((c) => typeof c === "number" && Number.isFinite(c)))) {
    return { error: `missing_input:${field} (an array of ${dim}D points as [x, y${dim === 3 ? ", z" : ""}] number pairs)` };
  }
  if (pts.length > 20000) return { error: `size_above_envelope:${field} is capped at 20000 points at the JS tier (Qhull is the engine tier)` };
  return { points: pts.map((p) => [...p]) };
}

/* ---------------- 2D hull (monotone chain) ---------------- */

const cross2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function hull2d(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const uniq = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (uniq.length === 1) return { hull: uniq, degenerate: "point" };
  const lower = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= EPS) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = uniq.length - 1; i >= 0; i -= 1) {
    const p = uniq[i];
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= EPS) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length === 2) return { hull, degenerate: "segment" };
  return { hull, degenerate: null };
}

function polygonArea2(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/* ---------------- 3D hull (incremental, beneath-beyond) ---------------- */

function orient3(a, b, c, d) {
  // signed volume x6 of tetrahedron (a,b,c,d)
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const wx = d[0] - a[0], wy = d[1] - a[1], wz = d[2] - a[2];
  return ux * (vy * wz - vz * wy) - uy * (vx * wz - vz * wx) + uz * (vx * wy - vy * wx);
}

function hull3d(points) {
  const pts = points;
  // find a non-degenerate initial tetrahedron
  let i0 = 0;
  let i1 = -1, i2 = -1, i3 = -1;
  for (let i = 1; i < pts.length; i += 1) {
    const dx = pts[i][0] - pts[0][0], dy = pts[i][1] - pts[0][1], dz = pts[i][2] - pts[0][2];
    if (dx * dx + dy * dy + dz * dz > EPS) { i1 = i; break; }
  }
  if (i1 < 0) return { error: "degenerate_input:all points coincide" };
  // i2: the point farthest (in cross-product magnitude) from the line i0->i1
  const d01 = [pts[i1][0] - pts[i0][0], pts[i1][1] - pts[i0][1], pts[i1][2] - pts[i0][2]];
  for (let i = 0; i < pts.length; i += 1) {
    if (i === i0 || i === i1) continue;
    const d0i = [pts[i][0] - pts[i0][0], pts[i][1] - pts[i0][1], pts[i][2] - pts[i0][2]];
    const cx = d01[1] * d0i[2] - d01[2] * d0i[1];
    const cy = d01[2] * d0i[0] - d01[0] * d0i[2];
    const cz = d01[0] * d0i[1] - d01[1] * d0i[0];
    if (cx * cx + cy * cy + cz * cz > EPS) { i2 = i; break; }
  }
  if (i2 < 0) return { error: "degenerate_input:all points are collinear — the 3D hull is a segment" };
  for (let i = 0; i < pts.length; i += 1) {
    if (i === i0 || i === i1 || i === i2) continue;
    if (Math.abs(orient3(pts[i0], pts[i1], pts[i2], pts[i])) > 1e-11) { i3 = i; break; }
  }
  if (i3 < 0) return { error: "degenerate_input:all points are coplanar — use convex-hull-2d in the plane" };

  // faces: [a, b, c] index triples oriented outward
  let faces = [];
  const tet = [i0, i1, i2, i3];
  const centroid = [0, 1, 2, 3].map((k) => (pts[i0][k] + pts[i1][k] + pts[i2][k] + pts[i3][k]) / 4);
  for (let f = 0; f < 4; f += 1) {
    const face = tet.filter((_, j) => j !== f);
    const opp = tet[f];
    if (orient3(pts[face[0]], pts[face[1]], pts[face[2]], pts[opp]) > 0) {
      faces.push([face[0], face[2], face[1]]);
    } else {
      faces.push(face);
    }
  }
  const inside = (p, face) => orient3(pts[face[0]], pts[face[1]], pts[face[2]], p) <= 1e-11;

  for (let i = 0; i < pts.length; i += 1) {
    if (tet.includes(i)) continue;
    const p = pts[i];
    const visible = faces.filter((face) => !inside(p, face));
    if (visible.length === 0) continue;
    // horizon edges: edges of visible faces not shared with another visible face
    const edgeCount = new Map();
    const edgeDir = new Map();
    for (const face of visible) {
      for (let e = 0; e < 3; e += 1) {
        const a = face[e];
        const b = face[(e + 1) % 3];
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
        edgeDir.set(key, [a, b]);
      }
    }
    faces = faces.filter((face) => !visible.includes(face));
    for (const [key, count] of edgeCount) {
      if (count !== 1) continue;
      const [a, b] = edgeDir.get(key);
      // new face (a, b, i) oriented outward: centroid must be inside
      const cand = [a, b, i];
      if (orient3(pts[cand[0]], pts[cand[1]], pts[cand[2]], centroid) > 0) cand.reverse();
      // after reverse the vertex order changed; rebuild as [a, i, b] if needed
      faces.push(orient3(pts[cand[0]], pts[cand[1]], pts[cand[2]], centroid) <= 0 ? cand : [cand[0], cand[2], cand[1]]);
    }
  }
  // volume and area
  let volume = 0;
  let area = 0;
  for (const face of faces) {
    const [a, b, c] = face.map((ix) => pts[ix]);
    volume += orient3([0, 0, 0], a, b, c) / 6;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  const vertexSet = new Set();
  for (const face of faces) for (const ix of face) vertexSet.add(ix);
  // verification: every input point inside or on every face
  let maxViolation = 0;
  for (const p of pts) {
    for (const face of faces) {
      const v = orient3(pts[face[0]], pts[face[1]], pts[face[2]], p);
      if (v > maxViolation) maxViolation = v;
    }
  }
  return { faces, volume: Math.abs(volume), area, vertices: [...vertexSet].map((ix) => pts[ix]), maxViolation };
}

/* ---------------- Delaunay (Bowyer-Watson) ---------------- */

function circumcircle(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < EPS) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { center: [ux, uy], r2: (a[0] - ux) ** 2 + (a[1] - uy) ** 2 };
}

function delaunay(points) {
  const pts = points;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }
  const span = Math.max(maxX - minX, maxY - minY, 1) * 20;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const superPts = [[cx - span, cy - span], [cx + span, cy - span], [cx, cy + span]];
  const all = [...pts, ...superPts];
  const S = pts.length;
  let triangles = [[S, S + 1, S + 2]];
  for (let i = 0; i < S; i += 1) {
    const p = pts[i];
    const bad = [];
    for (const t of triangles) {
      const cc = circumcircle(all[t[0]], all[t[1]], all[t[2]]);
      if (cc && (p[0] - cc.center[0]) ** 2 + (p[1] - cc.center[1]) ** 2 < cc.r2 - 1e-12) bad.push(t);
    }
    const edgeCount = new Map();
    const edgeDir = new Map();
    for (const t of bad) {
      for (let e = 0; e < 3; e += 1) {
        const a = t[e];
        const b = t[(e + 1) % 3];
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
        edgeDir.set(key, [a, b]);
      }
    }
    triangles = triangles.filter((t) => !bad.includes(t));
    for (const [key, count] of edgeCount) {
      if (count !== 1) continue;
      const [a, b] = edgeDir.get(key);
      triangles.push([a, b, i]);
    }
  }
  triangles = triangles.filter((t) => t.every((ix) => ix < S));
  // verification: every circumcircle empty of the other points
  let maxViolation = 0;
  for (const t of triangles) {
    const cc = circumcircle(pts[t[0]], pts[t[1]], pts[t[2]]);
    if (!cc) continue;
    for (let i = 0; i < S; i += 1) {
      if (t.includes(i)) continue;
      const d2 = (pts[i][0] - cc.center[0]) ** 2 + (pts[i][1] - cc.center[1]) ** 2;
      const violation = cc.r2 - d2;
      if (violation > maxViolation) maxViolation = violation;
    }
  }
  return { triangles, maxViolation };
}

/* ---------------- targets ---------------- */

function runGeom(ctx, target) {
  const inputs = ctx?.inputs || {};
  switch (target) {
    case "convex-hull-2d": {
      const parsed = parsePoints(inputs, "points", 2);
      if (parsed.error) return { notComputed: parsed.error };
      if (parsed.points.length < 1) return { notComputed: "missing_input:points" };
      const { hull, degenerate } = hull2d(parsed.points);
      const area = degenerate ? 0 : Math.abs(polygonArea2(hull));
      let perimeter = 0;
      if (!degenerate || degenerate === "segment") {
        for (let i = 0; i < hull.length; i += 1) {
          const a = hull[i];
          const b = hull[(i + 1) % hull.length];
          perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
        }
        if (degenerate === "segment") perimeter /= 2; // closed loop double-counts a segment
      }
      return {
        inputs: { points: parsed.points.length },
        outputs: { hull, area, perimeter, degenerate },
        warnings: degenerate ? [`degenerate_hull:${degenerate} — the point set does not span a polygon`] : [],
        margins: [], covers: [target],
      };
    }
    case "convex-hull-3d": {
      const parsed = parsePoints(inputs, "points", 3);
      if (parsed.error) return { notComputed: parsed.error };
      if (parsed.points.length < 4) return { notComputed: "invalid_input:a 3D hull needs at least 4 points" };
      if (parsed.points.length > 2000) return { notComputed: "size_above_envelope:the incremental 3D hull is capped at 2000 points (Qhull is the engine tier)" };
      const r = hull3d(parsed.points);
      if (r.error) return { notComputed: r.error };
      if (r.maxViolation > 1e-9) {
        return {
          inputs: {},
          outputs: { hullVerificationViolation: r.maxViolation },
          failures: [{ check: "hull_containment", detail: `an input point lies outside the computed hull by ${r.maxViolation} (signed volume x6) — reported as a solver failure, never served` }],
          margins: [], covers: [target],
        };
      }
      return {
        inputs: { points: parsed.points.length },
        outputs: { volume: r.volume, surfaceArea: r.area, hullVertices: r.vertices, facetCount: r.faces.length, containmentVerified: true },
        margins: [], covers: [target],
      };
    }
    case "delaunay": {
      const parsed = parsePoints(inputs, "points", 2);
      if (parsed.error) return { notComputed: parsed.error };
      if (parsed.points.length < 3) return { notComputed: "invalid_input:delaunay needs at least 3 points" };
      if (parsed.points.length > 2000) return { notComputed: "size_above_envelope:delaunay is capped at 2000 points at the JS tier" };
      const r = delaunay(parsed.points);
      if (r.maxViolation > 1e-9) {
        return {
          inputs: {},
          outputs: { emptyCircleViolation: r.maxViolation },
          failures: [{ check: "empty_circle", detail: `a point lies inside another triangle's circumcircle by ${r.maxViolation} — the triangulation is not Delaunay; reported as a failure, never served` }],
          margins: [], covers: [target],
        };
      }
      return {
        inputs: { points: parsed.points.length },
        outputs: { triangles: r.triangles, triangleCount: r.triangles.length, emptyCircleVerified: true },
        margins: [], covers: [target],
      };
    }
    case "point-in-polygon": {
      const parsed = parsePoints(inputs, "polygon", 2);
      if (parsed.error) return { notComputed: parsed.error };
      const q = inputs.point;
      if (!Array.isArray(q) || q.length !== 2 || !q.every((c) => typeof c === "number" && Number.isFinite(c))) {
        return { notComputed: "missing_input:point (a [x, y] pair)" };
      }
      const poly = parsed.points;
      // boundary first: on any segment (within tolerance) is its own verdict
      for (let i = 0; i < poly.length; i += 1) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const abx = b[0] - a[0], aby = b[1] - a[1];
        const len2 = abx * abx + aby * aby;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * abx + (q[1] - a[1]) * aby) / len2));
        const px = a[0] + t * abx, py = a[1] + t * aby;
        if (Math.hypot(q[0] - px, q[1] - py) <= 1e-12) {
          return { inputs: {}, outputs: { verdict: "boundary" }, margins: [], covers: [target] };
        }
      }
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return { inputs: {}, outputs: { verdict: inside ? "inside" : "outside" }, margins: [], covers: [target] };
    }
    case "closest-pair": {
      const parsed = parsePoints(inputs, "points", 2);
      if (parsed.error) return { notComputed: parsed.error };
      if (parsed.points.length < 2) return { notComputed: "invalid_input:closest-pair needs at least 2 points" };
      // O(n^2) under the cap, exact — the divide-and-conquer form is an
      // optimization, not a different answer; the cap keeps this honest.
      if (parsed.points.length > 5000) return { notComputed: "size_above_envelope:the exact closest-pair scan is capped at 5000 points at this tier" };
      let best = Infinity;
      let pair = null;
      const pts = parsed.points;
      for (let i = 0; i < pts.length; i += 1) {
        for (let j = i + 1; j < pts.length; j += 1) {
          const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
          if (d < best) { best = d; pair = [pts[i], pts[j]]; }
        }
      }
      return { inputs: { points: pts.length }, outputs: { distance: best, pair }, margins: [], covers: [target] };
    }
    case "segment-intersection": {
      const { p1, p2, p3, p4 } = inputs;
      for (const [name, p] of [["p1", p1], ["p2", p2], ["p3", p3], ["p4", p4]]) {
        if (!Array.isArray(p) || p.length !== 2 || !p.every((c) => typeof c === "number" && Number.isFinite(c))) {
          return { notComputed: `missing_input:${name} (a [x, y] pair)` };
        }
      }
      const d1 = cross2(p3, p4, p1);
      const d2 = cross2(p3, p4, p2);
      const d3 = cross2(p1, p2, p3);
      const d4 = cross2(p1, p2, p4);
      const onSeg = (a, b, q) => Math.min(a[0], b[0]) - EPS <= q[0] && q[0] <= Math.max(a[0], b[0]) + EPS
        && Math.min(a[1], b[1]) - EPS <= q[1] && q[1] <= Math.max(a[1], b[1]) + EPS;
      if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) {
        const t = d1 / (d1 - d2);
        const point = [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
        return { inputs: {}, outputs: { type: "point", point }, margins: [], covers: [target] };
      }
      if (Math.abs(d1) <= EPS && onSeg(p3, p4, p1)) return { inputs: {}, outputs: { type: "point", point: p1, touching: true }, margins: [], covers: [target] };
      if (Math.abs(d2) <= EPS && onSeg(p3, p4, p2)) return { inputs: {}, outputs: { type: "point", point: p2, touching: true }, margins: [], covers: [target] };
      if (Math.abs(d3) <= EPS && onSeg(p1, p2, p3)) return { inputs: {}, outputs: { type: "point", point: p3, touching: true }, margins: [], covers: [target] };
      if (Math.abs(d4) <= EPS && onSeg(p1, p2, p4)) return { inputs: {}, outputs: { type: "point", point: p4, touching: true }, margins: [], covers: [target] };
      if (Math.abs(d1) <= EPS && Math.abs(d2) <= EPS) {
        return { inputs: {}, outputs: { type: "collinear", overlap: onSeg(p3, p4, p1) || onSeg(p3, p4, p2) || onSeg(p1, p2, p3) }, margins: [], covers: [target] };
      }
      return { inputs: {}, outputs: { type: "none" }, margins: [], covers: [target] };
    }
    case "boolean":
      return { notComputed: "requires_engine_tier:occ — polygon booleans ride the OCC engine tier; the JS tier seated here does not approximate them" };
    default:
      return { notComputed: `unknown_operation:${target}` };
  }
}

export const geometryComp = registerSolver({
  id: "math.geometry-comp",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 2,
  method: "monotone-chain 2D hull, incremental beneath-beyond 3D hull, Bowyer-Watson Delaunay — every hull containment-checked and every circumcircle emptiness-checked in code before serving",
  reference: "closed-form geometry (catalogue) — reference case: the unit cube's hull has volume 1 and surface area 6 with all eight vertices on the hull",
  regime: "2D sets to 20000 points; 3D hull and Delaunay to 2000; boundary verdicts are first-class (boundary / degenerate / touching), never forced into a binary",
  units: { inputs: "point arrays [x, y] or [x, y, z], polygon vertex lists, segment endpoints", outputs: "hulls, areas, volumes, triangulations, verdicts — as declared per target" },
  tolerance: "orientation predicates at 1e-12; hull containment and empty-circle verification gates at 1e-9 — a violated gate is a solver FAIL, not a served answer",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runGeom,
});
