// server/lib/conkay/aero/panel2d.js
//
// 2D incompressible potential-flow panel method (Hess-Smith): constant-strength
// source panels plus one uniform vortex strength on every panel, with a Kutta
// condition (equal and opposite tangential velocity on the two panels next to
// the trailing-edge node), and an optional ground plane by the method of images
// (mirror panels with the same source and the opposite vortex sign: the normal
// velocity on the plane is zero by symmetry).
// References: J. L. Hess and A. M. O. Smith, "Calculation of potential flow
// about arbitrary bodies", Prog. Aerospace Sci. 8 (1967) 1-138; J. Katz and A.
// Plotkin, Low-Speed Aerodynamics, 2nd ed. (2001), ch. 11.
// Benchmarks (tests/conkay-aero.test.js): the circular cylinder (exact Cp =
// 1 - 4 sin^2 theta, no lift, d'Alembert zero drag) and Joukowski airfoils
// (exact surface speed and lift from the conformal map).
// Validity: inviscid, attached, incompressible (M < 0.3), 2D. It gives a
// pressure distribution and the sign of a section's lift; it predicts no drag
// (d'Alembert) and nothing about separation. Not CFD.

export const PANEL2D_VERSION = "1.0.0";

const TWO_PI = 2 * Math.PI;

/** Velocity at P induced by a unit-strength constant source panel A->B (global coords; orientation-independent). */
function srcVel(P, A, B, self = false) {
  const lx = B[0] - A[0], ly = B[1] - A[1], l = Math.hypot(lx, ly);
  const tx = lx / l, ty = ly / l, nx = -ty, ny = tx;
  const dx = P[0] - A[0], dy = P[1] - A[1];
  const x = dx * tx + dy * ty, y = dx * nx + dy * ny;
  let u, v;
  if (self) { u = 0; v = 0.5; } else {
    const r1 = Math.hypot(x, y), r2 = Math.hypot(x - l, y);
    u = Math.log(r1 / r2) / TWO_PI;
    v = (Math.atan2(y, x - l) - Math.atan2(y, x)) / TWO_PI;
  }
  return [u * tx + v * nx, u * ty + v * ny];
}
const rot90 = ([u, v]) => [-v, u]; // vortex panel (counter-clockwise positive) = source field turned +90 deg

function gauss(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-300) throw new Error("singular panel system");
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

/** Signed area (positive = counter-clockwise). */
export function signedArea(nodes) {
  let a = 0;
  for (let i = 0; i < nodes.length - 1; i++) a += nodes[i][0] * nodes[i + 1][1] - nodes[i + 1][0] * nodes[i][1];
  return a / 2;
}

/**
 * Solve the flow about a closed body.
 *   nodes: [[x, y], ...] closed (last = first), CLOCKWISE, starting and ending at the trailing-edge node when kutta;
 *   alphaDeg: free-stream angle; kutta: true (lifting) | false (non-lifting: no vortex);
 *   ground: null | { y } (a plane y = const below the body).
 * Returns { panels: [{ mid, len, t, n, vt, cp }], gamma, circulation (clockwise positive), cl (Kutta-Joukowski,
 *   on refLength), clPressure, cdPressure, refLength, flags }.
 */
export function solvePanels(nodes, { alphaDeg = 0, kutta = true, ground = null, vinf = 1, refLength = null } = {}) {
  const flags = [];
  if (nodes.length < 4) throw new Error("need at least 3 panels");
  const closed = nodes[0][0] === nodes.at(-1)[0] && nodes[0][1] === nodes.at(-1)[1];
  if (!closed) throw new Error("nodes must be closed (last node = first node)");
  if (signedArea(nodes) > 0) throw new Error("nodes must run clockwise (outward normal on the left of travel)");
  const N = nodes.length - 1;
  const a = (alphaDeg * Math.PI) / 180, V = [vinf * Math.cos(a), vinf * Math.sin(a)];
  const P = [];
  for (let i = 0; i < N; i++) {
    const A = nodes[i], B = nodes[i + 1];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (!(len > 0)) throw new Error(`panel ${i} has zero length`);
    const t = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
    P.push({ A, B, len, t, n: [-t[1], t[0]], mid: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2] });
  }
  if (ground) {
    const minY = Math.min(...nodes.map((p) => p[1]));
    if (!(minY > ground.y)) throw new Error("the body must lie above the ground plane");
  }
  const mirror = (p) => [p[0], 2 * ground.y - p[1]];
  // influence of panel j at control point i: source (per unit sigma_j) and vortex (per unit gamma, summed later)
  const src = [], vor = [];
  for (let i = 0; i < N; i++) {
    src.push([]); vor.push([]);
    for (let j = 0; j < N; j++) {
      let s = srcVel(P[i].mid, P[j].A, P[j].B, i === j);
      let w = rot90(s);
      if (ground) {
        const si = srcVel(P[i].mid, mirror(P[j].A), mirror(P[j].B));
        s = [s[0] + si[0], s[1] + si[1]];
        const wi = rot90(si);
        w = [w[0] - wi[0], w[1] - wi[1]]; // image vortex has the opposite sense
      }
      src[i].push(s); vor[i].push(w);
    }
  }
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1];
  const M = N + (kutta ? 1 : 0);
  const Am = Array.from({ length: M }, () => new Array(M).fill(0));
  const b = new Array(M).fill(0);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) Am[i][j] = dot(src[i][j], P[i].n);
    if (kutta) Am[i][N] = P.reduce((s, _, j) => s + dot(vor[i][j], P[i].n), 0);
    b[i] = -dot(V, P[i].n);
  }
  if (kutta) {
    for (const k of [0, N - 1]) {
      for (let j = 0; j < N; j++) Am[N][j] += dot(src[k][j], P[k].t);
      Am[N][N] += P.reduce((s, _, j) => s + dot(vor[k][j], P[k].t), 0);
      b[N] -= dot(V, P[k].t);
    }
  }
  const x = gauss(Am, b);
  const gamma = kutta ? x[N] : 0;
  let cx = 0, cy = 0;
  const out = P.map((p, i) => {
    let vt = dot(V, p.t);
    for (let j = 0; j < N; j++) vt += x[j] * dot(src[i][j], p.t) + gamma * dot(vor[i][j], p.t);
    const cp = 1 - (vt / vinf) ** 2;
    cx += -cp * p.n[0] * p.len; cy += -cp * p.n[1] * p.len; // force per (q * length): pressure acts against the outward normal
    return { mid: p.mid, len: p.len, t: p.t, n: p.n, vt, cp };
  });
  const perimeter = P.reduce((s, p) => s + p.len, 0);
  const xs = nodes.map((p) => p[0]);
  const chord = refLength ?? Math.max(...xs) - Math.min(...xs);
  const circulation = -gamma * perimeter; // clockwise positive (lift for flow in +x)
  // lift / drag directions relative to the free stream
  const lift = -cx * Math.sin(a) + cy * Math.cos(a), drag = cx * Math.cos(a) + cy * Math.sin(a);
  return {
    version: PANEL2D_VERSION, panels: out, gamma, circulation, refLength: chord, sigma: x.slice(0, N),
    _geom: { P, ground, V, mirror: ground ? mirror : null },
    cl: (2 * circulation) / (vinf * chord), clPressure: lift / chord, cdPressure: drag / chord, flags,
  };
}

/** Velocity [u, v] at a field point (outside the body) of a solution from solvePanels. */
export function velocityAt(sol, Q) {
  const { P, ground, V, mirror } = sol._geom;
  let u = V[0], v = V[1];
  P.forEach((p, j) => {
    const s = srcVel(Q, p.A, p.B), w = rot90(s);
    u += sol.sigma[j] * s[0] + sol.gamma * w[0]; v += sol.sigma[j] * s[1] + sol.gamma * w[1];
    if (ground) {
      const si = srcVel(Q, mirror(p.A), mirror(p.B)), wi = rot90(si);
      u += sol.sigma[j] * si[0] - sol.gamma * wi[0]; v += sol.sigma[j] * si[1] - sol.gamma * wi[1];
    }
  });
  return [u, v];
}

/** Close an open point list into a polygon (last node = first); the caller supplies clockwise order. */
export function closeLoop(points) {
  const p = points.map((q) => [q[0], q[1]]);
  p.push([p[0][0], p[0][1]]);
  return p;
}
