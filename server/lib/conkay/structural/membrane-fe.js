// server/lib/conkay/structural/membrane-fe.js
//
// Plane-stress membrane FE for a flat sheet with cut-outs: how much of its
// in-plane shear (or axial) stiffness a sheet keeps when holes are cut in it.
// Used for the tub's shear sheets (a firewall with pass-throughs): the frame
// model's equivalent-diagonal panel (shear-panel.js) is scaled by the ratio
// k_cut / k_solid computed here.
//
// Element: four-node rectangle with Wilson's incompatible modes (QM6: the
// bilinear field plus 1 - xi², 1 - eta² for u and v, condensed out), which is
// exact for pure bending of rectangular elements and passes the constant-strain
// patch test on rectangles (Taylor, Beresford & Wilson 1976, "A non-conforming
// element for stress analysis", IJNME 10:1211; Cook, Malkus, Plesha & Witt,
// Concepts and Applications of FEA, 4th ed., sec. 6.7). Linear elastic,
// isotropic, plane stress, small strain.
//
// Mesh: a structured grid of square-ish cells over the a × b sheet; a cell
// whose centre lies inside a hole is removed (holes are stair-stepped at the
// cell size: the removed area is reported next to the true hole area). Solve:
// banded Cholesky on the nodes in row order.
//
// Boundary conditions:
//   shear     "picture frame": every edge node moves as a rigid pin-jointed
//             frame shearing by gamma: u = gamma · y, v = 0 (the sheet's edges
//             are bonded to stiff box members). k = 2 U / delta², delta = gamma b;
//             a solid sheet gives exactly k = G t a / b.
//   tension   x = 0 edge held in x (one node also in y), uniform traction on
//             x = a; free contraction. k = F² / (2 U); solid: k = E t b / a.
//
// Benchmarks (tests/conkay-tub-openings.test.js):
//   - patch tests: solid sheet in shear and in tension reproduce G t a / b and
//     E t b / a to round-off;
//   - plane-stress cantilever (L/h = 10, tip shear): tip deflection within 2 %
//     of Timoshenko beam theory P L³/3EI + P L/(kappa G A), kappa = 5/6;
//   - a circular hole in a wide sheet under tension: the compliance increase
//     tends to the non-interacting (dilute) value 3p for porosity p
//     (E_eff = E / (1 + 3p), plane stress, circular holes: Kachanov, Tsukrov &
//     Shafiro 1994, Appl. Mech. Rev. 47(1S):S151; the same 3 pi a² / (E A)
//     extra compliance follows from Kirsch's solution), with mesh convergence.
// Validity: thin flat isotropic sheet, linear, no buckling (the frame model's
// panel check covers shear buckling of the gross sheet; local buckling or
// stress concentration at a cut-out edge is NOT checked here).

const VERSION = "1.0.0";
export const MEMBRANE_FE_VERSION = VERSION;

function dMatrix(E, nu) {
  const c = E / (1 - nu * nu);
  return [[c, c * nu, 0], [c * nu, c, 0], [0, 0, (c * (1 - nu)) / 2]];
}

/** Condensed 8×8 stiffness of a QM6 rectangle 2hx × 2hy, thickness t. Node order (-,-) (+,-) (+,+) (-,+); dofs [u1 v1 … u4 v4]. */
export function qm6Stiffness(hx, hy, t, E, nu) {
  const D = dMatrix(E, nu);
  const g = 1 / Math.sqrt(3);
  const K = Array.from({ length: 12 }, () => new Float64Array(12));
  const xs = [-1, 1, 1, -1], ys = [-1, -1, 1, 1];
  for (const xi of [-g, g]) {
    for (const eta of [-g, g]) {
      const B = [new Float64Array(12), new Float64Array(12), new Float64Array(12)];
      for (let k = 0; k < 4; k++) {
        const dNdx = (xs[k] * (1 + ys[k] * eta)) / 4 / hx;
        const dNdy = (ys[k] * (1 + xs[k] * xi)) / 4 / hy;
        B[0][2 * k] = dNdx; B[1][2 * k + 1] = dNdy; B[2][2 * k] = dNdy; B[2][2 * k + 1] = dNdx;
      }
      // incompatible modes: u += a1 (1 - xi²) + a2 (1 - eta²); v += a3 (1 - xi²) + a4 (1 - eta²)
      const dP1 = (-2 * xi) / hx, dP2 = (-2 * eta) / hy;
      B[0][8] = dP1; B[2][9] = dP2; B[1][11] = dP2; B[2][10] = dP1;
      const w = hx * hy * t; // Gauss weights 1 × 1
      for (let i = 0; i < 12; i++) {
        const DBi = [0, 1, 2].map((r) => D[r][0] * B[0][i] + D[r][1] * B[1][i] + D[r][2] * B[2][i]);
        for (let j = 0; j < 12; j++) K[i][j] += w * (B[0][j] * DBi[0] + B[1][j] * DBi[1] + B[2][j] * DBi[2]);
      }
    }
  }
  // static condensation of the four internal modes
  const ii = [8, 9, 10, 11];
  const Kii = ii.map((r) => ii.map((c) => K[r][c]));
  const inv = invert(Kii);
  const out = Array.from({ length: 8 }, () => new Float64Array(8));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      let s = K[r][c];
      for (let p = 0; p < 4; p++) for (let q = 0; q < 4; q++) s -= K[r][ii[p]] * inv[p][q] * K[ii[q]][c];
      out[r][c] = s;
    }
  }
  return out;
}

function invert(A) {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row) => row.slice(n));
}

function inHole(x, y, holes) {
  return holes.some((h) => (h.shape === "circle"
    ? (x - h.cx) ** 2 + (y - h.cy) ** 2 < h.r ** 2
    : Math.abs(x - h.cx) < h.w / 2 && Math.abs(y - h.cy) < h.h / 2));
}

export function holeArea(h) {
  return h.shape === "circle" ? Math.PI * h.r * h.r : h.w * h.h;
}

/** Structured mesh of an a × b sheet with the cells inside holes removed. */
export function membraneMesh({ a, b, cell, nx, ny, holes = [] }) {
  nx = nx || Math.max(2, Math.round(a / cell));
  ny = ny || Math.max(2, Math.round(b / cell));
  const hx = a / nx / 2, hy = b / ny / 2;
  const elements = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = (2 * i + 1) * hx, cy = (2 * j + 1) * hy;
      if (inHole(cx, cy, holes)) continue;
      const n0 = j * (nx + 1) + i;
      elements.push([n0, n0 + 1, n0 + nx + 2, n0 + nx + 1]);
    }
  }
  const used = new Uint8Array((nx + 1) * (ny + 1));
  for (const e of elements) for (const n of e) used[n] = 1;
  const nodeIndex = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  let k = 0;
  for (let n = 0; n < used.length; n++) if (used[n]) nodeIndex[n] = k++;
  return { a, b, nx, ny, hx, hy, elements, nodeIndex, nodes: k, removedArea: a * b - elements.length * 4 * hx * hy };
}

/**
 * Solve the mesh. prescribed(i, j, x, y) → { u?, v? } or null; forces: [{ i, j, fx, fy }].
 * Returns { U (strain energy), disp(i, j) → [u, v], dofs }.
 */
export function solveMembrane(mesh, { t, E, nu, prescribed = () => null, forces = [] }) {
  const { nx, ny, hx, hy, elements, nodeIndex } = mesh;
  const n = 2 * mesh.nodes;
  const Ke = qm6Stiffness(hx, hy, t, E, nu);
  // bandwidth from the element connectivity
  let bw = 0;
  for (const e of elements) {
    const ids = e.map((g) => nodeIndex[g]);
    bw = Math.max(bw, 2 * (Math.max(...ids) - Math.min(...ids)) + 1);
  }
  const W = bw + 1;
  const L = new Float64Array(n * W); // L[i*W + (i-j)] = K[i][j], j ≤ i
  const at = (i, j) => (i >= j ? i * W + (i - j) : j * W + (j - i));
  for (const e of elements) {
    const d = e.flatMap((g) => [2 * nodeIndex[g], 2 * nodeIndex[g] + 1]);
    for (let r = 0; r < 8; r++) for (let c = 0; c <= 7; c++) if (d[r] >= d[c]) L[at(d[r], d[c])] += Ke[r][c];
  }
  const K0 = L.slice(); // for the energy
  const f = new Float64Array(n);
  for (const F of forces) {
    const g = nodeIndex[F.j * (nx + 1) + F.i];
    if (g < 0) throw new Error(`force on a removed node (${F.i}, ${F.j})`);
    f[2 * g] += F.fx || 0; f[2 * g + 1] += F.fy || 0;
  }
  // prescribed values: move their columns to the right-hand side, then pin the rows
  const fixed = new Map();
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const g = nodeIndex[j * (nx + 1) + i];
      if (g < 0) continue;
      const p = prescribed(i, j, 2 * i * hx, 2 * j * hy);
      if (!p) continue;
      if (p.u != null) fixed.set(2 * g, p.u);
      if (p.v != null) fixed.set(2 * g + 1, p.v);
    }
  }
  for (const [dof, val] of fixed) {
    if (val === 0) continue;
    for (let k = Math.max(0, dof - bw); k <= Math.min(n - 1, dof + bw); k++) if (!fixed.has(k)) f[k] -= L[at(k, dof)] * val;
  }
  for (const [dof, val] of fixed) {
    for (let k = Math.max(0, dof - bw); k <= Math.min(n - 1, dof + bw); k++) L[at(k, dof)] = 0;
    L[at(dof, dof)] = 1;
    f[dof] = val;
  }
  // banded Cholesky
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - bw);
    for (let j = j0; j <= i; j++) {
      let s = L[at(i, j)];
      const k0 = Math.max(j0, j - bw);
      for (let k = k0; k < j; k++) s -= L[at(i, k)] * L[at(j, k)];
      if (i === j) {
        if (!(s > 0)) throw new Error(`membrane stiffness not positive definite at dof ${i} (a free island of elements, or no supports)`);
        L[at(i, i)] = Math.sqrt(s);
      } else L[at(i, j)] = s / L[at(j, j)];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = f[i];
    for (let k = Math.max(0, i - bw); k < i; k++) s -= L[at(i, k)] * y[k];
    y[i] = s / L[at(i, i)];
  }
  const u = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k <= Math.min(n - 1, i + bw); k++) s -= L[at(k, i)] * u[k];
    u[i] = s / L[at(i, i)];
  }
  // strain energy ½ uᵀ K u with the unconstrained stiffness
  let U = 0;
  for (let i = 0; i < n; i++) {
    for (let j = Math.max(0, i - bw); j <= i; j++) {
      const kij = K0[at(i, j)];
      if (kij) U += (i === j ? 0.5 : 1) * kij * u[i] * u[j];
    }
  }
  return { U, dofs: n, disp: (i, j) => { const g = nodeIndex[j * (nx + 1) + i]; return g < 0 ? null : [u[2 * g], u[2 * g + 1]]; } };
}

/**
 * In-plane stiffness of an a × b sheet (thickness t) with holes, and its ratio to the solid sheet's.
 * load "shear" (picture frame, shear along a) or "tension" (along a). cell: target element size (m).
 */
export function sheetStiffness({ a, b, t, E, nu, holes = [], cell, load = "shear" }) {
  if (!(a > 0 && b > 0 && t > 0 && E > 0 && nu >= 0 && nu < 0.5)) throw new Error("sheet needs a, b, t, E > 0 and 0 ≤ nu < 0.5");
  for (const h of holes) {
    const ext = h.shape === "circle" ? [h.r, h.r] : [h.w / 2, h.h / 2];
    if (h.cx - ext[0] < 0 || h.cx + ext[0] > a || h.cy - ext[1] < 0 || h.cy + ext[1] > b) throw new Error(`hole ${h.id || ""} is not inside the sheet`);
  }
  const mesh = membraneMesh({ a, b, cell: cell || Math.min(a, b) / 40, holes });
  const G = E / (2 * (1 + nu));
  let k, kSolid;
  if (load === "shear") {
    const gamma = 1e-3;
    const onEdge = (i, j) => i === 0 || j === 0 || i === mesh.nx || j === mesh.ny;
    const r = solveMembrane(mesh, { t, E, nu, prescribed: (i, j, x, y) => (onEdge(i, j) ? { u: gamma * y, v: 0 } : null) });
    const delta = gamma * b;
    k = (2 * r.U) / (delta * delta);
    kSolid = (G * t * a) / b;
  } else if (load === "tension") {
    const sigma = 1e6, F = sigma * t * b;
    const forces = [];
    for (let j = 0; j <= mesh.ny; j++) forces.push({ i: mesh.nx, j, fx: (F / mesh.ny) * (j === 0 || j === mesh.ny ? 0.5 : 1) });
    const r = solveMembrane(mesh, { t, E, nu, forces, prescribed: (i, j) => (i === 0 ? (j === 0 ? { u: 0, v: 0 } : { u: 0 }) : null) });
    k = (F * F) / (2 * r.U);
    kSolid = (E * t * b) / a;
  } else throw new Error(`load "${load}" (shear | tension)`);
  return {
    k, kSolid, ratio: k / kSolid, load, nx: mesh.nx, ny: mesh.ny, cellM: [2 * mesh.hx, 2 * mesh.hy], dofs: 2 * mesh.nodes,
    holeArea: holes.reduce((s, h) => s + holeArea(h), 0), removedArea: mesh.removedArea, version: VERSION,
  };
}

/**
 * The shear-stiffness factor of a sheet with cut-outs, at two mesh sizes (cell and cell / 2), with
 * the finer value used and the change between them reported as the discretisation estimate.
 * Deterministic, so results are kept per input for the process.
 */
const FACTOR_CACHE = new Map();
export function cutoutShearFactor({ a, b, t, E, nu, holes, cell = 0.01 }) {
  const key = JSON.stringify([a, b, t, E, nu, holes, cell]);
  if (!FACTOR_CACHE.has(key)) FACTOR_CACHE.set(key, cutoutShearFactorUncached({ a, b, t, E, nu, holes, cell }));
  return FACTOR_CACHE.get(key);
}

function cutoutShearFactorUncached({ a, b, t, E, nu, holes, cell }) {
  const coarse = sheetStiffness({ a, b, t, E, nu, holes, cell, load: "shear" });
  const fine = sheetStiffness({ a, b, t, E, nu, holes, cell: cell / 2, load: "shear" });
  return {
    value: fine.ratio,
    coarse: coarse.ratio,
    meshChange: Math.abs(fine.ratio - coarse.ratio),
    holeArea: fine.holeArea, removedArea: fine.removedArea,
    basis: `computed: plane-stress QM6 membrane FE (structural/membrane-fe.js ${VERSION}), picture-frame shear, ${fine.nx} × ${fine.ny} cells (${Math.round(fine.cellM[0] * 1000)} mm); ${coarse.nx} × ${coarse.ny} gives ${coarse.ratio.toFixed(4)}`,
  };
}
