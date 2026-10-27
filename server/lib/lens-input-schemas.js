// server/lib/lens-input-schemas.js
//
// One place to look up the input schema for a lens action, and a compact way
// to write one. lens-action-dispatch.lensActionSpec() falls back to
// lensInputSpec() for any action that was registered without its own spec, so
// a schema here applies on /api/lens/run, lens.run and the MCP mirror without
// touching the domain file.
//
// Compact rules (compileRule):
//   "num"            any finite number (signed: lat-like, deltas, offsets)
//   "num>=0"         number, not negative
//   "num:1..9"       number in [1, 9]
//   "int>=0" / "int:0..23"   same, whole numbers only
//   "date"           real calendar date or ISO datetime (epoch ms also ok)
//   "lat" / "lng"    latitude [-90, 90] / longitude [-180, 180]
//   "str!"           required non-blank string
//   ["a", "b"]       enum: anything else is refused, never coerced
// "$empty": true     refuse a create whose body is {} or all blanks
//
// Every compact rule is form-friendly: an optional field may be omitted, null
// or "" (an untouched input), and a number may arrive as a numeric string
// ("12" from an <input>). A present, wrong value is refused with
// { ok:false, error:"invalid_input", field, reason } → HTTP 400.

import { wave1Spec } from "./lens-input-schemas-wave1.js";
import { WAVE2 } from "./lens-input-schemas-wave2.js";

const RANGE = /^(num|int)(?:>=(-?\d+(?:\.\d+)?)|:(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?))?$/;

export function compileRule(rule) {
  // ["~i", ...values] = case-insensitive (the handler lower-cases the value itself).
  if (Array.isArray(rule)) {
    if (rule[0] === "~i") return { type: "enum", enum: rule.slice(1), blankOk: true, ci: true };
    return { type: "enum", enum: rule, blankOk: true };
  }
  if (rule && typeof rule === "object") return rule;
  const r = String(rule).trim();
  if (r === "date") return { type: "isoDate", epochOk: true };
  if (r === "lat") return { type: "number", min: -90, max: 90, numericString: true, blankOk: true };
  if (r === "lng") return { type: "number", min: -180, max: 180, numericString: true, blankOk: true };
  if (r === "str!") return { type: "string", required: true, nonBlank: true };
  const m = RANGE.exec(r);
  if (m) {
    const out = { type: m[1] === "int" ? "int" : "number", numericString: true, blankOk: true };
    if (m[2] !== undefined) out.min = Number(m[2]);
    if (m[3] !== undefined) { out.min = Number(m[3]); out.max = Number(m[4]); }
    return out;
  }
  throw new Error(`lens-input-schemas: unknown rule "${r}"`);
}

export function compileSpec(compact) {
  if (!compact || typeof compact !== "object") return null;
  const paramSchema = {};
  let nonEmptyCreate = false;
  for (const [field, rule] of Object.entries(compact)) {
    if (field === "$empty") { nonEmptyCreate = !!rule; continue; }
    paramSchema[field] = compileRule(rule);
  }
  const spec = {};
  if (Object.keys(paramSchema).length) spec.paramSchema = paramSchema;
  if (nonEmptyCreate) spec.nonEmptyCreate = true;
  return Object.keys(spec).length ? spec : null;
}

const COMPILED = new Map();
for (const [domain, actions] of Object.entries(WAVE2)) {
  for (const [action, compact] of Object.entries(actions)) {
    const spec = compileSpec(compact);
    if (spec) COMPILED.set(`${domain}.${action}`, spec);
  }
}

/** Schema for domain.action, or null. Wave 1 (hand-written) wins over wave 2. */
const MERGED = new Map();

/**
 * Spec for one lens action: the hand-written wave-1 spec, with any wave-2
 * field rules it doesn't already cover layered underneath (wave-1 rules win
 * field-by-field; nonEmptyCreate is OR-ed).
 */
export function lensInputSpec(domain, action) {
  const key = `${domain}.${action}`;
  if (MERGED.has(key)) return MERGED.get(key);
  const w1 = wave1Spec(domain, action) || null;
  const w2 = COMPILED.get(key) || null;
  let out = w1 || w2;
  if (w1 && w2) {
    out = {
      ...w1,
      paramSchema: { ...(w2.paramSchema || {}), ...(w1.paramSchema || {}) },
      ...(w1.nonEmptyCreate || w2.nonEmptyCreate ? { nonEmptyCreate: true } : {}),
    };
  }
  MERGED.set(key, out || null);
  return out || null;
}

export function lensInputSpecKeys() {
  return [...COMPILED.keys()];
}
