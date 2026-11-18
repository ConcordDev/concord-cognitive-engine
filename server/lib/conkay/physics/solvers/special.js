// server/lib/conkay/physics/solvers/special.js
//
// math.special — SX-NUM-15 (ConKay solver catalogue, Wave 0).
//
// Special functions at the JS tier, against the NIST DLMF.
// Every function carries the DLMF domain as its envelope:
// poles and out-of-domain arguments are refused by name, not
// approximated around.
//
//   gamma / log-gamma  Lanczos (g = 7) with reflection; poles
//                      at the non-positive integers refused.
//   erf                power series for |x| <= 2.5, continued
//                      fraction (modified Lentz) for erfc
//                      beyond; the catalogue reference case is
//                      erf(1) = 0.8427007929 (DLMF).
//   bessel-j / -i      integer orders by their power series.
//                      Y and K name the GSL engine tier.
//   beta               via log-gamma.
//   elliptic-k / -e    complete integrals (parameter m) by the
//                      arithmetic-geometric mean.
//   lambertw           both real branches by Halley iteration;
//                      x < -1/e has no real value, refused.
//   hypergeometric     2F1 by its series inside |z| < 1; the
//                      disc boundary names the transformation
//                      follow-on rather than extrapolating.
//   airy               Ai and Bi by their power series for
//                      |x| <= 10; beyond names the GSL tier.

import { registerSolver } from "../registry.js";

/* ---------------- gamma ---------------- */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(x) {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let acc = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i += 1) acc += LANCZOS[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(acc);
}

const isPole = (x) => Number.isInteger(x) && x <= 0;

/* ---------------- erf ---------------- */

function erfSeries(x) {
  // erf(x) = (2/sqrt(pi)) * SUM (-1)^n x^{2n+1} / (n! (2n+1))
  let term = x;
  let sum = x;
  for (let n = 1; n < 200; n += 1) {
    term *= -(x * x) / n;
    const add = term / (2 * n + 1);
    sum += add;
    if (Math.abs(add) < 1e-17 * Math.max(1, Math.abs(sum))) break;
  }
  return (2 / Math.sqrt(Math.PI)) * sum;
}

function erfc(x) {
  if (x < 0) return 2 - erfc(-x);
  if (x <= 2.5) return 1 - erfSeries(x);
  // Continued fraction (DLMF 7.9.2), modified Lentz:
  //   2 e^{x^2} INT_x^inf e^{-t^2} dt
  //     = 1 / (x + (1/2)/(x + 1/(x + (3/2)/(x + ...))))
  // so erfc(x) = e^{-x^2}/sqrt(pi) * 1/(x + R), where R is the
  // tail fraction with numerators n/2 and denominators all x.
  const tiny = 1e-300;
  let R = tiny;
  let C = R;
  let D = 0;
  for (let n = 1; n <= 500; n += 1) {
    const a = n / 2;
    D = x + a * D;
    if (D === 0) D = tiny;
    C = x + a / C;
    if (C === 0) C = tiny;
    D = 1 / D;
    const delta = C * D;
    R *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * (x + R));
}

/* ---------------- bessel ---------------- */

function besselJ(n, x) {
  if (x < 0) return (n % 2 === 0 ? 1 : -1) * besselJ(n, -x);
  const half = x / 2;
  let term = (half ** n) / fact(n);
  let sum = term;
  for (let k = 1; k < 300; k += 1) {
    term *= -(half * half) / (k * (k + n));
    sum += term;
    if (Math.abs(term) < 1e-17 * Math.max(1, Math.abs(sum))) break;
  }
  return sum;
}

function besselI(n, x) {
  if (x < 0) return (n % 2 === 0 ? 1 : -1) * besselI(n, -x);
  const half = x / 2;
  let term = (half ** n) / fact(n);
  let sum = term;
  for (let k = 1; k < 300; k += 1) {
    term *= (half * half) / (k * (k + n));
    sum += term;
    if (Math.abs(term) < 1e-17 * Math.max(1, Math.abs(sum))) break;
  }
  return sum;
}

function fact(n) {
  let f = 1;
  for (let i = 2; i <= n; i += 1) f *= i;
  return f;
}

/* ---------------- elliptic (AGM) ---------------- */

function ellipticKE(m) {
  if (m === 1) return { K: Infinity, E: 1 };
  // AGM: a0 = 1, b0 = sqrt(1 - m); K = pi / (2 a_inf);
  // E = K * (1 - S), S = m/2 + SUM_{n>=1} 2^{n-1} c_n^2 with
  // c_n = (a_{n-1} - b_{n-1}) / 2.
  let a = 1;
  let b = Math.sqrt(1 - m);
  let S = m / 2;
  let pow2 = 1; // 2^{n-1} for n = 1, 2, ...
  for (let n = 1; n <= 60; n += 1) {
    const c = (a - b) / 2;
    S += pow2 * c * c;
    pow2 *= 2;
    const an = (a + b) / 2;
    b = Math.sqrt(a * b);
    a = an;
    if (Math.abs(c) < 1e-17) break;
  }
  const K = Math.PI / (2 * a);
  return { K, E: K * (1 - S) };
}

/* ---------------- lambert W ---------------- */

function lambertW(x, branch) {
  if (branch === -1 && x >= 0) return NaN;
  let w;
  if (branch === 0) {
    w = x > 3 ? Math.log(x) - Math.log(Math.log(x)) : x / Math.E + 0.3;
    if (x === 0) return 0;
  } else {
    w = Math.log(-x) - Math.log(-Math.log(-x)) - 0.3;
  }
  for (let i = 0; i < 100; i += 1) {
    const ew = Math.exp(w);
    const f = w * ew - x;
    const denom = ew * (w + 1) - ((w + 2) * f) / (2 * w + 2);
    const step = f / denom;
    w -= step;
    if (Math.abs(step) < 1e-15 * Math.max(1, Math.abs(w))) break;
  }
  return w;
}

/* ---------------- airy ---------------- */

function airySeries(x) {
  // Ai(x) = c1 f(x) - c2 g(x); Bi(x) = sqrt(3) (c1 f(x) + c2 g(x))
  // with f(x) = SUM 3^k (1/3)_k x^{3k} / (3k)! and
  // g(x) = SUM 3^k (2/3)_k x^{3k+1} / (3k+1)!; the term ratios
  // are x^3 / ((3k)(3k-1)) and x^3 / ((3k)(3k+1)).
  const c1 = 0.35502805388781723926; // Ai(0)
  const c2 = 0.25881940379280679841; // -Ai'(0)
  let f = 1;
  let g = x;
  let tf = 1;
  let tg = x;
  const x3 = x ** 3;
  for (let k = 1; k < 300; k += 1) {
    tf *= x3 / ((3 * k) * (3 * k - 1));
    f += tf;
    tg *= x3 / ((3 * k) * (3 * k + 1));
    g += tg;
    if (Math.abs(tf) < 1e-18 * Math.max(1, Math.abs(f)) && Math.abs(tg) < 1e-18 * Math.max(1, Math.abs(g))) break;
  }
  return { Ai: c1 * f - c2 * g, Bi: Math.sqrt(3) * (c1 * f + c2 * g) };
}

/* ---------------- the solver ---------------- */

function pointsOf(inputs) {
  const pts = inputs.points;
  if (!Array.isArray(pts) || pts.length === 0 || !pts.every(Number.isFinite)) {
    return { refusal: "missing_input:points (a non-empty array of finite values)" };
  }
  return { pts };
}

function runSpecial(ctx, target) {
  const inputs = ctx?.inputs || {};

  if (target === "gamma" || target === "log-gamma") {
    const p = pointsOf(inputs);
    if (p.refusal) return { notComputed: p.refusal };
    for (const x of p.pts) {
      if (isPole(x)) return { notComputed: `pole:gamma has a pole at ${x} — a pole is not a number and is never approximated around` };
    }
    return {
      inputs: { points: p.pts.length },
      outputs: { values: p.pts.map((x) => ({ x, y: target === "gamma" ? Math.exp(logGamma(x)) : logGamma(x) })) },
      margins: [],
      covers: [target],
    };
  }

  if (target === "erf") {
    const p = pointsOf(inputs);
    if (p.refusal) return { notComputed: p.refusal };
    return {
      inputs: { points: p.pts.length },
      outputs: {
        values: p.pts.map((x) => {
          const e = x >= 0 ? (x <= 2.5 ? erfSeries(x) : 1 - erfc(x)) : -erf0(-x);
          return { x, erf: e, erfc: 1 - e };
        }),
      },
      margins: [],
      covers: [target],
    };
  }

  if (target === "bessel-j" || target === "bessel-i") {
    const n = inputs.order;
    if (!Number.isInteger(n) || n < 0 || n > 30) return { notComputed: "missing_input:order (an integer 0..30)" };
    const p = pointsOf(inputs);
    if (p.refusal) return { notComputed: p.refusal };
    for (const x of p.pts) {
      if (Math.abs(x) > 30) return { notComputed: `outside_envelope:|x| = ${Math.abs(x)} > 30 — the series tier certifies to 30; larger arguments: requires_engine_tier:gsl` };
    }
    const fn = target === "bessel-j" ? besselJ : besselI;
    return {
      inputs: { order: n, points: p.pts.length },
      outputs: { values: p.pts.map((x) => ({ x, y: fn(n, x) })) },
      margins: [],
      covers: [target],
    };
  }

  if (target === "beta") {
    const { a, b } = inputs;
    if (!(a > 0) || !(b > 0)) return { notComputed: "missing_input:positive a and b (the beta integral's DLMF domain)" };
    return {
      inputs: { a, b },
      outputs: { value: Math.exp(logGamma(a) + logGamma(b) - logGamma(a + b)) },
      margins: [],
      covers: [target],
    };
  }

  if (target === "elliptic-k" || target === "elliptic-e") {
    const p = pointsOf(inputs);
    if (p.refusal) return { notComputed: p.refusal };
    for (const m of p.pts) {
      if (m > 1) return { notComputed: `outside_envelope:parameter m = ${m} > 1 — K diverges and E leaves the real DLMF domain` };
    }
    return {
      inputs: { points: p.pts.length },
      outputs: {
        values: p.pts.map((m) => {
          if (m === 1) return { m, y: target === "elliptic-k" ? Infinity : 1 };
          const { K, E } = ellipticKE(m);
          return { m, y: target === "elliptic-k" ? K : E };
        }),
      },
      margins: [],
      covers: [target],
    };
  }

  if (target === "lambertw") {
    const branch = inputs.branch === undefined ? 0 : inputs.branch;
    if (branch !== 0 && branch !== -1) return { notComputed: "invalid_input:branch must be 0 or -1" };
    const p = pointsOf(inputs);
    if (p.refusal) return { notComputed: p.refusal };
    for (const x of p.pts) {
      if (x < -1 / Math.E) return { notComputed: `outside_envelope:x = ${x} < -1/e — no real branch exists there` };
      if (branch === -1 && x >= 0) return { notComputed: `outside_envelope:the -1 branch is real only on [-1/e, 0)` };
    }
    return {
      inputs: { branch, points: p.pts.length },
      outputs: { values: p.pts.map((x) => ({ x, y: lambertW(x, branch) })) },
      margins: [],
      covers: [target],
    };
  }

  if (target === "hypergeometric") {
    const { a, b, c, z } = inputs;
    if (![a, b, c, z].every(Number.isFinite)) return { notComputed: "missing_input:finite a, b, c, z" };
    if (isPole(c)) return { notComputed: `pole:c = ${c} is a non-positive integer — 2F1 is undefined there` };
    if (Math.abs(z) >= 1) return { notComputed: `outside_envelope:|z| = ${Math.abs(z)} >= 1 — the series disc; boundary values ride the transformation-formula follow-on, not an extrapolation of the series` };
    let term = 1;
    let sum = 1;
    for (let k = 1; k < 1000; k += 1) {
      term *= ((a + k - 1) * (b + k - 1) * z) / ((c + k - 1) * k);
      sum += term;
      if (Math.abs(term) < 1e-16 * Math.max(1, Math.abs(sum))) break;
    }
    return {
      inputs: { a, b, c, z },
      outputs: { value: sum },
      margins: [],
      covers: [target],
    };
  }

  if (target === "airy") {
    const p = pointsOf(inputs);
    if (p.refusal) return { notComputed: p.refusal };
    for (const x of p.pts) {
      if (Math.abs(x) > 10) return { notComputed: `outside_envelope:|x| = ${Math.abs(x)} > 10 — the series tier's certified range; larger arguments: requires_engine_tier:gsl` };
    }
    return {
      inputs: { points: p.pts.length },
      outputs: { values: p.pts.map((x) => ({ x, ...airySeries(x) })) },
      margins: [],
      covers: [target],
    };
  }

  return { notComputed: `unknown_operation:${target} (Bessel Y and K: requires_engine_tier:gsl)` };
}

function erf0(x) {
  return x <= 2.5 ? erfSeries(x) : 1 - erfc(x);
}

export const special = registerSolver({
  id: "math.special",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 1,
  method: "Lanczos gamma with reflection, erf by power series + continued fraction, Bessel J/I by power series, AGM complete elliptic integrals, Halley Lambert W on both real branches, 2F1 inside its series disc, Airy by power series",
  reference: "NIST DLMF — reference case erf(1) = 0.8427007929; Gamma(1/2) = sqrt(pi); J0(1) = 0.7651976866; K(m=1/2) = 1.8540746773; W(1) = 0.5671432904",
  regime: "DLMF domains enforced: gamma poles and 2F1 c-poles refused, Bessel series certified to |x| <= 30, Airy to |x| <= 10, 2F1 inside |z| < 1, Lambert W real branches only",
  units: { inputs: "evaluation points per function, plus per-target parameters (order, branch, a/b/c/z)", outputs: "function values at the requested points" },
  tolerance: "series and iterations run to machine precision (terms < 1e-16 relative)",
  screening: true,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runSpecial,
});
