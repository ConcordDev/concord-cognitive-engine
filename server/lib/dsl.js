// server/lib/dsl.js
//
// ConKay-as-Builder Phase 7 — the Concord lens/agent DSL. A small, narrow
// language ConKay can read / write / verify that **transpiles to macro calls**
// and executes through an injected `runMacro` (in production, the Phase-2
// confined `ctx.runMacro` — so a DSL program can only reach the macros its
// capability manifest grants; security and "it can build" are the same gate).
//
// Not a general-purpose language by design — it competes with nothing. The
// front end is hand-rolled off the math.js CAS template (tokenizer +
// recursive-descent parser, no deps); the back end tree-walks the AST and calls
// `runMacro(domain, name, input)` for each macro-call node.
//
// Grammar (v1):
//   program := stmt*
//   stmt    := 'let' IDENT '=' expr | 'if' expr block ('else' block)? | expr
//   block   := '{' stmt* '}'
//   expr    := macrocall | member | literal | object | array | '(' expr ')'
//   macrocall := IDENT '.' IDENT '(' expr? ')'   # domain.macro({ k: v, ... })
//   member    := IDENT ('.' IDENT)*              # variable + dot-path
//   object    := '{' (IDENT|STR) ':' expr (',' …)* '}'
//   array     := '[' expr (',' …)* ']'
//   literal   := STRING | NUMBER | 'true' | 'false' | 'null'

export class DslError extends Error {
  constructor(message, meta) { super(message); this.name = "DslError"; this.meta = meta; }
}

const KEYWORDS = new Set(["let", "if", "else", "true", "false", "null"]);
const PUNC = new Set(["{", "}", "[", "]", "(", ")", ",", ":", ".", "=", "|"]);

// ── Lexer (adapted from math.js casTokenize) ────────────────────────────────
export function tokenize(src) {
  const s = String(src ?? "");
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
    if (ch === "#") { while (i < s.length && s[i] !== "\n") i++; continue; } // line comment
    if (ch === '"' || ch === "'") {
      const q = ch; i++; let str = "";
      while (i < s.length && s[i] !== q) {
        if (s[i] === "\\") { str += s[i + 1] ?? ""; i += 2; } else str += s[i++];
      }
      if (s[i] !== q) throw new DslError(`Unterminated string at ${i}`);
      i++; toks.push({ t: "str", v: str }); continue;
    }
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(s[i + 1] || ""))) {
      let num = s[i++]; while (i < s.length && /[0-9.]/.test(s[i])) num += s[i++];
      toks.push({ t: "num", v: parseFloat(num) }); continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let id = ""; while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) id += s[i++];
      toks.push({ t: KEYWORDS.has(id) ? "kw" : "ident", v: id }); continue;
    }
    if (PUNC.has(ch)) { toks.push({ t: "punc", v: ch }); i++; continue; }
    throw new DslError(`Unexpected character '${ch}' at ${i}`);
  }
  toks.push({ t: "eof", v: null });
  return toks;
}

// ── Parser (recursive descent) ──────────────────────────────────────────────
export function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isPunc = (v) => peek().t === "punc" && peek().v === v;
  const isKw = (v) => peek().t === "kw" && peek().v === v;
  const eatPunc = (v) => { if (!isPunc(v)) throw new DslError(`Expected '${v}' but got '${peek().v}'`); next(); };
  const identOrKw = () => { const t = peek(); if (t.t === "ident" || t.t === "kw") { next(); return t.v; } throw new DslError(`Expected identifier, got '${t.v}'`); };

  function program() {
    const body = [];
    while (peek().t !== "eof") body.push(stmt());
    return { type: "Program", body };
  }
  function stmt() {
    if (isKw("let")) { next(); if (peek().t !== "ident") throw new DslError("Expected name after 'let'"); const name = next().v; eatPunc("="); return { type: "Let", name, value: expr() }; }
    if (isKw("if")) { next(); const cond = expr(); const cons = block(); let alt = null; if (isKw("else")) { next(); alt = block(); } return { type: "If", cond, cons, alt }; }
    return { type: "ExprStmt", expr: expr() };
  }
  function block() {
    eatPunc("{"); const body = [];
    while (!isPunc("}") && peek().t !== "eof") body.push(stmt());
    eatPunc("}"); return body;
  }
  function expr() {
    const tok = peek();
    if (tok.t === "ident") {
      const parts = [next().v];
      while (isPunc(".")) { next(); parts.push(identOrKw()); }
      // `domain.macro( input )` (exactly 2 parts + parens) is a macro call. Using
      // call syntax keeps `if cond { block }` + object literals unambiguous.
      if (parts.length === 2 && isPunc("(")) {
        next();
        const input = isPunc(")") ? { type: "Object", props: {} } : expr();
        eatPunc(")");
        return { type: "MacroCall", domain: parts[0], name: parts[1], input };
      }
      // otherwise a variable + dot-path member access.
      let node = { type: "Var", name: parts[0] };
      for (let k = 1; k < parts.length; k++) node = { type: "Member", object: node, prop: parts[k] };
      return node;
    }
    if (tok.t === "str") { next(); return { type: "Literal", value: tok.v }; }
    if (tok.t === "num") { next(); return { type: "Literal", value: tok.v }; }
    if (isKw("true")) { next(); return { type: "Literal", value: true }; }
    if (isKw("false")) { next(); return { type: "Literal", value: false }; }
    if (isKw("null")) { next(); return { type: "Literal", value: null }; }
    if (isPunc("{")) return object();
    if (isPunc("[")) return array();
    if (isPunc("(")) { next(); const e = expr(); eatPunc(")"); return e; }
    throw new DslError(`Unexpected token '${tok.v}'`);
  }
  function object() {
    eatPunc("{"); const props = {};
    while (!isPunc("}")) {
      const key = peek().t === "str" ? next().v : identOrKw();
      eatPunc(":"); props[key] = expr();
      if (isPunc(",")) next();
    }
    eatPunc("}"); return { type: "Object", props };
  }
  function array() {
    eatPunc("["); const items = [];
    while (!isPunc("]")) { items.push(expr()); if (isPunc(",")) next(); }
    eatPunc("]"); return { type: "Array", items };
  }
  const ast = program();
  if (peek().t !== "eof") throw new DslError(`Unexpected trailing token '${peek().v}'`);
  return ast;
}

// ── Interpreter (tree-walk → runMacro) ──────────────────────────────────────
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

export async function execute(ast, { runMacro, env = new Map(), maxCalls = 100 } = {}) {
  if (typeof runMacro !== "function") throw new DslError("execute: runMacro required");
  const trace = [];

  async function evalExpr(node) {
    switch (node.type) {
      case "Literal": return node.value;
      case "Var": {
        if (!env.has(node.name)) throw new DslError(`undefined variable '${node.name}'`);
        return env.get(node.name);
      }
      case "Member": {
        const base = await evalExpr(node.object);
        return base == null ? undefined : base[node.prop];
      }
      case "Object": {
        const o = {};
        for (const k of Object.keys(node.props)) o[k] = await evalExpr(node.props[k]);
        return o;
      }
      case "Array": {
        const a = [];
        for (const it of node.items) a.push(await evalExpr(it));
        return a;
      }
      case "MacroCall": {
        if (trace.length >= maxCalls) throw new DslError(`macro-call budget (${maxCalls}) exceeded`);
        const input = await evalExpr(node.input);
        const res = await runMacro(node.domain, node.name, input);
        const ok = !(res && res.ok === false);
        trace.push({ domain: node.domain, name: node.name, ok });
        if (!ok) {
          // A denied/failed macro call HALTS the program — the sandbox boundary
          // (capability_denied from the confined ctx) surfaces here.
          throw new DslError(`macro '${node.domain}.${node.name}' rejected: ${res.error || res.reason || "failed"}`, { res });
        }
        return res && typeof res === "object" && "result" in res ? res.result : res;
      }
      default:
        throw new DslError(`cannot evaluate node '${node.type}'`);
    }
  }

  async function runStmts(stmts) {
    let last;
    for (const st of stmts) {
      if (st.type === "Let") env.set(st.name, await evalExpr(st.value));
      else if (st.type === "If") {
        if (truthy(await evalExpr(st.cond))) await runStmts(st.cons);
        else if (st.alt) await runStmts(st.alt);
      } else if (st.type === "ExprStmt") last = await evalExpr(st.expr);
    }
    return last;
  }

  const result = await runStmts(ast.body);
  return { result, env, trace };
}

/**
 * Parse + execute a Concord DSL program. Never throws — returns a clean envelope
 * { ok, result?, error?, trace, env? }. Pass the Phase-2 confined `runMacro` to
 * confine the program to its capability manifest.
 */
export async function runDsl(src, { runMacro, env, maxCalls } = {}) {
  let ast;
  try { ast = parse(src); }
  catch (e) { return { ok: false, phase: "parse", error: String(e?.message || e), trace: [] }; }
  try {
    const out = await execute(ast, { runMacro, env: env instanceof Map ? env : new Map(Object.entries(env || {})), maxCalls });
    return { ok: true, result: out.result, trace: out.trace, env: Object.fromEntries(out.env) };
  } catch (e) {
    return { ok: false, phase: "runtime", error: String(e?.message || e), trace: e?.meta?.trace || [] };
  }
}

export default { tokenize, parse, execute, runDsl, DslError };
