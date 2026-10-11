// server/lib/conkay/assembly/cage.js
//
// Half-body control cage for the styled skeleton. Quads only, openings cut
// out of the cage (arches, daylight opening, lower intake), then mirrored
// and welded on y = 0 and subdivided with Catmull–Clark. The limit surface
// is what containment sees. Creases are semi-sharp, not a Class-A claim.

import { makeSpline } from "./style.js";
import { catmullClark, edgeKey } from "./subdiv.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const GLASS_OFFSET = 0.004;
const ROWS = 13;
const SHOULDER = 5;
const BELT = 4;
const RAIL = 3;
const ROCKER = 9;
const HOOD = 1;

function archWeight(spec, x) {
  const R = spec.tyreRadius + spec.archGap;
  let w = 0;
  for (const ax of [spec.frontAxleX, spec.rearAxleX]) {
    const dx = Math.abs(x - ax);
    const span = R * 0.92;
    if (dx < span) w = Math.max(w, Math.cos((dx / span) * Math.PI * 0.5) ** 2);
  }
  return w;
}

function sillWeight(spec, x) {
  const a = spec.frontAxleX + spec.tyreRadius + 0.06;
  const b = spec.rearAxleX - spec.tyreRadius - 0.06;
  if (!(x > a && x < b)) return 0;
  const fade = 0.22;
  let w = 1;
  if (x < a + fade) w = (x - a) / fade;
  if (x > b - fade) w = Math.min(w, (b - x) / fade);
  return clamp(w, 0, 1);
}

function sectionRows(spec, profileAt, x) {
  const p = profileAt(x);
  const archW = archWeight(spec, x);
  const onHood = x < spec.cowlX - 0.02 && x > spec.noseX - 0.02;
  const hoodT = onHood
    ? Math.sin(Math.PI * clamp((x - spec.noseX) / Math.max(0.2, spec.cowlX - spec.noseX), 0, 1))
    : 0;
  const crownZ = p.crownZ + 0.011 * hoodT;
  const shoulderY = p.shoulderY * (1 + 0.055 * archW);
  let shoulderZ = p.shoulderZ;
  // The fender crown sits on the tyre circle plus the arch gap, so the
  // opening reads as the tyre plus ~30 mm instead of a tall flat arch.
  const lip = spec.tyreRadius + spec.archGap + 0.01;
  for (const ax of [spec.frontAxleX, spec.rearAxleX]) {
    const dx = x - ax;
    // Only the crown of the arch. Pulling the side of the opening down onto
    // the circle puts sheet metal through the tyre.
    if (Math.abs(dx) >= lip * 0.58) continue;
    const arc = spec.tyreCenterZ + Math.sqrt(Math.max(0, lip * lip - dx * dx));
    const w = Math.cos((Math.abs(dx) / (lip * 0.58)) * Math.PI * 0.5) ** 2;
    shoulderZ = lerp(shoulderZ, arc, w);
  }
  let beltZ = Math.min(p.beltZ, Math.max(shoulderZ, p.shoulderZ) - 0.004);
  if (shoulderZ > beltZ - 0.006) beltZ = shoulderZ - 0.012;
  let railZ = Math.min(p.railZ, crownZ - 0.008);
  if (railZ < beltZ + 0.02) railZ = Math.min(crownZ - 0.01, beltZ + Math.max(0.02, (crownZ - beltZ) * 0.45));
  const beltY = shoulderY * 0.935;
  const railY = Math.min(p.railY, beltY * 0.84);
  const hoodY = Math.max(0.02, Math.min(railY * 0.46, railY - 0.015));
  const rockerY = Math.min(p.rockerY, shoulderY * 0.86);
  const floorZ = p.floorZ + 0.012;
  const side = (t, bow) => ({
    y: lerp(shoulderY, rockerY, t) + bow,
    z: lerp(shoulderZ, rockerY > 0 ? lerp(beltZ, floorZ, 0.55) : floorZ, t),
  });
  const upper = side(0.22, 0.012);
  const bow = side(0.5, 0.02);
  const lower = side(0.76, 0.009);
  const zRocker = Math.min(p.rockerZ, lower.z - 0.004);
  const rows = [
    { y: 0, z: crownZ },
    { y: hoodY, z: crownZ - 0.007 },
    { y: lerp(hoodY, railY, 0.58), z: lerp(crownZ - 0.007, railZ, 0.55) },
    { y: railY, z: railZ },
    { y: beltY, z: beltZ },
    { y: shoulderY, z: shoulderZ },
    { y: Math.min(shoulderY * 0.995, upper.y), z: lerp(shoulderZ, zRocker, 0.28) },
    { y: Math.min(shoulderY * 0.99, bow.y), z: lerp(shoulderZ, zRocker, 0.55) },
    { y: Math.min(shoulderY * 0.97, lower.y), z: lerp(shoulderZ, zRocker, 0.8) },
    { y: rockerY, z: zRocker },
    { y: rockerY * 0.62, z: lerp(zRocker, floorZ, 0.5) },
    { y: rockerY * 0.28, z: floorZ + 0.006 },
    { y: 0, z: floorZ },
  ];
  // Keep the walk from folding back on itself in plan: y rises to the
  // shoulder, then falls to the centreline.
  let peak = 0;
  for (let i = 0; i <= SHOULDER; i++) {
    rows[i].y = Math.max(rows[i].y, peak);
    peak = rows[i].y;
  }
  let prev = rows[SHOULDER].y;
  for (let i = SHOULDER + 1; i < rows.length; i++) {
    rows[i].y = Math.min(rows[i].y, prev);
    prev = rows[i].y;
  }
  rows[0].y = 0;
  rows[ROWS - 1].y = 0;
  // Lower door scallop: the row above the rocker tucks in between the wheels.
  // The shoulder crease is left alone.
  const sw = sillWeight(spec, x);
  if (sw > 0) rows[8].y = Math.max(rows[9].y + 0.02, rows[8].y - 0.034 * sw);
  // Side rows that fall inside the tyre circle get a small lift. Moving x
  // here folds the fender, so only z changes, and only by a few millimetres.
  const clear = spec.tyreRadius + spec.archGap + 0.006;
  for (let i = SHOULDER; i <= ROCKER; i++) {
    for (const ax of [spec.frontAxleX, spec.rearAxleX]) {
      const dx = x - ax;
      const dz = rows[i].z - spec.tyreCenterZ;
      const d = Math.hypot(dx, dz);
      if (d > 0.05 && d < clear && rows[i].y > 0.72) {
        const need = Math.sqrt(Math.max(0, clear * clear - dx * dx));
        const lift = Math.min(0.012, Math.max(0, need - dz));
        rows[i].z += lift;
      }
    }
  }
  // Strictly descending z keeps a quad between two stations from twisting
  // when the fender would otherwise rise back above the belt.
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].z > rows[i - 1].z - 0.004) rows[i].z = rows[i - 1].z - 0.004;
  }
  return rows;
}

function stationList(spec) {
  const R = spec.tyreRadius + spec.archGap;
  const ax = spec.frontAxleX;
  const rx = spec.rearAxleX;
  const kamm = spec.kammX || spec.tailX - 0.14;
  const cPost = spec.cPillarX || rx;
  const back = spec.backlightX || Math.min(kamm - 0.2, rx - R);
  const raw = [
    { x: spec.noseX, id: "nose", collapse: true, pin: true },
    { x: spec.noseX + 0.055, id: "nose2" },
    { x: spec.noseX + 0.12, id: "nose3" },
    { x: spec.noseX + 0.2, id: "flare" },
    { x: spec.noseX + 0.28, id: "flare2" },
    { x: spec.noseX + 0.36, id: "nose4" },
    { x: ax - R - 0.05, id: "fa0" },
    { x: ax - R * 0.75, id: "fa1" },
    { x: ax - R * 0.32, id: "fa2" },
    { x: ax, id: "faxle", pin: true },
    { x: ax + R * 0.32, id: "fa3" },
    { x: ax + R * 0.75, id: "fa4" },
    { x: ax + R + 0.05, id: "fa5" },
    { x: lerp(ax + R + 0.05, spec.cowlX, 0.5), id: "hood" },
    { x: spec.cowlX, id: "cowl", pin: true },
    { x: spec.cowlX + 0.055, id: "ws0" },
    { x: lerp(spec.cowlX, spec.headerX, 0.5), id: "ws1" },
    { x: spec.headerX - 0.05, id: "ws2" },
    { x: spec.headerX, id: "header", pin: true },
    { x: spec.headerX + 0.045, id: "rf0" },
    { x: spec.headerX + 0.1, id: "sd0" },
    { x: lerp(spec.headerX, spec.bPillarX, 0.5), id: "sd1" },
    { x: spec.bPillarX - 0.05, id: "sd2" },
    { x: spec.bPillarX - 0.016, id: "bp0", pin: true },
    { x: spec.bPillarX + 0.016, id: "bp1", pin: true },
    { x: spec.bPillarX + 0.06, id: "sd3" },
    { x: lerp(spec.bPillarX, cPost, 0.5), id: "sd4" },
    { x: cPost - 0.05, id: "sd5" },
    { x: cPost, id: "cp", pin: true },
    { x: Math.min(back, kamm - 0.08), id: "bk0" },
    { x: lerp(Math.min(back, kamm - 0.08), kamm, 0.55), id: "bk1" },
    { x: rx - R * 0.72, id: "ra0" },
    { x: rx - R * 0.28, id: "ra1" },
    { x: rx, id: "raxle", pin: true },
    { x: rx + R * 0.45, id: "ra2" },
    { x: rx + R * 0.45 + 0.12, id: "rq0" },
    { x: rx + R * 0.45 + 0.26, id: "rq1" },
    { x: kamm, id: "kamm", pin: true },
    { x: spec.tailX, id: "tail", collapse: true, pin: true },
  ];
  const sorted = raw
    .filter((s) => Number.isFinite(s.x))
    .map((s) => ({ ...s, x: clamp(s.x, spec.noseX, spec.tailX) }))
    .sort((a, b) => a.x - b.x);
  const out = [];
  for (const st of sorted) {
    const prev = out[out.length - 1];
    if (!prev) { out.push(st); continue; }
    const gap = st.x - prev.x;
    if (gap < 0.012) {
      if ((st.pin || st.collapse) && !(prev.pin || prev.collapse)) out[out.length - 1] = st;
      continue;
    }
    if (gap < 0.03 && !st.pin && !st.collapse && !prev.pin && !prev.collapse) continue;
    out.push(st);
  }
  out[0] = { ...out[0], x: spec.noseX, id: "nose", collapse: true, pin: true, scale: 1, wrap: 0 };
  const last = out[out.length - 1];
  out[out.length - 1] = { ...last, x: spec.tailX, id: "tail", collapse: true, pin: true, scale: 1, wrap: 0 };
  return out;
}

function placeStation(spec, profileAt, st) {
  const rows = sectionRows(spec, profileAt, st.x);
  if (st.collapse) {
    const n = rows.length;
    const dir = st.id === "tail" ? 1 : -1;
    return rows.map((r, i) => {
      const t = i / (n - 1);
      return { x: st.x + Math.sin(Math.PI * t) * 0.018 * dir, y: 0, z: r.z, row: i, st: st.id };
    });
  }
  const scale = st.scale ?? 1;
  const baseShoulder = Math.max(0.04, rows[SHOULDER].y);
  const wrap = st.wrap ?? 0;
  return rows.map((r, i) => {
    const y = r.y * scale;
    const t = y / baseShoulder;
    return { x: st.x + wrap * t * t, y, z: r.z, row: i, st: st.id };
  });
}

function makeGrid(spec, profileAt) {
  const stations = stationList(spec);
  const pts = stations.map((st) => placeStation(spec, profileAt, st));
  // The nose and tail rows must share the neighbouring loop's height, or the
  // cap quads twist into bowties and the subdivided normals flip.
  const n = ROWS;
  for (let i = 0; i < n; i++) {
    const end = i === 0 || i === n - 1;
    const srcN = pts[1][i];
    pts[0][i].z = srcN.z;
    // Taut wedge. The leading edge stays at bumper height (the neighbour's z)
    // and nearly one x. Only the outboard corner tucks aft, so the plan
    // corner is tight instead of a round pelican bulb.
    // One x for the leading edge. The plan spline turns to full width within
    // 0.14 m, and the nose loop is creased, so the corner stays tight without
    // a local tuck that breaks the hood highlight.
    pts[0][i].y = end ? 0 : srcN.y * 0.98;
    pts[0][i].x = spec.noseX - 0.002;
    const srcT = pts[pts.length - 2][i];
    pts[pts.length - 1][i].z = srcT.z;
    pts[pts.length - 1][i].y = end ? 0 : srcT.y * 0.97;
    pts[pts.length - 1][i].x = spec.tailX;
  }
  return { stations, pts, count: stations.length * ROWS + 2 };
}

function centroid(pts) {
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p.x; y += p.y; z += p.z; }
  const n = pts.length || 1;
  return { x: x / n, y: y / n, z: z / n };
}

function inArch(corners, spec) {
  const ys = corners.map((p) => p.y);
  const maxY = Math.max(...ys);
  const minY = Math.min(...ys);
  if (maxY < 0.78 || minY < 0.45) return false;
  const c = centroid(corners);
  if (c.y < 0.7) return false;
  const hole = spec.tyreRadius + 0.012;
  const lip = spec.tyreRadius + spec.archGap + 0.012;
  for (const ax of [spec.frontAxleX, spec.rearAxleX]) {
    const ds = corners.map((p) => Math.hypot(p.x - ax, p.z - spec.tyreCenterZ));
    const inside = ds.filter((d) => d < lip).length;
    if (Math.hypot(c.x - ax, c.z - spec.tyreCenterZ) < hole && inside >= 3) return true;
  }
  return false;
}

function inIntake(corners, spec, bay) {
  if (bay > 1) return false;
  const c = centroid(corners);
  if (c.z > (spec.grilleZ || spec.floorZ + 0.2) + (spec.grilleHalfZ || 0.04) + 0.05) return false;
  if (c.z < spec.floorZ + 0.02) return false;
  const gy = Math.max(0.2, Math.min(spec.grilleHalfY || 0.7, (spec.halfWidth || 0.95) * 0.82));
  const gz = Math.max(0.016, spec.grilleHalfZ || 0.024);
  const cz = spec.grilleZ || spec.floorZ + 0.09;
  const ellipse = (c.y / gy) ** 2 + ((c.z - cz) / gz) ** 2 < 1.2;
  const fallback = bay <= 1 && corners.every((p) => p.row >= ROCKER && p.row <= ROCKER + 2);
  return ellipse || fallback;
}

function inTrim(corners, spec) {
  const xs = corners.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const rMax = Math.max(...corners.map((p) => p.row));
  if (rMax > BELT) return false;
  const b = spec.bPillarX;
  // The two stations astride the pillar are ~32 mm apart. That bay is the
  // dark trim, not a second bubble of glass.
  return xMax - xMin < 0.05 && xMin < b && xMax > b;
}

function inGlass(corners, spec) {
  const xs = corners.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const rMax = Math.max(...corners.map((p) => p.row));
  const cowl = spec.cowlX;
  const cPost = spec.cPillarX || spec.rearAxleX;
  if (xMax < cowl + 0.045) return false;
  if (xMin > cPost - 0.01) return false;
  // One daylight opening: crown through the belt, from the A-pillar base
  // over the roof. The last stretch before the C-pillar drops to the rail
  // so the quarter window tapers and the lower edge kicks up.
  const kick = cPost - 0.18;
  if (xMin > kick) return rMax <= RAIL;
  return rMax <= BELT;
}

function classify(grid, spec) {
  const keep = [];
  const glass = [];
  const intake = [];
  const arch = [];
  const trim = [];
  const nS = grid.pts.length;
  for (let s = 0; s < nS - 1; s++) {
    for (let r = 0; r < ROWS - 1; r++) {
      const corners = [grid.pts[s][r], grid.pts[s + 1][r], grid.pts[s + 1][r + 1], grid.pts[s][r + 1]];
      const quad = [[s, r], [s + 1, r], [s + 1, r + 1], [s, r + 1]];
      if (inArch(corners, spec)) { arch.push(quad); continue; }
      if (inIntake(corners, spec, s)) { intake.push(quad); continue; }
      if (inTrim(corners, spec)) { trim.push(quad); continue; }
      if (inGlass(corners, spec)) { glass.push(quad); continue; }
      keep.push(quad);
    }
  }
  return { keep, glass, intake, arch, trim };
}

function snapArches(grid, keep, spec) {
  const used = new Set();
  for (const q of keep) for (const [s, r] of q) used.add(s * ROWS + r);
  const R = spec.tyreRadius + spec.archGap;
  for (let s = 0; s < grid.pts.length; s++) {
    for (let r = 0; r < ROWS; r++) {
      if (!used.has(s * ROWS + r)) continue;
      const p = grid.pts[s][r];
      if (p.y < 0.84) continue;
      for (const ax of [spec.frontAxleX, spec.rearAxleX]) {
        const dx = p.x - ax;
        const dz = p.z - spec.tyreCenterZ;
        const d = Math.hypot(dx, dz);
        if (d > 1e-4 && d < R - 0.004) {
          const t = (R + 0.01) / d;
          p.x = ax + dx * t;
          p.z = spec.tyreCenterZ + dz * t;
        }
      }
    }
  }
}

// Close a station by folding each row onto the centreline, a few millimetres
// past the loop. Every new vertex lies on y = 0, so the mirror welds it and
// the cap stays valence 4. A single pole was valence ~28 and broke the nose
// highlights.
function spineCap(verts, map, stationIndex, dir, pull) {
  const ids = [];
  for (let r = 0; r < ROWS; r++) ids.push(map.get(stationIndex * ROWS + r));
  if (ids.some((id) => id == null)) return [];
  const spine = [];
  for (let r = 0; r < ROWS; r++) {
    const p = verts[ids[r]];
    const along = pull == null ? 0.01 + 0.04 * Math.sin(Math.PI * (r / (ROWS - 1))) : pull;
    spine.push(verts.length);
    verts.push([p[0] + dir * along, 0, p[2]]);
  }
  const faces = [];
  for (let r = 0; r < ROWS - 1; r++) {
    const a = ids[r];
    const b = ids[r + 1];
    const d = spine[r];
    const c = spine[r + 1];
    faces.push(dir < 0 ? [d, a, b, c] : [a, d, c, b]);
  }
  return faces;
}

function indexGrid(grid, groups) {
  const used = new Set();
  for (const g of groups) for (const q of g) for (const [s, r] of q) used.add(s * ROWS + r);
  const map = new Map();
  const verts = [];
  for (const id of used) {
    const s = Math.floor(id / ROWS);
    const r = id % ROWS;
    map.set(id, verts.length);
    const p = grid.pts[s][r];
    verts.push([p.x, p.y, p.z]);
  }
  const toFaces = (quads) => quads.map((q) => q.map(([s, r]) => map.get(s * ROWS + r)));
  return {
    verts, map,
    keep: toFaces(groups[0]),
    glass: toFaces(groups[1]),
    intake: toFaces(groups[2]),
    trim: toFaces(groups[3] || []),
  };
}

function creaseLists(grid, idx) {
  const creases = [];
  const hard = [];
  const add = (a, b, sharp) => {
    if (a == null || b == null || a === b) return;
    creases.push([a, b, sharp]);
    hard.push([a, b]);
  };
  const at = (s, r) => idx.map.get(s * ROWS + r);
  const nS = grid.pts.length;
  for (let s = 0; s < nS - 1; s++) {
    const x0 = grid.pts[s][0].x;
    const x1 = grid.pts[s + 1][0].x;
    // Sharpness stays >= 1 through the last subdivision, so the corner stays
    // on this edge instead of bleeding into the panels beside it.
    add(at(s, SHOULDER), at(s + 1, SHOULDER), 3.6);
    add(at(s, BELT), at(s + 1, BELT), 3.2);
    add(at(s, RAIL), at(s + 1, RAIL), 3.6);
    add(at(s, ROCKER), at(s + 1, ROCKER), 3.4);
    if (Math.max(x0, x1) < grid.pts[0][0].x + (specCowl(grid) - grid.pts[0][0].x) * 0.98 && x1 < specCowl(grid) + 0.02) {
      add(at(s, HOOD), at(s + 1, HOOD), 3.2);
    }
  }
  for (let s = 0; s < nS; s++) {
    const id = grid.stations[s].id;
    if (id !== "kamm" && id !== "tail" && id !== "nose") continue;
    for (let r = 0; r < ROWS - 1; r++) add(at(s, r), at(s, r + 1), 3.6);
  }
  return { creases, hard };
}

function specCowl(grid) {
  const c = grid.stations.find((s) => s.id === "cowl");
  return c ? c.x : grid.pts[Math.floor(grid.pts.length / 2)][0].x;
}

function mirrorMesh(verts, faceGroups, creases, hardPairs) {
  const n = verts.length;
  const leftOf = new Array(n);
  const out = verts.map((v) => [v[0], v[1], v[2]]);
  for (let i = 0; i < n; i++) {
    if (Math.abs(verts[i][1]) <= 1e-7) {
      out[i][1] = 0;
      leftOf[i] = i;
    } else {
      leftOf[i] = out.length;
      out.push([verts[i][0], -verts[i][1], verts[i][2]]);
    }
  }
  const mirrorFaces = (faces) => {
    const both = faces.map((f) => f.slice());
    for (const f of faces) {
      const mf = new Array(f.length);
      for (let k = 0; k < f.length; k++) mf[k] = leftOf[f[f.length - 1 - k]];
      both.push(mf);
    }
    return both;
  };
  const outC = creases.map(([a, b, s]) => [a, b, s]);
  const outH = hardPairs.map(([a, b]) => [a, b]);
  for (const [a, b, s] of creases) outC.push([leftOf[a], leftOf[b], s]);
  for (const [a, b] of hardPairs) outH.push([leftOf[a], leftOf[b]]);
  return {
    verts: out,
    groups: faceGroups.map(mirrorFaces),
    creases: outC,
    hardPairs: outH,
  };
}

function toMaps(creases, hardPairs) {
  const crease = new Map();
  const hard = new Set();
  for (const [a, b, s] of creases) {
    if (a == null || b == null || a === b) continue;
    const k = edgeKey(a, b);
    crease.set(k, Math.max(crease.get(k) || 0, s));
  }
  for (const [a, b] of hardPairs) {
    if (a == null || b == null || a === b) continue;
    hard.add(edgeKey(a, b));
  }
  return { crease, hard };
}

function faceNormal(pos, f) {
  const a = f[0] * 3, b = f[1] * 3, c = f[2] * 3;
  const nx = (pos[b + 1] - pos[a + 1]) * (pos[c + 2] - pos[a + 2]) - (pos[b + 2] - pos[a + 2]) * (pos[c + 1] - pos[a + 1]);
  const ny = (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]) - (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]);
  const nz = (pos[b] - pos[a]) * (pos[c + 1] - pos[a + 1]) - (pos[b + 1] - pos[a + 1]) * (pos[c] - pos[a]);
  return { x: nx, y: ny, z: nz };
}

function orient(verts, groups) {
  const pos = new Float64Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    pos[i * 3] = verts[i][0]; pos[i * 3 + 1] = verts[i][1]; pos[i * 3 + 2] = verts[i][2];
  }
  let score = 0;
  for (const f of groups[0]) {
    let x = 0, y = 0, z = 0;
    for (const i of f) { x += pos[i * 3]; y += pos[i * 3 + 1]; z += pos[i * 3 + 2]; }
    x /= f.length; y /= f.length; z /= f.length;
    if (z < 0.5 || Math.abs(y) > 0.25) continue;
    score += faceNormal(pos, f).z;
  }
  if (score >= 0) return { positions: pos, groups };
  const flipped = groups.map((faces) => faces.map((f) => [...f].reverse()));
  return { positions: pos, groups: flipped };
}

function markBoundaries(positions, faces, hard) {
  const count = new Map();
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const k = edgeKey(f[i], f[(i + 1) % f.length]);
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  for (const [k, n] of count) if (n === 1) hard.add(k);
  void positions;
  return count;
}

function triangulate(faces) {
  const idx = [];
  for (const f of faces) {
    if (f.length === 4) idx.push(f[0], f[1], f[2], f[0], f[2], f[3]);
    else if (f.length === 3) idx.push(f[0], f[1], f[2]);
    else for (let i = 1; i < f.length - 1; i++) idx.push(f[0], f[i], f[i + 1]);
  }
  return idx;
}

function computeNormals(positions, indices) {
  const n = positions.length / 3;
  const acc = new Float64Array(n * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const nx = (positions[b + 1] - positions[a + 1]) * (positions[c + 2] - positions[a + 2]) - (positions[b + 2] - positions[a + 2]) * (positions[c + 1] - positions[a + 1]);
    const ny = (positions[b + 2] - positions[a + 2]) * (positions[c] - positions[a]) - (positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2]);
    const nz = (positions[b] - positions[a]) * (positions[c + 1] - positions[a + 1]) - (positions[b + 1] - positions[a + 1]) * (positions[c] - positions[a]);
    acc[a] += nx; acc[a + 1] += ny; acc[a + 2] += nz;
    acc[b] += nx; acc[b + 1] += ny; acc[b + 2] += nz;
    acc[c] += nx; acc[c + 1] += ny; acc[c + 2] += nz;
  }
  const normals = new Array(n * 3);
  for (let i = 0; i < n; i++) {
    let nx = acc[i * 3], ny = acc[i * 3 + 1], nz = acc[i * 3 + 2];
    if (Math.abs(positions[i * 3 + 1]) < 1e-4) ny = 0;
    let L = Math.hypot(nx, ny, nz);
    if (L < 1e-12) { nx = 0; ny = 0; nz = 1; L = 1; }
    normals[i * 3] = nx / L;
    normals[i * 3 + 1] = ny / L;
    normals[i * 3 + 2] = nz / L;
  }
  return normals;
}

function asArray(src) {
  const out = new Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i];
  return out;
}

function sampleLimit(positions, spec) {
  const step = 0.05;
  const x0 = spec.noseX - 0.04;
  const x1 = spec.tailX + 0.04;
  const nBins = Math.max(2, Math.ceil((x1 - x0) / step));
  const bins = [];
  for (let i = 0; i < nBins; i++) bins.push({ x: x0 + (i + 0.5) * step, crown: -Infinity, samples: [] });
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const y = Math.abs(positions[i * 3 + 1]);
    const z = positions[i * 3 + 2];
    const b = Math.floor((x - x0) / step);
    if (b < 0 || b >= nBins) continue;
    // The floor centreline survives inside a daylight opening. It is not the roof.
    // Leave that bin empty so the crown spline bridges the glass, the way the
    // sheet metal does. A sample under the rocker was reading as a 0.13 m roof
    // and then as a metre-scale cage lift.
    const floorCut = (spec.floorZ ?? 0.1) + 0.09;
    if (y < 0.055 && z > floorCut && z > bins[b].crown) bins[b].crown = z;
    bins[b].samples.push({ z, y });
  }
  const crown = [];
  const xs = [];
  const cols = [];
  for (const bin of bins) {
    // Centreline only. A daylight opening has no skin there; the spline bridges it.
    if (bin.crown > -1e8) crown.push({ x: Math.round(bin.x * 1e3) / 1e3, v: bin.crown });
    if (!bin.samples.length) continue;
    const zmap = new Map();
    for (const s of bin.samples) {
      const k = Math.round(s.z / 0.04);
      const prev = zmap.get(k);
      if (!prev || s.y > prev.y) zmap.set(k, { z: k * 0.04, y: s.y });
    }
    xs.push(Math.round(bin.x * 1e3) / 1e3);
    cols.push([...zmap.values()].sort((a, b) => a.z - b.z));
  }
  return { crown, width: { xs, cols } };
}

function widthAt(grid, x, z) {
  const xs = grid?.xs || [];
  if (!xs.length) return NaN;
  let i = 0;
  while (i < xs.length - 1 && xs[i + 1] < x) i++;
  const colW = (col) => {
    if (!col?.length) return NaN;
    let best = -Infinity;
    let near = col[0];
    let nd = Infinity;
    for (const s of col) {
      const d = Math.abs(s.z - z);
      if (d < nd) { nd = d; near = s; }
      if (d <= 0.06) best = Math.max(best, s.y);
    }
    return best > -1e8 ? best : near.y;
  };
  const y0 = colW(grid.cols[i]);
  if (i >= xs.length - 1) return y0;
  const t = clamp((x - xs[i]) / (xs[i + 1] - xs[i] || 1), 0, 1);
  const y1 = colW(grid.cols[i + 1]);
  return y0 + (y1 - y0) * t;
}

function limitMisses(samples, spec) {
  const conflicts = Array.isArray(spec.packageConflicts) ? spec.packageConflicts : [];
  if (samples.crown.length < 2) return [];
  const ev = makeSpline(samples.crown);
  const out = [];
  for (const hit of conflicts) {
    if (!hit || !Number.isFinite(hit.x)) continue;
    const hx = hit.hx || 0;
    const xs = [hit.x - hx, hit.x, hit.x + hx].map((x) => clamp(x, spec.noseX, spec.tailX));
    if (Number.isFinite(hit.zTop)) {
      let low = Infinity;
      for (const x of xs) low = Math.min(low, ev(x));
      const need = hit.zTop + (Number.isFinite(hit.zClear) ? 0.006 : -0.045);
      const deficit = need - low;
      if (deficit > 0.003) out.push({ kind: "z", x0: hit.x - hx, x1: hit.x + hx, deficit, reason: hit.reason || "package" });
    }
    if (Number.isFinite(hit.yHalf)) {
      const have = widthAt(samples.width, hit.x, Number.isFinite(hit.zTop) ? hit.zTop : spec.floorZ + 0.2);
      const deficit = (hit.yHalf - 0.04) - have;
      if (deficit > 0.003) out.push({ kind: "y", x0: hit.x - hx, x1: hit.x + hx, deficit, reason: hit.reason || "package" });
    }
  }
  return out;
}

function applyMisses(grid, misses) {
  const notes = [];
  for (const miss of misses) {
    let peak = 0;
    for (const row of grid.pts) {
      const x = row[0].x;
      if (x < miss.x0 - 0.14 || x > miss.x1 + 0.14) continue;
      let w = 1;
      if (x < miss.x0) w = 1 - (miss.x0 - x) / 0.14;
      if (x > miss.x1) w = 1 - (x - miss.x1) / 0.14;
      w = Math.max(0, w);
      const d = miss.deficit * 1.5 * w;
      if (d <= 0) continue;
      if (miss.kind === "z") {
        for (let r = 0; r <= SHOULDER; r++) row[r].z += d;
      } else {
        for (let r = 1; r < ROWS - 1; r++) row[r].y = Math.min(row[r].y + d, (row[SHOULDER].y || d) + d);
      }
      peak = Math.max(peak, d);
    }
    if (peak > 0.002) {
      const mm = Math.round(peak * 1000);
      notes.push(miss.kind === "y"
        ? `cage plan raised ${mm} mm for ${miss.reason}`
        : `cage crown raised ${mm} mm for ${miss.reason}`);
    }
  }
  return notes;
}

function archViolations(positions, spec) {
  const R = spec.tyreRadius + spec.archGap;
  let n = 0;
  const nV = positions.length / 3;
  for (let i = 0; i < nV; i++) {
    const y = Math.abs(positions[i * 3 + 1]);
    if (y <= 0.9) continue;
    for (const ax of [spec.frontAxleX, spec.rearAxleX]) {
      const d = Math.hypot(positions[i * 3] - ax, positions[i * 3 + 2] - spec.tyreCenterZ);
      if (d < R - 0.02) n++;
    }
  }
  return n;
}

function faceList(facesOrIdx) {
  if (facesOrIdx.length && Array.isArray(facesOrIdx[0])) return facesOrIdx;
  const faces = [];
  for (let t = 0; t < facesOrIdx.length; t += 3) faces.push([facesOrIdx[t], facesOrIdx[t + 1], facesOrIdx[t + 2]]);
  return faces;
}

function newell(positions, f) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < f.length; i++) {
    const a = f[i] * 3;
    const b = f[(i + 1) % f.length] * 3;
    nx += (positions[a + 1] - positions[b + 1]) * (positions[a + 2] + positions[b + 2]);
    ny += (positions[a + 2] - positions[b + 2]) * (positions[a] + positions[b]);
    nz += (positions[a] - positions[b]) * (positions[a + 1] + positions[b + 1]);
  }
  return [nx, ny, nz];
}

// Dihedral of adjacent cage faces. Quad diagonals are not surface edges, so
// a quad list is measured as quads. Degenerate faces are skipped: a zero-area
// triangle was producing a unit-length noise normal and a fake 90°+ bend.
function highlightMetric(positions, facesOrIdx, hard) {
  const faces = faceList(facesOrIdx);
  const faceN = new Array(faces.length);
  const uses = new Map();
  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    const n = newell(positions, f);
    const L = Math.hypot(n[0], n[1], n[2]);
    // Slivers where the cap meets the centreline. Their normals are noise.
    if (L < 2e-5) continue;
    faceN[fi] = [n[0] / L, n[1] / L, n[2] / L];
    for (let i = 0; i < f.length; i++) {
      const key = edgeKey(f[i], f[(i + 1) % f.length]);
      const rec = uses.get(key);
      if (rec) rec.push(fi);
      else uses.set(key, [fi]);
    }
  }
  let max = 0;
  let panelMax = 0;
  let over = 0;
  let samples = 0;
  for (const [k, fs] of uses) {
    if (fs.length !== 2 || hard.has(k)) continue;
    const n0 = faceN[fs[0]];
    const n1 = faceN[fs[1]];
    if (!n0 || !n1) continue;
    const dot = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
    const ang = Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;
    samples++;
    if (ang > max) max = ang;
    const f = faces[fs[0]];
    let a = f[0];
    let b = f[1];
    for (let i = 0; i < f.length; i++) {
      if (edgeKey(f[i], f[(i + 1) % f.length]) === k) { a = f[i]; b = f[(i + 1) % f.length]; break; }
    }
    const len = Math.hypot(
      positions[a * 3] - positions[b * 3],
      positions[a * 3 + 1] - positions[b * 3 + 1],
      positions[a * 3 + 2] - positions[b * 3 + 2],
    );
    if (len >= 0.028 && ang > panelMax) panelMax = ang;
    if (ang > 8) over++;
  }
  return {
    maxDeg: Math.round(max * 10) / 10,
    panelMaxDeg: Math.round(panelMax * 10) / 10,
    over8: over,
    samples,
  };
}

function grilleFrom(verts, faces) {
  const pts = [];
  const seen = new Set();
  for (const f of faces) for (const i of f) {
    if (seen.has(i)) continue;
    seen.add(i);
    pts.push({ x: verts[i][0], y: verts[i][1], z: verts[i][2] });
  }
  return pts;
}

function buildArchWell(positions, indices, spec) {
  const count = new Map();
  const touch = (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    count.set(k, (count.get(k) || 0) + 1);
  };
  for (let t = 0; t < indices.length; t += 3) {
    touch(indices[t], indices[t + 1]);
    touch(indices[t + 1], indices[t + 2]);
    touch(indices[t + 2], indices[t]);
  }
  const R = spec.tyreRadius + spec.archGap;
  const pos = [];
  const idx = [];
  const add = (p) => { const i = pos.length / 3; pos.push(p.x, p.y, p.z); return i; };
  for (const [k, n] of count) {
    if (n !== 1) continue;
    const [ia, ib] = k.split("|").map(Number);
    const pa = { x: positions[ia * 3], y: positions[ia * 3 + 1], z: positions[ia * 3 + 2] };
    const pb = { x: positions[ib * 3], y: positions[ib * 3 + 1], z: positions[ib * 3 + 2] };
    if (Math.abs(pa.y) < 0.55 || Math.abs(pb.y) < 0.55) continue;
    let axle = spec.frontAxleX;
    let best = Infinity;
    for (const ax of [spec.frontAxleX, spec.rearAxleX]) {
      const e = Math.abs(Math.hypot(pa.x - ax, pa.z - spec.tyreCenterZ) - R) + Math.abs(Math.hypot(pb.x - ax, pb.z - spec.tyreCenterZ) - R);
      if (e < best) { best = e; axle = ax; }
    }
    if (best > 0.09) continue;
    const pull = (p, dist, yIn) => {
      const dx = p.x - axle;
      const dz = p.z - spec.tyreCenterZ;
      const L = Math.hypot(dx, dz) || 1;
      const side = Math.sign(p.y) || 1;
      return { x: p.x - (dx / L) * dist, y: p.y - side * yIn, z: p.z - (dz / L) * dist };
    };
    const a0 = add(pull(pa, 0.012, 0.01));
    const b0 = add(pull(pb, 0.012, 0.01));
    const a1 = add(pull(pa, 0.05, 0.04));
    const b1 = add(pull(pb, 0.05, 0.04));
    idx.push(a0, b0, b1, a0, b1, a1);
  }
  const normals = pos.length ? computeNormals(pos, idx) : [];
  return { positions: pos, normals, indices: idx };
}

function swapGlassFront(glass, bodyPos) {
  const n = glass.positions.length / 3;
  if (n < 2) return;
  const step = Math.max(1, Math.floor(n / 48));
  let pick = 0;
  let best = Infinity;
  const bStep = Math.max(1, Math.floor(bodyPos.length / 3 / 4000));
  for (let i = 0; i < n; i += step) {
    const x = glass.positions[i * 3], y = glass.positions[i * 3 + 1], z = glass.positions[i * 3 + 2];
    let near = Infinity;
    for (let j = 0; j < bodyPos.length; j += 3 * bStep) {
      const d = Math.hypot(bodyPos[j] - x, bodyPos[j + 1] - y, bodyPos[j + 2] - z);
      if (d < near) near = d;
    }
    const err = Math.abs(near - GLASS_OFFSET);
    if (err < best) { best = err; pick = i; }
  }
  if (pick === 0) return;
  const swapV = (arr, stride) => {
    for (let k = 0; k < stride; k++) {
      const tmp = arr[k];
      arr[k] = arr[pick * stride + k];
      arr[pick * stride + k] = tmp;
    }
  };
  swapV(glass.positions, 3);
  swapV(glass.normals, 3);
  for (let i = 0; i < glass.indices.length; i++) {
    if (glass.indices[i] === 0) glass.indices[i] = pick;
    else if (glass.indices[i] === pick) glass.indices[i] = 0;
  }
}

function subdivideParts(spec, grid) {
  const groups = classify(grid, spec);
  if (!groups.intake.length) {
    // The ellipse missed the nose. Cut a small mouth and drop those quads from the skin.
    const extra = [];
    const nS = grid.pts.length;
    for (let s = 0; s < Math.min(2, nS - 1); s++) {
      for (let r = ROCKER; r <= ROCKER + 2 && r < ROWS - 1; r++) extra.push([[s, r], [s + 1, r], [s + 1, r + 1], [s, r + 1]]);
    }
    const key = (q) => q.map((p) => p.join(":")).join("|");
    const drop = new Set(extra.map(key));
    groups.keep = groups.keep.filter((q) => !drop.has(key(q)));
    groups.intake = extra;
  }
  snapArches(grid, groups.keep, spec);
  const indexed = indexGrid(grid, [groups.keep, groups.glass, groups.intake, groups.trim]);
  indexed.keep.push(...spineCap(indexed.verts, indexed.map, 0, -1, 0.006));
  indexed.keep.push(...spineCap(indexed.verts, indexed.map, grid.pts.length - 1, 1, 0.004));
  const cre = creaseLists(grid, indexed);
  const mirrored = mirrorMesh(indexed.verts, [indexed.keep, indexed.glass, indexed.intake, indexed.trim], cre.creases, cre.hard);
  const oriented = orient(mirrored.verts, mirrored.groups);
  const maps = toMaps(mirrored.creases, mirrored.hardPairs);
  markBoundaries(oriented.positions, oriented.groups[0], maps.hard);
  const levels = spec.quality === "mobile" ? 2 : 3;
  const body = catmullClark({
    positions: oriented.positions,
    faces: oriented.groups[0],
    crease: maps.crease,
    hard: maps.hard,
  }, levels);
  const glassIn = catmullClark({
    positions: oriented.positions.slice(),
    faces: oriented.groups[1],
    crease: new Map(),
    hard: new Set(),
  }, levels);
  const trimIn = oriented.groups[3].length
    ? catmullClark({
      positions: oriented.positions.slice(),
      faces: oriented.groups[3],
      crease: new Map(),
      hard: new Set(),
    }, levels)
    : { positions: new Float64Array(0), faces: [] };
  const bodyIdx = triangulate(body.faces);
  const glassIdx = triangulate(glassIn.faces);
  const trimIdx = triangulate(trimIn.faces);
  const positions = asArray(body.positions);
  const glassRaw = asArray(glassIn.positions);
  const glassPos = glassRaw.slice();
  const normals = computeNormals(positions, bodyIdx);
  const gNormals = computeNormals(glassPos, glassIdx);
  for (let i = 0; i < glassPos.length; i += 3) {
    glassPos[i] += gNormals[i] * GLASS_OFFSET;
    glassPos[i + 1] += gNormals[i + 1] * GLASS_OFFSET;
    glassPos[i + 2] += gNormals[i + 2] * GLASS_OFFSET;
  }
  const glass = { positions: glassPos, normals: gNormals, indices: glassIdx };
  swapGlassFront(glass, positions);
  const trimPos = asArray(trimIn.positions);
  const trim = { positions: trimPos, normals: computeNormals(trimPos, trimIdx), indices: trimIdx };
  const hl = highlightMetric(positions, body.faces, body.hard);
  // Roof glass is the crown. Sample it before the 4 mm offset, or the
  // centreline bins under the daylight opening read as the floor.
  const samples = sampleLimit(joinPos(positions, glassRaw), spec);
  const grillePts = grilleFrom(mirrored.verts, mirrored.groups[2]);
  const mesh = { positions, normals, indices: bodyIdx, triangles: bodyIdx.length / 3 };
  return {
    mesh, glass, trim, samples, highlight: hl, grillePts, levels,
    archCount: archViolations(positions, spec),
    controlPoints: indexed.verts.length,
  };
}

function joinPos(a, b) {
  if (!b.length) return a;
  const out = new Float64Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export function buildCageBody(spec, profileAt) {
  const grid = makeGrid(spec, profileAt);
  let built = subdivideParts(spec, grid);
  const notes = [];
  for (let iter = 0; iter < 2 && (limitMisses(built.samples, spec).length || built.archCount); iter++) {
    const miss = limitMisses(built.samples, spec);
    if (miss.length) notes.push(...applyMisses(grid, miss));
    if (built.archCount) snapArches(grid, classify(grid, spec).keep, spec);
    built = subdivideParts(spec, grid);
  }
  const fresh = (spec.pushes || []).filter((p) => !String(p).startsWith("cage "));
  spec.pushes = fresh.concat(notes);
  spec.limitCrown = built.samples.crown;
  spec.limitWidth = built.samples.width;
  spec.cagePoints = built.controlPoints;
  spec.cageLevels = built.levels;
  spec.highlightContinuity = {
    maxDeg: built.highlight.maxDeg,
    panelMaxDeg: built.highlight.panelMaxDeg,
    over8: built.highlight.over8,
    samples: built.highlight.samples,
  };
  spec.grillePts = built.grillePts;
  const archWell = buildArchWell(built.mesh.positions, built.mesh.indices, spec);
  return {
    mesh: built.mesh,
    archWell,
    glass: built.glass,
    trim: built.trim,
    stations: grid.stations.length,
    section: ROWS,
  };
}

export { widthAt };
