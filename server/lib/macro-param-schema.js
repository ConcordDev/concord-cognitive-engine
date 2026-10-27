// server/lib/macro-param-schema.js
//
// Gate D — per-macro param-schema validation (the param-drift bug class).
//
// Several playtest bugs were param-key drift: a macro reads `input.world` but the caller
// sends `input.worldId` (#6/#31), or a required field is missing entirely (#21), and the
// macro either throws deep inside or silently does the wrong thing. register(domain,name,
// fn,spec) already preserves arbitrary spec keys; a macro can now declare
// `spec.paramSchema` and runMacro validates `input` against it BEFORE calling the handler,
// returning a clean { ok:false, error:"param_validation", ... } instead of a 500 / silent
// wrong-thing. Opt-in + additive: a macro with no paramSchema is unaffected.
//
// Lens actions use the same schema through validateLensActionInput. That path refuses
// instead of coercing: a negative money/qty, a non-number, an unknown enum, a calendar-
// impossible date, a non-http(s) URL, an empty create, or a foreign key that does not
// exist in the caller's store. Negative latitudes, longitudes, temperatures, and offsets
// stay legal — only rules that set min, or money/qty (default min 0), refuse a negative.
//
// Schema shape (declarative, no zod dependency):
//   paramSchema: {
//     species_id: { type: "string", required: true },
//     world:      { type: "string" },
//     count:      { type: "number", min: 1, max: 100 },
//     qty:        { type: "number", qty: true },          // min 0 unless min is set
//     amount:     { type: "number", money: true },
//     year:       { type: "int", min: 1, max: 9999 },
//     mode:       { type: "enum", enum: ["a", "b"] },     // refuse, never coerce
//     dueAt:      { type: "isoDate" },                    // real calendar day
//     site:       { type: "url" },                        // http or https only
//     patientId:  { type: "string", fk: { store: "veterinaryLens.patients", owned: true } },
//   }
// spec.nonEmptyCreate refuses {} (and blank-only bodies) before field checks.
//
// Form-friendly flags (used by the compact schemas in lens-input-schemas.js):
//   numericString: true  — "12" / " 3.5 " count as numbers (an <input> value);
//                          "abc" is still expected_number.
//   blankOk: true        — "" counts as "not sent" (an untouched optional field).
//   epochOk: true        — an isoDate field also takes epoch milliseconds.

import { actorId, isAdmin, requireOwner } from "./lens-authz.js";
import { ownValue } from "./own-lookup.js";

const TYPE_CHECK = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  int: (v) => typeof v === "number" && Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  isoDate: (v) => isRealCalendarDate(v),
  url: (v) => isHttpUrl(v),
};

/** YYYY-MM-DD or an ISO datetime whose calendar day exists. Rejects 2026-13-45 and "whenever". */
export function isRealCalendarDate(value) {
  if (typeof value !== "string") return false;
  const s = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** http: or https: only. javascript:, data:, and bare strings are refused. */
export function isHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const NUMERIC_STRING = /^\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?\s*$/;

function dig(root, storePath) {
  if (root == null || typeof storePath !== "string" || !storePath) return undefined;
  let cur = root;
  for (const part of storePath.split(".")) {
    if (cur == null) return undefined;
    if (cur instanceof Map) {
      if (!cur.has(part)) return undefined;
      cur = cur.get(part);
      continue;
    }
    if (typeof cur !== "object") return undefined;
    cur = ownValue(cur, part);
  }
  return cur;
}

function resolveStore(ctx, storePath) {
  const roots = [];
  if (ctx?.state) roots.push(ctx.state);
  const globalState = globalThis._concordSTATE;
  if (globalState && globalState !== ctx?.state) roots.push(globalState);
  for (const root of roots) {
    const found = dig(root, storePath);
    if (found !== undefined) return found;
  }
  return undefined;
}

function recordMatchesId(rec, id) {
  if (!rec || typeof rec !== "object") return false;
  if (rec.id != null && String(rec.id) === id) return true;
  return false;
}

/**
 * fk:{ store, owned }. A Map keyed by userId is the caller's bucket
 * (veterinaryLens.patients). A flat array is matched by id, then
 * requireOwner when owned is set. A miss in someone else's bucket is
 * fk_not_found — the id is not revealed as belonging to another account.
 * Ownership itself is lens-authz requireOwner (admin bypass included).
 */
function checkFk(ctx, fk, raw) {
  const id = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
  if (!id) return "expected_id";
  const storeName = fk && typeof fk === "object" ? fk.store : null;
  if (!storeName) return "fk_not_found";
  const store = resolveStore(ctx, storeName);
  const owned = !!(fk && fk.owned);

  if (store instanceof Map) {
    const uid = actorId(ctx);
    const ownBucket = uid ? store.get(uid) : null;
    const ownHit = Array.isArray(ownBucket) && ownBucket.some((rec) => recordMatchesId(rec, id));
    if (ownHit) return null;
    if (owned && isAdmin(ctx)) {
      for (const bucket of store.values()) {
        if (Array.isArray(bucket) && bucket.some((rec) => recordMatchesId(rec, id))) return null;
      }
    }
    // Unscoped map of id → record (not a per-user bucket).
    if (!owned) {
      if (store.has(id)) return null;
      for (const rec of store.values()) {
        if (recordMatchesId(rec, id)) return null;
      }
    }
    return "fk_not_found";
  }

  if (Array.isArray(store)) {
    const rec = store.find((row) => recordMatchesId(row, id));
    if (!rec) return "fk_not_found";
    if (owned) {
      const owner = rec.userId ?? rec.ownerId ?? rec.createdBy ?? rec.owner ?? null;
      const auth = requireOwner(ctx, owner);
      if (!auth.ok) return "fk_not_owned";
    }
    return null;
  }

  return "fk_not_found";
}

function effectiveMin(rule) {
  if (typeof rule.min === "number") return rule.min;
  if ((rule.money || rule.qty) && (rule.type === "number" || rule.type === "int")) return 0;
  return undefined;
}

/**
 * Validate an input object against a declarative param schema.
 * @returns {{ ok: boolean, errors: Array<{ field:string, reason:string }> }}
 */
export function validateParamSchema(schema, input, ctx) {
  const errors = [];
  if (!schema || typeof schema !== "object") return { ok: true, errors };
  const obj = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  for (const [field, rule] of Object.entries(schema)) {
    if (!rule || typeof rule !== "object") continue;
    const present = obj[field] !== undefined && obj[field] !== null;

    if (!present) {
      if (rule.required) errors.push({ field, reason: "required" });
      continue;
    }

    let val = obj[field];
    if ((rule.type === "isoDate" || rule.type === "url" || rule.blankOk) && typeof val === "string" && val.trim() === "") {
      if (rule.required) errors.push({ field, reason: "required" });
      continue;
    }
    if (rule.numericString && (rule.type === "number" || rule.type === "int") && typeof val === "string" && NUMERIC_STRING.test(val)) {
      val = Number(val);
    }
    if (rule.epochOk && rule.type === "isoDate" && typeof val === "number" && Number.isFinite(val) && val > 0) {
      continue;
    }

    if (rule.type === "enum") {
      const hit = Array.isArray(rule.enum) && (rule.enum.includes(val) ||
        (rule.ci && typeof val === "string" && rule.enum.includes(val.trim().toLowerCase())));
      if (!hit) {
        errors.push({ field, reason: "unknown_enum" });
      }
      continue;
    }

    if (rule.type) {
      const check = TYPE_CHECK[rule.type];
      if (check && !check(val)) {
        errors.push({ field, reason: `expected_${rule.type}` });
        continue;
      }
    }

    if (rule.type === "number" || rule.type === "int") {
      const min = effectiveMin(rule);
      if (typeof min === "number" && val < min) errors.push({ field, reason: `min_${min}` });
      if (typeof rule.max === "number" && val > rule.max) errors.push({ field, reason: `max_${rule.max}` });
    }

    if (rule.type !== "enum" && Array.isArray(rule.enum) && !rule.enum.includes(val)) {
      errors.push({ field, reason: `enum:${rule.enum.join("|")}` });
    }
    if (rule.type === "string" && rule.nonBlank && val.trim() === "") {
      errors.push({ field, reason: "required" });
      continue;
    }
    if (rule.type === "string" && typeof rule.maxLength === "number" && val.length > rule.maxLength) {
      errors.push({ field, reason: `maxLength_${rule.maxLength}` });
    }
    if (rule.fk) {
      const fkReason = checkFk(ctx, rule.fk, val);
      if (fkReason) errors.push({ field, reason: fkReason });
    }
  }

  return { ok: errors.length === 0, errors };
}

function isBlankValue(v) {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

export function isEmptyCreate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return true;
  const keys = Object.keys(input);
  if (keys.length === 0) return true;
  return keys.every((k) => isBlankValue(input[k]));
}

/**
 * Lens-action input gate. Returns null when the body is acceptable, otherwise
 * { ok:false, error:"invalid_input", field, reason } with no stack text.
 */
export function validateLensActionInput(spec, input, ctx) {
  if (!spec || typeof spec !== "object") return null;
  if (spec.nonEmptyCreate && isEmptyCreate(input)) {
    return { ok: false, error: "invalid_input", field: null, reason: "empty_create" };
  }
  if (!spec.paramSchema) return null;
  const pv = validateParamSchema(spec.paramSchema, input, ctx);
  if (pv.ok) return null;
  const first = pv.errors[0] || { field: null, reason: "invalid" };
  return { ok: false, error: "invalid_input", field: first.field, reason: first.reason };
}

export default validateParamSchema;
