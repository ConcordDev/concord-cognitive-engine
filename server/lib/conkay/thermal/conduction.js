// server/lib/conkay/thermal/conduction.js
//
// Heat conduction, 1D and 2D, steady and transient, by the finite-volume
// method (vertex-centred: boundary nodes own half cells), in SI.
//
//   solve1D: a bar / wall / fin along x with cross-section A(x) and perimeter
//            P(x); constant k, rho, cp; volumetric generation; lateral
//            convection h·P·(T - Tinf) (fins); end conditions: temperature,
//            heat flux q(t) into the body, convection (h, Tinf) or adiabatic.
//   solve2D:  a rectangle (unit depth) on an nx × ny grid; each edge a
//            temperature, flux, convection or adiabatic condition.
//   Transient: theta scheme, Crank-Nicolson (theta = 1/2) with two implicit
//            Euler start-up steps (Rannacher) so a sudden boundary change does
//            not ring; implicit Euler on request.
//
// Validity range (stated; results outside it are flagged by the caller):
// Fourier conduction with constant properties (k, rho, cp independent of
// temperature), no radiation, no contact resistance inside the body, no phase
// change; mesh resolution checked by re-solving at half the spacing
// (meshCheck) and reporting the change.
//
// Benchmarks (Incropera et al., Fundamentals of Heat and Mass Transfer, 7th
// ed.) are in tests/conkay-heat-transfer.test.js.

export const CONDUCTION_VERSION = "1.0.0";

// ── error function (for the semi-infinite solutions) ─────────────────────────
// erf by its Maclaurin series for |x| < 2.5, erfc by the Lentz continued
// fraction beyond; both to ~1e-15 relative.
export function erf(x) {
  if (x < 0) return -erf(-x);
  if (x < 2.5) {
    let term = x, sum = x;
    for (let n = 1; n < 200; n++) {
      term *= (-x * x) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return (2 / Math.sqrt(Math.PI)) * sum;
  }
  return 1 - erfc(x);
}

export function erfc(x) {
  if (x < 2.5) return 1 - erf(x);
  // erfc(x) = exp(-x^2)/sqrt(pi) * 1/(x + 1/2/(x + 1/(x + 3/2/(x + 2/(x + ...)))))
  const tiny = 1e-300;
  let f = x, C = x, D = 0;
  for (let n = 1; n < 300; n++) {
    const a = n / 2;
    D = x + a * D; D = Math.abs(D) < tiny ? tiny : D; D = 1 / D;
    C = x + a / C; C = Math.abs(C) < tiny ? tiny : C;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / f;
}

// ── linear solvers ──────────────────────────────────────────────────────────

function thomas(a, b, c, d) {
  const n = b.length;
  const cp = new Float64Array(n), dp = new Float64Array(n);
  cp[0] = c[0] / b[0]; dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / m; dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
  }
  const x = new Float64Array(n);
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

/** Banded LU (no pivoting: conduction matrices are diagonally dominant). A is n × (2w+1), A[i][w + j - i]. */
function bandedFactor(A, n, w) {
  for (let k = 0; k < n; k++) {
    const piv = A[k][w];
    if (!(Math.abs(piv) > 0)) throw new Error("singular conduction matrix (no path to a fixed temperature or convection?)");
    for (let i = k + 1; i <= Math.min(n - 1, k + w); i++) {
      const f = A[i][w + k - i] / piv;
      if (!f) continue;
      A[i][w + k - i] = f;
      for (let j = k + 1; j <= Math.min(n - 1, k + w); j++) A[i][w + j - i] -= f * A[k][w + j - k];
    }
  }
  return A;
}

function bandedSolve(LU, n, w, b) {
  const y = Float64Array.from(b);
  for (let i = 0; i < n; i++) for (let k = Math.max(0, i - w); k < i; k++) y[i] -= LU[i][w + k - i] * y[k];
  for (let i = n - 1; i >= 0; i--) {
    for (let k = i + 1; k <= Math.min(n - 1, i + w); k++) y[i] -= LU[i][w + k - i] * y[k];
    y[i] /= LU[i][w];
  }
  return y;
}

// ── 1D ──────────────────────────────────────────────────────────────────────

const val = (f, ...args) => (typeof f === "function" ? f(...args) : f);

/**
 * spec: { L, n (cells, default 100), k, rho?, cp?, area? (m^2 or fn(x)), perimeter?, hLateral?, TinfLateral?,
 *         generation? (W/m^3 or fn(x, t)), left, right, steady?: true | transient?: { tEnd, dt, T0 (number | fn(x)),
 *         theta? (0.5), record?: [t...] } }
 * BC: { type: "T", T } | { type: "q", q (W/m^2 into the body, number | fn(t)) } | { type: "conv", h, Tinf } | { type: "adiabatic" }
 * Returns { x, T (final), history: [{ t, T }], heatIn: { left, right } (W, final state) }.
 */
export function solve1D(spec) {
  const n = spec.n ?? 100, L = spec.L, dx = L / n, N = n + 1;
  const x = Float64Array.from({ length: N }, (_, i) => i * dx);
  const A = (xx) => val(spec.area ?? 1, xx);
  const P = (xx) => val(spec.perimeter ?? 0, xx);
  const h = spec.hLateral ?? 0, Tinf = spec.TinfLateral ?? 0;
  // conductances between nodes, node volumes, lateral areas
  const Kc = Float64Array.from({ length: n }, (_, i) => (spec.k * A(x[i] + dx / 2)) / dx);
  const vol = Float64Array.from({ length: N }, (_, i) => A(x[i]) * (i === 0 || i === n ? dx / 2 : dx));
  const lat = Float64Array.from({ length: N }, (_, i) => h * P(x[i]) * (i === 0 || i === n ? dx / 2 : dx));
  const cap = spec.transient ? Float64Array.from(vol, (v) => v * spec.rho * spec.cp) : null;
  const ends = [{ bc: spec.left, i: 0, a: A(0) }, { bc: spec.right, i: n, a: A(L) }];

  // K T = f : assemble the steady operator (lower a, diag b, upper c) and the source f(t)
  const a = new Float64Array(N), b = new Float64Array(N), c = new Float64Array(N);
  for (let i = 0; i < n; i++) { b[i] += Kc[i]; b[i + 1] += Kc[i]; c[i] -= Kc[i]; a[i + 1] -= Kc[i]; }
  for (let i = 0; i < N; i++) b[i] += lat[i];
  for (const e of ends) if (e.bc.type === "conv") b[e.i] += e.bc.h * e.a;
  const source = (t) => {
    const f = new Float64Array(N);
    for (let i = 0; i < N; i++) f[i] = lat[i] * Tinf + (spec.generation ? val(spec.generation, x[i], t) * vol[i] : 0);
    for (const e of ends) {
      if (e.bc.type === "q") f[e.i] += val(e.bc.q, t) * e.a;
      if (e.bc.type === "conv") f[e.i] += e.bc.h * e.a * e.bc.Tinf;
    }
    return f;
  };
  const fixed = ends.filter((e) => e.bc.type === "T");
  const applyFixed = (aa, bb, cc, dd) => { for (const e of fixed) { aa[e.i] = 0; cc[e.i] = 0; bb[e.i] = 1; dd[e.i] = e.bc.T; } };
  const heatIn = (T) => {
    const out = {};
    ends.forEach((e, s) => {
      const j = s === 0 ? 1 : n - 1;
      const kk = Kc[s === 0 ? 0 : n - 1];
      // energy balance on the boundary half cell: heat in through the boundary = conduction out + lateral loss + storage(0 at steady) - generation
      const cond = kk * (T[e.i] - T[j]);
      const lossLat = lat[e.i] * (T[e.i] - Tinf);
      const gen = spec.generation ? val(spec.generation, x[e.i], spec.transient?.tEnd ?? 0) * vol[e.i] : 0;
      out[s === 0 ? "left" : "right"] = cond + lossLat - gen;
    });
    return out;
  };

  if (!spec.transient) {
    const d = source(0);
    const aa = a.slice(), bb = b.slice(), cc = c.slice();
    applyFixed(aa, bb, cc, d);
    const T = thomas(aa, bb, cc, d);
    return { x, T, history: [], heatIn: heatIn(T) };
  }
  const { tEnd, dt, record = [] } = spec.transient;
  const theta0 = spec.transient.theta ?? 0.5;
  let T = Float64Array.from(x, (xx) => val(spec.transient.T0, xx));
  for (const e of fixed) T[e.i] = e.bc.T;
  const history = [];
  const rec = [...record].sort((p, q) => p - q);
  let ri = 0;
  const steps = Math.round(tEnd / dt);
  let fOld = source(0);
  for (let s = 1; s <= steps; s++) {
    const t = s * dt;
    const th = s <= 2 && theta0 < 1 ? 1 : theta0; // Rannacher start-up
    const fNew = source(t);
    const aa = new Float64Array(N), bb = new Float64Array(N), cc = new Float64Array(N), d = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      aa[i] = th * a[i]; cc[i] = th * c[i]; bb[i] = cap[i] / dt + th * b[i];
      const KT = b[i] * T[i] + (i > 0 ? a[i] * T[i - 1] : 0) + (i < n ? c[i] * T[i + 1] : 0);
      d[i] = (cap[i] / dt) * T[i] - (1 - th) * KT + th * fNew[i] + (1 - th) * fOld[i];
    }
    applyFixed(aa, bb, cc, d);
    T = thomas(aa, bb, cc, d);
    fOld = fNew;
    while (ri < rec.length && rec[ri] <= t + dt / 2) { history.push({ t, T: Float64Array.from(T) }); ri++; }
  }
  return { x, T, history, heatIn: heatIn(T) };
}

// ── 2D ──────────────────────────────────────────────────────────────────────

/**
 * spec: { Lx, Ly, nx, ny (cells), k, rho?, cp?, generation?, edges: { left, right, bottom, top } (BCs as 1D),
 *         steady | transient { tEnd, dt, T0, theta?, record? } }
 * Temperature edges win at corners. Returns { x, y, T (row-major j*(nx+1)+i), at(x, y), history }.
 */
export function solve2D(spec) {
  const { Lx, Ly, nx, ny, k } = spec;
  const dx = Lx / nx, dy = Ly / ny, NX = nx + 1, NY = ny + 1, N = NX * NY;
  const id = (i, j) => j * NX + i;
  const w = NX;
  const band = () => Array.from({ length: N }, () => new Float64Array(2 * w + 1));
  const K = band();
  const add = (r, cIdx, v) => { K[r][w + cIdx - r] += v; };
  const wx = (j) => (j === 0 || j === ny ? dy / 2 : dy); // face height for x-direction conduction
  const wy = (i) => (i === 0 || i === nx ? dx / 2 : dx);
  const vol = (i, j) => wy(i) * wx(j);
  for (let j = 0; j < NY; j++) {for (let i = 0; i < NX; i++) {
    const r = id(i, j);
    if (i < nx) { const g = (k * wx(j)) / dx; add(r, r, g); add(r, id(i + 1, j), -g); add(id(i + 1, j), id(i + 1, j), g); add(id(i + 1, j), r, -g); }
    if (j < ny) { const g = (k * wy(i)) / dy; add(r, r, g); add(r, id(i, j + 1), -g); add(id(i, j + 1), id(i, j + 1), g); add(id(i, j + 1), r, -g); }
  }}
  // boundary segments: [edge, node list, face length per node]
  const E = spec.edges;
  const seg = [];
  for (let j = 0; j < NY; j++) { seg.push(["left", id(0, j), wx(j)]); seg.push(["right", id(nx, j), wx(j)]); }
  for (let i = 0; i < NX; i++) { seg.push(["bottom", id(i, 0), wy(i)]); seg.push(["top", id(i, ny), wy(i)]); }
  for (const [e, r, len] of seg) if (E[e].type === "conv") add(r, r, E[e].h * len);
  const source = (t) => {
    const f = new Float64Array(N);
    if (spec.generation) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) f[id(i, j)] += val(spec.generation, i * dx, j * dy, t) * vol(i, j);
    for (const [e, r, len] of seg) {
      if (E[e].type === "q") f[r] += val(E[e].q, t) * len;
      if (E[e].type === "conv") f[r] += E[e].h * len * E[e].Tinf;
    }
    return f;
  };
  const fixedT = new Map();
  for (const [e, r] of seg) if (E[e].type === "T" && !fixedT.has(r)) fixedT.set(r, E[e].T);
  // corner precedence: if two T edges meet, the mean of the two temperatures
  for (const [r] of fixedT) {
    const ts = seg.filter(([e, rr]) => rr === r && E[e].type === "T").map(([e]) => E[e].T);
    fixedT.set(r, ts.reduce((s, v) => s + v, 0) / ts.length);
  }
  const x = Float64Array.from({ length: NX }, (_, i) => i * dx), y = Float64Array.from({ length: NY }, (_, j) => j * dy);
  const finish = (T, history) => ({
    x, y, T, history,
    at: (xx, yy) => {
      const i = Math.min(nx - 1, Math.max(0, Math.floor(xx / dx))), j = Math.min(ny - 1, Math.max(0, Math.floor(yy / dy)));
      const u = xx / dx - i, v = yy / dy - j;
      return (1 - u) * (1 - v) * T[id(i, j)] + u * (1 - v) * T[id(i + 1, j)] + (1 - u) * v * T[id(i, j + 1)] + u * v * T[id(i + 1, j + 1)];
    },
  });
  const system = (scale, diagAdd) => {
    const M = band();
    for (let r = 0; r < N; r++) for (let q = 0; q < 2 * w + 1; q++) M[r][q] = K[r][q] * scale;
    if (diagAdd) for (let r = 0; r < N; r++) M[r][w] += diagAdd[r];
    for (const [r] of fixedT) { M[r].fill(0); M[r][w] = 1; }
    return bandedFactor(M, N, w);
  };
  if (!spec.transient) {
    const LU = system(1, null);
    const f = source(0);
    for (const [r, Tv] of fixedT) f[r] = Tv;
    return finish(bandedSolve(LU, N, w, f), []);
  }
  const { tEnd, dt, record = [] } = spec.transient;
  const theta0 = spec.transient.theta ?? 0.5;
  const C = new Float64Array(N);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) C[id(i, j)] = (vol(i, j) * spec.rho * spec.cp) / dt;
  const LUs = new Map();
  const getLU = (th) => { if (!LUs.has(th)) LUs.set(th, system(th, C)); return LUs.get(th); };
  let T = Float64Array.from({ length: N }, (_, r) => val(spec.transient.T0, (r % NX) * dx, Math.floor(r / NX) * dy));
  for (const [r, Tv] of fixedT) T[r] = Tv;
  const history = [];
  const rec = [...record].sort((p, q) => p - q);
  let ri = 0;
  let fOld = source(0);
  const steps = Math.round(tEnd / dt);
  for (let s = 1; s <= steps; s++) {
    const t = s * dt;
    const th = s <= 2 && theta0 < 1 ? 1 : theta0;
    const fNew = source(t);
    const rhs = new Float64Array(N);
    for (let r = 0; r < N; r++) {
      let KT = 0;
      for (let q = Math.max(0, r - w); q <= Math.min(N - 1, r + w); q++) KT += K[r][w + q - r] * T[q];
      rhs[r] = C[r] * T[r] - (1 - th) * KT + th * fNew[r] + (1 - th) * fOld[r];
    }
    for (const [r, Tv] of fixedT) rhs[r] = Tv;
    T = bandedSolve(getLU(th), N, w, rhs);
    fOld = fNew;
    while (ri < rec.length && rec[ri] <= t + dt / 2) { history.push({ t, T: Float64Array.from(T) }); ri++; }
  }
  return finish(T, history);
}

/** Change in a scalar result when the mesh spacing is halved: run(n) vs run(2n). */
export function meshCheck(run, n) {
  const coarse = run(n), fine = run(2 * n);
  return { coarse, fine, relChange: Math.abs(fine - coarse) / Math.max(Math.abs(fine), 1e-300) };
}
