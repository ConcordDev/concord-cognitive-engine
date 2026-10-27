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
import { lensInputSpec } from "./lens-input-schemas.js";

const SPECS = new Map();

export function rememberLensActionSpec(key, spec) {
  if (!spec || typeof spec !== "object") return;
  if (!spec.paramSchema && !spec.nonEmptyCreate) return;
  SPECS.set(key, spec);
}

export function lensActionSpec(domain, action) {
  // A spec passed at registration wins field-by-field; the shared schema
  // table (lens-input-schemas.js) fills in fields it doesn't cover.
  const own = SPECS.get(`${domain}.${action}`) || null;
  const shared = lensInputSpec(domain, action);
  if (!own || !shared || own === shared) return own || shared;
  return {
    ...own,
    paramSchema: { ...(shared.paramSchema || {}), ...(own.paramSchema || {}) },
    ...(own.nonEmptyCreate || shared.nonEmptyCreate ? { nonEmptyCreate: true } : {}),
  };
}

export function rejectInvalidLensInput(spec, input, ctx) {
  // Global non-finite guard (Infinity / NaN / "1e999"), every action, spec or not.
  const nonFinite = rejectNonFiniteInput(input);
  if (nonFinite) return nonFinite;
  return validateLensActionInput(spec, input, ctx);
}

/** TypeError → invalid_input. Other throws are not rewritten. No message, no stack. */
export function invalidInputFromThrow(err) {
  if (!(err instanceof TypeError)) return null;
  const msg = String(err?.message || "");
  const reason = /\.(?:map|filter|reduce) is not a function/.test(msg) ? "not_a_function" : "type_error";
  return { ok: false, error: "invalid_input", field: null, reason };
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
