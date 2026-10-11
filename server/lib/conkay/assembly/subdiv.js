// server/lib/conkay/assembly/subdiv.js
//
// Catmull–Clark subdivision with Pixar semi-sharp creases.
// Face point = average of the face. Smooth edge point = (v0+v1+f0+f1)/4.
// A boundary edge, or a crease with sharpness >= 1, uses the midpoint and
// the child edges keep sharpness - 1. Sharpness between 0 and 1 blends the
// two rules and the children are smooth. A vertex with two crease (or
// boundary) edges uses (e0 + 6V + e1) / 8, blended the same way. Three or
// more crease edges leave the vertex where it is. Smooth vertices use
// (F + 2R + (n-3)V) / n.
//
// `hard` edges are the feature lines the highlight metric must ignore. They
// propagate onto the child halves even after the sharpness has faded.

const KEY = 1000003;

export function edgeKey(a, b) {
  return a < b ? a * KEY + b : b * KEY + a;
}

function catmullClarkOnce(mesh) {
  const src = mesh.positions;
  const faces = mesh.faces;
  const crease = mesh.crease || new Map();
  const hard = mesh.hard || new Set();
  const nV = src.length / 3;
  const nF = faces.length;

  const facePoint = new Float64Array(nF * 3);
  for (let f = 0; f < nF; f++) {
    const face = faces[f];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < face.length; k++) {
      const i = face[k] * 3;
      x += src[i]; y += src[i + 1]; z += src[i + 2];
    }
    const inv = 1 / face.length;
    facePoint[f * 3] = x * inv;
    facePoint[f * 3 + 1] = y * inv;
    facePoint[f * 3 + 2] = z * inv;
  }

  const edgeMap = new Map();
  for (let f = 0; f < nF; f++) {
    const face = faces[f];
    const m = face.length;
    for (let i = 0; i < m; i++) {
      const a = face[i];
      const b = face[(i + 1) % m];
      const k = edgeKey(a, b);
      const e = edgeMap.get(k);
      if (!e) edgeMap.set(k, { a, b, f0: f, f1: -1, sharp: crease.get(k) || 0, hard: hard.has(k) });
      else if (e.f1 < 0) e.f1 = f;
    }
  }

  const nE = edgeMap.size;
  const edgePoint = new Float64Array(nE * 3);
  const edgeIndex = new Map();
  let ei = 0;
  for (const [k, e] of edgeMap) {
    edgeIndex.set(k, ei);
    const a3 = e.a * 3;
    const b3 = e.b * 3;
    const ax = src[a3], ay = src[a3 + 1], az = src[a3 + 2];
    const bx = src[b3], by = src[b3 + 1], bz = src[b3 + 2];
    const boundary = e.f1 < 0;
    const sx = (ax + bx) * 0.5, sy = (ay + by) * 0.5, sz = (az + bz) * 0.5;
    if (boundary || e.sharp >= 1) {
      edgePoint[ei * 3] = sx;
      edgePoint[ei * 3 + 1] = sy;
      edgePoint[ei * 3 + 2] = sz;
      e.child = boundary ? 0 : e.sharp - 1;
    } else if (e.sharp <= 0) {
      const f0 = e.f0 * 3;
      const f1 = e.f1 * 3;
      edgePoint[ei * 3] = (ax + bx + facePoint[f0] + facePoint[f1]) * 0.25;
      edgePoint[ei * 3 + 1] = (ay + by + facePoint[f0 + 1] + facePoint[f1 + 1]) * 0.25;
      edgePoint[ei * 3 + 2] = (az + bz + facePoint[f0 + 2] + facePoint[f1 + 2]) * 0.25;
      e.child = 0;
    } else {
      const f0 = e.f0 * 3;
      const f1 = e.f1 * 3;
      const mx = (ax + bx + facePoint[f0] + facePoint[f1]) * 0.25;
      const my = (ay + by + facePoint[f0 + 1] + facePoint[f1 + 1]) * 0.25;
      const mz = (az + bz + facePoint[f0 + 2] + facePoint[f1 + 2]) * 0.25;
      const t = e.sharp;
      edgePoint[ei * 3] = mx + (sx - mx) * t;
      edgePoint[ei * 3 + 1] = my + (sy - my) * t;
      edgePoint[ei * 3 + 2] = mz + (sz - mz) * t;
      e.child = 0;
    }
    e.ei = ei;
    ei++;
  }

  const vFaces = new Array(nV);
  const vEdges = new Array(nV);
  for (let i = 0; i < nV; i++) { vFaces[i] = []; vEdges[i] = []; }
  for (const e of edgeMap.values()) {
    vEdges[e.a].push(e);
    vEdges[e.b].push(e);
  }
  for (let f = 0; f < nF; f++) {
    const face = faces[f];
    for (let k = 0; k < face.length; k++) vFaces[face[k]].push(f);
  }

  const vertPoint = new Float64Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    const edges = vEdges[i];
    const vfs = vFaces[i];
    const px = src[i * 3], py = src[i * 3 + 1], pz = src[i * 3 + 2];
    if (!edges.length || !vfs.length) {
      vertPoint[i * 3] = px; vertPoint[i * 3 + 1] = py; vertPoint[i * 3 + 2] = pz;
      continue;
    }
    const n = vfs.length;
    let fx = 0, fy = 0, fz = 0;
    for (let k = 0; k < n; k++) {
      const f = vfs[k] * 3;
      fx += facePoint[f]; fy += facePoint[f + 1]; fz += facePoint[f + 2];
    }
    fx /= n; fy /= n; fz /= n;
    const en = edges.length;
    let rx = 0, ry = 0, rz = 0;
    let bCount = 0;
    let cCount = 0;
    for (let k = 0; k < en; k++) {
      const e = edges[k];
      rx += (src[e.a * 3] + src[e.b * 3]) * 0.5;
      ry += (src[e.a * 3 + 1] + src[e.b * 3 + 1]) * 0.5;
      rz += (src[e.a * 3 + 2] + src[e.b * 3 + 2]) * 0.5;
      if (e.f1 < 0) bCount++;
      else if (e.sharp > 1e-8) cCount++;
    }
    rx /= en; ry /= en; rz /= en;
    const vn = en;
    const smoothX = (fx + 2 * rx + (vn - 3) * px) / vn;
    const smoothY = (fy + 2 * ry + (vn - 3) * py) / vn;
    const smoothZ = (fz + 2 * rz + (vn - 3) * pz) / vn;

    let ox = smoothX, oy = smoothY, oz = smoothZ;
    const sharpEdges = [];
    if (bCount >= 2 || cCount >= 2 || bCount + cCount >= 3) {
      for (let k = 0; k < en; k++) {
        const e = edges[k];
        if (e.f1 < 0 || e.sharp > 1e-8) sharpEdges.push(e);
      }
    }
    if (bCount > 2 || cCount > 2 || (bCount + cCount) > 2) {
      ox = px; oy = py; oz = pz;
    } else if (bCount === 2 || (bCount === 0 && cCount === 2)) {
      const use = bCount === 2 ? edges.filter((e) => e.f1 < 0) : edges.filter((e) => e.f1 >= 0 && e.sharp > 1e-8);
      const other = (e) => (e.a === i ? e.b : e.a);
      const a = other(use[0]);
      const b = other(use[1]);
      const sx = (src[a * 3] + 6 * px + src[b * 3]) / 8;
      const sy = (src[a * 3 + 1] + 6 * py + src[b * 3 + 1]) / 8;
      const sz = (src[a * 3 + 2] + 6 * pz + src[b * 3 + 2]) / 8;
      const s0 = use[0].f1 < 0 ? 1e9 : use[0].sharp;
      const s1 = use[1].f1 < 0 ? 1e9 : use[1].sharp;
      const s = Math.min(s0, s1);
      if (s >= 1) { ox = sx; oy = sy; oz = sz; }
      else { ox = smoothX + (sx - smoothX) * s; oy = smoothY + (sy - smoothY) * s; oz = smoothZ + (sz - smoothZ) * s; }
    } else if (bCount === 1) {
      ox = px; oy = py; oz = pz;
    }
    vertPoint[i * 3] = ox;
    vertPoint[i * 3 + 1] = oy;
    vertPoint[i * 3 + 2] = oz;
  }

  const total = nV + nF + nE;
  const out = new Float64Array(total * 3);
  out.set(vertPoint, 0);
  out.set(facePoint, nV * 3);
  const eBase = nV + nF;
  out.set(edgePoint, eBase * 3);

  const outFaces = new Array(faces.reduce((s, f) => s + f.length, 0));
  let fi = 0;
  const outCrease = new Map();
  const outHard = new Set();
  const mark = (a, b, s, isHard) => {
    const k = edgeKey(a, b);
    if (s > 1e-6) outCrease.set(k, s);
    if (isHard) outHard.add(k);
  };
  for (let f = 0; f < nF; f++) {
    const face = faces[f];
    const m = face.length;
    const fp = nV + f;
    for (let i = 0; i < m; i++) {
      const v0 = face[i];
      const v1 = face[(i + 1) % m];
      const vp = face[(i + m - 1) % m];
      const eNext = eBase + edgeIndex.get(edgeKey(v0, v1));
      const ePrev = eBase + edgeIndex.get(edgeKey(vp, v0));
      outFaces[fi++] = [v0, eNext, fp, ePrev];
      const rec = edgeMap.get(edgeKey(v0, v1));
      mark(v0, eNext, rec.child, rec.hard || rec.f1 < 0);
    }
  }
  return { positions: out, faces: outFaces, crease: outCrease, hard: outHard };
}

export function catmullClark(mesh, levels) {
  let cur = mesh;
  const n = Math.max(0, levels | 0);
  for (let i = 0; i < n; i++) cur = catmullClarkOnce(cur);
  return cur;
}
