// server/lib/lens-action-dispatch.js
//
// Opt-in spec for registerLensAction(domain, action, handler, spec).
// /api/lens/run, lens.run, the MCP mirror, and the test dispatcher call
// invokeLensHandler, which refuses a bad body BEFORE the handler and turns
// a handler TypeError (`.map is not a function` and the rest) into
// { ok:false, error:"invalid_input" } with no stack text.
//
// Specs are remembered only when they carry paramSchema or nonEmptyCreate,
// so a later register that omits a spec cannot wipe one already stored.

import { validateLensActionInput } from "./macro-param-schema.js";
import { rejectNonFiniteInput } from "./finite-input.js";

const SPECS = new Map();

export function rememberLensActionSpec(key, spec) {
  if (!spec || typeof spec !== "object") return;
  if (!spec.paramSchema && !spec.nonEmptyCreate) return;
  SPECS.set(key, spec);
}

export function lensActionSpec(domain, action) {
  return SPECS.get(`${domain}.${action}`) || null;
}

export function rejectInvalidLensInput(spec, input, ctx) {
  // Global non-finite guard (Infinity / NaN / "1e999"), every action, spec or not.
  const nonFinite = rejectNonFiniteInput(input);
  if (nonFinite) return nonFinite;
  return validateLensActionInput(spec, input, ctx);
}

/**
 * Wrong-typed caller input → invalid_input. Other throws are not rewritten.
 * No message and no stack: the harness treats "is not a function" /
 * "Cannot read properties" / "handler_error" as a crash.
 */
export function invalidInputFromThrow(err) {
  const msg = String(err?.message || "");
  if (err instanceof RangeError && /Invalid time value/.test(msg)) {
    return { ok: false, error: "invalid_input", field: null, reason: "invalid_time" };
  }
  if (!(err instanceof TypeError)) return null;
  const collection = /\.(?:map|filter|reduce|find|sort|slice|flatMap|forEach|join|split|some|every) is not a function/.test(msg)
    || /is not iterable/.test(msg)
    || /slice\.map is not a function/.test(msg);
  const reason = collection ? "not_a_function" : "type_error";
  return { ok: false, error: "invalid_input", field: null, reason };
}

/** Catch-block envelope: type/time mistakes are invalid_input; everything else stays handler_error. */
export function handlerFailure(err) {
  const typed = invalidInputFromThrow(err);
  if (typed) return typed;
  return { ok: false, error: "handler_error", message: String(err?.message || err) };
}

export async function invokeLensHandler(handler, ctx, artifact, input, spec) {
  const rejected = rejectInvalidLensInput(spec, input, ctx);
  if (rejected) return rejected;
  try {
    return await handler(ctx, artifact, input ?? {});
  } catch (err) {
    const typed = invalidInputFromThrow(err);
    if (typed) return typed;
    throw err;
  }
}
