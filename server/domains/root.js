// server/domains/root.js
// Domain actions for the root lens — a base-6 "Refusal Algebra" glyph calculator.
// Mirrors server/lib/refusal-algebra/* for the conversion + operation primitives,
// adds a multi-term expression evaluator, bitwise/modular operators, a saved
// computation notebook with history re-load, shareable derivations, a semantic
// glyph-name parser, and a worked-example tutorial.
//
// Persistence lives in globalThis._concordSTATE, keyed per user. Pure-math
// macros (eval / bitwise / glyphLookup / tutorial) hold no state.

import { GLYPHS, GLYPH_TO_DIGIT, GLYPH_NAMES, RADIX_SEPARATOR, NEG_MARKER }
  from "../lib/refusal-algebra/glyphs.js";
import { decimalToRefusalGlyphs, refusalGlyphsToDecimal }
  from "../lib/refusal-algebra/conversion.js";
import { add, subtract, multiply, divide } from "../lib/refusal-algebra/operations.js";

export default function registerRootActions(registerLensAction) {
  // NOTE (2026-06-27): root.js uses the legacy 3-arg registerLensAction(domain,
  // action, (ctx, artifact, params)) convention and is loaded by
  // server/domains/index.js (rootLens in the domainModules array → server.js
  // `domainModules.forEach(mod => mod(registerLensAction))`). It is NOT
  // saved-class — it was already wired via index.js. Do NOT add a canonical-
  // register shim here or rename the param: index.js calls this with the real
  // 3-arg registerLensAction, so a shim would double-wrap the handler params.
  // (The Phase-2 pass kept only the fail-closed numeric guard below.)

  // ─── fail-CLOSED numeric guard ────────────────────────────────────────
  // Reject poisoned numeric inputs (NaN/Infinity/negative/huge/non-numeric)
  // instead of silently clamping them to a default. Mirrors
  // domains/literary.js#badNumericField.
  function badNumericField(input, keys) {
    for (const k of keys) {
      const v = input?.[k];
      if (v === undefined || v === null || v === "") continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
    }
    return null;
  }

  // ─── per-user STATE ───────────────────────────────────────────────────
  function getRootState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.rootLens) STATE.rootLens = {};
    const s = STATE.rootLens;
    if (!(s.computations instanceof Map)) s.computations = new Map(); // userId -> Array<computation>
    if (!(s.shares instanceof Map)) s.shares = new Map();             // shareId -> shared computation
    return s;
  }
  function saveRoot() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const rootId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const rootNow = () => new Date().toISOString();
  const rootActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const rootList = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };

  // ─── shared math helpers ──────────────────────────────────────────────
  function glyphName(g) { return GLYPH_NAMES[g] || "compound"; }

  function safeToGlyph(n) {
    try { return isFinite(n) ? decimalToRefusalGlyphs(n) : "∞"; }
    catch { return "∞"; }
  }

  // ─── 1. Expression evaluator — multi-term, with precedence ─────────────
  // Accepts a string mixing decimal numerals AND glyph tokens, the operators
  // + − * × / ÷ % (modulo), and parentheses. Tokenises, runs shunting-yard
  // to RPN, evaluates, and reports each step with its glyph reading.
  function tokenizeExpression(raw) {
    const tokens = [];
    const s = String(raw || "").trim();
    let i = 0;
    const OPS = { "+": 1, "-": 1, "−": 1, "*": 1, "×": 1, "/": 1, "÷": 1, "%": 1 };
    while (i < s.length) {
      const ch = s[i];
      if (ch === " " || ch === "\t" || ch === "\n") { i += 1; continue; }
      if (ch === "(" || ch === ")") { tokens.push({ kind: "paren", value: ch }); i += 1; continue; }
      if (ch in OPS) { tokens.push({ kind: "op", value: ch === "−" ? "-" : ch === "×" ? "*" : ch === "÷" ? "/" : ch }); i += 1; continue; }
      // decimal number
      if (/[0-9.]/.test(ch)) {
        let num = "";
        while (i < s.length && /[0-9.]/.test(s[i])) { num += s[i]; i += 1; }
        const v = parseFloat(num);
        if (!isFinite(v)) throw new Error(`Invalid number "${num}"`);
        tokens.push({ kind: "num", value: v });
        continue;
      }
      // glyph run (digits + radix), possibly starting with a NEG marker
      if (ch === NEG_MARKER || ch in GLYPH_TO_DIGIT || ch === RADIX_SEPARATOR) {
        let run = "";
        while (i < s.length && (s[i] === NEG_MARKER || s[i] in GLYPH_TO_DIGIT || s[i] === RADIX_SEPARATOR
          || s.slice(i, i + 2) in GLYPH_TO_DIGIT)) {
          if (s.slice(i, i + 2) in GLYPH_TO_DIGIT) { run += s.slice(i, i + 2); i += 2; }
          else { run += s[i]; i += 1; }
        }
        if (!run) throw new Error(`Unrecognised glyph "${ch}"`);
        tokens.push({ kind: "num", value: refusalGlyphsToDecimal(run) });
        continue;
      }
      throw new Error(`Unexpected character "${ch}" at position ${i}`);
    }
    return tokens;
  }

  function toRPN(tokens) {
    const PREC = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2 };
    const output = [];
    const stack = [];
    for (const t of tokens) {
      if (t.kind === "num") { output.push(t); continue; }
      if (t.kind === "op") {
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.kind === "op" && PREC[top.value] >= PREC[t.value]) output.push(stack.pop());
          else break;
        }
        stack.push(t);
        continue;
      }
      if (t.value === "(") { stack.push(t); continue; }
      if (t.value === ")") {
        let matched = false;
        while (stack.length) {
          const top = stack.pop();
          if (top.kind === "paren" && top.value === "(") { matched = true; break; }
          output.push(top);
        }
        if (!matched) throw new Error("Unbalanced parentheses");
      }
    }
    while (stack.length) {
      const top = stack.pop();
      if (top.kind === "paren") throw new Error("Unbalanced parentheses");
      output.push(top);
    }
    return output;
  }

  function evalRPN(rpn) {
    const stack = [];
    const steps = [];
    for (const t of rpn) {
      if (t.kind === "num") { stack.push(t.value); continue; }
      if (stack.length < 2) throw new Error("Malformed expression");
      const b = stack.pop();
      const a = stack.pop();
      let v;
      switch (t.value) {
        case "+": v = a + b; break;
        case "-": v = a - b; break;
        case "*": v = a * b; break;
        case "/": v = b === 0 ? Infinity : a / b; break;
        case "%": v = b === 0 ? NaN : a % b; break;
        default: throw new Error(`Unknown operator "${t.value}"`);
      }
      steps.push({
        op: t.value,
        a, b, decimal: v,
        glyph: safeToGlyph(v),
      });
      stack.push(v);
    }
    if (stack.length !== 1) throw new Error("Malformed expression");
    return { value: stack[0], steps };
  }

  /**
   * evaluate — evaluate a multi-term base-6 / decimal expression.
   *   params.expression: string (required)
   * Returns { decimal, glyph, semantic, steps[], tokenCount }.
   */
  registerLensAction("root", "evaluate", (_ctx, _artifact, params = {}) => {
    const expression = String(params.expression || "").trim();
    if (!expression) return { ok: false, error: "expression is required" };
    try {
      const tokens = tokenizeExpression(expression);
      if (tokens.length === 0) return { ok: false, error: "expression is empty" };
      const rpn = toRPN(tokens);
      const { value, steps } = evalRPN(rpn);
      const glyph = safeToGlyph(value);
      const semantic = !isFinite(value)
        ? "The expression does not resolve to a finite structure"
        : `${expression} resolves to ${glyph} (${glyphName(glyph)}) — a ${steps.length}-step structural transformation`;
      return {
        ok: true,
        result: {
          expression,
          decimal: isFinite(value) ? value : null,
          glyph,
          semantic,
          steps,
          tokenCount: tokens.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── 3. Bitwise / modular operations in the base-6 algebra ─────────────
  /**
   * bitwise — apply a bitwise or modular operator to two operands.
   *   params.a, params.b: decimal numbers or glyph strings
   *   params.op: 'and' | 'or' | 'xor' | 'shl' | 'shr' | 'mod' | 'not'
   * For bitwise ops operands are floored to integers. Returns the result
   * as decimal + glyph, plus the base-6-digit-level rendering.
   */
  registerLensAction("root", "bitwise", (_ctx, _artifact, params = {}) => {
    const op = String(params.op || "").toLowerCase();
    const VALID = ["and", "or", "xor", "shl", "shr", "mod", "not"];
    if (!VALID.includes(op)) {
      return { ok: false, error: `op must be one of: ${VALID.join(", ")}` };
    }
    function coerce(v) {
      if (v == null || v === "") throw new Error("operand is required");
      if (typeof v === "number") return v;
      const str = String(v).trim();
      const asNum = Number(str);
      if (str !== "" && isFinite(asNum) && !/[⟐⟲⊚⸱]/.test(str)) return asNum;
      return refusalGlyphsToDecimal(str);
    }
    try {
      const a = coerce(params.a);
      const b = op === "not" ? 0 : coerce(params.b);
      const ai = Math.trunc(a);
      const bi = Math.trunc(b);
      let dec;
      switch (op) {
        case "and": dec = ai & bi; break;
        case "or": dec = ai | bi; break;
        case "xor": dec = ai ^ bi; break;
        case "shl": dec = ai << bi; break;
        case "shr": dec = ai >> bi; break;
        case "mod": dec = bi === 0 ? NaN : ai % bi; break;
        case "not": dec = ~ai; break;
        default: dec = 0;
      }
      if (!isFinite(dec) || Number.isNaN(dec)) {
        return { ok: false, error: op === "mod" ? "modulo by Refusal (0) is undefined" : "result is non-finite" };
      }
      const glyph = safeToGlyph(dec);
      const SYMS = { and: "∧", or: "∨", xor: "⊕", shl: "≪", shr: "≫", mod: "mod", not: "¬" };
      const semantic = op === "not"
        ? `Inversion of ${glyphName(safeToGlyph(ai))} — every bit pivots; ${glyph} (${glyphName(glyph)}) emerges`
        : op === "mod"
          ? `${glyphName(safeToGlyph(ai))} modulo ${glyphName(safeToGlyph(bi))} — the remainder cycle settles on ${glyphName(glyph)}`
          : `${glyphName(safeToGlyph(ai))} ${SYMS[op]} ${glyphName(safeToGlyph(bi))} produces ${glyphName(glyph)}`;
      return {
        ok: true,
        result: {
          op,
          symbol: SYMS[op],
          a: ai,
          b: op === "not" ? null : bi,
          decimal: dec,
          glyph,
          binary: (dec >>> 0).toString(2),
          base6: (Math.abs(dec)).toString(6),
          semantic,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── 5. Glyph keyboard input mode — type semantic names ───────────────
  /**
   * glyphLookup — translate semantic names (Refusal / Pivot / Bridge / etc.)
   * or base-6 digit numbers into glyph notation. Accepts a single term or a
   * space/comma-separated list.
   *   params.terms: string
   * Returns { tokens: [{ input, glyph, digit, name }], glyphString, decimal }.
   */
  registerLensAction("root", "glyphLookup", (_ctx, _artifact, params = {}) => {
    const raw = String(params.terms || "").trim();
    if (!raw) return { ok: false, error: "terms is required" };
    // name (case/space insensitive) -> glyph
    const nameIndex = {};
    for (const [glyph, name] of Object.entries(GLYPH_NAMES)) {
      nameIndex[name.toLowerCase().replace(/[\s-]/g, "")] = glyph;
    }
    const parts = raw.split(/[\s,]+/).filter(Boolean);
    const tokens = [];
    for (const part of parts) {
      const key = part.toLowerCase().replace(/[\s-]/g, "");
      let glyph = null;
      if (key in nameIndex) glyph = nameIndex[key];
      else if (/^[0-5]$/.test(part)) glyph = GLYPHS[Number(part)];
      else if (part in GLYPH_TO_DIGIT) glyph = part;
      if (!glyph) {
        return { ok: false, error: `"${part}" is not a glyph name or base-6 digit` };
      }
      tokens.push({
        input: part,
        glyph,
        digit: GLYPH_TO_DIGIT[glyph],
        name: glyphName(glyph),
      });
    }
    const glyphString = tokens.map((t) => t.glyph).join("");
    let decimal = null;
    try { decimal = refusalGlyphsToDecimal(glyphString); } catch { decimal = null; }
    return {
      ok: true,
      result: {
        tokens,
        glyphString,
        decimal,
        names: Object.entries(GLYPH_NAMES).map(([glyph, name]) => ({
          glyph, name, digit: GLYPH_TO_DIGIT[glyph],
        })),
      },
    };
  });

  // ─── 6. Algebra tutorial / worked examples ────────────────────────────
  // A deterministic, code-derived set of worked examples. Each example's
  // numbers are computed live from the real conversion/operation primitives
  // so the lesson can never drift from the implementation.
  registerLensAction("root", "tutorial", (_ctx, _artifact, _params = {}) => {
  try {
    const sumRes = add(11, 16);
    const mulRes = multiply(0, 7);
    const subRes = subtract(8, 8);
    const divRes = divide(5, 0);
    const lessons = [
      {
        id: "glyphs",
        title: "The six glyphs",
        body: "Refusal Algebra is base-6. Each digit is a glyph carrying a meaning: "
          + Object.entries(GLYPH_NAMES).map(([g, n]) => `${g} = ${n}`).join(", ") + ".",
        examples: Object.entries(GLYPHS).map(([d, g]) => ({
          input: `digit ${d}`, glyph: g, decimal: Number(d), reading: glyphName(g),
        })),
      },
      {
        id: "conversion",
        title: "Reading a number",
        body: "A decimal number is rewritten as a string of glyphs, most-significant first. "
          + "Each position is a power of 6, exactly like base-10 uses powers of 10.",
        examples: [27, 100, 215].map((n) => ({
          input: String(n), glyph: decimalToRefusalGlyphs(n), decimal: n,
          reading: `${n} = ${decimalToRefusalGlyphs(n)}`,
        })),
      },
      {
        id: "fractions",
        title: "Fractional radix",
        body: `Digits after the radix separator "${RADIX_SEPARATOR}" are negative powers of 6.`,
        examples: [0.5, 1.25].map((n) => ({
          input: String(n), glyph: decimalToRefusalGlyphs(n), decimal: n,
          reading: `${n} = ${decimalToRefusalGlyphs(n)}`,
        })),
      },
      {
        id: "operations",
        title: "Operations and the semantic layer",
        body: "Every arithmetic result also carries a semantic reading — a sentence "
          + "describing the structural transformation in glyph terms.",
        examples: [
          { input: "11 + 16", glyph: sumRes.numerical, decimal: sumRes.decimal, reading: sumRes.semantic },
          { input: "8 − 8", glyph: subRes.numerical, decimal: subRes.decimal, reading: subRes.semantic },
        ],
      },
      {
        id: "refusal-absorbs",
        title: "Refusal absorbs",
        body: "Multiplying by Refusal (0) always returns to Refusal. Dividing by Refusal "
          + "is undefined — the structure cannot resolve.",
        examples: [
          { input: "0 × 7", glyph: mulRes.numerical, decimal: mulRes.decimal, reading: mulRes.semantic },
          { input: "5 ÷ 0", glyph: divRes.numerical, decimal: null, reading: divRes.semantic },
        ],
      },
    ];
    return { ok: true, result: { lessons, lessonCount: lessons.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── 2. Saved computation notebook + history re-load ──────────────────
  /**
   * save — persist a computation so it can later be re-loaded into the
   * playground. Accepts either a two-operand op or a free-form expression.
   *   params.kind: 'operation' | 'expression' | 'bitwise'   (default 'operation')
   *   params.a, params.b, params.op  (operation/bitwise)
   *   params.expression               (expression)
   *   params.label?: string
   */
  registerLensAction("root", "save", (ctx, _artifact, params = {}) => {
  try {
    const s = getRootState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const kind = ["operation", "expression", "bitwise"].includes(params.kind) ? params.kind : "operation";
    let payload;
    let label = String(params.label || "").trim().slice(0, 120);
    if (kind === "expression") {
      const expression = String(params.expression || "").trim();
      if (!expression) return { ok: false, error: "expression is required" };
      payload = { expression };
      if (!label) label = expression;
    } else {
      const opMap = { operation: ["+", "-", "−", "*", "×", "/", "÷"], bitwise: ["and", "or", "xor", "shl", "shr", "mod", "not"] };
      const op = String(params.op || "");
      if (!opMap[kind].includes(op)) return { ok: false, error: `op must be one of: ${opMap[kind].join(", ")}` };
      const a = params.a;
      const b = params.b;
      if (a == null || a === "") return { ok: false, error: "operand a is required" };
      payload = { a, b: b ?? null, op };
      if (!label) label = `${a} ${op} ${b ?? ""}`.trim();
    }
    const entry = {
      id: rootId("rc"),
      kind,
      ...payload,
      label,
      resultGlyph: params.resultGlyph != null ? String(params.resultGlyph) : null,
      resultDecimal: params.resultDecimal != null && isFinite(Number(params.resultDecimal))
        ? Number(params.resultDecimal) : null,
      createdAt: rootNow(),
    };
    rootList(s.computations, rootActor(ctx)).unshift(entry);
    // Cap the per-user notebook to a reasonable size.
    const list = s.computations.get(rootActor(ctx));
    if (list.length > 200) list.length = 200;
    saveRoot();
    return { ok: true, result: { computation: entry, total: list.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * history — list saved computations for the user (most recent first).
   *   params.limit?: number (default 30, max 200)
   *   params.kind?: filter by kind
   */
  registerLensAction("root", "history", (ctx, _artifact, params = {}) => {
    const s = getRootState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const badNum = badNumericField(params, ["limit"]);
    if (badNum) return { ok: false, error: "invalid_limit" };
    let list = [...rootList(s.computations, rootActor(ctx))];
    if (params.kind) list = list.filter((c) => c.kind === String(params.kind));
    const limit = Math.max(1, Math.min(200, parseInt(params.limit, 10) || 30));
    return {
      ok: true,
      result: {
        computations: list.slice(0, limit),
        total: list.length,
      },
    };
  });

  /**
   * reload — fetch a single saved computation by id so the frontend can
   * re-hydrate the playground with its operands/expression.
   *   params.id: string (required)
   */
  registerLensAction("root", "reload", (ctx, _artifact, params = {}) => {
    const s = getRootState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const id = String(params.id || "");
    const entry = rootList(s.computations, rootActor(ctx)).find((c) => c.id === id);
    if (!entry) return { ok: false, error: "computation not found" };
    return { ok: true, result: { computation: entry } };
  });

  /**
   * deleteComputation — remove a saved computation from the notebook.
   *   params.id: string (required)
   */
  registerLensAction("root", "deleteComputation", (ctx, _artifact, params = {}) => {
    const s = getRootState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const list = rootList(s.computations, rootActor(ctx));
    const idx = list.findIndex((c) => c.id === String(params.id || ""));
    if (idx < 0) return { ok: false, error: "computation not found" };
    list.splice(idx, 1);
    saveRoot();
    return { ok: true, result: { deleted: params.id, total: list.length } };
  });

  // ─── 4. Shareable computation link ────────────────────────────────────
  /**
   * share — publish a computation to a public, read-only share registry and
   * return a stable shareId + relative link. The shared snapshot is immutable.
   *   params.kind / a / b / op / expression / resultGlyph / resultDecimal / label
   */
  registerLensAction("root", "share", (ctx, _artifact, params = {}) => {
    const s = getRootState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const kind = ["operation", "expression", "bitwise"].includes(params.kind) ? params.kind : "operation";
    let payload;
    if (kind === "expression") {
      const expression = String(params.expression || "").trim();
      if (!expression) return { ok: false, error: "expression is required" };
      payload = { expression };
    } else {
      const op = String(params.op || "");
      if (!op) return { ok: false, error: "op is required" };
      if (params.a == null || params.a === "") return { ok: false, error: "operand a is required" };
      payload = { a: params.a, b: params.b ?? null, op };
    }
    const shareId = rootId("share");
    const snapshot = {
      shareId,
      kind,
      ...payload,
      label: String(params.label || "").trim().slice(0, 120),
      resultGlyph: params.resultGlyph != null ? String(params.resultGlyph) : null,
      resultDecimal: params.resultDecimal != null && isFinite(Number(params.resultDecimal))
        ? Number(params.resultDecimal) : null,
      sharedBy: rootActor(ctx),
      sharedAt: rootNow(),
    };
    s.shares.set(shareId, snapshot);
    saveRoot();
    return {
      ok: true,
      result: {
        shareId,
        link: `/lenses/root?share=${shareId}`,
        snapshot,
      },
    };
  });

  /**
   * getShare — resolve a shareId to its immutable snapshot. Public-read.
   *   params.shareId: string (required)
   */
  registerLensAction("root", "getShare", (_ctx, _artifact, params = {}) => {
    const s = getRootState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const snapshot = s.shares.get(String(params.shareId || ""));
    if (!snapshot) return { ok: false, error: "share not found" };
    return { ok: true, result: { snapshot } };
  });
}
