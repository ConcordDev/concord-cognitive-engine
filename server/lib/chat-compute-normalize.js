// server/lib/chat-compute-normalize.js
//
// Compute-don't-guess for chat. A small model often (a) emits a compute call
// as bare JSON — {"key":"multiply","input":{"a":1234,"b":5678}} — with no
// [TOOL_CALL] wrapper, (b) invents keys like "multiply" that aren't
// "module.function", and (c) guesses the number itself (a QA run got
// 7,031,242 for 1234*5678; the true value is 7,006,652). These helpers turn
// those shapes into a real deterministic call (lib/compute symbolic.evaluate)
// and let chat.respond compute a plain arithmetic question itself when the
// model called no tool. Pinned by tests/chat-compute-normalize.test.js.

const OP_ALIASES = {
  multiply: "*", times: "*", product: "*", mul: "*",
  add: "+", plus: "+", sum: "+",
  subtract: "-", minus: "-", difference: "-", sub: "-",
  divide: "/", quotient: "/", div: "/",
  pow: "^", power: "^", exponent: "^",
};
const EVAL_ALIASES = new Set(["evaluate", "calculate", "calc", "arithmetic", "math", "compute", "eval", "math.evaluate", "math.calculate"]);

const num = (v) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()));
const SAFE_EXPR = /^[\d\s+\-*/^().%]+$/;

/**
 * Map a model-issued compute call onto a real one. Returns
 * { key, input, expression? } — expression set when the target is
 * symbolic.evaluate (which takes a string, not an object).
 */
export function normalizeComputeCall(key, input = {}) {
  const k = String(key || "").trim();
  const lower = k.toLowerCase();
  const inp = input && typeof input === "object" ? input : {};
  const expr = typeof inp.expression === "string" ? inp.expression
    : typeof inp.expr === "string" ? inp.expr : null;

  const op = OP_ALIASES[lower] || OP_ALIASES[lower.split(".").pop()];
  if (op) {
    const vals = Array.isArray(inp.values) ? inp.values
      : Array.isArray(inp.numbers) ? inp.numbers
        : [inp.a ?? inp.x ?? inp.left, inp.b ?? inp.y ?? inp.right];
    if (vals.length >= 2 && vals.every(num)) {
      return { key: "symbolic.evaluate", input: inp, expression: vals.map((v) => `(${String(v).trim()})`).join(op) };
    }
  }
  // Empty/undotted key with an expression is still a calculation.
  if ((EVAL_ALIASES.has(lower) || lower === "symbolic.evaluate" || !lower.includes(".")) && expr) {
    return { key: "symbolic.evaluate", input: inp, expression: expr };
  }
  return { key: k, input: inp };
}

/**
 * Pull a plain arithmetic expression out of a user's message ("what is
 * 1234 * 5678?", "calculate (2+3)^2/5"). Only digits/operators/parens — never
 * variables — and it must contain an operator between two numbers.
 * Returns the expression string or null.
 */
export function extractArithmetic(text) {
  const s = String(text || "")
    .replace(/\bto the power of\b/gi, "^").replace(/\bmultiplied by\b|\btimes\b/gi, "*")
    .replace(/\bdivided by\b|\bover\b(?=\s*\d)/gi, "/").replace(/\bplus\b/gi, "+").replace(/\bminus\b/gi, "-")
    .replace(/[×x](?=\s*\d)/gi, "*").replace(/÷/g, "/").replace(/,(?=\d{3}\b)/g, "");
  const candidates = s.match(/[\d(][\d\s+\-*/^().%]*[\d)]/g) || [];
  // Dates (2026-09-27), ranges (3-5) and phone numbers are "digits and
  // hyphens" too — a minus-only expression needs an explicit math cue.
  const mathCue = /\b(what(?:'?s| is)|calculate|compute|evaluate|solve|how much is|minus|subtract|plus|times|divided|multiply|equals?)\b|=\s*\?/i.test(String(text || ""));
  let best = null;
  for (const c of candidates) {
    const e = c.trim();
    if (!SAFE_EXPR.test(e)) continue;
    if (!/\d\s*[+\-*/^%]\s*[(\d]/.test(e)) continue;
    const onlyMinus = !/[+*/^%]/.test(e);
    if (onlyMinus && !mathCue) continue;
    if (!best || e.length > best.length) best = e;
  }
  return best;
}

/** "1234 * 5678 = 7,006,652" — a deterministic answer line for arithmetic. */
export function formatArithmeticAnswer(expression, value) {
  const shown = String(expression).replace(/\*/g, "×").replace(/\s+/g, " ").trim();
  const v = typeof value === "number" && Number.isFinite(value)
    ? (Number.isInteger(value) ? value.toLocaleString("en-US") : Number(value.toPrecision(12)).toString())
    : String(value);
  return `${shown} = ${v}`;
}

/**
 * The whole message is ASKING for a calculation — not merely containing one
 * ("explain why 2+2=4 in philosophy" is not). Returns the expression or null.
 */
export function arithmeticQuestion(text) {
  const raw = String(text || "").trim();
  const expr = extractArithmetic(raw);
  if (!expr || raw.length > 160) return null;
  const asks = /^\s*(what(?:'?s| is)|how much is|calculate|compute|evaluate|solve)\b/i.test(raw)
    || /\b(use run_compute|in your head|exactly)\b/i.test(raw);
  const rest = raw.replace(/[^a-z]/gi, " ").replace(/\b(what|whats|is|s|the|how|much|calculate|compute|evaluate|solve|please|plus|minus|times|divided|by|multiplied|to|power|of|over|use|run|don|t|guess|exactly|equals?)\b/gi, "").trim();
  return asks || rest.length === 0 ? expr : null;
}
