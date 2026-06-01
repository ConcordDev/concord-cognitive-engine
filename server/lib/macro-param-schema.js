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
// Schema shape (declarative, no zod dependency):
//   paramSchema: {
//     species_id: { type: "string", required: true },
//     world:      { type: "string" },
//     count:      { type: "number", min: 1, max: 100 },
//     mode:       { type: "string", enum: ["a", "b"] },
//   }

const TYPE_CHECK = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
};

/**
 * Validate an input object against a declarative param schema.
 * @returns {{ ok: boolean, errors: Array<{ field:string, reason:string }> }}
 */
export function validateParamSchema(schema, input) {
  const errors = [];
  if (!schema || typeof schema !== "object") return { ok: true, errors };
  const obj = input && typeof input === "object" ? input : {};

  for (const [field, rule] of Object.entries(schema)) {
    if (!rule || typeof rule !== "object") continue;
    const present = obj[field] !== undefined && obj[field] !== null;

    if (!present) {
      if (rule.required) errors.push({ field, reason: "required" });
      continue; // optional + absent → fine; no further checks
    }

    const val = obj[field];
    if (rule.type) {
      const check = TYPE_CHECK[rule.type];
      if (check && !check(val)) {
        errors.push({ field, reason: `expected_${rule.type}` });
        continue; // type wrong → skip range/enum (they'd be noise)
      }
    }
    if (rule.type === "number") {
      if (typeof rule.min === "number" && val < rule.min) errors.push({ field, reason: `min_${rule.min}` });
      if (typeof rule.max === "number" && val > rule.max) errors.push({ field, reason: `max_${rule.max}` });
    }
    if (Array.isArray(rule.enum) && !rule.enum.includes(val)) {
      errors.push({ field, reason: `enum:${rule.enum.join("|")}` });
    }
    if (rule.type === "string" && typeof rule.maxLength === "number" && val.length > rule.maxLength) {
      errors.push({ field, reason: `maxLength_${rule.maxLength}` });
    }
  }

  return { ok: errors.length === 0, errors };
}

export default validateParamSchema;
