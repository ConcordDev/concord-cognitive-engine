// server/domains/math.js
// Domain actions for mathematics: statistical analysis, matrix operations,
// polynomial evaluation, proof-step verification, plus a real symbolic
// computer-algebra system (CAS): tokeniser, recursive-descent parser, an
// algebraic-expression tree with simplification, symbolic differentiation,
// symbolic + numeric integration, equation solving, unit conversion,
// number-theory tools, and natural-language query parsing.

/* ───────────────────────── CAS: tokeniser ───────────────────────── */
const MATH_FUNCS = new Set([
  "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh",
  "ln", "log", "exp", "sqrt", "cbrt", "abs", "sign", "floor", "ceil",
]);
const MATH_CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2 };

function casTokenize(src) {
  const tokens = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n") { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < s.length && /[0-9.]/.test(s[i])) num += s[i++];
      if (s[i] === "e" && /[0-9+-]/.test(s[i + 1] || "")) {
        num += s[i++];
        if (s[i] === "+" || s[i] === "-") num += s[i++];
        while (i < s.length && /[0-9]/.test(s[i])) num += s[i++];
      }
      tokens.push({ t: "num", v: parseFloat(num) });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = "";
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) id += s[i++];
      tokens.push({ t: "ident", v: id });
      continue;
    }
    if ("+-*/^(),".includes(ch)) { tokens.push({ t: "op", v: ch }); i++; continue; }
    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }
  return tokens;
}

/* ───────────────────────── CAS: AST nodes ─────────────────────────
 * num(value) | sym(name) | { op, args:[...] } where op ∈ +,-,*,/,^ | { fn, arg }
 */
const N = {
  num: (v) => ({ k: "num", v }),
  sym: (name) => ({ k: "sym", name }),
  add: (a, b) => ({ k: "op", op: "+", a, b }),
  sub: (a, b) => ({ k: "op", op: "-", a, b }),
  mul: (a, b) => ({ k: "op", op: "*", a, b }),
  div: (a, b) => ({ k: "op", op: "/", a, b }),
  pow: (a, b) => ({ k: "op", op: "^", a, b }),
  neg: (a) => ({ k: "op", op: "*", a: { k: "num", v: -1 }, b: a }),
  fn: (fn, arg) => ({ k: "fn", fn, arg }),
};
const isNum = (n, v) => n.k === "num" && (v === undefined || n.v === v);
const isSym = (n, name) => n.k === "sym" && (name === undefined || n.name === name);

/* ───────────────────────── CAS: parser ───────────────────────────
 * Recursive descent: expr → term (('+'|'-') term)*; term → factor; etc.
 */
function casParse(src) {
  const tokens = casTokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (v) => {
    const tk = tokens[pos];
    if (!tk || (v !== undefined && tk.v !== v)) {
      throw new Error(`Expected '${v}' but got '${tk ? tk.v : "end of input"}'`);
    }
    pos++;
    return tk;
  };
  function parseExpr() {
    let node = parseTerm();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = eat().v;
      const rhs = parseTerm();
      node = op === "+" ? N.add(node, rhs) : N.sub(node, rhs);
    }
    return node;
  }
  function parseTerm() {
    let node = parseUnary();
    while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = eat().v;
      const rhs = parseUnary();
      node = op === "*" ? N.mul(node, rhs) : N.div(node, rhs);
    }
    // implicit multiplication: 2x, 3(x+1), x sin(x)
    while (peek() && ((peek().t === "num") || (peek().t === "ident") || (peek().t === "op" && peek().v === "("))) {
      node = N.mul(node, parseUnary());
    }
    return node;
  }
  function parseUnary() {
    if (peek() && peek().t === "op" && peek().v === "-") { eat(); return N.neg(parseUnary()); }
    if (peek() && peek().t === "op" && peek().v === "+") { eat(); return parseUnary(); }
    return parsePower();
  }
  function parsePower() {
    const base = parseAtom();
    if (peek() && peek().t === "op" && peek().v === "^") {
      eat();
      return N.pow(base, parseUnary()); // right-assoc
    }
    return base;
  }
  function parseAtom() {
    const tk = peek();
    if (!tk) throw new Error("Unexpected end of expression");
    if (tk.t === "num") { eat(); return N.num(tk.v); }
    if (tk.t === "op" && tk.v === "(") {
      eat("(");
      const node = parseExpr();
      eat(")");
      return node;
    }
    if (tk.t === "ident") {
      eat();
      if (MATH_FUNCS.has(tk.v) && peek() && peek().t === "op" && peek().v === "(") {
        eat("(");
        const arg = parseExpr();
        eat(")");
        return N.fn(tk.v, arg);
      }
      if (Object.prototype.hasOwnProperty.call(MATH_CONSTS, tk.v)) return N.num(MATH_CONSTS[tk.v]);
      return N.sym(tk.v);
    }
    throw new Error(`Unexpected token '${tk.v}'`);
  }
  const result = parseExpr();
  if (pos < tokens.length) throw new Error(`Unexpected trailing token '${tokens[pos].v}'`);
  return result;
}

/* ───────────────────────── CAS: simplifier ──────────────────────── */
function casSimplify(node) {
  if (!node || node.k === "num" || node.k === "sym") return node;
  if (node.k === "fn") {
    const arg = casSimplify(node.arg);
    if (arg.k === "num") {
      const map = {
        sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
        atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
        ln: Math.log, log: Math.log10 || ((x) => Math.log(x) / Math.LN10), exp: Math.exp,
        sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sign: Math.sign,
        floor: Math.floor, ceil: Math.ceil,
      };
      const f = map[node.fn];
      if (f) { const v = f(arg.v); if (Number.isFinite(v)) return N.num(v); }
    }
    return N.fn(node.fn, arg);
  }
  const a = casSimplify(node.a);
  const b = casSimplify(node.b);
  const op = node.op;
  if (a.k === "num" && b.k === "num") {
    const v = { "+": a.v + b.v, "-": a.v - b.v, "*": a.v * b.v, "/": a.v / b.v, "^": Math.pow(a.v, b.v) }[op];
    if (Number.isFinite(v)) return N.num(v);
  }
  if (op === "+") {
    if (isNum(a, 0)) return b;
    if (isNum(b, 0)) return a;
  }
  if (op === "-") {
    if (isNum(b, 0)) return a;
    if (isNum(a, 0)) return casSimplify(N.neg(b));
    if (casEqual(a, b)) return N.num(0);
  }
  if (op === "*") {
    if (isNum(a, 0) || isNum(b, 0)) return N.num(0);
    if (isNum(a, 1)) return b;
    if (isNum(b, 1)) return a;
    if (isNum(a, -1)) return casSimplify(N.neg(b));
    if (isNum(b, -1)) return casSimplify(N.neg(a));
    // x * x → x^2
    if (casEqual(a, b)) return N.pow(a, N.num(2));
    // fold coefficient: num * (num * x) → (num*num) * x
    if (a.k === "num" && b.k === "op" && b.op === "*" && b.a.k === "num") {
      return casSimplify(N.mul(N.num(a.v * b.a.v), b.b));
    }
  }
  if (op === "/") {
    if (isNum(a, 0)) return N.num(0);
    if (isNum(b, 1)) return a;
    if (casEqual(a, b) && !isNum(b, 0)) return N.num(1);
  }
  if (op === "^") {
    if (isNum(b, 0)) return N.num(1);
    if (isNum(b, 1)) return a;
    if (isNum(a, 1)) return N.num(1);
    if (isNum(a, 0)) return N.num(0);
  }
  return { k: "op", op, a, b };
}

function casEqual(x, y) {
  if (!x || !y || x.k !== y.k) return false;
  if (x.k === "num") return Math.abs(x.v - y.v) < 1e-12;
  if (x.k === "sym") return x.name === y.name;
  if (x.k === "fn") return x.fn === y.fn && casEqual(x.arg, y.arg);
  if (x.k === "op") return x.op === y.op && casEqual(x.a, y.a) && casEqual(x.b, y.b);
  return false;
}

/* ───────────────────────── CAS: pretty printer ──────────────────── */
function casToString(node) {
  if (!node) return "";
  if (node.k === "num") {
    const v = node.v;
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 1e9) / 1e9);
  }
  if (node.k === "sym") return node.name;
  if (node.k === "fn") return `${node.fn}(${casToString(node.arg)})`;
  const prec = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 }[node.op];
  const wrap = (child, side) => {
    const str = casToString(child);
    if (child.k === "op") {
      const cp = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 }[child.op];
      if (cp < prec || (cp === prec && side === "r" && (node.op === "-" || node.op === "/"))) return `(${str})`;
    }
    if (child.k === "num" && child.v < 0) return `(${str})`;
    return str;
  };
  // -1 * x → -x
  if (node.op === "*" && isNum(node.a, -1)) return `-${wrap(node.b, "r")}`;
  return `${wrap(node.a, "l")} ${node.op} ${wrap(node.b, "r")}`;
}

/* ───────────────────────── CAS: numeric eval ─────────────────────── */
function casEval(node, vars = {}) {
  if (node.k === "num") return node.v;
  if (node.k === "sym") {
    if (Object.prototype.hasOwnProperty.call(vars, node.name)) return vars[node.name];
    if (Object.prototype.hasOwnProperty.call(MATH_CONSTS, node.name)) return MATH_CONSTS[node.name];
    throw new Error(`Unbound variable '${node.name}'`);
  }
  if (node.k === "fn") {
    const x = casEval(node.arg, vars);
    const map = {
      sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
      atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
      ln: Math.log, log: (v) => Math.log(v) / Math.LN10, exp: Math.exp,
      sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sign: Math.sign,
      floor: Math.floor, ceil: Math.ceil,
    };
    return map[node.fn](x);
  }
  const a = casEval(node.a, vars);
  const b = casEval(node.b, vars);
  return { "+": a + b, "-": a - b, "*": a * b, "/": a / b, "^": Math.pow(a, b) }[node.op];
}

/* ───────────────────────── CAS: differentiation ─────────────────── */
function casDiff(node, x) {
  if (node.k === "num") return N.num(0);
  if (node.k === "sym") return N.num(node.name === x ? 1 : 0);
  if (node.k === "fn") {
    const u = node.arg;
    const du = casDiff(u, x);
    let outer;
    switch (node.fn) {
      case "sin": outer = N.fn("cos", u); break;
      case "cos": outer = N.neg(N.fn("sin", u)); break;
      case "tan": outer = N.div(N.num(1), N.pow(N.fn("cos", u), N.num(2))); break;
      case "asin": outer = N.div(N.num(1), N.fn("sqrt", N.sub(N.num(1), N.pow(u, N.num(2))))); break;
      case "acos": outer = N.neg(N.div(N.num(1), N.fn("sqrt", N.sub(N.num(1), N.pow(u, N.num(2)))))); break;
      case "atan": outer = N.div(N.num(1), N.add(N.num(1), N.pow(u, N.num(2)))); break;
      case "sinh": outer = N.fn("cosh", u); break;
      case "cosh": outer = N.fn("sinh", u); break;
      case "tanh": outer = N.div(N.num(1), N.pow(N.fn("cosh", u), N.num(2))); break;
      case "exp": outer = N.fn("exp", u); break;
      case "ln": outer = N.div(N.num(1), u); break;
      case "log": outer = N.div(N.num(1), N.mul(u, N.num(Math.LN10))); break;
      case "sqrt": outer = N.div(N.num(1), N.mul(N.num(2), N.fn("sqrt", u))); break;
      default: throw new Error(`Cannot differentiate function '${node.fn}'`);
    }
    return N.mul(outer, du);
  }
  const { op, a, b } = node;
  if (op === "+") return N.add(casDiff(a, x), casDiff(b, x));
  if (op === "-") return N.sub(casDiff(a, x), casDiff(b, x));
  if (op === "*") return N.add(N.mul(casDiff(a, x), b), N.mul(a, casDiff(b, x))); // product rule
  if (op === "/") {
    return N.div(N.sub(N.mul(casDiff(a, x), b), N.mul(a, casDiff(b, x))), N.pow(b, N.num(2)));
  }
  if (op === "^") {
    // constant exponent: power rule
    if (b.k === "num") {
      return N.mul(N.mul(b, N.pow(a, N.num(b.v - 1))), casDiff(a, x));
    }
    // constant base: a^u → a^u * ln(a) * u'
    if (a.k === "num") {
      return N.mul(N.mul(node, N.num(Math.log(a.v))), casDiff(b, x));
    }
    // general: f^g → f^g * (g' ln f + g f'/f)
    return N.mul(node, N.add(N.mul(casDiff(b, x), N.fn("ln", a)), N.mul(b, N.div(casDiff(a, x), a))));
  }
  throw new Error(`Cannot differentiate operator '${op}'`);
}

/* ───────────────────────── CAS: symbolic integration ─────────────
 * Handles power rule, common functions, linear u-substitution, sums.
 * Returns null when no closed form is found (caller falls back to numeric).
 */
function casIntegrate(node, x) {
  // sum rule
  if (node.k === "op" && (node.op === "+" || node.op === "-")) {
    const ia = casIntegrate(node.a, x);
    const ib = casIntegrate(node.b, x);
    if (!ia || !ib) return null;
    return node.op === "+" ? N.add(ia, ib) : N.sub(ia, ib);
  }
  // constant
  if (!casDependsOn(node, x)) return N.mul(node, N.sym(x));
  // c * f  (pull constant out)
  if (node.k === "op" && node.op === "*") {
    if (!casDependsOn(node.a, x)) { const i = casIntegrate(node.b, x); return i ? N.mul(node.a, i) : null; }
    if (!casDependsOn(node.b, x)) { const i = casIntegrate(node.a, x); return i ? N.mul(node.b, i) : null; }
  }
  // f / c
  if (node.k === "op" && node.op === "/" && !casDependsOn(node.b, x)) {
    const i = casIntegrate(node.a, x);
    return i ? N.div(i, node.b) : null;
  }
  // x  →  x^2/2
  if (isSym(node, x)) return N.div(N.pow(N.sym(x), N.num(2)), N.num(2));
  // x^n  →  x^(n+1)/(n+1),  1/x → ln|x|
  if (node.k === "op" && node.op === "^" && isSym(node.a, x) && node.b.k === "num") {
    if (node.b.v === -1) return N.fn("ln", N.fn("abs", N.sym(x)));
    return N.div(N.pow(N.sym(x), N.num(node.b.v + 1)), N.num(node.b.v + 1));
  }
  // 1/x
  if (node.k === "op" && node.op === "/" && node.a.k === "num" && isSym(node.b, x)) {
    return N.mul(node.a, N.fn("ln", N.fn("abs", N.sym(x))));
  }
  // linear-argument functions: f(ax+b) → F(ax+b)/a
  if (node.k === "fn") {
    const lin = casLinearCoeffs(node.arg, x);
    if (lin) {
      const [coefA] = lin;
      const anti = {
        sin: (u) => N.neg(N.fn("cos", u)),
        cos: (u) => N.fn("sin", u),
        exp: (u) => N.fn("exp", u),
        sqrt: (u) => N.div(N.mul(N.num(2 / 3), N.pow(u, N.num(3))), N.fn("sqrt", u)),
      };
      if (anti[node.fn]) return N.div(anti[node.fn](node.arg), N.num(coefA));
    }
  }
  // a^(linear)  →  a^u / (k ln a)
  if (node.k === "op" && node.op === "^" && node.a.k === "num") {
    const lin = casLinearCoeffs(node.b, x);
    if (lin) return N.div(node, N.num(lin[0] * Math.log(node.a.v)));
  }
  // exp via e^(linear) handled by power above; also (linear)^n
  if (node.k === "op" && node.op === "^" && node.b.k === "num") {
    const lin = casLinearCoeffs(node.a, x);
    if (lin && node.b.v !== -1) {
      return N.div(N.pow(node.a, N.num(node.b.v + 1)), N.num(lin[0] * (node.b.v + 1)));
    }
  }
  return null;
}

function casDependsOn(node, x) {
  if (node.k === "num") return false;
  if (node.k === "sym") return node.name === x;
  if (node.k === "fn") return casDependsOn(node.arg, x);
  return casDependsOn(node.a, x) || casDependsOn(node.b, x);
}

// Returns [a, b] if node === a*x + b (a,b constants), else null.
function casLinearCoeffs(node, x) {
  const s = casSimplify(node);
  if (!casDependsOn(s, x)) return [0, casEval(s, {})];
  if (isSym(s, x)) return [1, 0];
  if (s.k === "op" && s.op === "*") {
    if (!casDependsOn(s.a, x) && isSym(s.b, x)) return [casEval(s.a, {}), 0];
    if (!casDependsOn(s.b, x) && isSym(s.a, x)) return [casEval(s.b, {}), 0];
  }
  if (s.k === "op" && (s.op === "+" || s.op === "-")) {
    const la = casLinearCoeffs(s.a, x);
    const lb = casLinearCoeffs(s.b, x);
    if (la && lb) {
      return s.op === "+" ? [la[0] + lb[0], la[1] + lb[1]] : [la[0] - lb[0], la[1] - lb[1]];
    }
  }
  return null;
}

// Simpson's rule numeric integration as a fallback.
function casNumericIntegrate(node, x, lo, hi, n = 1000) {
  const steps = n % 2 === 0 ? n : n + 1;
  const h = (hi - lo) / steps;
  let sum = casEval(node, { [x]: lo }) + casEval(node, { [x]: hi });
  for (let i = 1; i < steps; i++) {
    const xi = lo + i * h;
    sum += (i % 2 === 0 ? 2 : 4) * casEval(node, { [x]: xi });
  }
  return (h / 3) * sum;
}

const casRound = (v) => Math.round(v * 1e9) / 1e9;

/* ───────────────────────── persistent CAS state ─────────────────── */
function getMathState() {
  const STATE = globalThis._concordSTATE;
  if (!STATE) return null;
  if (!STATE.mathCAS) STATE.mathCAS = new Map(); // userId → { history:[] }
  return STATE.mathCAS;
}
function mathUserId(ctx) {
  return (ctx && (ctx.userId || (ctx.actor && ctx.actor.userId))) || "anon";
}
function mathBucket(ctx) {
  const s = getMathState();
  if (!s) return null;
  const uid = mathUserId(ctx);
  if (!s.has(uid)) s.set(uid, { history: [] });
  return s.get(uid);
}

/* ───────────────────────── unit conversion tables ───────────────── */
// Each category maps a unit → factor relative to the category's base unit.
const UNIT_TABLE = {
  length: { base: "m", units: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254, nmi: 1852, ly: 9.4607304725808e15, au: 1.495978707e11 } },
  mass: { base: "kg", units: { kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, oz: 0.028349523125, st: 6.35029318 } },
  time: { base: "s", units: { s: 1, ms: 0.001, min: 60, h: 3600, day: 86400, week: 604800, year: 31557600 } },
  area: { base: "m2", units: { m2: 1, km2: 1e6, cm2: 1e-4, ha: 1e4, acre: 4046.8564224, ft2: 0.09290304, in2: 0.00064516 } },
  volume: { base: "l", units: { l: 1, ml: 0.001, m3: 1000, gal: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735295625 } },
  speed: { base: "mps", units: { mps: 1, kph: 0.277777778, mph: 0.44704, fps: 0.3048, knot: 0.514444444 } },
  pressure: { base: "pa", units: { pa: 1, kpa: 1000, bar: 1e5, atm: 101325, psi: 6894.757293, mmhg: 133.322387415, torr: 133.322368421 } },
  energy: { base: "j", units: { j: 1, kj: 1000, cal: 4.184, kcal: 4184, wh: 3600, kwh: 3.6e6, ev: 1.602176634e-19, btu: 1055.05585262 } },
  data: { base: "byte", units: { byte: 1, bit: 0.125, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 } },
  angle: { base: "rad", units: { rad: 1, deg: Math.PI / 180, grad: Math.PI / 200, turn: 2 * Math.PI } },
};
// Temperature is affine — handled separately.
function convertTemperature(value, from, to) {
  let celsius;
  if (from === "c") celsius = value;
  else if (from === "f") celsius = (value - 32) * 5 / 9;
  else if (from === "k") celsius = value - 273.15;
  else return null;
  if (to === "c") return celsius;
  if (to === "f") return celsius * 9 / 5 + 32;
  if (to === "k") return celsius + 273.15;
  return null;
}
function findUnitCategory(unit) {
  for (const [cat, def] of Object.entries(UNIT_TABLE)) {
    if (Object.prototype.hasOwnProperty.call(def.units, unit)) return cat;
  }
  return null;
}

/* ───────────────────────── number-theory helpers ────────────────── */
function primeFactorize(n) {
  const factors = [];
  let x = Math.abs(Math.trunc(n));
  if (x < 2) return factors;
  for (let d = 2; d * d <= x; d++) {
    while (x % d === 0) { factors.push(d); x /= d; }
  }
  if (x > 1) factors.push(x);
  return factors;
}
function isPrime(n) {
  const x = Math.abs(Math.trunc(n));
  if (x < 2) return false;
  if (x < 4) return true;
  if (x % 2 === 0) return false;
  for (let d = 3; d * d <= x; d += 2) if (x % d === 0) return false;
  return true;
}
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }
function lcm(a, b) { return a && b ? Math.abs(a * b) / gcd(a, b) : 0; }
function factorial(n) {
  if (n < 0 || !Number.isInteger(n)) return NaN;
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

/* ───────────── natural-language query → structured plan ───────────── */
function parseNaturalQuery(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  let m;
  // "integral of <expr> from <a> to <b>" / "integrate <expr> from a to b"
  m = q.match(/(?:integral of|integrate)\s+(.+?)\s+from\s+(-?[\d.]+)\s+to\s+(-?[\d.]+)/);
  if (m) return { op: "integrate", expression: m[1], variable: "x", lower: parseFloat(m[2]), upper: parseFloat(m[3]) };
  // "integral of <expr>" / "integrate <expr>"
  m = q.match(/(?:integral of|integrate|antiderivative of)\s+(.+)/);
  if (m) return { op: "integrate", expression: m[1].replace(/\s+(dx|with respect to x)$/, ""), variable: "x" };
  // "derivative of <expr>" / "differentiate <expr>"
  m = q.match(/(?:derivative of|differentiate|d\/dx of|d\/dx)\s+(.+)/);
  if (m) return { op: "derivative", expression: m[1].replace(/\s+(with respect to x)$/, ""), variable: "x" };
  // "solve <expr> = <expr>"  or  "solve <expr> for x"
  m = q.match(/solve\s+(.+?)\s*=\s*(.+?)(?:\s+for\s+(\w+))?$/);
  if (m) return { op: "solve", left: m[1], right: m[2], variable: m[3] || "x" };
  m = q.match(/solve\s+(.+?)(?:\s+for\s+(\w+))?$/);
  if (m) return { op: "solve", left: m[1], right: "0", variable: m[2] || "x" };
  // "simplify <expr>" / "expand <expr>"
  m = q.match(/(?:simplify|expand|reduce)\s+(.+)/);
  if (m) return { op: "simplify", expression: m[1] };
  // "factor <n>" / "prime factorization of <n>" / "is <n> prime"
  m = q.match(/(?:factor|factorize|prime factorization of|factorization of)\s+(\d+)/);
  if (m) return { op: "factorize", number: parseInt(m[1], 10) };
  m = q.match(/is\s+(\d+)\s+prime/);
  if (m) return { op: "isprime", number: parseInt(m[1], 10) };
  // "convert <n> <from> to <to>"
  m = q.match(/convert\s+(-?[\d.]+)\s*(\w+)\s+to\s+(\w+)/);
  if (m) return { op: "convert", value: parseFloat(m[1]), from: m[2], to: m[3] };
  // "<n>!" factorial
  m = q.match(/^(\d+)\s*!$/);
  if (m) return { op: "evaluate", expression: q };
  // fallthrough: treat as expression to evaluate/simplify
  return { op: "evaluate", expression: q };
}

export default function registerMathActions(registerLensAction) {
  /**
   * statisticalAnalysis
   * Compute descriptive statistics, distribution shape, and outlier detection
   * from artifact.data.values (array of numbers).
   */
  registerLensAction("math", "statisticalAnalysis", (ctx, artifact, _params) => {
  try {
    const raw = artifact.data?.values || [];
    const values = raw.map(Number).filter(v => !isNaN(v));
    if (values.length === 0) {
      return { ok: true, result: { message: "No numeric values to analyze." } };
    }

    const n = values.length;
    const sorted = [...values].sort((a, b) => a - b);

    // Central tendency
    const sum = values.reduce((s, v) => s + v, 0);
    const mean = sum / n;
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];

    // Mode (most frequent value)
    const freq = {};
    let maxFreq = 0;
    for (const v of values) { freq[v] = (freq[v] || 0) + 1; maxFreq = Math.max(maxFreq, freq[v]); }
    const modes = maxFreq > 1 ? Object.entries(freq).filter(([, f]) => f === maxFreq).map(([v]) => Number(v)) : [];

    // Spread
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n;
    const sampleVariance = n > 1 ? values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1) : 0;
    const stdDev = Math.sqrt(variance);
    const sampleStdDev = Math.sqrt(sampleVariance);
    const range = sorted[n - 1] - sorted[0];
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const coefficientOfVariation = mean !== 0 ? stdDev / Math.abs(mean) : Infinity;

    // Shape: skewness and kurtosis
    const m3 = values.reduce((s, v) => s + Math.pow(v - mean, 3), 0) / n;
    const m4 = values.reduce((s, v) => s + Math.pow(v - mean, 4), 0) / n;
    const skewness = stdDev > 0 ? m3 / Math.pow(stdDev, 3) : 0;
    const kurtosis = stdDev > 0 ? m4 / Math.pow(stdDev, 4) - 3 : 0; // excess kurtosis

    // Outlier detection (1.5 * IQR fence)
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const outliers = values.filter(v => v < lowerFence || v > upperFence);

    // Distribution shape classification
    let shape = "symmetric";
    if (Math.abs(skewness) > 1) shape = skewness > 0 ? "right-skewed" : "left-skewed";
    else if (Math.abs(skewness) > 0.5) shape = skewness > 0 ? "moderately-right-skewed" : "moderately-left-skewed";
    const tailWeight = kurtosis > 1 ? "heavy-tailed" : kurtosis < -1 ? "light-tailed" : "normal-tailed";

    const r = (v) => Math.round(v * 1e6) / 1e6;

    return {
      ok: true, result: {
        n,
        // Flat fields the math-lens UI reads directly (StatsResult: count/mean/median/
        // stdDev/min/max/q1/q3). Without these the lens rendered "μ=undefined".
        count: n, mean: r(mean), median: r(median), stdDev: r(stdDev),
        min: sorted[0], max: sorted[n - 1], q1: r(q1), q3: r(q3),
        centralTendency: { mean: r(mean), median: r(median), modes },
        spread: { stdDev: r(stdDev), sampleStdDev: r(sampleStdDev), variance: r(variance), range: r(range), iqr: r(iqr), coefficientOfVariation: r(coefficientOfVariation) },
        shape: { skewness: r(skewness), kurtosis: r(kurtosis), classification: shape, tailWeight },
        quartiles: { q1: r(q1), median: r(median), q3: r(q3) },
        extremes: { min: sorted[0], max: sorted[n - 1] },
        outliers: { count: outliers.length, values: outliers.slice(0, 20), lowerFence: r(lowerFence), upperFence: r(upperFence) },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * matrixOperations
   * Perform operations on matrices stored as 2D arrays.
   * artifact.data.matrixA, artifact.data.matrixB (optional)
   * params.operation: "determinant" | "transpose" | "multiply" | "inverse" | "eigenvalues" | "rank"
   */
  registerLensAction("math", "matrixOperations", (ctx, artifact, params) => {
  try {
    const A = artifact.data?.matrixA || artifact.data?.matrix || [];
    const B = artifact.data?.matrixB;
    const op = params.operation || "determinant";

    if (A.length === 0) return { ok: false, error: "matrixA is empty or missing." };
    const rows = A.length;
    const cols = A[0]?.length || 0;

    // Helper: determinant via LU decomposition for arbitrary NxN
    function det(M) {
      const n = M.length;
      if (n === 1) return M[0][0];
      if (n === 2) return M[0][0] * M[1][1] - M[0][1] * M[1][0];
      // Gaussian elimination with partial pivoting
      const work = M.map(row => [...row]);
      let d = 1;
      for (let i = 0; i < n; i++) {
        // Pivot
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
          if (Math.abs(work[k][i]) > Math.abs(work[maxRow][i])) maxRow = k;
        }
        if (maxRow !== i) { [work[i], work[maxRow]] = [work[maxRow], work[i]]; d *= -1; }
        if (Math.abs(work[i][i]) < 1e-12) return 0;
        d *= work[i][i];
        for (let k = i + 1; k < n; k++) {
          const factor = work[k][i] / work[i][i];
          for (let j = i; j < n; j++) work[k][j] -= factor * work[i][j];
        }
      }
      return d;
    }

    function transpose(M) {
      const r = M.length, c = M[0].length;
      const T = Array.from({ length: c }, () => new Array(r));
      for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j][i] = M[i][j];
      return T;
    }

    function multiply(M1, M2) {
      const r1 = M1.length, c1 = M1[0].length, c2 = M2[0].length;
      const result = Array.from({ length: r1 }, () => new Array(c2).fill(0));
      for (let i = 0; i < r1; i++)
        {for (let j = 0; j < c2; j++)
          {for (let k = 0; k < c1; k++)
            {result[i][j] += M1[i][k] * M2[k][j];}}}
      return result;
    }

    // Matrix rank via row echelon form
    function rank(M) {
      const work = M.map(row => [...row]);
      const r = work.length, c = work[0].length;
      let rnk = 0;
      for (let col = 0; col < c && rnk < r; col++) {
        let pivotRow = -1;
        for (let row = rnk; row < r; row++) {
          if (Math.abs(work[row][col]) > 1e-10) { pivotRow = row; break; }
        }
        if (pivotRow === -1) continue;
        [work[rnk], work[pivotRow]] = [work[pivotRow], work[rnk]];
        const pivot = work[rnk][col];
        for (let j = col; j < c; j++) work[rnk][j] /= pivot;
        for (let row = 0; row < r; row++) {
          if (row === rnk) continue;
          const factor = work[row][col];
          for (let j = col; j < c; j++) work[row][j] -= factor * work[rnk][j];
        }
        rnk++;
      }
      return rnk;
    }

    const r = (v) => Math.round(v * 1e8) / 1e8;

    switch (op) {
      case "determinant": {
        if (rows !== cols) return { ok: false, error: "Determinant requires a square matrix." };
        return { ok: true, result: { operation: "determinant", rows, cols, determinant: r(det(A)) } };
      }
      case "transpose": {
        return { ok: true, result: { operation: "transpose", originalDimensions: [rows, cols], resultDimensions: [cols, rows], matrix: transpose(A) } };
      }
      case "multiply": {
        if (!B) return { ok: false, error: "matrixB required for multiplication." };
        if (cols !== B.length) return { ok: false, error: `Dimension mismatch: A is ${rows}x${cols}, B is ${B.length}x${B[0]?.length || 0}.` };
        const product = multiply(A, B);
        return { ok: true, result: { operation: "multiply", dimensions: [rows, B[0].length], matrix: product.map(row => row.map(r)) } };
      }
      case "inverse": {
        if (rows !== cols) return { ok: false, error: "Inverse requires a square matrix." };
        const d = det(A);
        if (Math.abs(d) < 1e-12) return { ok: false, error: "Matrix is singular (determinant ≈ 0), no inverse exists." };
        // Gauss-Jordan elimination
        const n = rows;
        const aug = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
        for (let i = 0; i < n; i++) {
          let maxRow = i;
          for (let k = i + 1; k < n; k++) if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
          [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
          const pivot = aug[i][i];
          for (let j = 0; j < 2 * n; j++) aug[i][j] /= pivot;
          for (let k = 0; k < n; k++) {
            if (k === i) continue;
            const factor = aug[k][i];
            for (let j = 0; j < 2 * n; j++) aug[k][j] -= factor * aug[i][j];
          }
        }
        const inv = aug.map(row => row.slice(n).map(r));
        return { ok: true, result: { operation: "inverse", dimensions: [n, n], determinant: r(d), matrix: inv } };
      }
      case "rank": {
        return { ok: true, result: { operation: "rank", dimensions: [rows, cols], rank: rank(A), fullRank: rank(A) === Math.min(rows, cols) } };
      }
      case "eigenvalues": {
        // QR algorithm for eigenvalue approximation (small matrices only)
        if (rows !== cols) return { ok: false, error: "Eigenvalues require a square matrix." };
        if (rows > 10) return { ok: false, error: "Eigenvalue computation limited to 10x10 matrices." };
        // Power iteration for dominant eigenvalue, plus characteristic polynomial for 2x2/3x3
        if (rows === 2) {
          const trace = A[0][0] + A[1][1];
          const d = det(A);
          const disc = trace * trace - 4 * d;
          if (disc >= 0) {
            return { ok: true, result: { operation: "eigenvalues", eigenvalues: [r((trace + Math.sqrt(disc)) / 2), r((trace - Math.sqrt(disc)) / 2)], trace: r(trace), determinant: r(d), real: true } };
          } else {
            return { ok: true, result: { operation: "eigenvalues", eigenvalues: [{ real: r(trace / 2), imag: r(Math.sqrt(-disc) / 2) }, { real: r(trace / 2), imag: r(-Math.sqrt(-disc) / 2) }], trace: r(trace), determinant: r(d), real: false } };
          }
        }
        // For larger: simple QR iteration (30 steps)
        let Q = A.map(row => [...row]);
        for (let iter = 0; iter < 30; iter++) {
          // QR decomposition via Gram-Schmidt
          const n = Q.length;
          const Qm = Array.from({ length: n }, () => new Array(n).fill(0));
          const R = Array.from({ length: n }, () => new Array(n).fill(0));
          for (let j = 0; j < n; j++) {
            const v = Q.map(row => row[j]);
            for (let i = 0; i < j; i++) {
              let dot = 0;
              for (let k = 0; k < n; k++) dot += Qm[k][i] * v[k];
              R[i][j] = dot;
              for (let k = 0; k < n; k++) v[k] -= dot * Qm[k][i];
            }
            let norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
            if (norm < 1e-12) norm = 1e-12;
            R[j][j] = norm;
            for (let k = 0; k < n; k++) Qm[k][j] = v[k] / norm;
          }
          Q = multiply(R, Qm.map(row => [...row]));
          // Extract from the correct orientation
          const temp = Array.from({ length: n }, () => new Array(n).fill(0));
          for (let i = 0; i < n; i++) {for (let j = 0; j < n; j++) {
            for (let k = 0; k < n; k++) temp[i][j] += R[i][k] * Qm[k][j];
          }}
          Q = temp;
        }
        const eigenvalues = Array.from({ length: rows }, (_, i) => r(Q[i][i]));
        return { ok: true, result: { operation: "eigenvalues", eigenvalues, approximate: true, iterations: 30 } };
      }
      default:
        return { ok: false, error: `Unknown operation "${op}". Supported: determinant, transpose, multiply, inverse, rank, eigenvalues` };
    }
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * polynomialAnalysis
   * Analyze polynomial from coefficients [a_n, ..., a_1, a_0] (highest degree first).
   * Evaluate at points, find roots (for degree ≤ 4), compute derivative/integral.
   */
  registerLensAction("math", "polynomialAnalysis", (ctx, artifact, params) => {
  try {
    const coefficients = artifact.data?.coefficients || params.coefficients || [];
    if (coefficients.length === 0) return { ok: false, error: "No coefficients provided." };

    const degree = coefficients.length - 1;
    const r = (v) => Math.round(v * 1e8) / 1e8;

    // Evaluate polynomial at a point using Horner's method
    function evaluate(x) {
      let result = 0;
      for (let i = 0; i < coefficients.length; i++) {
        result = result * x + coefficients[i];
      }
      return result;
    }

    // Derivative coefficients
    const derivative = coefficients.slice(0, -1).map((c, i) => c * (degree - i));

    // Integral coefficients (constant = 0)
    const integral = coefficients.map((c, i) => c / (degree - i + 1));
    integral.push(0); // constant of integration

    // Evaluation at requested points
    const evalPoints = params.evaluateAt || [0, 1, -1];
    const evaluations = evalPoints.map(x => ({ x, y: r(evaluate(x)) }));

    // Root finding for small degrees
    let roots = null;
    if (degree === 1) {
      roots = [r(-coefficients[1] / coefficients[0])];
    } else if (degree === 2) {
      const [a, b, c] = coefficients;
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        roots = [r((-b + Math.sqrt(disc)) / (2 * a)), r((-b - Math.sqrt(disc)) / (2 * a))];
      } else {
        roots = [
          { real: r(-b / (2 * a)), imag: r(Math.sqrt(-disc) / (2 * a)) },
          { real: r(-b / (2 * a)), imag: r(-Math.sqrt(-disc) / (2 * a)) },
        ];
      }
    } else if (degree <= 4) {
      // Newton-Raphson from multiple starting points
      roots = [];
      const starts = [-10, -5, -2, -1, -0.5, 0, 0.5, 1, 2, 5, 10];
      const found = new Set();
      for (const start of starts) {
        let x = start;
        for (let i = 0; i < 100; i++) {
          const fx = evaluate(x);
          let fpx = 0;
          for (let j = 0; j < derivative.length; j++) fpx = fpx * x + derivative[j];
          if (Math.abs(fpx) < 1e-14) break;
          x = x - fx / fpx;
        }
        if (Math.abs(evaluate(x)) < 1e-8) {
          const rounded = r(x);
          const key = String(rounded);
          if (!found.has(key)) { found.add(key); roots.push(rounded); }
        }
        if (roots.length >= degree) break;
      }
    }

    // Flat shapes the math-lens UI reads (PolyResult: roots:number[], derivative:string).
    // It does roots.map(x => x.toFixed(3)), so roots must be a number array; complex roots
    // are surfaced separately. Without these the lens showed "deg undefined, 0 roots".
    const realRoots = Array.isArray(roots) ? roots.filter(x => typeof x === "number") : [];
    const complexRoots = Array.isArray(roots) ? roots.filter(x => x && typeof x === "object") : [];
    const fmtPoly = (coefs) => {
      const d = coefs.length - 1;
      const terms = coefs.map((c, i) => {
        if (c === 0) return null;
        const p = d - i, mag = Math.abs(c);
        const co = (mag === 1 && p > 0) ? "" : String(r(mag));
        const v = p > 1 ? `x^${p}` : p === 1 ? "x" : "";
        return { sign: c < 0 ? "-" : "+", body: co + v };
      }).filter(Boolean);
      if (terms.length === 0) return "0";
      return terms.map((t, i) => (i === 0 ? (t.sign === "-" ? "-" : "") : ` ${t.sign} `) + t.body).join("");
    };
    return {
      ok: true, result: {
        degree, coefficients,
        roots: realRoots,
        complexRoots,
        derivative: fmtPoly(derivative),
        derivativeDetail: { degree: Math.max(degree - 1, 0), coefficients: derivative },
        integral: { degree: degree + 1, coefficients: integral.map(r), note: "+C" },
        evaluations,
        rootsDetail: roots ? { values: roots, method: degree <= 2 ? "analytic" : "newton-raphson" } : { note: "Root-finding for degree > 4 not implemented" },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * regressionFit
   * Fit a regression model to data points.
   * artifact.data.points = [{ x, y }]
   * params.type: "linear" | "polynomial" | "exponential"
   * params.degree: number (for polynomial, default 2)
   */
  registerLensAction("math", "regressionFit", (ctx, artifact, params) => {
  try {
    // Accept EITHER points:[{x,y}] OR separate x:[] / y:[] arrays (the math-lens UI sends
    // the latter; reading only `points` made every regression error "Need 2 data points").
    const _d = artifact.data || {};
    let xs, ys;
    if (Array.isArray(_d.x) && Array.isArray(_d.y) && _d.x.length === _d.y.length && _d.x.length >= 2) {
      xs = _d.x.map(Number); ys = _d.y.map(Number);
    } else {
      const pts = _d.points || [];
      xs = pts.map(p => p.x); ys = pts.map(p => p.y);
    }
    const points = xs.map((x, i) => ({ x, y: ys[i] }));
    if (points.length < 2) return { ok: false, error: "Need at least 2 data points (x/y arrays or points)." };
    const n = points.length;
    const type = params.type || "linear";
    const r = (v) => Math.round(v * 1e8) / 1e8;

    if (type === "linear" || (type === "polynomial" && (params.degree || 2) === 1)) {
      // Least squares: y = mx + b
      const sumX = xs.reduce((s, v) => s + v, 0);
      const sumY = ys.reduce((s, v) => s + v, 0);
      const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
      const sumX2 = xs.reduce((s, x) => s + x * x, 0);
      const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const b = (sumY - m * sumX) / n;

      // R² calculation
      const yMean = sumY / n;
      const ssRes = ys.reduce((s, y, i) => s + Math.pow(y - (m * xs[i] + b), 2), 0);
      const ssTot = ys.reduce((s, y) => s + Math.pow(y - yMean, 2), 0);
      const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

      // Standard error of the estimate
      const se = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;

      // Pearson correlation
      const sumY2 = ys.reduce((s, y) => s + y * y, 0);
      const correlation = (n * sumXY - sumX * sumY) / Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

      artifact.data.regression = { type: "linear", slope: r(m), intercept: r(b), rSquared: r(rSquared) };

      return {
        ok: true, result: {
          type: "linear", equation: `y = ${r(m)}x + ${r(b)}`,
          slope: r(m), intercept: r(b),
          rSquared: r(rSquared), correlation: r(correlation),
          standardError: r(se), n,
          fit: rSquared > 0.9 ? "excellent" : rSquared > 0.7 ? "good" : rSquared > 0.5 ? "moderate" : "poor",
        },
      };
    }

    if (type === "exponential") {
      // y = a * e^(bx) → ln(y) = ln(a) + bx
      const positiveYs = ys.every(y => y > 0);
      if (!positiveYs) return { ok: false, error: "Exponential regression requires all y values > 0." };

      const lnYs = ys.map(y => Math.log(y));
      const sumX = xs.reduce((s, v) => s + v, 0);
      const sumLnY = lnYs.reduce((s, v) => s + v, 0);
      const sumXLnY = xs.reduce((s, x, i) => s + x * lnYs[i], 0);
      const sumX2 = xs.reduce((s, x) => s + x * x, 0);
      const b = (n * sumXLnY - sumX * sumLnY) / (n * sumX2 - sumX * sumX);
      const lnA = (sumLnY - b * sumX) / n;
      const a = Math.exp(lnA);

      const yMean = ys.reduce((s, y) => s + y, 0) / n;
      const ssRes = ys.reduce((s, y, i) => s + Math.pow(y - a * Math.exp(b * xs[i]), 2), 0);
      const ssTot = ys.reduce((s, y) => s + Math.pow(y - yMean, 2), 0);
      const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

      return {
        ok: true, result: {
          type: "exponential", equation: `y = ${r(a)} * e^(${r(b)}x)`,
          a: r(a), b: r(b), rSquared: r(rSquared), n,
          growthRate: r(b), doublingTime: b > 0 ? r(Math.log(2) / b) : null,
          fit: rSquared > 0.9 ? "excellent" : rSquared > 0.7 ? "good" : rSquared > 0.5 ? "moderate" : "poor",
        },
      };
    }

    // Polynomial regression via normal equations
    const deg = Math.min(params.degree || 2, Math.min(n - 1, 10));

    // Build Vandermonde matrix X^T * X and X^T * y
    const XtX = Array.from({ length: deg + 1 }, () => new Array(deg + 1).fill(0));
    const XtY = new Array(deg + 1).fill(0);
    for (let i = 0; i <= deg; i++) {
      for (let j = 0; j <= deg; j++) {
        XtX[i][j] = xs.reduce((s, x) => s + Math.pow(x, i + j), 0);
      }
      XtY[i] = xs.reduce((s, x, k) => s + Math.pow(x, i) * ys[k], 0);
    }

    // Solve via Gauss elimination
    const size = deg + 1;
    const aug = XtX.map((row, i) => [...row, XtY[i]]);
    for (let i = 0; i < size; i++) {
      let maxRow = i;
      for (let k = i + 1; k < size; k++) if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
      [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
      if (Math.abs(aug[i][i]) < 1e-12) continue;
      for (let k = i + 1; k < size; k++) {
        const factor = aug[k][i] / aug[i][i];
        for (let j = i; j <= size; j++) aug[k][j] -= factor * aug[i][j];
      }
    }
    const coeffs = new Array(size).fill(0);
    for (let i = size - 1; i >= 0; i--) {
      coeffs[i] = aug[i][size];
      for (let j = i + 1; j < size; j++) coeffs[i] -= aug[i][j] * coeffs[j];
      coeffs[i] /= aug[i][i] || 1;
    }

    // R²
    const yMean = ys.reduce((s, y) => s + y, 0) / n;
    const predict = (x) => coeffs.reduce((s, c, i) => s + c * Math.pow(x, i), 0);
    const ssRes = ys.reduce((s, y, i) => s + Math.pow(y - predict(xs[i]), 2), 0);
    const ssTot = ys.reduce((s, y) => s + Math.pow(y - yMean, 2), 0);
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    // Format equation
    const terms = coeffs.map((c, i) => {
      if (Math.abs(c) < 1e-10) return null;
      return i === 0 ? String(r(c)) : `${r(c)}x^${i}`;
    }).filter(Boolean).reverse().join(" + ");

    return {
      ok: true, result: {
        type: "polynomial", degree: deg,
        equation: `y = ${terms}`,
        coefficients: coeffs.map(r),
        rSquared: r(rSquared), n,
        fit: rSquared > 0.9 ? "excellent" : rSquared > 0.7 ? "good" : rSquared > 0.5 ? "moderate" : "poor",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /* ════════════════ symbolic computation (CAS) ════════════════ */

  /**
   * symbolicCompute — algebraic simplification, symbolic differentiation,
   * symbolic/numeric integration. Real CAS, no LLM.
   * params: { operation: 'simplify'|'derivative'|'integral', expression,
   *           variable='x', lower?, upper? }
   */
  registerLensAction("math", "symbolicCompute", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact && artifact.data), ...params };
      // Accept common aliases so callers (incl. the MCP concord.math tool, whose
      // schema advertises "differentiate | integrate") hit the right branch.
      const OP_ALIASES = { differentiate: "derivative", diff: "derivative", derive: "derivative", integrate: "integral", integration: "integral", antiderivative: "integral" };
      const rawOp = String(p.operation || "simplify").toLowerCase();
      const op = OP_ALIASES[rawOp] || rawOp;
      const exprStr = String(p.expression || "").trim();
      const variable = String(p.variable || "x").trim() || "x";
      if (!exprStr) return { ok: false, error: "No expression provided." };

      let tree;
      try { tree = casParse(exprStr); }
      catch (e) { return { ok: false, error: `Parse error: ${e.message}` }; }

      if (op === "simplify") {
        const simplified = casSimplify(tree);
        return { ok: true, result: { operation: "simplify", input: exprStr, output: casToString(simplified) } };
      }

      if (op === "derivative") {
        const d = casSimplify(casDiff(tree, variable));
        return {
          ok: true, result: {
            operation: "derivative", input: exprStr, variable,
            derivative: casToString(d),
            display: `d/d${variable} [ ${exprStr} ] = ${casToString(d)}`,
          },
        };
      }

      if (op === "integral") {
        const anti = casIntegrate(tree, variable);
        if (anti) {
          const simplified = casSimplify(anti);
          const out = { operation: "integral", input: exprStr, variable, closedForm: true, antiderivative: `${casToString(simplified)} + C` };
          if (p.lower !== undefined && p.upper !== undefined) {
            const lo = Number(p.lower), hi = Number(p.upper);
            const definite = casEval(simplified, { [variable]: hi }) - casEval(simplified, { [variable]: lo });
            out.definite = casRound(definite);
            out.bounds = { lower: lo, upper: hi };
          }
          return { ok: true, result: out };
        }
        // numeric fallback for definite integrals
        if (p.lower !== undefined && p.upper !== undefined) {
          const lo = Number(p.lower), hi = Number(p.upper);
          const numeric = casNumericIntegrate(tree, variable, lo, hi);
          return {
            ok: true, result: {
              operation: "integral", input: exprStr, variable, closedForm: false,
              method: "Simpson's rule (1000 intervals)",
              definite: casRound(numeric), bounds: { lower: lo, upper: hi },
            },
          };
        }
        return { ok: false, error: "No closed-form antiderivative found; supply lower/upper for a numeric definite integral." };
      }

      return { ok: false, error: `Unknown operation "${op}". Use simplify, derivative, or integral.` };
    } catch (e) {
      return { ok: false, error: `symbolicCompute failed: ${e.message}` };
    }
  });

  /**
   * stepSolveImpl — shared equation-solver core (used by stepSolve macro and
   * naturalQuery). Returns the same { ok, result|error } envelope.
   */
  function stepSolveImpl(p) {
    try {
      const variable = String(p.variable || "x").trim() || "x";
      const leftStr = String(p.left !== undefined ? p.left : p.expression || "").trim();
      const rightStr = String(p.right !== undefined ? p.right : "0").trim();
      if (!leftStr) return { ok: false, error: "No equation provided (need 'left')." };

      let left, right;
      try { left = casParse(leftStr); right = casParse(rightStr); }
      catch (e) { return { ok: false, error: `Parse error: ${e.message}` }; }

      const steps = [];
      // Move everything to the left: f(x) = left - right = 0
      const f = casSimplify(N.sub(left, right));
      steps.push(`Equation: ${leftStr} = ${rightStr}`);
      steps.push(`Rearrange to f(${variable}) = 0:  ${casToString(f)} = 0`);

      // Extract polynomial coefficients in `variable` (degree ≤ 2 via sampling).
      const sample = (xv) => casEval(f, { [variable]: xv });
      const c0 = sample(0);
      const cp1 = sample(1);
      const cm1 = sample(-1);
      // f(x) = a x² + b x + c  ⇒  c=f(0), a=(f(1)+f(-1))/2-c, b=(f(1)-f(-1))/2
      const a = (cp1 + cm1) / 2 - c0;
      const b = (cp1 - cm1) / 2;
      const c = c0;
      // verify it is genuinely degree ≤ 2 by checking f(2)
      const predict2 = a * 4 + b * 2 + c;
      const isPoly2 = Math.abs(predict2 - sample(2)) < 1e-6;

      const rnd = (v) => Math.round(v * 1e8) / 1e8;

      if (isPoly2 && Math.abs(a) > 1e-12) {
        steps.push(`Recognized quadratic: ${rnd(a)}${variable}² + ${rnd(b)}${variable} + ${rnd(c)} = 0`);
        steps.push(`Apply quadratic formula: ${variable} = (−b ± √(b²−4ac)) / 2a`);
        const disc = b * b - 4 * a * c;
        steps.push(`Discriminant b²−4ac = ${rnd(disc)}`);
        let roots, rootKind;
        if (disc > 1e-12) {
          const s = Math.sqrt(disc);
          roots = [rnd((-b + s) / (2 * a)), rnd((-b - s) / (2 * a))];
          rootKind = "two-real";
          steps.push(`√${rnd(disc)} ≈ ${rnd(s)}`);
          steps.push(`${variable}₁ = (${rnd(-b)} + ${rnd(s)}) / ${rnd(2 * a)} = ${roots[0]}`);
          steps.push(`${variable}₂ = (${rnd(-b)} − ${rnd(s)}) / ${rnd(2 * a)} = ${roots[1]}`);
        } else if (disc > -1e-12) {
          roots = [rnd(-b / (2 * a))];
          rootKind = "repeated";
          steps.push(`Discriminant ≈ 0 → one repeated root: ${variable} = ${roots[0]}`);
        } else {
          const re = rnd(-b / (2 * a)), im = rnd(Math.sqrt(-disc) / (2 * a));
          roots = [{ real: re, imag: im }, { real: re, imag: -im }];
          rootKind = "complex";
          steps.push(`Discriminant < 0 → complex roots: ${re} ± ${im}i`);
        }
        return { ok: true, result: { kind: "quadratic", variable, coefficients: { a: rnd(a), b: rnd(b), c: rnd(c) }, rootKind, roots, steps } };
      }

      if (isPoly2 && Math.abs(b) > 1e-12) {
        steps.push(`Recognized linear: ${rnd(b)}${variable} + ${rnd(c)} = 0`);
        steps.push(`Subtract ${rnd(c)} from both sides: ${rnd(b)}${variable} = ${rnd(-c)}`);
        steps.push(`Divide both sides by ${rnd(b)}`);
        const root = rnd(-c / b);
        steps.push(`${variable} = ${rnd(-c)} ÷ ${rnd(b)} = ${root}`);
        return { ok: true, result: { kind: "linear", variable, roots: [root], steps } };
      }

      if (isPoly2 && Math.abs(c) < 1e-9) {
        steps.push("Both sides reduce to an identity — infinitely many solutions.");
        return { ok: true, result: { kind: "identity", variable, roots: "infinite", steps } };
      }
      if (isPoly2) {
        steps.push(`Reduces to constant ${rnd(c)} = 0 — no solution.`);
        return { ok: true, result: { kind: "no-solution", variable, roots: [], steps } };
      }

      // general non-polynomial: bisection over a bracket
      const bracket = Array.isArray(p.bracket) && p.bracket.length === 2 ? p.bracket.map(Number) : [-50, 50];
      steps.push(`Non-polynomial equation — scanning [${bracket[0]}, ${bracket[1]}] for sign changes.`);
      const roots = [];
      const N_SCAN = 400;
      const dx = (bracket[1] - bracket[0]) / N_SCAN;
      let prevX = bracket[0], prevY = sample(prevX);
      for (let i = 1; i <= N_SCAN && roots.length < 8; i++) {
        const xv = bracket[0] + i * dx;
        let yv;
        try { yv = sample(xv); } catch { prevX = xv; prevY = NaN; continue; }
        if (Number.isFinite(prevY) && Number.isFinite(yv) && prevY * yv < 0) {
          // bisection refine
          let lo = prevX, hi = xv, flo = prevY;
          for (let k = 0; k < 80; k++) {
            const mid = (lo + hi) / 2;
            const fm = sample(mid);
            if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
          }
          roots.push(rnd((lo + hi) / 2));
        }
        prevX = xv; prevY = yv;
      }
      if (roots.length) steps.push(`Found ${roots.length} root(s) by bisection: ${roots.join(", ")}`);
      else steps.push("No sign change found in the bracket — no real root located.");
      return { ok: true, result: { kind: "numeric", variable, roots, steps, bracket } };
    } catch (e) {
      return { ok: false, error: `stepSolve failed: ${e.message}` };
    }
  }

  /**
   * stepSolve — equation/expression solving WITH step-by-step working.
   * Handles linear (ax+b=c), quadratic (ax²+bx+c=0), and falls back to
   * bisection root-finding for general continuous f(x)=g(x) on a bracket.
   * params: { left, right='0', variable='x', bracket?:[lo,hi] }
   */
  registerLensAction("math", "stepSolve", (ctx, artifact, params) => {
    return stepSolveImpl({ ...(artifact && artifact.data), ...params });
  });

  /**
   * naturalQuery — parse a natural-language math query and dispatch it
   * to the right computation. "integral of x^2 from 0 to 5", "factor 360",
   * "convert 5 km to mi", "derivative of sin(x)", "solve x^2-4=0".
   * params: { query }
   */
  registerLensAction("math", "naturalQuery", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact && artifact.data), ...params };
      const query = String(p.query || "").trim();
      if (!query) return { ok: false, error: "No query provided." };
      const plan = parseNaturalQuery(query);
      if (!plan) return { ok: false, error: "Could not interpret the query." };

      const rnd = (v) => Math.round(v * 1e8) / 1e8;

      if (plan.op === "integrate") {
        let tree;
        try { tree = casParse(plan.expression); }
        catch (e) { return { ok: false, error: `Parse error: ${e.message}` }; }
        const anti = casIntegrate(tree, plan.variable);
        if (plan.lower !== undefined && plan.upper !== undefined) {
          let value, closed;
          if (anti) { const s = casSimplify(anti); value = casEval(s, { [plan.variable]: plan.upper }) - casEval(s, { [plan.variable]: plan.lower }); closed = true; }
          else { value = casNumericIntegrate(tree, plan.variable, plan.lower, plan.upper); closed = false; }
          return { ok: true, result: { interpreted: plan, kind: "definite-integral", answer: rnd(value), closedForm: closed, expression: plan.expression, bounds: [plan.lower, plan.upper] } };
        }
        return { ok: true, result: { interpreted: plan, kind: "antiderivative", answer: anti ? `${casToString(casSimplify(anti))} + C` : null, closedForm: !!anti } };
      }

      if (plan.op === "derivative") {
        let tree;
        try { tree = casParse(plan.expression); }
        catch (e) { return { ok: false, error: `Parse error: ${e.message}` }; }
        const d = casSimplify(casDiff(tree, plan.variable));
        return { ok: true, result: { interpreted: plan, kind: "derivative", answer: casToString(d) } };
      }

      if (plan.op === "solve") {
        const inner = stepSolveImpl({ left: plan.left, right: plan.right, variable: plan.variable });
        return { ok: true, result: { interpreted: plan, kind: "solve", answer: inner.ok ? inner.result : null, detail: inner } };
      }

      if (plan.op === "simplify") {
        let tree;
        try { tree = casParse(plan.expression); }
        catch (e) { return { ok: false, error: `Parse error: ${e.message}` }; }
        return { ok: true, result: { interpreted: plan, kind: "simplify", answer: casToString(casSimplify(tree)) } };
      }

      if (plan.op === "factorize") {
        const factors = primeFactorize(plan.number);
        return { ok: true, result: { interpreted: plan, kind: "factorize", number: plan.number, primeFactors: factors } };
      }

      if (plan.op === "isprime") {
        return { ok: true, result: { interpreted: plan, kind: "isprime", number: plan.number, isPrime: isPrime(plan.number) } };
      }

      if (plan.op === "convert") {
        let value;
        const fromTemp = ["c", "f", "k"].includes(plan.from);
        if (fromTemp) value = convertTemperature(plan.value, plan.from, plan.to);
        else {
          const cat = findUnitCategory(plan.from);
          const cat2 = findUnitCategory(plan.to);
          if (!cat || cat !== cat2) return { ok: false, error: `Cannot convert ${plan.from} → ${plan.to}.` };
          value = plan.value * UNIT_TABLE[cat].units[plan.from] / UNIT_TABLE[cat].units[plan.to];
        }
        if (value === null || value === undefined) return { ok: false, error: "Conversion failed." };
        return { ok: true, result: { interpreted: plan, kind: "convert", answer: rnd(value), from: plan.from, to: plan.to } };
      }

      // evaluate
      try {
        const tree = casParse(plan.expression);
        const simplified = casSimplify(tree);
        if (simplified.k === "num") return { ok: true, result: { interpreted: plan, kind: "evaluate", answer: rnd(simplified.v) } };
        return { ok: true, result: { interpreted: plan, kind: "simplify", answer: casToString(simplified) } };
      } catch (e) {
        return { ok: false, error: `Could not evaluate "${plan.expression}": ${e.message}` };
      }
    } catch (e) {
      return { ok: false, error: `naturalQuery failed: ${e.message}` };
    }
  });

  /**
   * plotFunction — evaluate one or more functions over a range and return
   * point series suitable for charting. Real numeric evaluation via the CAS.
   * params: { expressions:[str] | expression:str, variable='x',
   *           xMin=-10, xMax=10, samples=200 }
   */
  registerLensAction("math", "plotFunction", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact && artifact.data), ...params };
      let exprs = p.expressions;
      if (!Array.isArray(exprs) || exprs.length === 0) {
        exprs = p.expression ? [p.expression] : [];
      }
      exprs = exprs.map((s) => String(s).trim()).filter(Boolean);
      if (exprs.length === 0) return { ok: false, error: "No expression(s) provided." };

      const variable = String(p.variable || "x").trim() || "x";
      const xMin = Number(p.xMin !== undefined ? p.xMin : -10);
      const xMax = Number(p.xMax !== undefined ? p.xMax : 10);
      if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin) {
        return { ok: false, error: "Invalid range: require xMax > xMin." };
      }
      const samples = Math.max(2, Math.min(2000, Math.trunc(Number(p.samples) || 200)));

      const trees = [];
      for (const e of exprs) {
        try { trees.push(casParse(e)); }
        catch (err) { return { ok: false, error: `Parse error in "${e}": ${err.message}` }; }
      }

      const dx = (xMax - xMin) / (samples - 1);
      const points = [];
      const seriesStats = exprs.map(() => ({ yMin: Infinity, yMax: -Infinity, defined: 0 }));
      for (let i = 0; i < samples; i++) {
        const xv = xMin + i * dx;
        const row = { x: Math.round(xv * 1e6) / 1e6 };
        trees.forEach((tree, idx) => {
          let yv;
          try { yv = casEval(tree, { [variable]: xv }); } catch { yv = null; }
          if (typeof yv === "number" && Number.isFinite(yv)) {
            row[`y${idx}`] = Math.round(yv * 1e6) / 1e6;
            seriesStats[idx].defined++;
            if (yv < seriesStats[idx].yMin) seriesStats[idx].yMin = yv;
            if (yv > seriesStats[idx].yMax) seriesStats[idx].yMax = yv;
          } else {
            row[`y${idx}`] = null;
          }
        });
        points.push(row);
      }

      const series = exprs.map((e, idx) => ({
        key: `y${idx}`, label: e,
        yMin: seriesStats[idx].defined ? Math.round(seriesStats[idx].yMin * 1e6) / 1e6 : null,
        yMax: seriesStats[idx].defined ? Math.round(seriesStats[idx].yMax * 1e6) / 1e6 : null,
        definedPoints: seriesStats[idx].defined,
      }));

      return { ok: true, result: { variable, xMin, xMax, samples, series, points } };
    } catch (e) {
      return { ok: false, error: `plotFunction failed: ${e.message}` };
    }
  });

  /**
   * unitConvert — unit conversion + dimensional analysis.
   * params: { value, from, to }  OR  { list:true, category? } to enumerate units.
   */
  registerLensAction("math", "unitConvert", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact && artifact.data), ...params };
      if (p.list) {
        const cats = {};
        for (const [cat, def] of Object.entries(UNIT_TABLE)) cats[cat] = Object.keys(def.units);
        cats.temperature = ["c", "f", "k"];
        if (p.category && cats[p.category]) return { ok: true, result: { category: p.category, units: cats[p.category] } };
        return { ok: true, result: { categories: cats } };
      }
      const value = Number(p.value);
      const from = String(p.from || "").trim().toLowerCase();
      const to = String(p.to || "").trim().toLowerCase();
      if (!Number.isFinite(value)) return { ok: false, error: "Numeric 'value' required." };
      if (!from || !to) return { ok: false, error: "'from' and 'to' units required." };

      // temperature is affine
      if (["c", "f", "k"].includes(from) || ["c", "f", "k"].includes(to)) {
        if (!(["c", "f", "k"].includes(from) && ["c", "f", "k"].includes(to))) {
          return { ok: false, error: `Cannot mix temperature with non-temperature units.` };
        }
        const out = convertTemperature(value, from, to);
        return { ok: true, result: { category: "temperature", value, from, to, converted: Math.round(out * 1e8) / 1e8, formula: "affine (offset + scale)" } };
      }

      const cat = findUnitCategory(from);
      const cat2 = findUnitCategory(to);
      if (!cat) return { ok: false, error: `Unknown unit "${from}".` };
      if (!cat2) return { ok: false, error: `Unknown unit "${to}".` };
      if (cat !== cat2) return { ok: false, error: `Dimension mismatch: "${from}" is ${cat}, "${to}" is ${cat2}.` };

      const factorFrom = UNIT_TABLE[cat].units[from];
      const factorTo = UNIT_TABLE[cat].units[to];
      const converted = value * factorFrom / factorTo;
      return {
        ok: true, result: {
          category: cat, value, from, to,
          converted: Math.round(converted * 1e10) / 1e10,
          baseUnit: UNIT_TABLE[cat].base,
          rate: Math.round((factorFrom / factorTo) * 1e10) / 1e10,
        },
      };
    } catch (e) {
      return { ok: false, error: `unitConvert failed: ${e.message}` };
    }
  });

  /**
   * numberTheory — factorization, primality, gcd/lcm, combinatorics,
   * named integer sequences.
   * params: { tool, n?, m?, k?, count? }
   *   tool ∈ factorize | isprime | primes | gcd | lcm | factorial |
   *          combinations | permutations | fibonacci | divisors | totient
   */
  registerLensAction("math", "numberTheory", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact && artifact.data), ...params };
      const tool = String(p.tool || "").trim();
      const n = p.n !== undefined ? Math.trunc(Number(p.n)) : undefined;
      const m = p.m !== undefined ? Math.trunc(Number(p.m)) : undefined;
      const k = p.k !== undefined ? Math.trunc(Number(p.k)) : undefined;

      switch (tool) {
        case "factorize": {
          if (n === undefined) return { ok: false, error: "'n' required." };
          const factors = primeFactorize(n);
          // group into exponent form
          const grouped = {};
          for (const f of factors) grouped[f] = (grouped[f] || 0) + 1;
          const exponents = Object.entries(grouped).map(([base, exp]) => ({ base: Number(base), exponent: exp }));
          return { ok: true, result: { tool, n, primeFactors: factors, factorization: exponents, isPrime: factors.length === 1 && factors[0] === Math.abs(n) } };
        }
        case "isprime": {
          if (n === undefined) return { ok: false, error: "'n' required." };
          return { ok: true, result: { tool, n, isPrime: isPrime(n) } };
        }
        case "primes": {
          const count = Math.max(1, Math.min(2000, Math.trunc(Number(p.count) || 20)));
          // sieve up to a generous bound
          const limit = Math.max(20, Math.ceil(count * (Math.log(count + 2) + Math.log(Math.log(count + 2)) + 2)));
          const sieve = new Uint8Array(limit + 1);
          const primes = [];
          for (let i = 2; i <= limit && primes.length < count; i++) {
            if (!sieve[i]) {
              primes.push(i);
              for (let j = i * i; j <= limit; j += i) sieve[j] = 1;
            }
          }
          return { ok: true, result: { tool, count: primes.length, primes } };
        }
        case "gcd": {
          if (n === undefined || m === undefined) return { ok: false, error: "'n' and 'm' required." };
          return { ok: true, result: { tool, n, m, gcd: gcd(n, m) } };
        }
        case "lcm": {
          if (n === undefined || m === undefined) return { ok: false, error: "'n' and 'm' required." };
          return { ok: true, result: { tool, n, m, lcm: lcm(n, m) } };
        }
        case "factorial": {
          if (n === undefined) return { ok: false, error: "'n' required." };
          if (n < 0 || n > 170) return { ok: false, error: "factorial: n must be 0..170." };
          return { ok: true, result: { tool, n, factorial: factorial(n) } };
        }
        case "combinations": {
          if (n === undefined || k === undefined) return { ok: false, error: "'n' and 'k' required." };
          if (k < 0 || k > n) return { ok: true, result: { tool, n, k, combinations: 0 } };
          let c = 1;
          for (let i = 0; i < Math.min(k, n - k); i++) c = c * (n - i) / (i + 1);
          return { ok: true, result: { tool, n, k, combinations: Math.round(c) } };
        }
        case "permutations": {
          if (n === undefined || k === undefined) return { ok: false, error: "'n' and 'k' required." };
          if (k < 0 || k > n) return { ok: true, result: { tool, n, k, permutations: 0 } };
          let perm = 1;
          for (let i = 0; i < k; i++) perm *= (n - i);
          return { ok: true, result: { tool, n, k, permutations: perm } };
        }
        case "fibonacci": {
          const count = Math.max(1, Math.min(90, Math.trunc(Number(p.count) || 15)));
          const seq = [0, 1];
          while (seq.length < count) seq.push(seq[seq.length - 1] + seq[seq.length - 2]);
          return { ok: true, result: { tool, count, sequence: seq.slice(0, count) } };
        }
        case "divisors": {
          if (n === undefined) return { ok: false, error: "'n' required." };
          const x = Math.abs(n);
          const divs = [];
          for (let d = 1; d * d <= x; d++) {
            if (x % d === 0) { divs.push(d); if (d !== x / d) divs.push(x / d); }
          }
          divs.sort((a, b) => a - b);
          return { ok: true, result: { tool, n, divisors: divs, count: divs.length, sum: divs.reduce((s, d) => s + d, 0) } };
        }
        case "totient": {
          if (n === undefined) return { ok: false, error: "'n' required." };
          let x = Math.abs(n), result = x;
          const factors = [...new Set(primeFactorize(x))];
          for (const pf of factors) result -= result / pf;
          return { ok: true, result: { tool, n, totient: Math.round(result) } };
        }
        default:
          return { ok: false, error: `Unknown tool "${tool}". Use factorize, isprime, primes, gcd, lcm, factorial, combinations, permutations, fibonacci, divisors, totient.` };
      }
    } catch (e) {
      return { ok: false, error: `numberTheory failed: ${e.message}` };
    }
  });

  /**
   * casHistory — persistent per-user log of CAS computations.
   * params: { action:'record'|'list'|'clear', entry?, limit? }
   */
  registerLensAction("math", "casHistory", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact && artifact.data), ...params };
      const action = p.action || "list";
      const bucket = mathBucket(ctx);
      if (!bucket) return { ok: true, result: { history: [], note: "State unavailable." } };

      if (action === "record") {
        if (!p.entry || typeof p.entry !== "object") return { ok: false, error: "'entry' object required." };
        bucket.history.unshift({ ...p.entry, at: new Date().toISOString() });
        if (bucket.history.length > 200) bucket.history.length = 200;
        return { ok: true, result: { recorded: true, total: bucket.history.length } };
      }
      if (action === "clear") {
        bucket.history = [];
        return { ok: true, result: { cleared: true } };
      }
      const limit = Math.max(1, Math.min(200, Math.trunc(Number(p.limit) || 50)));
      return { ok: true, result: { history: bucket.history.slice(0, limit), total: bucket.history.length } };
    } catch (e) {
      return { ok: false, error: `casHistory failed: ${e.message}` };
    }
  });
}
