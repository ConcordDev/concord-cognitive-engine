// server/lib/conkay/physics/solvers/units-dimensional.js
//
// math.units-dimensional — SX-NUM-02 (ConKay solver catalogue, W0).
//
// Dimensional analysis at the JS tier (CB-0820), per NIST SP 811:
//
//   dimension  — the dimension vector of a unit or unit expression
//                over the SI base dimensions [M, L, T, I, Θ, N, J],
//                with the named SI derived unit when it matches one.
//   convert    — exact conversions between units of the same
//                dimension; a dimension mismatch is NOT_COMPUTED
//                dimension_mismatch naming both dimensions. Factors
//                are the SP 811 / SI definitions (inch = 0.0254 m,
//                atm = 101325 Pa, eV = 1.602176634e-19 J — exact).
//                Affine units (°C, °F) are NOT in the table: temperature
//                here is kelvin, and the exclusion is named, not hidden.
//   check      — dimensional homogeneity of a sum: every term must
//                share one dimension. A mismatch is a computed FAIL
//                verdict naming the offending term, not a refusal.
//   pi-groups  — Buckingham π: the dimension matrix's null space,
//                computed by exact rational RREF, returned as
//                exponent vectors with expression strings. The count
//                is variables − rank, by construction.
//
// Unit expressions: "kg*m/s^2", "J/(kg*K)", "1/s", with integer
// exponents. Unknown units are refused by name.

import { registerSolver } from "../registry.js";

export const BASE_DIMS = ["M", "L", "T", "I", "Θ", "N", "J"];
const dim = (m = 0, l = 0, t = 0, i = 0, th = 0, n = 0, j = 0) => [m, l, t, i, th, n, j];
const D0 = dim();

// symbol -> {dims, factor (to SI base product), name?}
export const UNITS = {
  // base
  kg: { dims: dim(1, 0, 0, 0, 0, 0, 0), factor: 1 },
  m: { dims: dim(0, 1, 0, 0, 0, 0, 0), factor: 1 },
  s: { dims: dim(0, 0, 1, 0, 0, 0, 0), factor: 1 },
  A: { dims: dim(0, 0, 0, 1, 0, 0, 0), factor: 1 },
  K: { dims: dim(0, 0, 0, 0, 1, 0, 0), factor: 1 },
  mol: { dims: dim(0, 0, 0, 0, 0, 1, 0), factor: 1 },
  cd: { dims: dim(0, 0, 0, 0, 0, 0, 1), factor: 1 },
  // length
  mm: { dims: dim(0, 1, 0, 0, 0, 0, 0), factor: 1e-3 },
  cm: { dims: dim(0, 1, 0, 0, 0, 0, 0), factor: 1e-2 },
  km: { dims: dim(0, 1, 0, 0, 0, 0, 0), factor: 1e3 },
  um: { dims: dim(0, 1, 0, 0, 0, 0, 0), factor: 1e-6 },
  nm: { dims: dim(0, 1, 0, 0, 0, 0, 0), factor: 1e-9 },
  in: { dims: dim(0, 1, 0, 0, 0, 0, 0), factor: 0.0254 },
  ft: { dims: dim(0, 1, 0, 0, 0, 0, 0), factor: 0.3048 },
  yd: { dims: dim(0, 1, 0, 0, 0, 0, 0), factor: 0.9144 },
  mi: { dims: dim(0, 1, 0, 0, 0, 0, 0), factor: 1609.344 },
  // mass
  g: { dims: dim(1, 0, 0, 0, 0, 0, 0), factor: 1e-3 },
  mg: { dims: dim(1, 0, 0, 0, 0, 0, 0), factor: 1e-6 },
  t: { dims: dim(1, 0, 0, 0, 0, 0, 0), factor: 1e3 },
  lb: { dims: dim(1, 0, 0, 0, 0, 0, 0), factor: 0.45359237 },
  // time
  ms: { dims: dim(0, 0, 1, 0, 0, 0, 0), factor: 1e-3 },
  min: { dims: dim(0, 0, 1, 0, 0, 0, 0), factor: 60 },
  h: { dims: dim(0, 0, 1, 0, 0, 0, 0), factor: 3600 },
  // named derived (factor 1 in SI)
  Hz: { dims: dim(0, 0, -1, 0, 0, 0, 0), factor: 1, name: "hertz" },
  N: { dims: dim(1, 1, -2, 0, 0, 0, 0), factor: 1, name: "newton" },
  Pa: { dims: dim(1, -1, -2, 0, 0, 0, 0), factor: 1, name: "pascal" },
  J: { dims: dim(1, 2, -2, 0, 0, 0, 0), factor: 1, name: "joule" },
  W: { dims: dim(1, 2, -3, 0, 0, 0, 0), factor: 1, name: "watt" },
  C: { dims: dim(0, 0, 1, 1, 0, 0, 0), factor: 1, name: "coulomb" },
  V: { dims: dim(1, 2, -3, -1, 0, 0, 0), factor: 1, name: "volt" },
  F: { dims: dim(-1, -2, 4, 2, 0, 0, 0), factor: 1, name: "farad" },
  ohm: { dims: dim(1, 2, -3, -2, 0, 0, 0), factor: 1, name: "ohm" },
  S: { dims: dim(-1, -2, 3, 2, 0, 0, 0), factor: 1, name: "siemens" },
  Wb: { dims: dim(1, 2, -2, -1, 0, 0, 0), factor: 1, name: "weber" },
  T: { dims: dim(1, 0, -2, -1, 0, 0, 0), factor: 1, name: "tesla" },
  H: { dims: dim(1, 2, -2, -2, 0, 0, 0), factor: 1, name: "henry" },
  // scaled / non-SI accepted for use with SI (SP 811)
  L: { dims: dim(0, 3, 0, 0, 0, 0, 0), factor: 1e-3 },
  bar: { dims: dim(1, -1, -2, 0, 0, 0, 0), factor: 1e5 },
  atm: { dims: dim(1, -1, -2, 0, 0, 0, 0), factor: 101325 },
  psi: { dims: dim(1, -1, -2, 0, 0, 0, 0), factor: 6894.757293168 },
  lbf: { dims: dim(1, 1, -2, 0, 0, 0, 0), factor: 4.4482216152605 },
  eV: { dims: dim(1, 2, -2, 0, 0, 0, 0), factor: 1.602176634e-19 },
  cal: { dims: dim(1, 2, -2, 0, 0, 0, 0), factor: 4.184 },
  kWh: { dims: dim(1, 2, -2, 0, 0, 0, 0), factor: 3.6e6 },
  rad: { dims: D0, factor: 1, name: "radian" },
  sr: { dims: D0, factor: 1, name: "steradian" },
};

const NAMED_BY_DIMS = new Map();
for (const [sym, u] of Object.entries(UNITS)) {
  if (u.name && u.factor === 1) NAMED_BY_DIMS.set(u.dims.join(","), { symbol: sym, name: u.name });
}

export function formatDims(d) {
  const parts = [];
  d.forEach((e, i) => {
    if (e === 0) return;
    parts.push(e === 1 ? BASE_DIMS[i] : `${BASE_DIMS[i]}^${e}`);
  });
  return parts.length ? parts.join("*") : "1";
}

const dimsEq = (a, b) => a.every((v, i) => v === b[i]);
const dimsAdd = (a, b, s = 1) => a.map((v, i) => v + s * b[i]);
const dimsScale = (a, k) => a.map((v) => v * k);

/** Parse a unit expression into {dims, factor}. Throws on unknown units. */
export function parseUnitExpr(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (/[A-Za-zΘ]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-zΘ]/.test(src[j])) j += 1;
      tokens.push({ k: "unit", v: src.slice(i, j) });
      i = j; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j += 1;
      tokens.push({ k: "int", v: parseInt(src.slice(i, j), 10) });
      i = j; continue;
    }
    if ("*/^()+-".includes(c)) { tokens.push({ k: c }); i += 1; continue; }
    throw new Error(`unexpected character "${c}" in unit expression`);
  }
  let pos = 0;
  const peek = () => tokens[pos];
  function parseE() {
    let lhs = parseT();
    while (peek()?.k === "*" || peek()?.k === "/") {
      const op = tokens[pos].k; pos += 1;
      const rhs = parseT();
      lhs = op === "*"
        ? { dims: dimsAdd(lhs.dims, rhs.dims), factor: lhs.factor * rhs.factor }
        : { dims: dimsAdd(lhs.dims, rhs.dims, -1), factor: lhs.factor / rhs.factor };
    }
    return lhs;
  }
  function parseT() {
    let base = parseA();
    if (peek()?.k === "^") {
      pos += 1;
      let sign = 1;
      if (peek()?.k === "-") { sign = -1; pos += 1; }
      if (peek()?.k === "+") { pos += 1; }
      const e = tokens[pos];
      if (e?.k !== "int") throw new Error("unit exponent must be an integer");
      pos += 1;
      base = { dims: dimsScale(base.dims, sign * e.v), factor: base.factor ** (sign * e.v) };
    }
    return base;
  }
  function parseA() {
    const tok = tokens[pos];
    if (!tok) throw new Error("unexpected end of unit expression");
    if (tok.k === "(") { pos += 1; const e = parseE(); if (tokens[pos]?.k !== ")") throw new Error("expected ) in unit expression"); pos += 1; return e; }
    if (tok.k === "int" && tok.v === 1) { pos += 1; return { dims: D0, factor: 1 }; }
    if (tok.k === "unit") {
      pos += 1;
      const u = UNITS[tok.v];
      if (!u) throw new Error(`unknown_unit:${tok.v}`);
      return { dims: u.dims, factor: u.factor };
    }
    throw new Error(`unexpected token "${tok.k}" in unit expression`);
  }
  const out = parseE();
  if (pos !== tokens.length) throw new Error("trailing input in unit expression");
  return out;
}

/* -------- exact rational RREF for the Buckingham null space -------- */

function frac(n, d = 1) {
  if (n === 0) return [0, 1]; // canonical zero (never -0)
  if (d < 0) { n = -n; d = -d; }
  let a = Math.abs(n), b = d;
  while (b) { [a, b] = [b, a % b]; }
  const g = a || 1;
  return [n / g, d / g];
}
const fAdd = (x, y) => frac(x[0] * y[1] + y[0] * x[1], x[1] * y[1]);
const fMul = (x, y) => frac(x[0] * y[0], x[1] * y[1]);
const fNeg = (x) => (x[0] === 0 ? [0, 1] : [-x[0], x[1]]);
const fInv = (x) => (x[0] === 0 ? null : frac(x[1] * Math.sign(x[0]), Math.abs(x[0])));

/** Null-space basis of a small integer matrix, exact. Returns {rank, basis}. */
export function nullSpace(matrix) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const a = matrix.map((row) => row.map((v) => frac(v)));
  const pivotCols = [];
  let r = 0;
  for (let c = 0; c < cols && r < rows; c += 1) {
    let piv = -1;
    for (let i = r; i < rows; i += 1) if (a[i][c][0] !== 0) { piv = i; break; }
    if (piv === -1) continue;
    [a[r], a[piv]] = [a[piv], a[r]];
    const inv = fInv(a[r][c]);
    for (let j = 0; j < cols; j += 1) a[r][j] = fMul(a[r][j], inv);
    for (let i = 0; i < rows; i += 1) {
      if (i !== r && a[i][c][0] !== 0) {
        const f = a[i][c];
        for (let j = 0; j < cols; j += 1) a[i][j] = fAdd(a[i][j], fNeg(fMul(f, a[r][j])));
      }
    }
    pivotCols.push(c);
    r += 1;
  }
  const freeCols = [];
  for (let c = 0; c < cols; c += 1) if (!pivotCols.includes(c)) freeCols.push(c);
  const basis = freeCols.map((fc) => {
    const v = Array.from({ length: cols }, () => [0, 1]);
    v[fc] = [1, 1];
    pivotCols.forEach((pc, i) => { v[pc] = fNeg(a[i][fc]); });
    return v;
  });
  return { rank: pivotCols.length, basis };
}

function groupString(names, exps) {
  const numParts = [];
  const denParts = [];
  exps.forEach(([n, d], i) => {
    if (n === 0) return;
    const e = d === 1 ? Math.abs(n) : null;
    const base = names[i];
    const term = e === null ? `${base}^(${Math.abs(n)}/${d})` : e === 1 ? base : `${base}^${e}`;
    (n > 0 ? numParts : denParts).push(term);
  });
  const numS = numParts.length ? numParts.join("*") : "1";
  return denParts.length ? `${numS}/(${denParts.join("*")})` : numS;
}

/* ---------------- the solver ---------------- */

function runUnits(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target === "dimension") {
    if (typeof inputs.unit !== "string" || !inputs.unit.trim()) {
      return { notComputed: "missing_input:unit (SC-03)" };
    }
    let p;
    try { p = parseUnitExpr(inputs.unit); } catch (err) { return { notComputed: `invalid_input:unit ${err.message}` }; }
    const named = NAMED_BY_DIMS.get(p.dims.join(","));
    return {
      inputs: { unit: inputs.unit },
      outputs: {
        dimensions: formatDims(p.dims),
        vector: Object.fromEntries(BASE_DIMS.map((b, i) => [b, p.dims[i]])),
        ...(named && p.factor === 1 ? { namedUnit: named.symbol, namedUnitName: named.name } : {}),
        siFactor: p.factor,
      },
      margins: [],
      covers: [target],
    };
  }
  if (target === "convert") {
    const { value, from, to } = inputs;
    if (!Number.isFinite(value)) return { notComputed: "missing_input:value must be a finite number" };
    if (typeof from !== "string" || typeof to !== "string") {
      return { notComputed: "missing_input:from and to units are required (SC-03)" };
    }
    let pf, pt;
    try { pf = parseUnitExpr(from); } catch (err) { return { notComputed: `invalid_input:from ${err.message}` }; }
    try { pt = parseUnitExpr(to); } catch (err) { return { notComputed: `invalid_input:to ${err.message}` }; }
    if (!dimsEq(pf.dims, pt.dims)) {
      return { notComputed: `dimension_mismatch:${from} is ${formatDims(pf.dims)} but ${to} is ${formatDims(pt.dims)}` };
    }
    return {
      inputs: { value, from, to },
      outputs: { result: (value * pf.factor) / pt.factor, unit: to, dimensions: formatDims(pf.dims) },
      margins: [],
      covers: [target],
    };
  }
  if (target === "check") {
    const terms = inputs.terms;
    if (!Array.isArray(terms) || terms.length < 2) {
      return { notComputed: "missing_input:terms (an array of >= 2 unit expressions summed together)" };
    }
    const parsed = [];
    for (const t of terms) {
      try { parsed.push({ term: t, ...parseUnitExpr(t) }); } catch (err) {
        return { notComputed: `invalid_input:terms ${err.message}` };
      }
    }
    const ref = parsed[0];
    const bad = parsed.find((p) => !dimsEq(p.dims, ref.dims));
    if (bad) {
      return {
        inputs: { terms },
        outputs: { homogeneous: false, dimensions: formatDims(ref.dims), offending: bad.term, offendingDimensions: formatDims(bad.dims) },
        margins: [],
        failures: [{ name: "dimensional_homogeneity", detail: `${bad.term} (${formatDims(bad.dims)}) cannot be added to ${ref.term} (${formatDims(ref.dims)})` }],
        covers: [target],
      };
    }
    return {
      inputs: { terms },
      outputs: { homogeneous: true, dimensions: formatDims(ref.dims) },
      margins: [],
      covers: [target],
    };
  }
  if (target === "pi-groups") {
    const vars = inputs.variables;
    if (!Array.isArray(vars) || vars.length < 2) {
      return { notComputed: "missing_input:variables (an array of {name, unit})" };
    }
    const names = [];
    const cols = [];
    for (const v of vars) {
      if (!v?.name || typeof v.unit !== "string") {
        return { notComputed: "invalid_input:variables each entry needs {name, unit}" };
      }
      let p;
      try { p = parseUnitExpr(v.unit); } catch (err) { return { notComputed: `invalid_input:variables ${err.message}` }; }
      names.push(v.name);
      cols.push(p.dims);
    }
    // dimension matrix: rows = base dims that appear, cols = variables
    const activeRows = BASE_DIMS.map((_, i) => i).filter((i) => cols.some((c) => c[i] !== 0));
    const matrix = activeRows.map((i) => cols.map((c) => c[i]));
    const { rank, basis } = nullSpace(matrix);
    const groups = basis.map((exps) => ({
      exponents: Object.fromEntries(names.map((n, i) => [n, exps[i][1] === 1 ? exps[i][0] : exps[i][0] / exps[i][1]])),
      expression: groupString(names, exps),
    }));
    return {
      inputs: { variables: vars },
      outputs: {
        rank,
        variableCount: vars.length,
        groupCount: groups.length, // = variables - rank, Buckingham's theorem
        groups,
      },
      margins: [],
      covers: [target],
    };
  }
  return { notComputed: `unknown_operation:${target}` };
}

export const unitsDimensional = registerSolver({
  id: "math.units-dimensional",
  version: "1.0.0",
  domain: "math",
  domains: ["math", "physics"],
  fidelity: 0,
  method: "dimension algebra over the SI base dimensions; exact-definition conversion factors (NIST SP 811); Buckingham pi by exact rational null space",
  reference: "NIST SP 811 (Guide for the Use of the International System of Units); Buckingham (1914)",
  regime: "multiplicative unit systems; affine temperature scales (degC/degF offsets) are excluded by name — temperature is kelvin",
  units: { inputs: "unit expressions over the SP 811 table", outputs: "dimension vectors, converted values, pi-group exponent vectors" },
  tolerance: "exact (integer dimension algebra, rational null space; conversion factors are the SI definitions)",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runUnits,
});
