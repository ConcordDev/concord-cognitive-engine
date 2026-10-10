// server/lib/conkay/aero/stl-sections.js
//
// Cross-section areas of a closed, outward-oriented triangle mesh (the CAD
// body's STL) along one axis, without tracing section loops: by the divergence
// theorem, for the solid cut at x = c, the cut face has area
//   A(c) = - sum over triangles of (area of the triangle part with x < c) * n_x,
// because the clipped closed surface has zero net flux of the unit x field.
// Exact for the mesh (a polyhedron); the mesh's chordal deviation from the
// B-rep is the error. Works with holes and several loops (wheel wells).

import fs from "node:fs";

/** Triangles [[a, b, c], ...] of a binary STL buffer (vertices only; normals recomputed from the winding). */
export function readBinaryStl(buf) {
  if (buf.length < 84) throw new Error("not a binary STL (too short)");
  const n = buf.readUInt32LE(80);
  if (84 + n * 50 !== buf.length) throw new Error(`not a binary STL: ${n} triangles do not match ${buf.length} bytes`);
  const tris = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    const v = (k) => [buf.readFloatLE(o + k * 12), buf.readFloatLE(o + k * 12 + 4), buf.readFloatLE(o + k * 12 + 8)];
    tris[i] = [v(0), v(1), v(2)];
  }
  return tris;
}

export function readStlFile(path) {
  return readBinaryStl(fs.readFileSync(path));
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Area of the polygon part of triangle (a, b, c) with coordinate[axis] < cut, times the triangle's unit normal component. */
function clippedFlux(tri, axis, cut) {
  const nv = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])); // |nv| = 2 area
  const twiceArea = Math.hypot(...nv);
  if (twiceArea === 0) return 0;
  const nAxis = nv[axis] / twiceArea;
  if (nAxis === 0) return 0;
  // Sutherland-Hodgman clip of the triangle against coordinate < cut
  const out = [];
  for (let i = 0; i < 3; i++) {
    const p = tri[i], q = tri[(i + 1) % 3];
    const pin = p[axis] < cut, qin = q[axis] < cut;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (cut - p[axis]) / (q[axis] - p[axis]);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])]);
    }
  }
  if (out.length < 3) return 0;
  // area of the planar clipped polygon (fan), projected magnitude along the triangle normal
  let s = [0, 0, 0];
  for (let i = 1; i < out.length - 1; i++) {
    const c = cross(sub(out[i], out[0]), sub(out[i + 1], out[0]));
    s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]];
  }
  const area = Math.hypot(...s) / 2;
  return area * nAxis;
}

/** Closed-mesh checks: signed volume (positive = outward winding) and the net normal flux (should be ~0). */
export function meshChecks(tris) {
  let vol = 0;
  const flux = [0, 0, 0];
  for (const [a, b, c] of tris) {
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const n = cross(sub(b, a), sub(c, a));
    flux[0] += n[0] / 2; flux[1] += n[1] / 2; flux[2] += n[2] / 2;
  }
  return { volume: vol, netFlux: flux };
}

/** A(x) at the given cut positions (axis 0 = x). */
export function sectionAreas(tris, cuts, axis = 0) {
  return cuts.map((c) => {
    let s = 0;
    for (const t of tris) {
      const lo = Math.min(t[0][axis], t[1][axis], t[2][axis]);
      if (lo >= c) continue;
      s += clippedFlux(t, axis, c);
    }
    return { x: c, area: -s };
  });
}

/** Extent of the mesh along an axis. */
export function meshExtent(tris, axis = 0) {
  let lo = Infinity, hi = -Infinity;
  for (const t of tris) for (const v of t) { if (v[axis] < lo) lo = v[axis]; if (v[axis] > hi) hi = v[axis]; }
  return [lo, hi];
}
