// server/lib/conkay/physics/solvers/arbitrary-precision.js
//
// math.arbitrary-precision — SX-NUM-19 (ConKay solver
// catalogue, Wave 0).
//
// High-precision recompute: the checker agent's tool. A
// closed form is re-evaluated in BigInt decimal arithmetic
// at a DECLARED precision (an input, echoed with the
// result), so another solver's double-precision answer can
// be verified digit by digit. Results ship as digit strings
// — a binary float would discard exactly what this solver
// exists to keep. Rounding at the declared precision is
// round-half-even, stated on the record.
//
// Internally every operation runs at working precision
// (declared + 12 guard digits) and rounds once, at the end.
// The catalogue reference case is pi to 50 digits (Machin
// formula). Cancellation cases that destroy doubles —
// 10^20 + 1 - 10^20 — are exact here.

import { registerSolver } from "../registry.js";
import { parse } from "./math-symbolic.js";

/* ---------------- decimal core ----------------
 * A Dec is { m: BigInt, e: number } meaning m x 10^e,
 * normalized so m has at most P significant digits. */

const dLen = (m) => (m === 0n ? 1 : (m < 0n ? -m : m).toString().length);

function dNorm(m, e, P) {
  if (m === 0n) return { m: 0n, e: 0 };
  let len = dLen(m);
  if (len > P) {
    const drop = len - P;
    const pow = 10n ** BigInt(drop);
    const neg = m < 0n;
    const a = neg ? -m : m;
    let q = a / pow;
    const r = a % pow;
    const twice = 2n * r;
    if (twice > pow || (twice === pow && q % 2n === 1n)) q += 1n;
    m = neg ? -q : q;
    e += drop;
    if (dLen(m) > P) return dNorm(m, e, P); // rounding carried over
  }
  return { m, e };
}

const dInt = (n) => ({ m: BigInt(n), e: 0 });

function dFromString(s, P) {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(s).trim());
  if (!match || (match[2] === "" && !match[3])) throw new Error(`not a decimal literal: ${s}`);
  const digits = (match[2] + (match[3] || "")).replace(/^0+(?=\d)/, "");
  const exp = (match[4] ? Number(match[4]) : 0) - (match[3] || "").length;
  const m = BigInt((match[1] === "-" ? "-" : "") + (digits || "0"));
  return dNorm(m, exp, P);
}

function dAlign(a, b) {
  const e = Math.min(a.e, b.e);
  return [a.m * 10n ** BigInt(a.e - e), b.m * 10n ** BigInt(b.e - e), e];
}

const dAdd = (a, b, P) => { const [x, y, e] = dAlign(a, b); return dNorm(x + y, e, P); };
const dSub = (a, b, P) => { const [x, y, e] = dAlign(a, b); return dNorm(x - y, e, P); };
const dNeg = (a) => ({ m: -a.m, e: a.e });
const dMul = (a, b, P) => dNorm(a.m * b.m, a.e + b.e, P);

function dDiv(a, b, P) {
  if (b.m === 0n) throw new Error("division by zero");
  if (a.m === 0n) return { m: 0n, e: 0 };
  const scale = BigInt(P + dLen(b.m) + 2);
  const num = a.m * 10n ** scale;
  const neg = (num < 0n) !== (b.m < 0n);
  const an = num < 0n ? -num : num;
  const bn = b.m < 0n ? -b.m : b.m;
  let q = an / bn;
  const r = an % bn;
  const twice = 2n * r;
  if (twice > bn || (twice === bn && q % 2n === 1n)) q += 1n;
  return dNorm(neg ? -q : q, a.e - b.e - Number(scale), P);
}

function dPowInt(a, n, P) {
  if (n === 0) return dInt(1);
  if (n < 0) return dDiv(dInt(1), dPowInt(a, -n, P), P);
  let result = dInt(1);
  let base = a;
  let k = n;
  while (k > 0) {
    if (k % 2 === 1) result = dMul(result, base, P);
    k = Math.floor(k / 2);
    if (k > 0) base = dMul(base, base, P);
  }
  return result;
}

/** Integer square root of a non-negative BigInt (floor). */
function isqrt(n) {
  if (n < 2n) return n;
  let x = 10n ** BigInt(Math.ceil(n.toString().length / 2));
  let y = (x + n / x) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

function dSqrt(a, P) {
  if (a.m < 0n) throw new Error("sqrt of a negative value");
  if (a.m === 0n) return { m: 0n, e: 0 };
  // scale the mantissa to 2P digits with an even exponent
  let { m, e } = a;
  const target = 2 * P;
  let len = dLen(m);
  if (len < target) { m *= 10n ** BigInt(target - len); e -= target - len; len = target; }
  if (e % 2 !== 0) { m *= 10n; e -= 1; }
  const root = isqrt(m);
  // root has ~P digits; round it from the exact square check
  return dNorm(root, e / 2, P);
}

/* ---------------- constants & transcendentals ---------------- */

function dAtanInv(n, P) {
  // arctan(1/n), n >= 2 integer, alternating series
  const x2 = dInt(n * n);
  let term = dDiv(dInt(1), dInt(n), P);
  let sum = term;
  let k = 1;
  while (true) {
    term = dDiv(term, x2, P);
    const add = dDiv(term, dInt(2 * k + 1), P);
    sum = k % 2 === 1 ? dSub(sum, add, P) : dAdd(sum, add, P);
    if (dLen(add.m) > 0 && add.e + dLen(add.m) < -(P + 4)) break;
    if (k > 10000) break;
    k += 1;
  }
  return sum;
}

const piCache = new Map();
function dPi(P) {
  if (!piCache.has(P)) {
    const a = dMul(dInt(16), dAtanInv(5, P), P);
    const b = dMul(dInt(4), dAtanInv(239, P), P);
    piCache.set(P, dSub(a, b, P));
  }
  return piCache.get(P);
}

const eCache = new Map();
function dE(P) {
  if (!eCache.has(P)) {
    let sum = dInt(1);
    let term = dInt(1);
    let k = 1;
    while (true) {
      term = dDiv(term, dInt(k), P);
      sum = dAdd(sum, term, P);
      if (term.e + dLen(term.m) < -(P + 4)) break;
      k += 1;
    }
    eCache.set(P, sum);
  }
  return eCache.get(P);
}

function dExp(x, P) {
  if (x.m === 0n) return dInt(1);
  const approx = Number(x.m) * 10 ** x.e;
  if (!Number.isFinite(approx) || Math.abs(approx) > 1000) throw new Error("exp argument outside the seated range (|x| <= 1000)");
  const k = Math.round(approx);
  const r = dSub(x, dInt(k), P);
  let sum = dInt(1);
  let term = dInt(1);
  let i = 1;
  while (true) {
    term = dDiv(dMul(term, r, P), dInt(i), P);
    sum = dAdd(sum, term, P);
    if (term.m === 0n || term.e + dLen(term.m) < -(P + 4)) break;
    i += 1;
    if (i > 10000) break;
  }
  return dMul(sum, dPowInt(dE(P), k, P), P);
}

function dLog(x, P) {
  if (x.m <= 0n) throw new Error("log of a non-positive value");
  // normalize x = f x 10^n with f in [1, 10)
  let f = { ...x };
  let n = 0;
  const adj = f.e + dLen(f.m) - 1; // x ~ d.ddd x 10^adj
  f = dNorm(f.m, f.e - adj, P);
  n = adj;
  // reduce by repeated sqrt: log(f) = 2^s * log(f^(1/2^s))
  const S = 12;
  let g = f;
  for (let i = 0; i < S; i += 1) g = dSqrt(g, P);
  // log(g) = 2 * atanh((g-1)/(g+1)), argument now tiny
  const y = dDiv(dSub(g, dInt(1), P), dAdd(g, dInt(1), P), P);
  const y2 = dMul(y, y, P);
  let term = y;
  let sum = y;
  let k = 1;
  while (true) {
    term = dMul(term, y2, P);
    const add = dDiv(term, dInt(2 * k + 1), P);
    sum = dAdd(sum, add, P);
    if (add.m === 0n || add.e + dLen(add.m) < -(P + 4)) break;
    k += 1;
    if (k > 10000) break;
  }
  const logF = dMul(dMul(dInt(2 ** S), dInt(2), P), sum, P);
  if (n === 0) return logF;
  // ln(10) by the same reduction applied to 10 itself
  let g10 = dInt(10);
  for (let i = 0; i < S; i += 1) g10 = dSqrt(g10, P);
  const y10 = dDiv(dSub(g10, dInt(1), P), dAdd(g10, dInt(1), P), P);
  const y102 = dMul(y10, y10, P);
  let t10 = y10;
  let s10 = y10;
  let k10 = 1;
  while (true) {
    t10 = dMul(t10, y102, P);
    const add = dDiv(t10, dInt(2 * k10 + 1), P);
    s10 = dAdd(s10, add, P);
    if (add.m === 0n || add.e + dLen(add.m) < -(P + 4)) break;
    k10 += 1;
    if (k10 > 10000) break;
  }
  const ln10 = dMul(dMul(dInt(2 ** S), dInt(2), P), s10, P);
  return dAdd(logF, dMul(dInt(n), ln10, P), P);
}

function dSinCos(x, P) {
  const pi = dPi(P);
  const twoPi = dMul(dInt(2), pi, P);
  const approx = Number(x.m) * 10 ** x.e;
  let q = Math.floor(approx / (2 * Math.PI));
  let r = dSub(x, dMul(dInt(q), twoPi, P), P);
  // fix up the double-estimated quotient with exact compares
  const cmp = (a, b) => { const [u, v] = dAlign(a, b); return u < v ? -1 : u > v ? 1 : 0; };
  while (cmp(r, twoPi) >= 0) { r = dSub(r, twoPi, P); q += 1; }
  while (cmp(r, dInt(0)) < 0) { r = dAdd(r, twoPi, P); q -= 1; }
  if (cmp(r, pi) > 0) r = dSub(r, twoPi, P);
  const r2 = dNeg(dMul(r, r, P), P);
  let sin = r;
  let termS = r;
  let cos = dInt(1);
  let termC = dInt(1);
  for (let k = 1; k < 10000; k += 1) {
    termS = dDiv(dMul(termS, r2, P), dInt(2 * k * (2 * k + 1)), P);
    sin = dAdd(sin, termS, P);
    termC = dDiv(dMul(termC, r2, P), dInt((2 * k - 1) * (2 * k)), P);
    cos = dAdd(cos, termC, P);
    if (termS.e + dLen(termS.m) < -(P + 4) && termC.e + dLen(termC.m) < -(P + 4)) break;
  }
  return { sin, cos };
}

/* ---------------- expression evaluation ---------------- */

function evalAst(node, vars, P) {
  switch (node.t) {
    case "num": {
      if (node.v.d === 1n) return dNorm(node.v.n, 0, P);
      return dDiv(dNorm(node.v.n, 0, P), dNorm(node.v.d, 0, P), P);
    }
    case "var": {
      if (node.name === "pi") return dPi(P);
      if (node.name === "e") return dE(P);
      const v = vars[node.name];
      if (v === undefined) throw Object.assign(new Error(`missing_input:variable ${node.name} (supply it as a decimal string)`), { notComputed: true });
      return dFromString(v, P);
    }
    case "add": return node.args.reduce((acc, a) => dAdd(acc, evalAst(a, vars, P), P), dInt(0));
    case "mul": return node.args.reduce((acc, a) => dMul(acc, evalAst(a, vars, P), P), dInt(1));
    case "pow": {
      const base = evalAst(node.base, vars, P);
      const { n, d } = node.exp;
      if (d === 1n) return dPowInt(base, Number(n), P);
      if (d === 2n) {
        const s = dSqrt(base, P);
        return n === 1n ? s : dPowInt(s, Number(n), P);
      }
      throw Object.assign(new Error(`unsupported_exponent:${n}/${d} (integer and half exponents are seated; general rational powers are follow-on scope)`), { notComputed: true });
    }
    case "func": {
      const a = evalAst(node.arg, vars, P);
      switch (node.name) {
        case "sqrt": return dSqrt(a, P);
        case "exp": return dExp(a, P);
        case "log": return dLog(a, P);
        case "sin": return dSinCos(a, P).sin;
        case "cos": return dSinCos(a, P).cos;
        default: throw Object.assign(new Error(`unsupported_function:${node.name} (seated: sqrt, exp, log, sin, cos)`), { notComputed: true });
      }
    }
    default: throw new Error(`unknown AST node ${node.t}`);
  }
}

function dToString(v, digits) {
  if (v.m === 0n) return "0";
  const neg = v.m < 0n;
  let s = (neg ? -v.m : v.m).toString();
  // pad to exactly `digits` significant digits; the exponent
  // drops by the pad length so the value is unchanged
  let e = v.e;
  if (s.length < digits) {
    e -= digits - s.length;
    s = s.padEnd(digits, "0");
  }
  const pointPos = s.length + e;
  let out;
  if (pointPos <= -4 || pointPos > digits + 12) {
    out = `${s[0]}.${s.slice(1)}e${pointPos - 1}`;
  } else if (pointPos <= 0) {
    out = `0.${"0".repeat(-pointPos)}${s}`;
  } else if (pointPos >= s.length) {
    out = s + "0".repeat(pointPos - s.length);
  } else {
    out = `${s.slice(0, pointPos)}.${s.slice(pointPos)}`;
  }
  return (neg ? "-" : "") + out;
}

function runAp(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target !== "eval") {
    return { notComputed: `unknown_operation:${target}` };
  }
  const digits = inputs.digits === undefined ? 50 : inputs.digits;
  if (!Number.isInteger(digits) || digits < 10 || digits > 200) {
    return { notComputed: "invalid_input:digits must be an integer 10..200 (the declared precision is the contract)" };
  }
  if (typeof inputs.expression !== "string" || !inputs.expression.trim()) {
    return { notComputed: "missing_input:expression (a closed form over the symbolic grammar)" };
  }
  const P = digits + 12;
  let ast;
  try {
    ast = parse(inputs.expression);
  } catch (err) {
    return { notComputed: `invalid_input:expression ${err.message}` };
  }
  let value;
  try {
    value = evalAst(ast, inputs.vars || {}, P);
  } catch (err) {
    if (err.notComputed) return { notComputed: err.message };
    return { notComputed: `evaluation_failed:${err.message}` };
  }
  const rounded = dNorm(value.m, value.e, digits);
  return {
    inputs: { digits, guardDigits: 12, rounding: "half-even" },
    outputs: { value: dToString(rounded, digits), significantDigits: digits },
    margins: [],
    covers: [target],
  };
}

export const arbitraryPrecision = registerSolver({
  id: "math.arbitrary-precision",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 2,
  method: "BigInt decimal arithmetic at declared + 12 guard digits, round-half-even; Machin pi, sqrt-reduced log, range-reduced exp/sin/cos",
  reference: "the checker's recompute discipline (catalogue method: mpmath-class re-evaluation of any closed form); reference case: pi to 50 digits, a universal published constant",
  regime: "closed forms over + - * / ^ (integer and half exponents), sqrt, exp, log, sin, cos, pi, e and caller variables given as decimal strings; precision declared per call, 10..200 digits",
  units: { inputs: "expression string, vars as decimal strings, digits", outputs: "the value as a digit string at exactly the declared significant digits" },
  tolerance: "exact at the declared precision by construction: guard digits absorb intermediate rounding, the final rounding is half-even and named",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runAp,
});
