// server/lib/conkay/fluids/pipe-flow.js
//
// Incompressible internal flow in pipe networks, in SI.
//   - friction factor: laminar 64/Re (Re < 2300); turbulent Colebrook (Re > 4000),
//     solved by the existing engineering-compute ductColebrookFrictionFactor
//     (Haaland-seeded fixed point); transitional 2300 <= Re <= 4000 is not
//     predictable: the larger of the two is used (conservative) and flagged;
//   - pipe head loss: Darcy-Weisbach (f L/D + sum K) v^2 / 2g; minor losses as K
//     on the pipe velocity;
//   - components given by a loss coefficient on a reference area, or by a
//     quadratic dp = c Q^2, or UNKNOWN (then no operating point is claimed);
//   - pumps by a pressure-rise curve dp(Q) through datasheet points, valid only
//     inside the points' flow range (outside = extrapolation, flagged);
//   - network: Newton-Raphson on link flows and junction heads (the global
//     gradient formulation of Todini & Pilati, 1988), any topology with at least
//     one fixed-head node (a reservoir or an expansion tank).
// Validity range (results outside it are flagged): incompressible, single
// phase, fully developed, isothermal per solve (properties at one stated
// state), Colebrook range Re 4e3..1e8 and relative roughness <= 0.05, pump
// curves interpolated only. Cavitation (NPSH) is not checked.
// Benchmarks: tests/conkay-pipe-flow.test.js.

import { ductColebrookFrictionFactor } from "../../compute/engineering-compute.js";

export const PIPE_FLOW_VERSION = "1.0.0";
export const G = 9.80665;

/** Darcy friction factor: { f, regime, flags }. */
export function frictionFactor(Re, relRough) {
  const flags = [];
  if (!(Re > 0)) return { f: 0, regime: "no-flow", flags };
  if (relRough > 0.05) flags.push(`relative roughness ${relRough.toPrecision(3)} > 0.05: outside the Colebrook / Moody range`);
  if (Re < 2300) return { f: 64 / Re, regime: "laminar", flags };
  const fT = ductColebrookFrictionFactor(Re, relRough);
  if (Re <= 4000) {
    flags.push(`Re ${Re.toFixed(0)} is transitional (2300..4000): friction factor not predictable; the larger of laminar ${(64 / Re).toFixed(4)} and Colebrook ${fT.toFixed(4)} is used`);
    return { f: Math.max(64 / Re, fT), regime: "transitional", flags };
  }
  if (Re > 1e8) flags.push(`Re ${Re.toExponential(2)} > 1e8: beyond the Colebrook data range`);
  return { f: fT, regime: "turbulent", flags };
}

const area = (D) => (Math.PI * D * D) / 4;

/** Head loss (m) of a pipe link at flow Q (m^3/s, signed) and its details. */
export function pipeHeadLoss(link, Q, fluid) {
  const A = area(link.D), v = Math.abs(Q) / A;
  const Re = (fluid.rho * v * link.D) / fluid.mu;
  const ff = frictionFactor(Re, (link.eps ?? 0) / link.D);
  const sumK = (link.K || []).reduce((s, k) => s + k.K, 0);
  const h = (ff.f * (link.L / link.D) + sumK) * (v * v) / (2 * G);
  return { h: Math.sign(Q) * h, v, Re, f: ff.f, regime: ff.regime, flags: ff.flags, sumK };
}

/**
 * A pump curve through datasheet points [{ Q (m^3/s), dp (Pa) }]: dp(Q) = a - b Q^2 through two points, or a
 * least-squares quadratic dp = a + c Q - b Q^2 through three or more. Valid inside [min Q, max Q].
 */
export function pumpCurve(points) {
  const pts = [...points].sort((p, q) => p.Q - q.Q);
  if (pts.length < 2) throw new Error("a pump curve needs at least two points");
  let a, b, c = 0;
  if (pts.length === 2) {
    const [p1, p2] = pts;
    b = (p1.dp - p2.dp) / (p2.Q ** 2 - p1.Q ** 2);
    a = p1.dp + b * p1.Q ** 2;
  } else {
    // normal equations for dp = a + c Q + d Q^2
    const S = (fn) => pts.reduce((s, p) => s + fn(p), 0);
    const M = [[pts.length, S((p) => p.Q), S((p) => p.Q ** 2)], [S((p) => p.Q), S((p) => p.Q ** 2), S((p) => p.Q ** 3)], [S((p) => p.Q ** 2), S((p) => p.Q ** 3), S((p) => p.Q ** 4)]];
    const r = [S((p) => p.dp), S((p) => p.dp * p.Q), S((p) => p.dp * p.Q ** 2)];
    const x = gauss(M, r);
    a = x[0]; c = x[1]; b = -x[2];
  }
  return { a, b, c, range: [pts[0].Q, pts.at(-1).Q], dp: (Q) => a + c * Q - b * Q * Math.abs(Q), points: pts };
}

function gauss(M, r) {
  const n = r.length;
  const A = M.map((row, i) => [...row, r[i]]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
    [A[k], A[p]] = [A[p], A[k]];
    if (!(Math.abs(A[k][k]) > 1e-300)) throw new Error("singular network system (a junction with no path to a fixed head?)");
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k] / A[k][k];
      for (let j = k; j <= n; j++) A[i][j] -= f * A[k][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = A[i][n];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

/** Head change across a link in the direction from → to (loss positive, pump rise negative). */
function linkHead(link, Q, fluid) {
  if (link.type === "pipe") return pipeHeadLoss(link, Q, fluid).h;
  if (link.type === "pump") return -link.curve.dp(Q) / (fluid.rho * G);
  if (link.type === "component") {
    if (Number.isFinite(link.c)) return (link.c * Q * Math.abs(Q)) / (fluid.rho * G);
    if (Number.isFinite(link.K)) { const v = Q / area(link.Dref); return (link.K * v * Math.abs(v)) / (2 * G); }
  }
  throw new Error(`link ${link.id}: no head-loss model (unknown component)`);
}

/**
 * Solve a network. net: { fluid: { rho, mu }, nodes: [{ id, head? (m, fixed), demand? (m^3/s out) }],
 * links: [{ id, from, to, type: "pipe" (D, L, eps, K[]) | "pump" (curve) | "component" (c | K + Dref | unknown) }] }.
 * Returns { ok, Q: {id}, H: {id}, links: [...details], iterations, flags } or { ok:false, error }.
 */
export function solveNetwork(net, { tol = 1e-10, maxIter = 100, Q0 = 1e-3 } = {}) {
  const unknown = net.links.filter((l) => l.type === "component" && !Number.isFinite(l.c) && !Number.isFinite(l.K));
  if (unknown.length) return { ok: false, error: `unknown component loss: ${unknown.map((l) => l.id).join(", ")}; no operating point is claimed` };
  const free = net.nodes.filter((n) => !Number.isFinite(n.head));
  if (free.length === net.nodes.length) return { ok: false, error: "no fixed-head node" };
  const nL = net.links.length, nH = free.length, N = nL + nH;
  const hIdx = new Map(free.map((n, i) => [n.id, nL + i]));
  const fixedHead = new Map(net.nodes.filter((n) => Number.isFinite(n.head)).map((n) => [n.id, n.head]));
  const x = new Array(N).fill(0);
  net.links.forEach((l, i) => { x[i] = l.Q0 ?? Q0; });
  const head = (id) => (hIdx.has(id) ? x[hIdx.get(id)] : fixedHead.get(id));
  let it = 0, res = Infinity;
  for (; it < maxIter; it++) {
    const F = new Array(N).fill(0);
    const J = Array.from({ length: N }, () => new Array(N).fill(0));
    net.links.forEach((l, i) => {
      const Q = x[i];
      const dQ = Math.max(Math.abs(Q) * 1e-6, 1e-12);
      F[i] = linkHead(l, Q, net.fluid) - (head(l.from) - head(l.to));
      J[i][i] = (linkHead(l, Q + dQ, net.fluid) - linkHead(l, Q - dQ, net.fluid)) / (2 * dQ);
      if (hIdx.has(l.from)) J[i][hIdx.get(l.from)] = -1;
      if (hIdx.has(l.to)) J[i][hIdx.get(l.to)] = 1;
    });
    free.forEach((n, k) => {
      const r = nL + k;
      F[r] = -(n.demand || 0);
      net.links.forEach((l, i) => {
        if (l.to === n.id) { F[r] += x[i]; J[r][i] = 1; }
        if (l.from === n.id) { F[r] -= x[i]; J[r][i] = -1; }
      });
    });
    res = Math.max(...F.map(Math.abs));
    if (res < tol) break;
    let dx;
    try { dx = gauss(J, F.map((v) => -v)); } catch (e) { return { ok: false, error: e.message }; }
    for (let i = 0; i < N; i++) x[i] += dx[i];
  }
  if (!(res < tol * 1e3)) return { ok: false, error: `did not converge (residual ${res.toExponential(2)} after ${it} iterations)` };
  const flags = [];
  const links = net.links.map((l, i) => {
    const Q = x[i];
    const d = { id: l.id, type: l.type, Q, headLoss: linkHead(l, Q, net.fluid), dp: linkHead(l, Q, net.fluid) * net.fluid.rho * G };
    if (l.type === "pipe") {
      const p = pipeHeadLoss(l, Q, net.fluid);
      Object.assign(d, { v: p.v, Re: p.Re, f: p.f, regime: p.regime, sumK: p.sumK });
      for (const f of p.flags) flags.push(`${l.id}: ${f}`);
    }
    if (l.type === "pump") {
      if (Q < 0) flags.push(`${l.id}: reverse flow through the pump`);
      if (Q < l.curve.range[0] || Q > l.curve.range[1]) flags.push(`${l.id}: flow ${(Q * 60000).toFixed(1)} L/min is outside the pump curve's published points (${(l.curve.range[0] * 60000).toFixed(1)}..${(l.curve.range[1] * 60000).toFixed(1)} L/min): extrapolated`);
    }
    return d;
  });
  return { ok: true, iterations: it, residual: res, Q: Object.fromEntries(links.map((l) => [l.id, l.Q])), H: Object.fromEntries(net.nodes.map((n) => [n.id, head(n.id)])), links, flags };
}
