// server/lib/conkay/physics/solvers/math-symbolic.js
//
// math.symbolic — SX-NUM-01 (ConKay solver catalogue, Wave 0).
//
// Computer algebra in two tiers, per the catalogue row's own method:
//
//   L0 fast path (this module, in JS): exact symbolic work over a
//   documented grammar — parse, simplify, differentiate, integrate,
//   evaluate — with RATIONAL coefficients (BigInt fractions), so
//   results are exact, never floating-point approximations of a
//   closed form. Antiderivatives are verified by re-differentiating
//   them and comparing canonical forms before they are served; a
//   mismatch FAILs rather than serving a wrong answer.
//
//   Engine tier (NOT in this module): the SymPy class — solve,
//   limits, series, dsolve, Laplace/Fourier transforms, matrices.
//   Requests in that class return NOT_COMPUTED
//   requires_engine_tier:sympy. There is no quiet downgrade and no
//   partial credit: what the fast path cannot decide exactly, it
//   refuses by name.
//
// Grammar: numbers (decimals are exact rationals), identifiers,
// + - * / with implicit multiplication (2x, x(x+1)), ^ with integer
// or rational exponents, parentheses, unary minus, the functions
// sin cos tan exp log sqrt, and the constants pi and e (evaluation
// only — they stay symbolic in closed forms).
//
// Closed forms referenced from NIST DLMF and OpenStax Calculus.

import { registerSolver } from "../registry.js";

/* ---------------- exact rationals (BigInt) ---------------- */

const bgcd = (a, b) => {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b) { [a, b] = [b, a % b]; }
  return a || 1n;
};
export function rat(n, d = 1n) {
  n = BigInt(n); d = BigInt(d);
  if (d === 0n) throw new Error("rational with zero denominator");
  if (d < 0n) { n = -n; d = -d; }
  const g = bgcd(n, d);
  return { n: n / g, d: d / g };
}
const R0 = rat(0n), R1 = rat(1n), RM1 = rat(-1n);
const rAdd = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const rMul = (a, b) => rat(a.n * b.n, a.d * b.d);
const rNeg = (a) => rat(-a.n, a.d);
const rInv = (a) => (a.n === 0n ? null : rat(a.d, a.n)); // rat() normalizes the sign
const rEq = (a, b) => a.n === b.n && a.d === b.d;
const rIs = (a, v) => a.n === BigInt(v) && a.d === 1n;
const rNum = (a) => Number(a.n) / Number(a.d);
function ratFromDecimal(s) {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && !m[3])) throw new Error(`bad number "${s}"`);
  const int = m[2] || "0";
  const frac = m[3] || "";
  const scale = 10n ** BigInt(frac.length);
  let v = rat(BigInt(int) * scale + BigInt(frac || "0"), scale);
  if (m[1] === "-") v = rNeg(v);
  return v;
}
function ratPow(a, r) {
  // rational^rational only when exact: integer exponents
  if (r.d !== 1n) return null;
  if (r.n >= 0n) return rat(a.n ** r.n, a.d ** r.n);
  const pos = ratPow(a, rat(-r.n));
  return pos === null ? null : rInv(pos);
}

/* ---------------- AST + smart constructors ----------------
   node: {t:"num", v:rat} | {t:"var", name} | {t:"add"|"mul", args}
       | {t:"pow", base, exp:rat} | {t:"func", name, arg}          */

const num = (v) => ({ t: "num", v });
const isNum = (a, v) => a.t === "num" && (v === undefined || rIs(a.v, v));

export function print(ast) {
  switch (ast.t) {
    case "num": return ast.v.d === 1n ? `${ast.v.n}` : `${ast.v.n}/${ast.v.d}`;
    case "var": return ast.name;
    case "func": return `${ast.name}(${print(ast.arg)})`;
    case "pow": {
      const b = ["var", "func", "num"].includes(ast.base.t) ? print(ast.base) : `(${print(ast.base)})`;
      const e = ast.exp.d === 1n ? `${ast.exp.n}` : `(${ast.exp.n}/${ast.exp.d})`;
      return `${b}^${e}`;
    }
    case "mul": {
      let neg = false;
      const parts = [];
      for (const a of ast.args) {
        if (a.t === "num") {
          if (rIs(a.v, -1)) { neg = !neg; continue; }
          if (a.v.n < 0n) neg = !neg;
          parts.push(print(num(rat(a.v.n < 0n ? -a.v.n : a.v.n, a.v.d))));
        } else if (a.t === "add") parts.push(`(${print(a)})`);
        else parts.push(print(a));
      }
      return `${neg ? "-" : ""}${parts.join("*")}`;
    }
    case "add": {
      return ast.args.map((a, i) => {
        const s = print(a);
        if (i === 0) return s;
        return s.startsWith("-") ? `- ${s.slice(1)}` : `+ ${s}`;
      }).join(" ");
    }
    default: throw new Error(`print: unknown node ${ast.t}`);
  }
}

function splitCoeff(ast) {
  if (ast.t === "num") return { coeff: ast.v, rest: null };
  if (ast.t === "mul") {
    const nums = ast.args.filter((a) => a.t === "num");
    if (nums.length) {
      const rest = ast.args.filter((a) => a.t !== "num");
      return { coeff: nums[0].v, rest: rest.length === 1 ? rest[0] : { t: "mul", args: rest } };
    }
  }
  return { coeff: R1, rest: ast };
}

function degreeOf(rest) {
  if (!rest) return -Infinity;
  if (rest.t === "var") return 1;
  if (rest.t === "pow" && rest.base.t === "var") return rNum(rest.exp);
  if (rest.t === "mul") return rest.args.reduce((s, a) => s + Math.max(0, degreeOf(a)), 0);
  return 0;
}

export function mkAdd(args) {
  const flat = [];
  for (const a of args) {
    if (a.t === "add") flat.push(...a.args);
    else flat.push(a);
  }
  const byKey = new Map();
  for (const a of flat) {
    const { coeff, rest } = splitCoeff(a);
    const key = rest ? print(rest) : "";
    const prev = byKey.get(key);
    if (prev) prev.coeff = rAdd(prev.coeff, coeff);
    else byKey.set(key, { coeff, rest });
  }
  const terms = [...byKey.values()].filter((t) => !rIs(t.coeff, 0));
  terms.sort((x, y) => {
    const d = degreeOf(y.rest) - degreeOf(x.rest);
    if (d !== 0) return d;
    return print(x.rest || num(x.coeff)).localeCompare(print(y.rest || num(y.coeff)));
  });
  const built = terms.map(({ coeff, rest }) => {
    if (!rest) return num(coeff);
    if (rIs(coeff, 1)) return rest;
    return mkMulRaw([num(coeff), rest]);
  });
  if (built.length === 0) return num(R0);
  if (built.length === 1) return built[0];
  return { t: "add", args: built };
}

function mkMulRaw(args) { return args.length === 1 ? args[0] : { t: "mul", args }; }

export function mkMul(args) {
  const flat = [];
  for (const a of args) {
    if (a.t === "mul") flat.push(...a.args);
    else flat.push(a);
  }
  let coeff = R1;
  const byBase = new Map();
  const others = [];
  for (const a of flat) {
    if (a.t === "num") { coeff = rMul(coeff, a.v); continue; }
    if (rIs(coeff, 0)) return num(R0);
    const base = a.t === "pow" ? a.base : a;
    const exp = a.t === "pow" ? a.exp : R1;
    const key = print(base);
    if (byBase.has(key)) {
      const prev = byBase.get(key);
      prev.exp = rAdd(prev.exp, exp);
    } else if (a.t === "pow" || a.t === "var") byBase.set(key, { base, exp });
    else others.push(a);
  }
  if (rIs(coeff, 0)) return num(R0);
  const factors = [];
  for (const { base, exp } of byBase.values()) {
    if (rIs(exp, 0)) continue;
    factors.push(rIs(exp, 1) ? base : mkPow(base, exp));
  }
  factors.push(...others);
  factors.sort((x, y) => print(x).localeCompare(print(y)));
  const all = [];
  if (!rIs(coeff, 1) || factors.length === 0) all.push(num(coeff));
  all.push(...factors);
  if (all.length === 0) return num(R1);
  return mkMulRaw(all);
}

export function mkPow(base, exp) {
  if (rIs(exp, 0)) return num(R1);
  if (rIs(exp, 1)) return base;
  if (base.t === "num") {
    const v = ratPow(base.v, exp);
    if (v) return num(v);
  }
  if (base.t === "pow") return mkPow(base.base, rMul(base.exp, exp));
  return { t: "pow", base, exp };
}

const neg = (a) => mkMul([num(RM1), a]);
const inv = (a) => mkPow(a, RM1);

/* ---------------- parser ---------------- */

const FUNCS = new Set(["sin", "cos", "tan", "exp", "log", "sqrt"]);

export function parse(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1;
      tokens.push({ k: "num", v: src.slice(i, j), at: i });
      i = j; continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z]/.test(src[j])) j += 1;
      tokens.push({ k: "id", v: src.slice(i, j), at: i });
      i = j; continue;
    }
    if ("+-*/^()".includes(c)) { tokens.push({ k: c, at: i }); i += 1; continue; }
    throw new Error(`unexpected character "${c}" at position ${i}`);
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (k) => {
    if (tokens[pos]?.k !== k) throw new Error(`expected "${k}" at token ${pos}`);
    pos += 1;
  };
  function parseExpr() {
    let lhs = parseTerm();
    while (peek()?.k === "+" || peek()?.k === "-") {
      const op = tokens[pos].k; pos += 1;
      const rhs = parseTerm();
      lhs = op === "+" ? mkAdd([lhs, rhs]) : mkAdd([lhs, neg(rhs)]);
    }
    return lhs;
  }
  function startsAtom(tok) {
    return tok && (tok.k === "num" || tok.k === "id" || tok.k === "(");
  }
  function parseTerm() {
    let lhs = parseFactor();
    for (;;) {
      const tok = peek();
      if (tok?.k === "*") { pos += 1; lhs = mkMul([lhs, parseFactor()]); }
      else if (tok?.k === "/") { pos += 1; lhs = mkMul([lhs, inv(parseFactor())]); }
      else if (startsAtom(tok)) { lhs = mkMul([lhs, parseFactor()]); } // implicit multiplication
      else break;
    }
    return lhs;
  }
  function parseFactor() {
    const base = parseUnary();
    if (peek()?.k === "^") {
      pos += 1;
      const e = parseFactor();
      if (e.t !== "num") throw new Error("exponent must be a rational literal in this grammar");
      return mkPow(base, e.v);
    }
    return base;
  }
  function parseUnary() {
    if (peek()?.k === "-") { pos += 1; return neg(parseUnary()); }
    if (peek()?.k === "+") { pos += 1; return parseUnary(); }
    return parseAtom();
  }
  function parseAtom() {
    const tok = tokens[pos];
    if (!tok) throw new Error("unexpected end of expression");
    if (tok.k === "num") { pos += 1; return num(ratFromDecimal(tok.v)); }
    if (tok.k === "(") { pos += 1; const e = parseExpr(); eat(")"); return e; }
    if (tok.k === "id") {
      pos += 1;
      if (FUNCS.has(tok.v) && peek()?.k === "(") {
        pos += 1;
        const arg = parseExpr();
        eat(")");
        if (tok.v === "sqrt") return mkPow(arg, rat(1n, 2n));
        return { t: "func", name: tok.v, arg };
      }
      return { t: "var", name: tok.v };
    }
    throw new Error(`unexpected token "${tok.k}" at position ${tok.at}`);
  }
  const out = parseExpr();
  if (pos !== tokens.length) throw new Error(`trailing input at token ${pos}`);
  return out;
}

/* ---------------- calculus ---------------- */

const containsVar = (ast, v) =>
  ast.t === "var" ? ast.name === v
    : ast.t === "num" ? false
      : ast.t === "pow" ? containsVar(ast.base, v)
        : ast.t === "func" ? containsVar(ast.arg, v)
          : ast.args.some((a) => containsVar(a, v));

export function differentiate(ast, v) {
  switch (ast.t) {
    case "num": return num(R0);
    case "var": return num(ast.name === v ? R1 : R0);
    case "add": return mkAdd(ast.args.map((a) => differentiate(a, v)));
    case "mul": {
      const terms = ast.args.map((a, i) =>
        mkMul([...ast.args.slice(0, i), differentiate(a, v), ...ast.args.slice(i + 1)]));
      return mkAdd(terms);
    }
    case "pow": {
      if (!containsVar(ast.base, v)) return num(R0);
      return mkMul([num(ast.exp), mkPow(ast.base, rAdd(ast.exp, RM1)), differentiate(ast.base, v)]);
    }
    case "func": {
      const u = ast.arg;
      const du = differentiate(u, v);
      switch (ast.name) {
        case "sin": return mkMul([{ t: "func", name: "cos", arg: u }, du]);
        case "cos": return neg(mkMul([{ t: "func", name: "sin", arg: u }, du]));
        case "tan": return mkMul([mkPow({ t: "func", name: "cos", arg: u }, rat(-2n)), du]);
        case "exp": return mkMul([{ t: "func", name: "exp", arg: u }, du]);
        case "log": return mkMul([du, inv(u)]);
        default: throw new Error(`differentiate: unsupported function ${ast.name}`);
      }
    }
    default: throw new Error(`differentiate: unknown node ${ast.t}`);
  }
}

function linearCoeff(arg, v) {
  // returns a (rational) when arg is a*v or v, else null
  if (arg.t === "var" && arg.name === v) return R1;
  const { coeff, rest } = splitCoeff(arg);
  if (rest && rest.t === "var" && rest.name === v && arg.t === "mul") return coeff;
  return null;
}

export function integrate(ast, v) {
  // returns an AST, or null when outside the JS-decidable class
  if (!containsVar(ast, v)) return mkMul([ast, { t: "var", name: v }]);
  switch (ast.t) {
    case "var": return mkMul([num(rat(1n, 2n)), mkPow(ast, rat(2n))]);
    case "pow": {
      if (ast.base.t === "var" && ast.base.name === v) {
        if (rIs(ast.exp, -1)) return { t: "func", name: "log", arg: ast.base };
        const e1 = rAdd(ast.exp, R1);
        const invE = rInv(e1);
        if (!invE) return null;
        return mkMul([num(invE), mkPow(ast.base, e1)]);
      }
      return null;
    }
    case "add": {
      const parts = ast.args.map((a) => integrate(a, v));
      if (parts.some((p) => p === null)) return null;
      return mkAdd(parts);
    }
    case "mul": {
      // Constant factors (numbers, other variables, constant
      // expressions) factor out; exactly one var-bearing factor may
      // remain and must itself be integrable. Products of distinct
      // var-bearing factors need parts/substitution: outside class.
      const constFactors = ast.args.filter((a) => !containsVar(a, v));
      const varFactors = ast.args.filter((a) => containsVar(a, v));
      if (varFactors.length !== 1) return null;
      const inner = integrate(varFactors[0], v);
      if (inner === null) return null;
      return mkMul([...constFactors, inner]);
    }
    case "func": {
      const a = linearCoeff(ast.arg, v);
      if (a === null) return null;
      const invA = rInv(a);
      if (!invA) return null;
      switch (ast.name) {
        case "exp": return mkMul([num(invA), ast]);
        case "sin": return neg(mkMul([num(invA), { t: "func", name: "cos", arg: ast.arg }]));
        case "cos": return mkMul([num(invA), { t: "func", name: "sin", arg: ast.arg }]);
        case "log":
          // ∫ log(x) dx = x log(x) − x (integration by parts, DLMF 1.4)
          if (ast.arg.t === "var" && ast.arg.name === v && rIs(a, 1)) {
            return mkAdd([mkMul([ast.arg, ast]), neg(ast.arg)]);
          }
          return null;
        default: return null;
      }
    }
    default: return null;
  }
}

export function evaluateAst(ast, env) {
  switch (ast.t) {
    case "num": return rNum(ast.v);
    case "var": {
      if (ast.name === "pi") return Math.PI;
      if (ast.name === "e") return Math.E;
      const v = env[ast.name];
      if (!Number.isFinite(v)) throw new Error(`no value for variable ${ast.name}`);
      return v;
    }
    case "add": return ast.args.reduce((s, a) => s + evaluateAst(a, env), 0);
    case "mul": return ast.args.reduce((s, a) => s * evaluateAst(a, env), 1);
    case "pow": return evaluateAst(ast.base, env) ** rNum(ast.exp);
    case "func": return Math[ast.name](evaluateAst(ast.arg, env));
    default: throw new Error(`evaluate: unknown node ${ast.t}`);
  }
}

/* ---------------- the solver ---------------- */

const ENGINE_TIER_OPS = new Set(["solve", "limit", "series", "dsolve", "laplace", "fourier", "matrices"]);
const FAST_OPS = new Set(["simplify", "differentiate", "integrate", "evaluate"]);

function runSymbolic(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (ENGINE_TIER_OPS.has(target)) {
    return { notComputed: `requires_engine_tier:sympy (${target} is in the SymPy class; the JS fast path does not decide it)` };
  }
  if (!FAST_OPS.has(target)) return { notComputed: `unknown_operation:${target}` };
  const expr = inputs.expression;
  if (typeof expr !== "string" || !expr.trim()) {
    return { notComputed: "missing_input:expression (SC-03: no expression assumed)" };
  }
  const variable = typeof inputs.variable === "string" && inputs.variable ? inputs.variable : "x";
  let ast;
  try {
    ast = parse(expr);
  } catch (err) {
    return { notComputed: `invalid_input:expression ${err.message}` };
  }
  const echo = { expression: expr, variable };
  if (target === "simplify") {
    return { inputs: echo, outputs: { result: print(ast) }, margins: [], covers: [target] };
  }
  if (target === "evaluate") {
    const point = inputs.point;
    if (!Number.isFinite(point)) return { notComputed: "missing_input:point (evaluate needs a finite point)" };
    let value;
    try {
      value = evaluateAst(ast, { [variable]: point });
    } catch (err) {
      return { notComputed: `invalid_input:evaluation ${err.message}` };
    }
    if (!Number.isFinite(value)) return { notComputed: `evaluation_undefined:expression is not finite at ${variable} = ${point}` };
    return { inputs: { ...echo, point }, outputs: { result: value }, margins: [], covers: [target] };
  }
  if (target === "differentiate") {
    const d = differentiate(ast, variable);
    return { inputs: echo, outputs: { result: print(d) }, margins: [], covers: [target] };
  }
  // integrate: serve only after the round-trip check
  const anti = integrate(ast, variable);
  if (anti === null) {
    return { notComputed: `not_integrable_in_js_scope:${print(ast)} (outside the fast path's decidable class; SymPy tier)` };
  }
  const roundTrip = print(differentiate(anti, variable));
  if (roundTrip !== print(ast)) {
    return {
      inputs: echo,
      outputs: { candidate: print(anti), roundTrip },
      margins: [],
      failures: [{ name: "antiderivative_round_trip", detail: `d/dx(${print(anti)}) = ${roundTrip} != ${print(ast)}` }],
      covers: [target],
    };
  }
  return {
    inputs: echo,
    outputs: { result: print(anti), verifiedByRedifferentiation: true },
    margins: [],
    covers: [target],
  };
}

export const mathSymbolic = registerSolver({
  id: "math.symbolic",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 0,
  method: "in-JS symbolic fast path: exact rational coefficients, canonical simplification, symbolic differentiation, pattern integration verified by re-differentiation; the SymPy class is refused by name as requires_engine_tier:sympy",
  reference: "NIST DLMF (closed forms); OpenStax Calculus Vol. 1-3",
  regime: "the documented grammar; integrable class = constants, powers of the variable (incl. x^-1 -> log), linear-argument exp/sin/cos, log(x), and sums/constant multiples of those",
  units: { inputs: "expression string, variable name, point (evaluate)", outputs: "canonical closed-form string, or a number for evaluate" },
  tolerance: "exact (rational arithmetic); evaluate is the only floating-point operation",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runSymbolic,
});
