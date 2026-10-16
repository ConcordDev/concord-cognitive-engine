// server/lib/conkay/structural/truss2d.js
//
// A planar pin-jointed truss by the direct stiffness method: two translations per joint, axial bars only.
//   k_bar = (E A / L) [c² cs -c² -cs; cs s² -cs -s²; ...]  (c, s = direction cosines)
//   K u = F on the free DOFs (Cholesky); a singular K is a MECHANISM and is reported, never solved into a number;
//   bar force N = (E A / L) [(u_j - u_i) · e]  (+ tension, - compression); reactions = K u - F at the supports.
// For a statically determinate truss (m + r = 2j, stable) the bar forces do not depend on E or A, so they are the
// method-of-joints answers (Hibbeler, Engineering Mechanics: Statics, ch. 6, the method of joints / sections),
// which the tests derive by hand.
//
// Validity (declared; outside it, results are flagged, never a pass):
//   linear elastic bars, small displacements (largest joint displacement under 1 % of the span), pin joints
//   (no bending: real gusseted joints add secondary bending, not modelled), loads at joints only, no buckling of
//   compression members (reported as compression; a buckling check needs the section and is separate).
//
// trussGeometry({ type: "pratt"|"howe"|"warren", panels, span, height }) -> { joints, bars, supports, top, bottom }

export const TRUSS2D_VERSION = "1.0.0";
export const TRUSS2D_VALIDITY = "linear elastic pin-jointed bars, small displacements (< 1 % of the span), loads at joints only, member buckling not checked";

/** Solve. joints [{ id, x, y }], bars [{ id, i, j, EA }], supports [{ joint, fix: ["x","y"] }], loads [{ joint, Fx, Fy }]. */
export function solveTruss({ joints, bars, supports, loads = [] }) {
  const errors = [];
  if (!Array.isArray(joints) || joints.length < 2) errors.push("a truss needs at least two joints");
  if (!Array.isArray(bars) || !bars.length) errors.push("a truss needs at least one bar");
  if (errors.length) return { ok: false, errors };
  const index = new Map(joints.map((j, k) => [j.id, k]));
  if (index.size !== joints.length) return { ok: false, errors: ["joint ids must be unique"] };
  for (const b of bars) {
    if (!index.has(b.i) || !index.has(b.j)) errors.push(`bar ${b.id}: unknown joint`);
    else if (b.i === b.j) errors.push(`bar ${b.id}: both ends at one joint`);
    if (!(Number.isFinite(b.EA) && b.EA > 0)) errors.push(`bar ${b.id}: EA must be a positive number (N)`);
  }
  for (const l of loads) if (!index.has(l.joint)) errors.push(`load on unknown joint ${l.joint}`);
  for (const s of supports) if (!index.has(s.joint)) errors.push(`support on unknown joint ${s.joint}`);
  if (errors.length) return { ok: false, errors };
  const n = joints.length * 2;
  const K = new Float64Array(n * n);
  const geo = bars.map((b) => {
    const a = joints[index.get(b.i)], c = joints[index.get(b.j)];
    const dx = c.x - a.x, dy = c.y - a.y, L = Math.hypot(dx, dy);
    return { ...b, L, c: dx / L, s: dy / L, ia: index.get(b.i), ib: index.get(b.j) };
  });
  for (const g of geo) {
    if (!(g.L > 0)) return { ok: false, errors: [`bar ${g.id} has zero length`] };
    const k = g.EA / g.L;
    const m = [[g.c * g.c, g.c * g.s], [g.c * g.s, g.s * g.s]];
    const dofs = [2 * g.ia, 2 * g.ia + 1, 2 * g.ib, 2 * g.ib + 1];
    for (let p = 0; p < 4; p++) {for (let q = 0; q < 4; q++) {
      const sign = (p < 2) === (q < 2) ? 1 : -1;
      K[dofs[p] * n + dofs[q]] += sign * k * m[p % 2][q % 2];
    }}
  }
  const F = new Float64Array(n);
  for (const l of loads) { const k = index.get(l.joint); F[2 * k] += l.Fx || 0; F[2 * k + 1] += l.Fy || 0; }
  const fixed = new Set();
  for (const s of supports) for (const d of s.fix) fixed.add(2 * index.get(s.joint) + (d === "x" ? 0 : 1));
  const free = [...Array(n).keys()].filter((d) => !fixed.has(d));
  const m = free.length;
  // Cholesky on the free block; a non-positive pivot is a mechanism
  const A = new Float64Array(m * m);
  for (let p = 0; p < m; p++) for (let q = 0; q < m; q++) A[p * m + q] = K[free[p] * n + free[q]];
  const scale = Math.max(...geo.map((g) => g.EA / g.L));
  for (let j = 0; j < m; j++) {
    let d = A[j * m + j];
    for (let k = 0; k < j; k++) d -= A[j * m + k] ** 2;
    if (!(d > 1e-10 * scale)) {
      const dof = free[j];
      return { ok: false, mechanism: true, errors: [`mechanism: no stiffness at joint ${joints[Math.floor(dof / 2)].id} in ${dof % 2 ? "y" : "x"} (the truss is unstable or under-restrained)`] };
    }
    A[j * m + j] = Math.sqrt(d);
    for (let i = j + 1; i < m; i++) {
      let s = A[i * m + j];
      for (let k = 0; k < j; k++) s -= A[i * m + k] * A[j * m + k];
      A[i * m + j] = s / A[j * m + j];
    }
  }
  const y = new Float64Array(m), x = new Float64Array(m);
  for (let i = 0; i < m; i++) { let s = F[free[i]]; for (let k = 0; k < i; k++) s -= A[i * m + k] * y[k]; y[i] = s / A[i * m + i]; }
  for (let i = m - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < m; k++) s -= A[k * m + i] * x[k]; x[i] = s / A[i * m + i]; }
  const u = new Float64Array(n);
  free.forEach((d, i) => { u[d] = x[i]; });
  const forces = geo.map((g) => {
    const du = (u[2 * g.ib] - u[2 * g.ia]) * g.c + (u[2 * g.ib + 1] - u[2 * g.ia + 1]) * g.s;
    const N = (g.EA / g.L) * du;
    return { id: g.id, i: g.i, j: g.j, lengthM: g.L, N, sense: Math.abs(N) < 1e-9 * scale ? "zero" : N > 0 ? "tension" : "compression" };
  });
  const reactions = supports.map((s) => {
    const k = index.get(s.joint);
    const r = (d) => { let sum = -F[d]; for (let q = 0; q < n; q++) sum += K[d * n + q] * u[q]; return sum; };
    return { joint: s.joint, Rx: s.fix.includes("x") ? r(2 * k) : 0, Ry: s.fix.includes("y") ? r(2 * k + 1) : 0 };
  });
  const r = [...fixed].length;
  const span = Math.max(...joints.map((j) => j.x)) - Math.min(...joints.map((j) => j.x)) || Math.max(...geo.map((g) => g.L));
  const maxDisp = Math.max(...joints.map((_, k) => Math.hypot(u[2 * k], u[2 * k + 1])));
  const flags = [];
  if (maxDisp > 0.01 * span) flags.push(`largest joint displacement ${maxDisp.toFixed(4)} m is over 1 % of the span: small-displacement theory is not a model of this`);
  return {
    ok: true, version: TRUSS2D_VERSION, validity: TRUSS2D_VALIDITY,
    determinacy: { members: bars.length, reactions: r, joints: joints.length, staticallyDeterminate: bars.length + r === 2 * joints.length, degree: bars.length + r - 2 * joints.length },
    forces, reactions, displacements: joints.map((j, k) => ({ joint: j.id, ux: u[2 * k], uy: u[2 * k + 1] })), maxDisplacementM: maxDisp, flags,
  };
}

/** Joints and bars of a Pratt, Howe or Warren truss: bottom chord joints L0..Ln, top joints U*, supports pin at L0 and roller at Ln. */
export function trussGeometry({ type, panels, span, height }) {
  if (!["pratt", "howe", "warren"].includes(type)) return { ok: false, errors: [`unknown truss type "${type}" (pratt, howe, warren)`] };
  if (!(Number.isInteger(panels) && panels >= 2)) return { ok: false, errors: ["panels must be an integer of 2 or more"] };
  if (!(span > 0 && height > 0)) return { ok: false, errors: ["span and height must be positive lengths"] };
  if (type !== "warren" && panels % 2) return { ok: false, errors: [`a ${type} truss here is symmetric about midspan: give an even number of panels`] };
  const d = span / panels;
  const joints = [], bars = [];
  const bottom = [], top = [];
  for (let i = 0; i <= panels; i++) { joints.push({ id: `L${i}`, x: i * d, y: 0 }); bottom.push(`L${i}`); }
  const bar = (i, j) => bars.push({ id: `${i}-${j}`, i, j });
  for (let i = 0; i < panels; i++) bar(`L${i}`, `L${i + 1}`);
  if (type === "warren") {
    for (let i = 0; i < panels; i++) { joints.push({ id: `U${i}`, x: (i + 0.5) * d, y: height }); top.push(`U${i}`); }
    for (let i = 0; i < panels - 1; i++) bar(`U${i}`, `U${i + 1}`);
    for (let i = 0; i < panels; i++) { bar(`L${i}`, `U${i}`); bar(`U${i}`, `L${i + 1}`); }
  } else {
    for (let i = 1; i < panels; i++) { joints.push({ id: `U${i}`, x: i * d, y: height }); top.push(`U${i}`); }
    for (let i = 1; i < panels - 1; i++) bar(`U${i}`, `U${i + 1}`);
    bar("L0", "U1"); bar(`U${panels - 1}`, `L${panels}`); // end posts (inclined)
    for (let i = 1; i < panels; i++) bar(`L${i}`, `U${i}`); // verticals
    const half = panels / 2;
    for (let i = 1; i < panels - 1; i++) {
      // Pratt: diagonals slope down toward midspan (tension under gravity); Howe: up toward midspan (compression)
      const left = i < half;
      if (type === "pratt") (left ? bar(`U${i}`, `L${i + 1}`) : bar(`L${i}`, `U${i + 1}`));
      else (left ? bar(`L${i}`, `U${i + 1}`) : bar(`U${i}`, `L${i + 1}`));
    }
  }
  return { ok: true, joints, bars, top, bottom, supports: [{ joint: "L0", fix: ["x", "y"] }, { joint: `L${panels}`, fix: ["y"] }] };
}
