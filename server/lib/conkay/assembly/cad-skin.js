// server/lib/conkay/assembly/cad-skin.js
//
// One body: Studio draws the analysed solid. The CAD kernel (cad.body) writes the body it solved and
// checked (envelopes enclosed by the skin offset, tub enclosed by the skin thickness, wheel wells cut)
// as a binary STL; this reads it into the inline mesh the Studio viewer draws (welded vertices,
// area-weighted normals), and answers "is this point inside that solid" for the parts Studio adds that
// no kernel check covered (steering wheel and column, pedals, ...).
//
//   readBinaryStl(buffer)        triangles of a binary STL (80-byte header, uint32 count, 50 bytes each)
//   cadSkinMesh(triangles)       { positions, normals, paint, glass: [], bounds, triangles } (welded at 1e-6 m)
//   pointInSolid(skin, p)        ray-crossing parity along a fixed oblique direction (Möller–Trumbore),
//                                three directions voting, so a ray grazing an edge cannot flip the answer
//   boxInSolid(skin, placement, half)   the box's centre and 8 corners all inside
//
// The test is exact for a closed, consistently meshed solid (cad.body checks the solid is one closed
// BRep before it writes the STL). It is a containment screen, not a clearance: a box inside the solid
// may still be closer to the skin than the skin is thick.

import fs from "node:fs";

export const CAD_SKIN_VERSION = "1.0.0";

/** Triangles [[ax,ay,az],[bx,..],[cx,..]] of a binary STL buffer. Throws on an ASCII or truncated file. */
export function readBinaryStl(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 84) throw new Error("not a binary STL: shorter than its 84-byte header");
  const n = buf.readUInt32LE(80);
  if (buf.length !== 84 + n * 50) throw new Error(`not a binary STL: ${n} triangles need ${84 + n * 50} bytes, file has ${buf.length}`);
  const tris = new Array(n);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12; // skip the facet normal
    const v = (k) => [buf.readFloatLE(o + k * 12), buf.readFloatLE(o + k * 12 + 4), buf.readFloatLE(o + k * 12 + 8)];
    tris[t] = [v(0), v(1), v(2)];
  }
  return tris;
}

export function readStlFile(path) {
  return readBinaryStl(fs.readFileSync(path));
}

const round5 = (v) => Math.round(v * 1e5) / 1e5;

/** The inline Studio mesh of the solid: welded vertices, area-weighted vertex normals, every triangle painted. */
export function cadSkinMesh(tris) {
  const index = new Map();
  const positions = [];
  const paint = [];
  const key = (p) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)},${Math.round(p[2] * 1e6)}`;
  const vid = (p) => {
    const k = key(p);
    let i = index.get(k);
    if (i == null) { i = positions.length / 3; positions.push(p[0], p[1], p[2]); index.set(k, i); }
    return i;
  };
  for (const [a, b, c] of tris) {
    const ia = vid(a), ib = vid(b), ic = vid(c);
    if (ia === ib || ib === ic || ia === ic) continue; // degenerate after welding
    paint.push(ia, ib, ic);
  }
  const normals = new Array(positions.length).fill(0);
  for (let t = 0; t < paint.length; t += 3) {
    const [i, j, k] = [paint[t], paint[t + 1], paint[t + 2]];
    const ux = positions[j * 3] - positions[i * 3], uy = positions[j * 3 + 1] - positions[i * 3 + 1], uz = positions[j * 3 + 2] - positions[i * 3 + 2];
    const vx = positions[k * 3] - positions[i * 3], vy = positions[k * 3 + 1] - positions[i * 3 + 1], vz = positions[k * 3 + 2] - positions[i * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // |n| = 2 × area: area-weighted
    for (const v of [i, j, k]) { normals[v * 3] += nx; normals[v * 3 + 1] += ny; normals[v * 3 + 2] += nz; }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const L = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
    normals[v] /= L; normals[v + 1] /= L; normals[v + 2] /= L;
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < positions.length; v += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[v + k]); max[k] = Math.max(max[k], positions[v + k]); }
  return { positions: positions.map(round5), normals: normals.map(round5), paint, glass: [], bounds: { min: min.map(round5), max: max.map(round5) }, triangles: paint.length / 3 };
}

/** A containment index over the triangles (kept apart from the drawn mesh so the payload stays inline arrays). */
export function cadSkinSolid(tris) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  return { tris, bounds: { min, max } };
}

// three fixed oblique directions (not along an axis or a mesh's natural grid): a ray that grazes an edge or a
// vertex in one direction does not in the others, and the majority decides
const DIRS = [[0.8017837, 0.5345225, 0.2672612], [-0.2672612, 0.8017837, -0.5345225], [0.5345225, -0.2672612, 0.8017837]];

function crossings(tris, p, d) {
  let n = 0;
  for (const [a, b, c] of tris) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det;
    const tx = p[0] - a[0], ty = p[1] - a[1], tz = p[2] - a[2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 1e-12) n++;
  }
  return n;
}

/** Is point p inside the closed solid? Majority of three ray-parity tests. */
export function pointInSolid(solid, p) {
  const { min, max } = solid.bounds;
  for (let k = 0; k < 3; k++) if (p[k] < min[k] || p[k] > max[k]) return false;
  let votes = 0;
  for (const d of DIRS) if (crossings(solid.tris, p, d) % 2 === 1) votes++;
  return votes >= 2;
}

/** Are the box's centre and its 8 corners all inside the solid? placement { x, y, z, yawDeg?, pitchDeg? }, half [hx, hy, hz]. */
export function boxInSolid(solid, placement, half) {
  const yaw = ((placement.yawDeg || 0) * Math.PI) / 180, pitch = ((placement.pitchDeg || 0) * Math.PI) / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // local x along the yaw/pitch heading, z up-ish (same convention as packaging obb: yaw about z, then pitch)
  const ax = [cy * cp, sy * cp, -sp], ay = [-sy, cy, 0], az = [cy * sp, sy * sp, cp];
  const pts = [[placement.x, placement.y, placement.z]];
  for (const sx of [-1, 1]) for (const s2 of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push([0, 1, 2].map((k) => [placement.x, placement.y, placement.z][k] + sx * half[0] * ax[k] + s2 * half[1] * ay[k] + sz * half[2] * az[k]));
  }
  return pts.every((p) => pointInSolid(solid, p));
}

/**
 * Side-profile stations of the solid: at each x, the slice through the triangles gives the roof (highest z), the
 * floor (lowest z), the half width (largest |y|) and the height of that widest point (the shoulder, drawn as the
 * belt line on the packaging sheet). rows: [{ role, x }] -> [{ role, x, roofZ, floorZ, beltZ, halfWidth }].
 */
export function cadStations(solid, rows) {
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const { min, max } = solid.bounds;
  return rows.map(({ role, x: x0 }) => {
    const x = Math.min(max[0] - 1e-4, Math.max(min[0] + 1e-4, x0));
    let roof = -Infinity, floor = Infinity, half = 0, beltZ = null;
    for (const t of solid.tris) {
      for (let e = 0; e < 3; e++) {
        const a = t[e], b = t[(e + 1) % 3];
        if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
        const s = (x - a[0]) / (b[0] - a[0]);
        const y = a[1] + s * (b[1] - a[1]), z = a[2] + s * (b[2] - a[2]);
        roof = Math.max(roof, z); floor = Math.min(floor, z);
        if (Math.abs(y) > half) { half = Math.abs(y); beltZ = z; }
      }
    }
    return Number.isFinite(roof) ? { role, x: r4(x), roofZ: r4(roof), floorZ: r4(floor), beltZ: r4(beltZ), halfWidth: r4(half) } : { role, x: r4(x), roofZ: null, floorZ: null, beltZ: null, halfWidth: null };
  });
}
