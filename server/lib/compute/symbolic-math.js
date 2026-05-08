/**
 * Symbolic Math Engine
 *
 * Algebra and calculus symbolic manipulation:
 * - Parse algebraic expressions
 * - Simplify
 * - Expand
 * - Differentiate
 * - Integrate (simple cases)
 * - Solve equations (linear, quadratic, cubic)
 * - Substitution
 *
 * Pure ES module. No dependencies.
 *
 * AST node shapes:
 *   { type: 'num', value: Number }
 *   { type: 'var', name: String }
 *   { type: 'op',  op: '+' | '-' | '*' | '/' | '^', args: [AST, AST] }
 *   { type: 'neg', arg: AST }
 *   { type: 'fn',  name: 'sin'|'cos'|'tan'|'ln'|'exp'|'sqrt', arg: AST }
 */

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'ln', 'log', 'exp', 'sqrt']);

function tokenize(input) {
  const tokens = [];
  let i = 0;
  const s = String(input).replace(/\s+/g, '');
  while (i < s.length) {
    const c = s[i];
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) j++;
      tokens.push({ type: 'num', value: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i;
      while (
        j < s.length &&
        ((s[j] >= 'a' && s[j] <= 'z') ||
          (s[j] >= 'A' && s[j] <= 'Z') ||
          (s[j] >= '0' && s[j] <= '9') ||
          s[j] === '_')
      )
        {j++;}
      const name = s.slice(i, j);
      if (FUNCTIONS.has(name.toLowerCase())) {
        tokens.push({ type: 'fn', name: name.toLowerCase() });
      } else {
        tokens.push({ type: 'ident', name });
      }
      i = j;
      continue;
    }
    if ('+-*/^()'.includes(c)) {
      tokens.push({ type: c });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ type: ',' });
      i++;
      continue;
    }
    throw new Error(`symbolic-math: unexpected character "${c}" at ${i}`);
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (recursive descent; precedence: + - < * / < ^ < unary < fn/paren)
// ---------------------------------------------------------------------------

function makeParser(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t) => {
    if (tokens[pos].type !== t) {
      throw new Error(`symbolic-math: expected ${t}, got ${tokens[pos].type}`);
    }
    return tokens[pos++];
  };

  function parseExpr() {
    let left = parseTerm();
    while (peek().type === '+' || peek().type === '-') {
      const op = eat(peek().type).type;
      const right = parseTerm();
      left = { type: 'op', op, args: [left, right] };
    }
    return left;
  }

  function parseTerm() {
    let left = parseFactor();
    while (peek().type === '*' || peek().type === '/') {
      const op = eat(peek().type).type;
      const right = parseFactor();
      left = { type: 'op', op, args: [left, right] };
    }
    return left;
  }

  function parseFactor() {
    // Unary minus
    if (peek().type === '-') {
      eat('-');
      return { type: 'neg', arg: parseFactor() };
    }
    if (peek().type === '+') {
      eat('+');
      return parseFactor();
    }
    return parsePower();
  }

  function parsePower() {
    const base = parseAtom();
    if (peek().type === '^') {
      eat('^');
      const exp = parseFactor(); // right-associative
      return { type: 'op', op: '^', args: [base, exp] };
    }
    return base;
  }

  function parseAtom() {
    const t = peek();
    if (t.type === 'num') {
      eat('num');
      return { type: 'num', value: t.value };
    }
    if (t.type === 'ident') {
      eat('ident');
      return { type: 'var', name: t.name };
    }
    if (t.type === 'fn') {
      eat('fn');
      eat('(');
      const arg = parseExpr();
      eat(')');
      return { type: 'fn', name: t.name, arg };
    }
    if (t.type === '(') {
      eat('(');
      const e = parseExpr();
      eat(')');
      return e;
    }
    throw new Error(`symbolic-math: unexpected token ${t.type}`);
  }

  return { parseExpr };
}

export function parse(expression) {
  if (expression && typeof expression === 'object' && expression.type) {
    return expression; // already AST
  }
  // Handle equations: split on '=' -> return {type:'eq', lhs, rhs}
  const str = String(expression);
  if (str.includes('=')) {
    const [l, r] = str.split('=');
    return { type: 'eq', lhs: parse(l), rhs: parse(r) };
  }
  const tokens = tokenize(str);
  const p = makeParser(tokens);
  const ast = p.parseExpr();
  return ast;
}

// ---------------------------------------------------------------------------
// Stringify
// ---------------------------------------------------------------------------

export function stringify(ast) {
  if (!ast) return '';
  switch (ast.type) {
    case 'num': {
      const v = ast.value;
      if (v < 0) return `(${v})`;
      return String(v);
    }
    case 'var':
      return ast.name;
    case 'neg':
      return `(-${stringify(ast.arg)})`;
    case 'fn':
      return `${ast.name}(${stringify(ast.arg)})`;
    case 'op': {
      const [a, b] = ast.args;
      return `(${stringify(a)} ${ast.op} ${stringify(b)})`;
    }
    case 'eq':
      return `${stringify(ast.lhs)} = ${stringify(ast.rhs)}`;
    default:
      return '?';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NUM = (v) => ({ type: 'num', value: v });
const VAR = (n) => ({ type: 'var', name: n });
const OP = (op, a, b) => ({ type: 'op', op, args: [a, b] });
const NEG = (a) => ({ type: 'neg', arg: a });
const FN = (name, a) => ({ type: 'fn', name, arg: a });

function isNum(ast, v) {
  if (!ast || ast.type !== 'num') return false;
  return v === undefined || ast.value === v;
}

function isZero(ast) {
  return isNum(ast, 0);
}
function isOne(ast) {
  return isNum(ast, 1);
}

function equals(a, b) {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'num':
      return a.value === b.value;
    case 'var':
      return a.name === b.name;
    case 'neg':
      return equals(a.arg, b.arg);
    case 'fn':
      return a.name === b.name && equals(a.arg, b.arg);
    case 'op':
      return (
        a.op === b.op && equals(a.args[0], b.args[0]) && equals(a.args[1], b.args[1])
      );
    default:
      return false;
  }
}

function clone(ast) {
  return JSON.parse(JSON.stringify(ast));
}

// ---------------------------------------------------------------------------
// Simplify
// ---------------------------------------------------------------------------

export function simplify(expression) {
  let ast = typeof expression === 'string' ? parse(expression) : clone(expression);
  let prev;
  let iter = 0;
  do {
    prev = JSON.stringify(ast);
    ast = simplifyOnce(ast);
    iter++;
  } while (JSON.stringify(ast) !== prev && iter < 50);
  return ast;
}

function simplifyOnce(ast) {
  if (!ast) return ast;
  if (ast.type === 'num' || ast.type === 'var') return ast;
  if (ast.type === 'neg') {
    const a = simplifyOnce(ast.arg);
    if (a.type === 'num') return NUM(-a.value);
    if (a.type === 'neg') return a.arg;
    return NEG(a);
  }
  if (ast.type === 'fn') {
    const a = simplifyOnce(ast.arg);
    if (a.type === 'num') {
      const n = a.value;
      switch (ast.name) {
        case 'sin':
          return NUM(Math.sin(n));
        case 'cos':
          return NUM(Math.cos(n));
        case 'tan':
          return NUM(Math.tan(n));
        case 'ln':
          return NUM(Math.log(n));
        case 'log':
          return NUM(Math.log(n));
        case 'exp':
          return NUM(Math.exp(n));
        case 'sqrt':
          return NUM(Math.sqrt(n));
      }
    }
    return FN(ast.name, a);
  }
  if (ast.type === 'op') {
    const [a, b] = ast.args.map(simplifyOnce);
    const op = ast.op;

    // Numeric folding
    if (a.type === 'num' && b.type === 'num') {
      switch (op) {
        case '+':
          return NUM(a.value + b.value);
        case '-':
          return NUM(a.value - b.value);
        case '*':
          return NUM(a.value * b.value);
        case '/':
          if (b.value === 0) return OP(op, a, b);
          return NUM(a.value / b.value);
        case '^':
          return NUM(Math.pow(a.value, b.value));
      }
    }

    // Identity rules
    if (op === '+') {
      if (isZero(a)) return b;
      if (isZero(b)) return a;
      if (equals(a, b)) return OP('*', NUM(2), a);
    }
    if (op === '-') {
      if (isZero(a)) return NEG(b);
      if (isZero(b)) return a;
      if (equals(a, b)) return NUM(0);
    }
    if (op === '*') {
      if (isZero(a) || isZero(b)) return NUM(0);
      if (isOne(a)) return b;
      if (isOne(b)) return a;
      if (equals(a, b)) return OP('^', a, NUM(2));
    }
    if (op === '/') {
      if (isZero(a)) return NUM(0);
      if (isOne(b)) return a;
      if (equals(a, b)) return NUM(1);
    }
    if (op === '^') {
      if (isZero(b)) return NUM(1);
      if (isOne(b)) return a;
      if (isZero(a)) return NUM(0);
      if (isOne(a)) return NUM(1);
    }
    return OP(op, a, b);
  }
  if (ast.type === 'eq') {
    return { type: 'eq', lhs: simplifyOnce(ast.lhs), rhs: simplifyOnce(ast.rhs) };
  }
  return ast;
}

// ---------------------------------------------------------------------------
// Expand
// ---------------------------------------------------------------------------

export function expand(expression) {
  const ast = typeof expression === 'string' ? parse(expression) : clone(expression);
  return simplify(expandAst(ast));
}

function expandAst(ast) {
  if (!ast || ast.type === 'num' || ast.type === 'var') return ast;
  if (ast.type === 'neg') return NEG(expandAst(ast.arg));
  if (ast.type === 'fn') return FN(ast.name, expandAst(ast.arg));
  if (ast.type === 'op') {
    const [a, b] = ast.args.map(expandAst);
    const op = ast.op;
    // Distribute multiplication over addition/subtraction
    if (op === '*') {
      if (a.type === 'op' && (a.op === '+' || a.op === '-')) {
        return {
          type: 'op',
          op: a.op,
          args: [expandAst(OP('*', a.args[0], b)), expandAst(OP('*', a.args[1], b))],
        };
      }
      if (b.type === 'op' && (b.op === '+' || b.op === '-')) {
        return {
          type: 'op',
          op: b.op,
          args: [expandAst(OP('*', a, b.args[0])), expandAst(OP('*', a, b.args[1]))],
        };
      }
    }
    // (a+b)^n for small integer n
    if (op === '^' && b.type === 'num' && Number.isInteger(b.value) && b.value >= 0) {
      const n = b.value;
      if (n === 0) return NUM(1);
      if (n === 1) return a;
      let acc = a;
      for (let k = 1; k < n; k++) acc = expandAst(OP('*', acc, a));
      return acc;
    }
    return OP(op, a, b);
  }
  return ast;
}

// ---------------------------------------------------------------------------
// Differentiate
// ---------------------------------------------------------------------------

export function differentiate(expression, variable = 'x') {
  const ast = typeof expression === 'string' ? parse(expression) : clone(expression);
  return simplify(diff(ast, variable));
}

function diff(ast, v) {
  if (!ast) return NUM(0);
  if (ast.type === 'num') return NUM(0);
  if (ast.type === 'var') return NUM(ast.name === v ? 1 : 0);
  if (ast.type === 'neg') return NEG(diff(ast.arg, v));
  if (ast.type === 'fn') {
    const u = ast.arg;
    const du = diff(u, v);
    switch (ast.name) {
      case 'sin':
        return OP('*', FN('cos', u), du);
      case 'cos':
        return NEG(OP('*', FN('sin', u), du));
      case 'tan':
        return OP('/', du, OP('^', FN('cos', u), NUM(2)));
      case 'ln':
      case 'log':
        return OP('/', du, u);
      case 'exp':
        return OP('*', FN('exp', u), du);
      case 'sqrt':
        return OP('/', du, OP('*', NUM(2), FN('sqrt', u)));
    }
    return NUM(0);
  }
  if (ast.type === 'op') {
    const [a, b] = ast.args;
    const da = diff(a, v);
    const db = diff(b, v);
    switch (ast.op) {
      case '+':
        return OP('+', da, db);
      case '-':
        return OP('-', da, db);
      case '*':
        // (a*b)' = a'*b + a*b'
        return OP('+', OP('*', da, b), OP('*', a, db));
      case '/':
        // (a/b)' = (a'*b - a*b') / b^2
        return OP(
          '/',
          OP('-', OP('*', da, b), OP('*', a, db)),
          OP('^', b, NUM(2))
        );
      case '^': {
        // Case: u^n with n constant
        if (b.type === 'num') {
          // n * u^(n-1) * du
          return OP(
            '*',
            OP('*', NUM(b.value), OP('^', a, NUM(b.value - 1))),
            da
          );
        }
        // General: d/dx(a^b) = a^b * (b' * ln(a) + b * a'/a)
        return OP(
          '*',
          OP('^', a, b),
          OP('+', OP('*', db, FN('ln', a)), OP('*', b, OP('/', da, a)))
        );
      }
    }
  }
  return NUM(0);
}

// ---------------------------------------------------------------------------
// Integrate (simple cases)
// ---------------------------------------------------------------------------

export function integrate(expression, variable = 'x') {
  const ast = typeof expression === 'string' ? parse(expression) : clone(expression);
  return simplify(integr(ast, variable));
}

function integr(ast, v) {
  if (!ast) return NUM(0);
  // Constant
  if (ast.type === 'num') return OP('*', NUM(ast.value), VAR(v));
  // Variable
  if (ast.type === 'var') {
    if (ast.name === v) return OP('/', OP('^', VAR(v), NUM(2)), NUM(2));
    return OP('*', VAR(ast.name), VAR(v));
  }
  if (ast.type === 'neg') return NEG(integr(ast.arg, v));
  if (ast.type === 'op') {
    const [a, b] = ast.args;
    if (ast.op === '+') return OP('+', integr(a, v), integr(b, v));
    if (ast.op === '-') return OP('-', integr(a, v), integr(b, v));
    // Constant * f
    if (ast.op === '*') {
      if (!containsVar(a, v)) return OP('*', a, integr(b, v));
      if (!containsVar(b, v)) return OP('*', b, integr(a, v));
    }
    // Power rule: x^n -> x^(n+1)/(n+1)  (n != -1)
    if (
      ast.op === '^' &&
      a.type === 'var' &&
      a.name === v &&
      b.type === 'num'
    ) {
      if (b.value === -1) return FN('ln', VAR(v));
      return OP('/', OP('^', VAR(v), NUM(b.value + 1)), NUM(b.value + 1));
    }
    // 1/x
    if (
      ast.op === '/' &&
      a.type === 'num' &&
      a.value === 1 &&
      b.type === 'var' &&
      b.name === v
    ) {
      return FN('ln', VAR(v));
    }
  }
  if (ast.type === 'fn' && ast.arg.type === 'var' && ast.arg.name === v) {
    switch (ast.name) {
      case 'sin':
        return NEG(FN('cos', VAR(v)));
      case 'cos':
        return FN('sin', VAR(v));
      case 'exp':
        return FN('exp', VAR(v));
    }
  }
  // Give up: return unevaluated integral marker
  return { type: 'fn', name: 'integral', arg: ast };
}

function containsVar(ast, v) {
  if (!ast) return false;
  if (ast.type === 'var') return ast.name === v;
  if (ast.type === 'num') return false;
  if (ast.type === 'neg') return containsVar(ast.arg, v);
  if (ast.type === 'fn') return containsVar(ast.arg, v);
  if (ast.type === 'op') return containsVar(ast.args[0], v) || containsVar(ast.args[1], v);
  return false;
}

// ---------------------------------------------------------------------------
// Solve (linear, quadratic, cubic)
// ---------------------------------------------------------------------------

export function solve(equation, variable = 'x') {
  let ast;
  if (typeof equation === 'string') ast = parse(equation);
  else ast = clone(equation);

  // Convert equation to polynomial form f(x) = 0
  let poly;
  if (ast.type === 'eq') {
    poly = simplify({
      type: 'op',
      op: '-',
      args: [ast.lhs, ast.rhs],
    });
  } else {
    poly = simplify(ast);
  }

  const coeffs = polyCoefficients(expand(poly), variable);
  if (!coeffs) return [];
  // Strip trailing zero high coefficients
  while (coeffs.length > 1 && coeffs[coeffs.length - 1] === 0) coeffs.pop();
  const degree = coeffs.length - 1;
  if (degree === 0) {
    return coeffs[0] === 0 ? ['all reals'] : [];
  }
  if (degree === 1) {
    // a + bx = 0 -> x = -a/b
    return [-coeffs[0] / coeffs[1]];
  }
  if (degree === 2) {
    // a + bx + cx^2 = 0 -> ax^2+bx+c form: A=coeffs[2], B=coeffs[1], C=coeffs[0]
    const A = coeffs[2];
    const B = coeffs[1];
    const C = coeffs[0];
    const disc = B * B - 4 * A * C;
    if (disc < 0) {
      const re = -B / (2 * A);
      const im = Math.sqrt(-disc) / (2 * A);
      return [
        { re, im },
        { re, im: -im },
      ];
    }
    const s = Math.sqrt(disc);
    return [(-B + s) / (2 * A), (-B - s) / (2 * A)];
  }
  if (degree === 3) {
    // Cubic formula (Cardano)
    const a = coeffs[3];
    const b = coeffs[2];
    const c = coeffs[1];
    const d = coeffs[0];
    return solveCubic(a, b, c, d);
  }
  return [];
}

function polyCoefficients(ast, v) {
  // Returns array of numeric coefficients [c0, c1, c2, ...] if possible
  if (!ast) return [0];
  if (ast.type === 'num') return [ast.value];
  if (ast.type === 'var') {
    if (ast.name === v) return [0, 1];
    return null; // foreign variable
  }
  if (ast.type === 'neg') {
    const c = polyCoefficients(ast.arg, v);
    return c ? c.map((x) => -x) : null;
  }
  if (ast.type === 'op') {
    const [a, b] = ast.args;
    if (ast.op === '+') {
      const ca = polyCoefficients(a, v);
      const cb = polyCoefficients(b, v);
      if (!ca || !cb) return null;
      return polyAdd(ca, cb);
    }
    if (ast.op === '-') {
      const ca = polyCoefficients(a, v);
      const cb = polyCoefficients(b, v);
      if (!ca || !cb) return null;
      return polyAdd(ca, cb.map((x) => -x));
    }
    if (ast.op === '*') {
      const ca = polyCoefficients(a, v);
      const cb = polyCoefficients(b, v);
      if (!ca || !cb) return null;
      return polyMul(ca, cb);
    }
    if (ast.op === '^') {
      if (a.type === 'var' && a.name === v && b.type === 'num' && Number.isInteger(b.value) && b.value >= 0) {
        const res = new Array(b.value + 1).fill(0);
        res[b.value] = 1;
        return res;
      }
      const ca = polyCoefficients(a, v);
      if (!ca) return null;
      if (b.type === 'num' && Number.isInteger(b.value) && b.value >= 0) {
        let out = [1];
        for (let k = 0; k < b.value; k++) out = polyMul(out, ca);
        return out;
      }
      return null;
    }
    if (ast.op === '/') {
      const cb = polyCoefficients(b, v);
      if (!cb || cb.length !== 1 || cb[0] === 0) return null;
      const ca = polyCoefficients(a, v);
      if (!ca) return null;
      return ca.map((x) => x / cb[0]);
    }
  }
  return null;
}

function polyAdd(a, b) {
  const n = Math.max(a.length, b.length);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) out[i] = (a[i] || 0) + (b[i] || 0);
  return out;
}

function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      out[i + j] += a[i] * b[j];
    }
  }
  return out;
}

function solveCubic(a, b, c, d) {
  // Depressed cubic substitution: x = t - b/(3a)
  const p = (3 * a * c - b * b) / (3 * a * a);
  const q = (2 * b * b * b - 9 * a * b * c + 27 * a * a * d) / (27 * a * a * a);
  const disc = (q * q) / 4 + (p * p * p) / 27;
  const shift = -b / (3 * a);
  const roots = [];
  if (disc > 0) {
    const sq = Math.sqrt(disc);
    const u = Math.cbrt(-q / 2 + sq);
    const v = Math.cbrt(-q / 2 - sq);
    roots.push(u + v + shift);
    // Complex conjugate pair
    const re = -(u + v) / 2 + shift;
    const im = ((u - v) * Math.sqrt(3)) / 2;
    roots.push({ re, im });
    roots.push({ re, im: -im });
  } else if (disc === 0) {
    const u = Math.cbrt(-q / 2);
    roots.push(2 * u + shift);
    roots.push(-u + shift);
  } else {
    const r = Math.sqrt(-(p * p * p) / 27);
    const phi = Math.acos(-q / (2 * r));
    const m = 2 * Math.cbrt(r);
    for (let k = 0; k < 3; k++) {
      roots.push(m * Math.cos((phi + 2 * Math.PI * k) / 3) + shift);
    }
  }
  return roots;
}

// ---------------------------------------------------------------------------
// Substitute
// ---------------------------------------------------------------------------

export function substitute(expression, variable, replacement) {
  const ast = typeof expression === 'string' ? parse(expression) : clone(expression);
  const rep =
    typeof replacement === 'number'
      ? NUM(replacement)
      : typeof replacement === 'string'
        ? parse(replacement)
        : clone(replacement);
  return simplify(subst(ast, variable, rep));
}

function subst(ast, v, rep) {
  if (!ast) return ast;
  if (ast.type === 'var') return ast.name === v ? clone(rep) : ast;
  if (ast.type === 'num') return ast;
  if (ast.type === 'neg') return NEG(subst(ast.arg, v, rep));
  if (ast.type === 'fn') return FN(ast.name, subst(ast.arg, v, rep));
  if (ast.type === 'op') return OP(ast.op, subst(ast.args[0], v, rep), subst(ast.args[1], v, rep));
  if (ast.type === 'eq') return { type: 'eq', lhs: subst(ast.lhs, v, rep), rhs: subst(ast.rhs, v, rep) };
  return ast;
}

// ---------------------------------------------------------------------------
// Evaluate
// ---------------------------------------------------------------------------

export function evaluate(expression, assignment = {}) {
  const ast = typeof expression === 'string' ? parse(expression) : expression;
  return evalAst(ast, assignment);
}

function evalAst(ast, env) {
  if (!ast) return 0;
  switch (ast.type) {
    case 'num':
      return ast.value;
    case 'var':
      if (!(ast.name in env)) throw new Error(`symbolic-math: unbound variable ${ast.name}`);
      return env[ast.name];
    case 'neg':
      return -evalAst(ast.arg, env);
    case 'fn': {
      const a = evalAst(ast.arg, env);
      switch (ast.name) {
        case 'sin':
          return Math.sin(a);
        case 'cos':
          return Math.cos(a);
        case 'tan':
          return Math.tan(a);
        case 'ln':
          return Math.log(a);
        case 'log':
          return Math.log(a);
        case 'exp':
          return Math.exp(a);
        case 'sqrt':
          return Math.sqrt(a);
      }
      return NaN;
    }
    case 'op': {
      const a = evalAst(ast.args[0], env);
      const b = evalAst(ast.args[1], env);
      switch (ast.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return a / b;
        case '^':
          return Math.pow(a, b);
      }
      return NaN;
    }
  }
  return NaN;
}

// ---------------------------------------------------------------------------
// Free variables
// ---------------------------------------------------------------------------

export function getVariables(expression) {
  const ast = typeof expression === 'string' ? parse(expression) : expression;
  const seen = new Set();
  collectVars(ast, seen);
  return Array.from(seen).sort();
}

function collectVars(ast, out) {
  if (!ast) return;
  if (ast.type === 'var') out.add(ast.name);
  else if (ast.type === 'neg') collectVars(ast.arg, out);
  else if (ast.type === 'fn') collectVars(ast.arg, out);
  else if (ast.type === 'op') {
    collectVars(ast.args[0], out);
    collectVars(ast.args[1], out);
  } else if (ast.type === 'eq') {
    collectVars(ast.lhs, out);
    collectVars(ast.rhs, out);
  }
}
