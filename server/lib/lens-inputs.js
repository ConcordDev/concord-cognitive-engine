// server/lib/lens-inputs.js
//
// "Unknown stays unknown" helpers for lens compute actions.
//
// Many one-line lens calculators used to fill a missing input with a silent
// constant (`parseFloat(x) || 5`), so an empty form returned a confident but
// invented answer. These helpers let a handler declare which inputs it needs
// and return a NOT_COMPUTED envelope (ok:true so the UI renders it, but no
// numbers) listing `missingInputs` instead of guessing. When every required
// input is supplied, the handler's maths is unchanged.

/**
 * Read required numeric inputs.
 * spec strings: "key" (any finite), "key>0" (strictly positive), "key>=0".
 * @returns {{ values: Record<string, number>, missing: string[] }}
 */
export function needNums(data, specs) {
  const src = data && typeof data === "object" ? data : {};
  const values = {};
  const missing = [];
  for (const spec of specs) {
    const m = /^([^<>=]+?)(>=0|>0)?$/.exec(spec);
    const key = m[1];
    const rule = m[2] || "";
    const raw = src[key];
    const n = raw === null || raw === undefined || raw === "" ? NaN : (typeof raw === "number" ? raw : parseFloat(raw));
    const ok = Number.isFinite(n) && (rule === ">0" ? n > 0 : rule === ">=0" ? n >= 0 : true);
    if (ok) values[key] = n; else missing.push(key);
  }
  return { values, missing };
}

/**
 * Caller-supplied collection.
 * Omitted (null, undefined, "") means an empty list, the same as `value || []`.
 * Any other non-array is the caller's input and is refused by field name,
 * before a `.map` or `for...of` can throw.
 * Returns the array, or `{ ok:false, error:"invalid_input", field, reason:"expected_array" }`.
 */
export function requireList(value, field) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value;
  return { ok: false, error: "invalid_input", field, reason: "expected_array" };
}

/** Optional finite number, or null when absent/invalid (never a silent default). */
export function optNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** NOT_COMPUTED envelope for a lens action that lacks required inputs. */
export function notComputed(missingInputs, message, extra = {}) {
  return {
    ok: true,
    result: {
      status: "NOT_COMPUTED",
      missingInputs: [...missingInputs],
      message: message || `Not computed: missing ${missingInputs.join(", ")}`,
      ...extra,
    },
  };
}

/**
 * Wrap a rule-of-thumb / lookup-table / text-heuristic lens handler so its
 * output is labelled ADVISORY (never a computed or verified verdict).
 * Leaves error and NOT_COMPUTED replies untouched.
 */
export function advisory(basis, fn) {
  const label = (r) => {
    if (!r || r.ok !== true || !r.result || typeof r.result !== "object" || Array.isArray(r.result)) return r;
    if (r.result.status === "NOT_COMPUTED" || r.result.provenance) return r; // sourced results are not advisory
    return { ...r, result: { ...r.result, status: "ADVISORY", verdict: null, advisoryBasis: basis } };
  };
  // Stays synchronous for synchronous handlers (callers/tests read .result directly).
  return function advisoryLensHandler(...args) {
    const r = fn(...args);
    return r && typeof r.then === "function" ? r.then(label) : label(r);
  };
}
