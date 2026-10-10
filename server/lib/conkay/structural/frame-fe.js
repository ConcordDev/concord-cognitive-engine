// server/lib/conkay/structural/frame-fe.js
//
// Linear-static 3D frame FE with linear (eigenvalue) buckling, in SI.
//
// Wraps Concord's existing beam-frame element (lib/simulation/fea-solver.js:
// 12-DOF Euler-Bernoulli element, its rotation convention and global assembly,
// pinned by tests/fea-frame-element.test.js) and adds what a design check
// needs and that path does not do:
//   - members subdivided into elements, member uniform loads (consistent
//     nodal loads + fixed-end forces), internal forces along every element;
//   - a reduced solve on the free DOFs (Cholesky): a mechanism is reported,
//     never solved by penalty into a fake answer;
//   - section properties (rect / round tube, solid rect, I) and stress
//     recovery: sigma = |N|/A + bending at the extreme fibre, torsional shear,
//     von Mises combination;
//   - linear buckling: (K + lambda Kg) phi = 0 with the consistent geometric
//     stiffness of each element from its axial force in the load case;
//   - a validity check: every result outside the model's stated range is
//     flagged (FrameValidity), never reported as a pass.
//
// Validity range (stated; outside it, results are flagged):
//   linear elastic material, stress below yield; small displacements
//   (rotations < 0.1 rad, translations < 2 % of the longest member);
//   Euler-Bernoulli members (length / depth >= 10 for every member carrying
//   at least a quarter of the largest bending stress; shear deformation not
//   modelled); flexural buckling only (no lateral-torsional, local or
//   torsional buckling); elastic buckling (each compressed member's stress at
//   the critical load <= 0.44 Fy, the AISC 360-16 E3 elastic limit
//   Fy/Fe <= 2.25); tube walls within AISC 360-16 Table B4.1a slenderness
//   (rect HSS b/t <= 1.40 sqrt(E/Fy), round HSS D/t <= 0.11 E/Fy), since
//   local buckling is not modelled; transverse shear stress neglected.
//
// Local axes: local x along the member; local y from the member's yRef or the
// model's `up` vector (model.up = [0,0,1] for a z-up model: horizontal
// members have their section height vertical; members along `up` use global
// x as reference); without either, fea-solver's planar convention (XY-plane
// frames, y up). local z = x × y. A section's `height` lies along local y
// (bending about local z uses Iz).

import { buildStiffnessMatrix, elementData } from "../../simulation/fea-solver.js";

export const FRAME_FE_VERSION = "1.0.0";
const DOF = 6;
const DOF_MAP = { x: 0, y: 1, z: 2, rx: 3, ry: 4, rz: 5 };

// ── sections ────────────────────────────────────────────────────────────────

/**
 * Section properties. shapes (SI, m):
 *   rect-tube { width, height, wall }   thin-walled closed (Bredt) torsion
 *   round-tube { od, wall }
 *   rect { width, height }              solid
 *   i-beam { height, flangeWidth, flangeThickness, webThickness }  open, thin-walled torsion
 *   properties { A, Iz, Iy, J, cy?, cz?, depth?, tauPerT? }  given directly
 * Returns { A, Iz, Iy, J, cy, cz, round, torsionShear(T), depth, wall? , kind }.
 */
export function sectionProps(s) {
  if (!s || typeof s !== "object") throw new Error("section required");
  if (s.shape === "rect-tube") {
    const b = s.width, h = s.height, t = s.wall;
    if (!(b > 2 * t && h > 2 * t && t > 0)) throw new Error("rect-tube needs width, height > 2·wall > 0");
    const bi = b - 2 * t, hi = h - 2 * t;
    const Am = (b - t) * (h - t);
    return {
      kind: "rect-tube", A: b * h - bi * hi, Iz: (b * h ** 3 - bi * hi ** 3) / 12, Iy: (h * b ** 3 - hi * bi ** 3) / 12,
      J: (2 * t * (b - t) ** 2 * (h - t) ** 2) / (b + h - 2 * t), cy: h / 2, cz: b / 2, round: false, depth: Math.max(b, h),
      wallSlenderness: { ratio: (Math.max(b, h) - 3 * t) / t, basis: "flat width (b - 3t) / t, AISC 360-16 B4.1b(d)" },
      torsionShear: (T) => Math.abs(T) / (2 * t * Am),
    };
  }
  if (s.shape === "round-tube") {
    const D = s.od, t = s.wall, d = D - 2 * t;
    if (!(D > 2 * t && t > 0)) throw new Error("round-tube needs od > 2·wall > 0");
    const I = (Math.PI / 64) * (D ** 4 - d ** 4);
    return {
      kind: "round-tube", A: (Math.PI / 4) * (D ** 2 - d ** 2), Iz: I, Iy: I, J: 2 * I, cy: D / 2, cz: D / 2, round: true, depth: D,
      wallSlenderness: { ratio: D / t, basis: "D / t" },
      torsionShear: (T) => (Math.abs(T) * D) / 2 / (2 * I),
    };
  }
  if (s.shape === "rect") {
    const b = s.width, h = s.height;
    const long = Math.max(b, h), short = Math.min(b, h), q = short / long;
    const beta = 1 / 3 - 0.21 * q * (1 - q ** 4 / 12);
    return {
      kind: "rect", A: b * h, Iz: (b * h ** 3) / 12, Iy: (h * b ** 3) / 12, J: beta * long * short ** 3, cy: h / 2, cz: b / 2, round: false, depth: long,
      torsionShear: (T) => (Math.abs(T) * (3 * long + 1.8 * short)) / (long ** 2 * short ** 2),
    };
  }
  if (s.shape === "i-beam") {
    const h = s.height, bf = s.flangeWidth, tf = s.flangeThickness, tw = s.webThickness;
    const hw = h - 2 * tf;
    const J = (2 * bf * tf ** 3 + (h - tf) * tw ** 3) / 3;
    return {
      kind: "i-beam", A: 2 * bf * tf + hw * tw, Iz: (bf * h ** 3 - (bf - tw) * hw ** 3) / 12, Iy: (2 * tf * bf ** 3) / 12 + (hw * tw ** 3) / 12,
      J, cy: h / 2, cz: bf / 2, round: false, depth: h,
      torsionShear: (T) => (Math.abs(T) * Math.max(tf, tw)) / J,
    };
  }
  if (s.shape === "properties") {
    // explicit section properties (a catalogue section, or a benchmark idealisation such as
    // an axially rigid member); stresses need cy, cz; torsional shear needs tauPerT (1/m^3)
    for (const k of ["A", "Iz", "Iy", "J"]) if (!(s[k] > 0)) throw new Error(`properties section needs ${k} > 0`);
    return {
      kind: "properties", A: s.A, Iz: s.Iz, Iy: s.Iy, J: s.J, cy: s.cy ?? 0, cz: s.cz ?? 0, round: false, depth: s.depth ?? 2 * Math.max(s.cy ?? 0, s.cz ?? 0),
      torsionShear: (T) => Math.abs(T) * (s.tauPerT ?? 0),
    };
  }
  throw new Error(`section shape "${s.shape}" not supported (rect-tube, round-tube, rect, i-beam, properties)`);
}

// ── dense linear algebra on the free DOFs ───────────────────────────────────

function cholesky(A, n) {
  const L = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    let s = A[j * n + j];
    for (let k = 0; k < j; k++) s -= L[j * n + k] ** 2;
    if (!(s > 1e-9 * Math.abs(A[j * n + j] || 1)) || !(s > 0)) return { ok: false, dof: j };
    const d = Math.sqrt(s);
    L[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let v = A[i * n + j];
      for (let k = 0; k < j; k++) v -= L[i * n + k] * L[j * n + k];
      L[i * n + j] = v / d;
    }
  }
  return { ok: true, L };
}

function cholSolve(L, n, b) {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let v = b[i]; for (let k = 0; k < i; k++) v -= L[i * n + k] * y[k]; y[i] = v / L[i * n + i]; }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let v = y[i]; for (let k = i + 1; k < n; k++) v -= L[k * n + i] * x[k]; x[i] = v / L[i * n + i]; }
  return x;
}

/** Cyclic Jacobi eigenvalues of a symmetric matrix (in place). Returns { values, vectors (column-major n×n) }. */
function jacobiEigen(A, n, { tol = 1e-12, maxSweeps = 60 } = {}) {
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0, diag = 0;
    for (let i = 0; i < n; i++) { diag += A[i * n + i] ** 2; for (let j = i + 1; j < n; j++) off += A[i * n + j] ** 2; }
    if (off <= tol * tol * Math.max(diag, 1e-300)) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = A[p * n + p], aqq = A[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p], akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k], aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p], vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: Array.from({ length: n }, (_, i) => A[i * n + i]), vectors: V };
}

// ── model ───────────────────────────────────────────────────────────────────

/**
 * Local y reference of a member: its own yRef, else the model's `up` vector
 * (members parallel to `up` take global x, or global y if they lie along x),
 * else undefined (fea-solver's planar convention: XY-plane frames, y up).
 */
function localYRef(m, a, b, up) {
  if (m.yRef) return m.yRef;
  if (!up) return undefined;
  const d = [b.x - a.x, b.y - a.y, b.z - a.z];
  const L = Math.hypot(...d);
  const cos = Math.abs(d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / (L * Math.hypot(...up));
  if (cos < 0.999) return up;
  return Math.abs(d[0]) / L > 0.999 ? [0, 1, 0] : [1, 0, 0];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * Build the element mesh. model: { nodes: [{ id, x, y, z }], members: [{ id, i, j,
 * section, E, G, fy?, segments? }], supports: [{ node, fix: ["x",...] | "fixed" | "pinned" }] }
 */
function mesh(model, segmentsDefault) {
  const nodes = model.nodes.map((n) => ({ id: String(n.id), x: n.x, y: n.y, z: n.z ?? 0 }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const elements = [];
  const members = [];
  for (const m of model.members) {
    const a = byId.get(String(m.i)), b = byId.get(String(m.j));
    if (!a || !b) throw new Error(`member ${m.id}: unknown node ${!a ? m.i : m.j}`);
    const sec = sectionProps(m.section);
    if (!(m.E > 0)) throw new Error(`member ${m.id}: E required`);
    const G = m.G > 0 ? m.G : null;
    if (!G) throw new Error(`member ${m.id}: G required (E / (2 (1 + nu)))`);
    const nSeg = Math.max(1, Math.round(m.segments ?? segmentsDefault));
    const ids = [a.id];
    for (let s = 1; s < nSeg; s++) {
      const t = s / nSeg;
      const id = `${m.id}#${s}`;
      const n = { id, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, internal: true };
      nodes.push(n); byId.set(id, n); ids.push(id);
    }
    ids.push(b.id);
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const mem = { ...m, sec, L, elements: [] };
    for (let s = 0; s < nSeg; s++) {
      const e = { id: `${m.id}:${s}`, member: m.id, nodeI: ids[s], nodeJ: ids[s + 1], yRef: localYRef(m, a, b, model.up), area: sec.A, Iz: sec.Iz, Iy: sec.Iy, J: sec.J, elasticModulus: m.E, shearModulus: G, s0: (s / nSeg) * L };
      elements.push(e); mem.elements.push(e);
    }
    members.push(mem);
  }
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const constrained = new Set();
  for (const s of model.supports || []) {
    const i = index.get(String(s.node));
    if (i == null) throw new Error(`support at unknown node ${s.node}`);
    const fix = s.fix === "fixed" ? Object.keys(DOF_MAP) : s.fix === "pinned" ? ["x", "y", "z"] : s.fix || [];
    for (const d of fix) constrained.add(i * DOF + DOF_MAP[d]);
  }
  return { nodes, elements, members, index, constrained };
}

/** Consistent load vector (local) of a uniform local load q = [qx, qy, qz] (N/m) on an element of length L. */
function udlLocal(q, L) {
  const [qx, qy, qz] = q;
  const p = new Float64Array(12);
  p[0] = (qx * L) / 2; p[6] = (qx * L) / 2;
  p[1] = (qy * L) / 2; p[5] = (qy * L * L) / 12; p[7] = (qy * L) / 2; p[11] = -(qy * L * L) / 12;
  p[2] = (qz * L) / 2; p[4] = -(qz * L * L) / 12; p[8] = (qz * L) / 2; p[10] = (qz * L * L) / 12; // theta_y = -dw/dx
  return p;
}

const matVec3 = (R, v) => [0, 1, 2].map((r) => R[r][0] * v[0] + R[r][1] * v[1] + R[r][2] * v[2]);
function toLocal12(R, ue) { const o = new Float64Array(12); for (let b = 0; b < 4; b++) { const v = matVec3(R, [ue[b * 3], ue[b * 3 + 1], ue[b * 3 + 2]]); o.set(v, b * 3); } return o; }
function toGlobal12(R, pl) { const o = new Float64Array(12); for (let b = 0; b < 4; b++) for (let c = 0; c < 3; c++) o[b * 3 + c] = R[0][c] * pl[b * 3] + R[1][c] * pl[b * 3 + 1] + R[2][c] * pl[b * 3 + 2]; return o; }

/** Consistent geometric stiffness (local, 12×12) of an element with axial force N (tension +). */
function geometricLocal(N, L) {
  const kg = Array.from({ length: 12 }, () => new Float64Array(12));
  const c = N / (30 * L);
  const base = [[36, 3 * L, -36, 3 * L], [3 * L, 4 * L * L, -3 * L, -L * L], [-36, -3 * L, 36, -3 * L], [3 * L, -L * L, -3 * L, 4 * L * L]];
  const put = (dofs, sgn) => {
    for (let r = 0; r < 4; r++) {for (let q = 0; q < 4; q++) {
      const flip = (r % 2) !== (q % 2) ? sgn : 1; // rotation-translation coupling sign
      kg[dofs[r]][dofs[q]] += c * base[r][q] * flip;
    }}
  };
  put([1, 5, 7, 11], 1); // v, theta_z
  put([2, 4, 8, 10], -1); // w, theta_y (theta_y = -dw/dx)
  return kg;
}

/**
 * Solve. model as in mesh() plus loadCases: [{ id, nodal: [{ node, F: [fx,fy,fz], M?: [mx,my,mz] }],
 * udl: [{ member, w: [wx,wy,wz] (global, N/m) }] }], options { segments (8), buckling: [loadCaseId] }.
 */
export function analyzeFrame(model, { segments = 8, buckling = [] } = {}) {
  const M = mesh(model, segments);
  const nN = M.nodes.length, size = nN * DOF;
  const { K } = buildStiffnessMatrix(M.elements, M.nodes);
  const free = [];
  for (let i = 0; i < size; i++) if (!M.constrained.has(i)) free.push(i);
  const nf = free.length;
  const Kff = new Float64Array(nf * nf);
  for (let a = 0; a < nf; a++) for (let b = 0; b < nf; b++) Kff[a * nf + b] = K[free[a] * size + free[b]];
  const ch = cholesky(Kff, nf);
  if (!ch.ok) {
    const d = free[ch.dof];
    return { ok: false, error: "mechanism", detail: `no stiffness at ${M.nodes[Math.floor(d / DOF)].id}.${Object.keys(DOF_MAP)[d % DOF]}: the structure is unstable or under-restrained` };
  }
  const elData = new Map(M.elements.map((e) => [e.id, elementData(M.nodes, e)]));
  const memberById = new Map(M.members.map((m) => [m.id, m]));
  const cases = [];
  for (const lc of model.loadCases || []) {
    const F = new Float64Array(size);
    for (const l of lc.nodal || []) {
      const i = M.index.get(String(l.node));
      if (i == null) throw new Error(`load case ${lc.id}: unknown node ${l.node}`);
      (l.F || []).forEach((v, k) => { F[i * DOF + k] += v || 0; });
      (l.M || []).forEach((v, k) => { F[i * DOF + 3 + k] += v || 0; });
    }
    const qLocal = new Map(); // element id → local q
    for (const u of lc.udl || []) {
      const mem = memberById.get(u.member);
      if (!mem) throw new Error(`load case ${lc.id}: unknown member ${u.member}`);
      for (const e of mem.elements) {
        const { R, props } = elData.get(e.id);
        const q = matVec3(R, u.w);
        const prev = qLocal.get(e.id) || [0, 0, 0];
        qLocal.set(e.id, [prev[0] + q[0], prev[1] + q[1], prev[2] + q[2]]);
        const pg = toGlobal12(R, udlLocal(q, props.L));
        const ii = M.index.get(e.nodeI), jj = M.index.get(e.nodeJ);
        for (let d = 0; d < 6; d++) { F[ii * DOF + d] += pg[d]; F[jj * DOF + d] += pg[6 + d]; }
      }
    }
    const uf = cholSolve(ch.L, nf, Float64Array.from(free, (i) => F[i]));
    const u = new Float64Array(size);
    free.forEach((i, a) => { u[i] = uf[a]; });
    // reactions R = K u - F at constrained DOFs
    const reactions = [];
    for (const i of M.constrained) {
      let v = 0;
      for (let j = 0; j < size; j++) v += K[i * size + j] * u[j];
      reactions.push({ node: M.nodes[Math.floor(i / DOF)].id, dof: Object.keys(DOF_MAP)[i % DOF], value: v - F[i] });
    }
    // element end forces and internal forces along each element
    const elForces = new Map();
    const memberResults = [];
    for (const mem of M.members) {
      let worst = null;
      const along = [];
      for (const e of mem.elements) {
        const { R, kl, props } = elData.get(e.id);
        const ii = M.index.get(e.nodeI), jj = M.index.get(e.nodeJ);
        const ue = new Float64Array(12);
        for (let d = 0; d < 6; d++) { ue[d] = u[ii * DOF + d]; ue[6 + d] = u[jj * DOF + d]; }
        const ul = toLocal12(R, ue);
        const q = qLocal.get(e.id) || [0, 0, 0];
        const p = udlLocal(q, props.L);
        const f = new Float64Array(12);
        for (let r = 0; r < 12; r++) { let v = -p[r]; for (let c = 0; c < 12; c++) v += kl[r][c] * ul[c]; f[r] = v; }
        elForces.set(e.id, { f, q, L: props.L });
        const L = props.L;
        const stations = new Set([0, L / 4, L / 2, (3 * L) / 4, L]);
        if (q[1]) { const s = -f[1] / q[1]; if (s > 0 && s < L) stations.add(s); }
        if (q[2]) { const s = -f[2] / q[2]; if (s > 0 && s < L) stations.add(s); }
        for (const s of stations) {
          const N = -f[0] - q[0] * s;
          const Mz = -f[5] + f[1] * s + (q[1] * s * s) / 2;
          const My = -f[4] - f[2] * s - (q[2] * s * s) / 2;
          const T = -f[3];
          const sec = mem.sec;
          const bend = sec.round ? (Math.hypot(Mz, My) * sec.cy) / sec.Iz : (Math.abs(Mz) * sec.cy) / sec.Iz + (Math.abs(My) * sec.cz) / sec.Iy;
          const sigma = Math.abs(N) / sec.A + bend;
          const tau = sec.torsionShear(T);
          const vm = Math.sqrt(sigma * sigma + 3 * tau * tau);
          const r = { at: e.s0 + s, N, Mz, My, T, sigma, tau, vonMises: vm };
          along.push(r);
          if (!worst || vm > worst.vonMises) worst = r;
        }
      }
      along.sort((a, b) => a.at - b.at);
      // most compressive axial force along the member (f[6] = axial force at end j, tension +)
      const compression = Math.max(0, ...mem.elements.map((e) => -elForces.get(e.id).f[6]));
      memberResults.push({ id: mem.id, length: mem.L, section: mem.sec.kind, A: mem.sec.A, worst, along, fy: mem.fy ?? null, utilization: mem.fy ? worst.vonMises / mem.fy : null, compression });
    }
    const displacements = M.nodes.filter((n) => !n.internal).map((n) => {
      const i = M.index.get(n.id) * DOF;
      return { node: n.id, u: [u[i], u[i + 1], u[i + 2]], r: [u[i + 3], u[i + 4], u[i + 5]] };
    });
    const allDisp = M.nodes.map((n) => { const i = M.index.get(n.id) * DOF; return { node: n.id, t: Math.hypot(u[i], u[i + 1], u[i + 2]), r: Math.max(Math.abs(u[i + 3]), Math.abs(u[i + 4]), Math.abs(u[i + 5])) }; });
    const res = {
      id: lc.id, displacements, reactions, members: memberResults,
      maxTranslation: Math.max(...allDisp.map((d) => d.t)), maxRotation: Math.max(...allDisp.map((d) => d.r)),
      nodeDisplacement: (id) => { const i = M.index.get(String(id)) * DOF; return [u[i], u[i + 1], u[i + 2], u[i + 3], u[i + 4], u[i + 5]]; },
    };
    if (buckling.includes(lc.id)) res.buckling = bucklingSolve(M, K, free, ch.L, elData, elForces, size);
    cases.push(res);
  }
  return { ok: true, version: FRAME_FE_VERSION, cases, members: M.members.map((m) => ({ id: m.id, L: m.L, sec: m.sec, E: m.E, fy: m.fy ?? null })), dofs: { total: size, free: nf } };
}

const MAX_BUCKLING_DOF = 900;

function bucklingSolve(M, K, free, L, elData, elForces, size) {
  const nf = free.length;
  if (nf > MAX_BUCKLING_DOF) return { ok: false, error: `buckling not computed: ${nf} free DOFs exceeds the dense eigen-solver limit ${MAX_BUCKLING_DOF}` };
  const Kg = new Float64Array(size * size);
  for (const e of M.elements) {
    const { R } = elData.get(e.id);
    const { f, L: le } = elForces.get(e.id);
    const N = (f[6] - f[0]) / 2; // mean axial force, tension +
    const kg = geometricLocal(N, le);
    // global = Tᵀ kg T
    const T = Array.from({ length: 12 }, () => new Float64Array(12));
    for (let b = 0; b < 4; b++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) T[b * 3 + r][b * 3 + c] = R[r][c];
    const ii = M.index.get(e.nodeI), jj = M.index.get(e.nodeJ);
    const dofs = [...Array(6).keys()].map((d) => ii * DOF + d).concat([...Array(6).keys()].map((d) => jj * DOF + d));
    for (let r = 0; r < 12; r++) {for (let c = 0; c < 12; c++) {
      let v = 0;
      for (let a = 0; a < 12; a++) { if (!T[a][r]) continue; for (let b = 0; b < 12; b++) if (T[b][c] && kg[a][b]) v += T[a][r] * kg[a][b] * T[b][c]; }
      if (v) Kg[dofs[r] * size + dofs[c]] += v;
    }}
  }
  // C = L⁻¹ (−Kg_ff) L⁻ᵀ
  const G = new Float64Array(nf * nf);
  for (let a = 0; a < nf; a++) for (let b = 0; b < nf; b++) G[a * nf + b] = -Kg[free[a] * size + free[b]];
  const Y = new Float64Array(nf * nf); // Y = L⁻¹ G  (column by column)
  for (let c = 0; c < nf; c++) {
    for (let i = 0; i < nf; i++) { let v = G[i * nf + c]; for (let k = 0; k < i; k++) v -= L[i * nf + k] * Y[k * nf + c]; Y[i * nf + c] = v / L[i * nf + i]; }
  }
  const C = new Float64Array(nf * nf); // C = Y L⁻ᵀ  ⇔  Cᵀ = L⁻¹ Yᵀ
  for (let r = 0; r < nf; r++) {
    for (let i = 0; i < nf; i++) { let v = Y[r * nf + i]; for (let k = 0; k < i; k++) v -= L[i * nf + k] * C[r * nf + k]; C[r * nf + i] = v / L[i * nf + i]; }
  }
  for (let a = 0; a < nf; a++) for (let b = a + 1; b < nf; b++) { const m = (C[a * nf + b] + C[b * nf + a]) / 2; C[a * nf + b] = m; C[b * nf + a] = m; }
  const { values, vectors } = jacobiEigen(C, nf);
  let best = -1, mu = 0;
  values.forEach((v, i) => { if (v > mu) { mu = v; best = i; } });
  if (best < 0 || !(mu > 1e-14)) return { ok: true, factor: Infinity, note: "no compressive instability under this load case (no positive buckling factor)" };
  // mode: phi = L⁻ᵀ v
  const v = Float64Array.from({ length: nf }, (_, i) => vectors[i * nf + best]);
  const phi = new Float64Array(nf);
  for (let i = nf - 1; i >= 0; i--) { let s = v[i]; for (let k = i + 1; k < nf; k++) s -= L[k * nf + i] * phi[k]; phi[i] = s / L[i * nf + i]; }
  const positive = values.filter((x) => x > 1e-14).sort((a, b) => b - a).slice(0, 3).map((x) => 1 / x);
  return { ok: true, factor: 1 / mu, nextFactors: positive.slice(1), modeMaxDof: (() => { let m = 0, at = 0; phi.forEach((x, i) => { if (Math.abs(x) > m) { m = Math.abs(x); at = free[i]; } }); return `${M.nodes[Math.floor(at / DOF)].id}.${Object.keys(DOF_MAP)[at % DOF]}`; })() };
}

// ── validity ────────────────────────────────────────────────────────────────

/**
 * Flags every result outside the stated validity range. caseResult from analyzeFrame,
 * members from analyzeFrame().members. Returns { inRange, flags: [{ code, member?, detail }] }.
 */
export function frameValidity(result, caseResult) {
  const flags = [];
  const longest = Math.max(...result.members.map((m) => m.L));
  // members whose bending stress is under a quarter of the largest are not flagged as deep (lightly loaded stubs)
  const maxBend = Math.max(0, ...caseResult.members.map((mr) => mr.worst.sigma - Math.abs(mr.worst.N) / mr.A));
  if (caseResult.maxRotation > 0.1) flags.push({ code: "large_rotation", detail: `max rotation ${caseResult.maxRotation.toFixed(3)} rad > 0.1 rad: small-displacement theory not valid` });
  if (caseResult.maxTranslation > 0.02 * longest) flags.push({ code: "large_displacement", detail: `max translation ${(caseResult.maxTranslation * 1000).toFixed(1)} mm > 2 % of the longest member: geometric nonlinearity not modelled` });
  for (const m of result.members) {
    const mr = caseResult.members.find((x) => x.id === m.id);
    if (m.L / m.sec.depth < 10 && mr.worst.sigma - Math.abs(mr.worst.N) / m.sec.A > 0.25 * maxBend) flags.push({ code: "deep_member", member: m.id, detail: `length/depth ${(m.L / m.sec.depth).toFixed(1)} < 10: shear deformation (Timoshenko) not modelled` });
    if (m.fy && mr.worst.vonMises > m.fy) flags.push({ code: "beyond_yield", member: m.id, detail: `von Mises ${(mr.worst.vonMises / 1e6).toFixed(1)} MPa > Fy ${(m.fy / 1e6).toFixed(1)} MPa: linear-elastic result not valid` });
    if (m.fy && m.sec.wallSlenderness) {
      const lim = m.sec.kind === "round-tube" ? (0.11 * m.E) / m.fy : 1.4 * Math.sqrt(m.E / m.fy);
      if (m.sec.wallSlenderness.ratio > lim) flags.push({ code: "slender_wall", member: m.id, detail: `wall slenderness ${m.sec.wallSlenderness.ratio.toFixed(1)} > ${lim.toFixed(1)} (AISC 360-16 Table B4.1a): local buckling not modelled` });
    }
    if (caseResult.buckling?.ok && Number.isFinite(caseResult.buckling.factor) && m.fy && mr.compression > 0) {
      const fe = (caseResult.buckling.factor * mr.compression) / m.sec.A;
      if (fe > 0.44 * m.fy) flags.push({ code: "inelastic_buckling", member: m.id, detail: `stress at the critical load ${(fe / 1e6).toFixed(1)} MPa > 0.44 Fy: inelastic buckling (AISC 360-16 E3, Fy/Fe > 2.25); the elastic buckling factor overestimates capacity` });
    }
  }
  return { inRange: flags.length === 0, flags };
}
