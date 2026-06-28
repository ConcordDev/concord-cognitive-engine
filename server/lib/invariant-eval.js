// server/lib/invariant-eval.js
//
// Orchestrated Invariant Engine — the shared, SAFE invariant evaluator.
//
// An "invariant" is a JS boolean expression written over two free variables,
// `input` (the macro input object) and `output` (whatever the macro returned).
// Examples:
//   "output.ok === true"
//   "typeof output === 'object' && output !== null"
//   "output.count >= 0 && output.count <= input.limit"
//
// Both the adversarial runner (scripts/macro-assassin.mjs) and a future runtime
// wrapper compile invariants through this module so the semantics are identical
// everywhere. The contract is strict:
//   - `evalInvariant` NEVER throws. A bad expression, a thrown evaluation, or a
//     non-boolean result all resolve to a structured failure ({ ok:false, ... }).
//   - Compilation is cached (compile-once per distinct expression string) so a
//     fuzz loop that evaluates the same invariant thousands of times pays the
//     `new Function` cost once.
//
// SAFETY NOTE: invariant expressions are AUTHORED CONTENT (committed under
// content/contracts/), not user input. They run with whatever `new Function`
// grants — there is no sandbox VM here. This is acceptable because the only
// inputs are repo-controlled. Do NOT wire this evaluator to evaluate
// expressions sourced from end-user requests.

/** @type {Map<string, { fn: Function|null, error: string|null }>} */
const _cache = new Map();

/**
 * Compile (and cache) an invariant expression into a callable
 * (input, output) => any. Compilation failures are cached as { fn:null,error }.
 * @param {string} expr
 * @returns {{ fn: Function|null, error: string|null }}
 */
export function compileInvariant(expr) {
  if (typeof expr !== "string" || expr.trim() === "") {
    return { fn: null, error: "invariant_expr_must_be_nonempty_string" };
  }
  const cached = _cache.get(expr);
  if (cached) return cached;

  let entry;
  try {
    // The expression is wrapped in `return (...)` so authors write a bare
    // boolean expression, not a statement. `"use strict"` keeps the body from
    // leaking implicit globals.
    // eslint-disable-next-line no-new-func
    const fn = new Function("input", "output", `"use strict"; return (${expr});`);
    entry = { fn, error: null };
  } catch (err) {
    entry = { fn: null, error: `compile_error: ${err?.message || String(err)}` };
  }
  _cache.set(expr, entry);
  return entry;
}

/**
 * Evaluate an invariant expression. Never throws.
 *
 * @param {string} expr   - boolean JS expression over (input, output)
 * @param {*} input        - the macro input
 * @param {*} output       - the macro output
 * @returns {{ ok: boolean, value: boolean, reason: string|null }}
 *   - ok:    true  → expression compiled, evaluated, and returned truthy boolean-ish `true`
 *   - ok:    false → compile error, evaluation throw, or a falsy/non-true result
 *   - value: the coerced boolean result (false on any error path)
 *   - reason: null on success, else a short machine-readable cause
 */
export function evalInvariant(expr, input, output) {
  const { fn, error } = compileInvariant(expr);
  if (!fn) {
    return { ok: false, value: false, reason: error || "compile_error" };
  }
  let raw;
  try {
    raw = fn(input, output);
  } catch (err) {
    return { ok: false, value: false, reason: `eval_throw: ${err?.message || String(err)}` };
  }
  // Treat the invariant as satisfied only when it evaluates to a truthy value.
  // A non-boolean truthy (e.g. a number) is tolerated but normalized; a falsy
  // value (including the common `undefined` from a missing field) is a failure.
  const value = Boolean(raw);
  if (!value) {
    return { ok: false, value: false, reason: "invariant_false" };
  }
  return { ok: true, value: true, reason: null };
}

/** Clear the compile cache (test/diagnostic use only). */
export function _clearInvariantCache() {
  _cache.clear();
}

export default evalInvariant;
