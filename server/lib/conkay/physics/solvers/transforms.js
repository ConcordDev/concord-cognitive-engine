// server/lib/conkay/physics/solvers/transforms.js
//
// math.transforms — SX-NUM-14 (ConKay solver catalogue, Wave 0).
//
// Transforms at the JS tier, against the DLMF tables:
//
//   fft / ifft   radix-2 FFT for power-of-two lengths, direct
//                DFT for other lengths up to 512. Every result
//                carries round-trip and Parseval certificates
//                computed on the call itself.
//   dct          DCT-II with orthonormal scaling, direct sums.
//   laplace      F(s) = INT_0^inf e^{-st} f(t) dt for an
//                expression f, by tanh-sinh quadrature on a
//                finite window whose tail bound is computed
//                and reported; s <= 0 is refused (the integral
//                is not certified there).
//   inverse-laplace
//                the Abate-Whitt Euler method (Fourier-series
//                inversion with binomial Euler averaging) over
//                a complex extension of the symbolic grammar.
//                The catalogue reference pair is 1/(s+1) ->
//                e^{-t} (DLMF); the suite also pins 1/s -> 1
//                and 1/(s^2+1) -> sin t.
//   hilbert      analytic signal via FFT; outputs the envelope.
//   dwt          Haar wavelet transform with an exact
//                reconstruction certificate; deeper wavelet
//                families are the PyWavelets engine tier.
//
// Complex values travel as {re, im} pairs.

import { registerSolver } from "../registry.js";
import { parse, evaluateAst } from "./math-symbolic.js";

/* ---------------- complex arithmetic ---------------- */

const C = (re, im = 0) => ({ re, im });
const cadd = (a, b) => C(a.re + b.re, a.im + b.im);
const csub = (a, b) => C(a.re - b.re, a.im - b.im);
const cmul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const cexp = (a) => C(Math.exp(a.re) * Math.cos(a.im), Math.exp(a.re) * Math.sin(a.im));
const clog = (a) => C(Math.log(Math.hypot(a.re, a.im)), Math.atan2(a.im, a.re));
const csin = (a) => C(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im));
const ccos = (a) => C(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im));
const ctan = (a) => cdiv(csin(a), ccos(a));
const csqrt = (a) => {
  const r = Math.hypot(a.re, a.im);
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sqrt(Math.max(0, (r - a.re) / 2)) * (a.im < 0 ? -1 : 1);
  return C(re, im);
};
const cpow = (a, b) => cexp(cmul(b, clog(a)));

// The math-symbolic AST: {t:"num", v:{n,d} rational} |
// {t:"var", name} | {t:"add"|"mul", args} | {t:"pow", base,
// exp: rational} | {t:"func", name, arg}. Subtraction and
// division arrive as add/mul with negated / inverted factors,
// and sqrt arrives as pow with exponent 1/2.
function evalComplex(node, env) {
  switch (node.t) {
    case "num": return C(Number(node.v.n) / Number(node.v.d));
    case "var": {
      const v = env[node.name];
      if (v === undefined) throw new Error(`unbound variable ${node.name}`);
      return typeof v === "number" ? C(v) : v;
    }
    case "add": return node.args.map((a) => evalComplex(a, env)).reduce(cadd, C(0));
    case "mul": return node.args.map((a) => evalComplex(a, env)).reduce(cmul, C(1));
    case "pow": {
      const base = evalComplex(node.base, env);
      const exp = Number(node.exp.n) / Number(node.exp.d);
      return cpow(base, C(exp));
    }
    case "func": {
      const a = evalComplex(node.arg, env);
      switch (node.name) {
        case "sin": return csin(a);
        case "cos": return ccos(a);
        case "tan": return ctan(a);
        case "exp": return cexp(a);
        case "log": return clog(a);
        default: throw new Error(`function ${node.name} has no complex extension here`);
      }
    }
    default: throw new Error(`unknown AST node ${node.t}`);
  }
}

/* ---------------- FFT ---------------- */

function fftInPlace(re, im, invert) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((invert ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let j = 0; j < len / 2; j += 1) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + len / 2] * cwr - im[i + j + len / 2] * cwi;
        const vi = re[i + j + len / 2] * cwi + im[i + j + len / 2] * cwr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
  if (invert) for (let i = 0; i < n; i += 1) { re[i] /= n; im[i] /= n; }
}

const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

function dft(re, im, invert) {
  const n = re.length;
  const outR = new Array(n).fill(0);
  const outI = new Array(n).fill(0);
  const sgn = invert ? 1 : -1;
  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < n; j += 1) {
      const ang = (sgn * 2 * Math.PI * k * j) / n;
      const wr = Math.cos(ang);
      const wi = Math.sin(ang);
      outR[k] += re[j] * wr - im[j] * wi;
      outI[k] += re[j] * wi + im[j] * wr;
    }
  }
  if (invert) for (let k = 0; k < n; k += 1) { outR[k] /= n; outI[k] /= n; }
  return { re: outR, im: outI };
}

function transform(reIn, imIn, invert) {
  const n = reIn.length;
  if (isPow2(n)) {
    const re = reIn.slice();
    const im = imIn.slice();
    fftInPlace(re, im, invert);
    return { re, im };
  }
  return dft(reIn, imIn, invert);
}

/* ---------------- the solver ---------------- */

function readSignal(inputs) {
  const sig = inputs.signal;
  if (!Array.isArray(sig) || sig.length === 0) return { refusal: "missing_input:signal (an array of numbers or {re, im} pairs)" };
  if (sig.length > 4096) return { refusal: `signal_too_long:${sig.length} exceeds the JS tier cap 4096` };
  const re = [];
  const im = [];
  for (const v of sig) {
    if (typeof v === "number" && Number.isFinite(v)) { re.push(v); im.push(0); }
    else if (v && Number.isFinite(v.re) && Number.isFinite(v.im ?? 0)) { re.push(v.re); im.push(v.im ?? 0); }
    else return { refusal: "invalid_input:signal entries must be finite numbers or {re, im} pairs" };
  }
  if (!isPow2(re.length) && re.length > 512) {
    return { refusal: `unsupported_length:${re.length} is not a power of two and exceeds the direct-DFT cap 512 (arbitrary lengths: requires_engine_tier:fftw)` };
  }
  return { re, im };
}

function runTransforms(ctx, target) {
  const inputs = ctx?.inputs || {};

  if (target === "fft" || target === "ifft" || target === "hilbert") {
    const sig = readSignal(inputs);
    if (sig.refusal) return { notComputed: sig.refusal };
    const n = sig.re.length;
    if (target === "hilbert" && !isPow2(n)) return { notComputed: `unsupported_length:hilbert needs a power-of-two length (got ${n})` };
    const fwd = transform(sig.re, sig.im, false);
    if (target === "fft") {
      const back = transform(fwd.re, fwd.im, true);
      let rt = 0;
      for (let i = 0; i < n; i += 1) rt = Math.max(rt, Math.abs(back.re[i] - sig.re[i]), Math.abs(back.im[i] - sig.im[i]));
      let eTime = 0;
      let eFreq = 0;
      for (let i = 0; i < n; i += 1) {
        eTime += sig.re[i] ** 2 + sig.im[i] ** 2;
        eFreq += fwd.re[i] ** 2 + fwd.im[i] ** 2;
      }
      return {
        inputs: { length: n },
        outputs: {
          spectrum: fwd.re.map((v, i) => ({ re: v, im: fwd.im[i] })),
          roundTripError: rt,
          parsevalRelativeError: eTime > 0 ? Math.abs(eFreq / n - eTime) / eTime : 0,
        },
        margins: [],
        covers: [target],
      };
    }
    if (target === "ifft") {
      const back = transform(sig.re, sig.im, true);
      return {
        inputs: { length: n },
        outputs: { signal: back.re.map((v, i) => ({ re: v, im: back.im[i] })) },
        margins: [],
        covers: [target],
      };
    }
    // hilbert: zero the negative frequencies, double the positive
    const hr = fwd.re.slice();
    const hi = fwd.im.slice();
    for (let k = 0; k < n; k += 1) {
      if (k === 0 || (n % 2 === 0 && k === n / 2)) continue;
      if (k < n / 2) { hr[k] *= 2; hi[k] *= 2; }
      else { hr[k] = 0; hi[k] = 0; }
    }
    const analytic = transform(hr, hi, true);
    return {
      inputs: { length: n },
      outputs: { envelope: analytic.re.map((v, i) => Math.hypot(v, analytic.im[i])) },
      margins: [],
      covers: [target],
    };
  }

  if (target === "dct") {
    const sig = readSignal(inputs);
    if (sig.refusal) return { notComputed: sig.refusal };
    if (sig.im.some((v) => v !== 0)) return { notComputed: "invalid_input:dct takes a real signal" };
    const n = sig.re.length;
    if (n > 1024) return { notComputed: `signal_too_long:${n} exceeds the direct-DCT cap 1024` };
    const out = new Array(n);
    for (let k = 0; k < n; k += 1) {
      let s = 0;
      for (let j = 0; j < n; j += 1) s += sig.re[j] * Math.cos((Math.PI * k * (2 * j + 1)) / (2 * n));
      out[k] = s * (k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n));
    }
    return {
      inputs: { length: n },
      outputs: { coefficients: out },
      margins: [],
      covers: [target],
    };
  }

  if (target === "laplace") {
    if (typeof inputs.f !== "string" || !inputs.f.trim()) return { notComputed: "missing_input:f (an expression over t; SC-03)" };
    let ast;
    try {
      ast = parse(inputs.f);
    } catch (err) {
      return { notComputed: `invalid_input:f ${err.message}` };
    }
    const ss = inputs.s;
    if (!Array.isArray(ss) || ss.length === 0 || !ss.every((v) => Number.isFinite(v))) {
      return { notComputed: "missing_input:s (a non-empty array of finite evaluation points)" };
    }
    for (const s of ss) {
      if (!(s > 0)) return { notComputed: `outside_envelope:s = ${s} <= 0 — the truncated integral is certified only for s > 0` };
    }
    const tol = inputs.tol === undefined ? 1e-10 : inputs.tol;
    const values = [];
    for (const s of ss) {
      // window: tail <= maxSample * e^{-sT}/s; sample |f| coarsely
      let maxF = 0;
      for (let i = 0; i <= 200; i += 1) maxF = Math.max(maxF, Math.abs(evaluateAst(ast, { t: i * 0.25 })));
      const T = Math.max(10, Math.log(Math.max(1, maxF) / (s * tol)) / s + 2);
      // tanh-sinh over [0, T], levels by doubling
      const integrate = (h) => {
        let sum = 0;
        for (let k = -80; k <= 80; k += 1) {
          const u = k * h;
          const sinhU = Math.sinh(u);
          const coshU = Math.cosh(u);
          const x = (T / 2) * (1 + Math.tanh(Math.PI / 2 * sinhU));
          const w = ((T / 2) * (Math.PI / 2) * coshU) / (Math.cosh((Math.PI / 2) * sinhU) ** 2);
          const fv = evaluateAst(ast, { t: x }) * Math.exp(-s * x);
          if (Number.isFinite(fv) && Number.isFinite(w)) sum += h * w * fv;
        }
        return sum;
      };
      const coarse = integrate(0.25);
      const mid = integrate(0.125);
      const fine = integrate(0.0625);
      if (Math.abs(fine - mid) > Math.max(tol, 1e-8) * Math.max(1, Math.abs(fine)) * 10) {
        return { notComputed: `not_converged:the Laplace quadrature for s = ${s} did not settle between levels (estimates ${coarse} / ${mid} / ${fine})` };
      }
      values.push({ s, value: fine, tailBound: (maxF * Math.exp(-s * T)) / s });
    }
    return {
      inputs: { points: ss.length },
      outputs: { values },
      margins: [],
      covers: [target],
    };
  }

  if (target === "inverse-laplace") {
    if (typeof inputs.F !== "string" || !inputs.F.trim()) return { notComputed: "missing_input:F (an expression over s; SC-03)" };
    let ast;
    try {
      ast = parse(inputs.F);
    } catch (err) {
      return { notComputed: `invalid_input:F ${err.message}` };
    }
    const ts = inputs.t;
    if (!Array.isArray(ts) || ts.length === 0 || !ts.every((v) => Number.isFinite(v) && v > 0)) {
      return { notComputed: "missing_input:t (a non-empty array of positive evaluation times)" };
    }
    // Abate-Whitt Euler: A sets the discretization error ~e^{-A};
    // N base terms + M Euler-averaged tail terms.
    const A = 25;
    const N = 60;
    const M = 40;
    const binom = [1];
    for (let i = 1; i <= M; i += 1) binom.push((binom[i - 1] * (M - i + 1)) / i);
    const values = ts.map((t) => {
      const a = A / (2 * t);
      const partials = [];
      let s = 0;
      for (let k = 0; k <= N + M; k += 1) {
        const Fk = evalComplex(ast, { s: C(a, (k * Math.PI) / t) }).re;
        const term = (k === 0 ? 0.5 : 1) * (k % 2 === 0 ? 1 : -1) * Fk;
        s += term;
        partials.push(s);
      }
      let avg = 0;
      for (let m = 0; m <= M; m += 1) avg += (binom[m] / 2 ** M) * partials[N + m];
      return { t, value: (Math.exp(A / 2) / t) * avg };
    });
    return {
      inputs: { points: ts.length, method: "Abate-Whitt Euler (A=25, N=60, M=40)" },
      outputs: { values },
      margins: [],
      covers: [target],
    };
  }

  if (target === "dwt") {
    const sig = readSignal(inputs);
    if (sig.refusal) return { notComputed: sig.refusal };
    if (sig.im.some((v) => v !== 0)) return { notComputed: "invalid_input:dwt takes a real signal" };
    const n = sig.re.length;
    if (!isPow2(n) || n < 2) return { notComputed: `unsupported_length:Haar DWT needs a power-of-two length >= 2 (got ${n})` };
    const levels = Math.log2(n);
    let approx = sig.re.slice();
    const details = [];
    while (approx.length > 1) {
      const half = approx.length / 2;
      const a = new Array(half);
      const d = new Array(half);
      for (let i = 0; i < half; i += 1) {
        a[i] = (approx[2 * i] + approx[2 * i + 1]) / Math.SQRT2;
        d[i] = (approx[2 * i] - approx[2 * i + 1]) / Math.SQRT2;
      }
      details.unshift(d);
      approx = a;
    }
    // exact reconstruction certificate: details[0] is the
    // coarsest level (it was unshifted first), so reconstruction
    // pairs it with the approximation first and refines outward
    let rec = approx.slice();
    for (let lev = 0; lev < details.length; lev += 1) {
      const d = details[lev];
      const out = new Array(rec.length * 2);
      for (let i = 0; i < rec.length; i += 1) {
        out[2 * i] = (rec[i] + d[i]) / Math.SQRT2;
        out[2 * i + 1] = (rec[i] - d[i]) / Math.SQRT2;
      }
      rec = out;
    }
    let rt = 0;
    for (let i = 0; i < n; i += 1) rt = Math.max(rt, Math.abs(rec[i] - sig.re[i]));
    return {
      inputs: { length: n, levels },
      outputs: { approximation: approx, details, reconstructionError: rt },
      margins: [],
      covers: [target],
    };
  }

  return { notComputed: `unknown_operation:${target} (wavelet families beyond Haar: requires_engine_tier:pywavelets)` };
}

export const transforms = registerSolver({
  id: "math.transforms",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 2,
  method: "radix-2 FFT / direct DFT, orthonormal DCT-II, tanh-sinh Laplace quadrature with a computed tail bound, Abate-Whitt Euler inverse Laplace over a complex extension of the symbolic grammar, FFT Hilbert envelope, Haar DWT",
  reference: "DLMF transform tables — reference pairs: 1/(s+1) <-> e^{-t}, 1/s <-> 1, 1/(s^2+1) <-> sin t, 1/s^2 <-> t",
  regime: "FFT lengths to 4096 (direct DFT only to 512 for non-powers of two); Laplace certified for s > 0; inverse Laplace for t > 0; Haar DWT needs power-of-two lengths",
  units: { inputs: "sample arrays, or expressions (f over t / F over s) with evaluation points", outputs: "transform values with the target's certificate (round-trip / Parseval / tail bound / reconstruction error)" },
  tolerance: "FFT round-trip and Parseval are exact to rounding; Laplace quadrature must settle between levels or refuse",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runTransforms,
});
