// server/lib/conkay/knowledge/json-schema-lite.js
//
// A small, dependency-free validator for the subset of JSON Schema the
// knowledge-layer schemas use: type (incl. type arrays and "integer"), const,
// enum, required, properties, additionalProperties (false or a schema),
// items, minItems, uniqueItems, minLength, pattern, minimum, maximum, anyOf,
// and local $ref ("#/$defs/name"). The schemas stay plain JSON Schema so other
// tools can read them; this file only enforces them. Unsupported keywords
// throw, so a schema can't silently ask for a check that isn't made.

const SUPPORTED = new Set([
  "$schema", "$id", "$defs", "$ref", "$comment", "title", "description", "default", "examples",
  "type", "const", "enum", "required", "properties", "additionalProperties", "items",
  "minItems", "uniqueItems", "minLength", "pattern", "minimum", "maximum", "anyOf",
]);

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(v, t) {
  const actual = typeOf(v);
  if (t === "number") return actual === "number" || actual === "integer";
  return actual === t;
}

function resolveRef(root, ref) {
  const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
  if (!m || !root.$defs || !root.$defs[m[1]]) throw new Error(`unresolvable $ref ${ref}`);
  return root.$defs[m[1]];
}

function check(schema, v, path, root, errors) {
  for (const k of Object.keys(schema)) if (!SUPPORTED.has(k)) throw new Error(`json-schema-lite: unsupported keyword "${k}" at ${path}`);
  if (schema.$ref) { check(resolveRef(root, schema.$ref), v, path, root, errors); return; }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(v, t))) { errors.push(`${path}: expected ${types.join(" or ")}, got ${typeOf(v)}`); return; }
  }
  if ("const" in schema && v !== schema.const) errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(v)) errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")} (got ${JSON.stringify(v)})`);
  if (schema.anyOf) {
    const ok = schema.anyOf.some((s) => { const e = []; check(s, v, path, root, e); return e.length === 0; });
    if (!ok) errors.push(`${path}: does not match any allowed shape`);
  }
  const t = typeOf(v);
  if (t === "string") {
    if (schema.minLength != null && v.length < schema.minLength) errors.push(`${path}: must be at least ${schema.minLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(v)) errors.push(`${path}: does not match ${schema.pattern}`);
  }
  if (t === "number" || t === "integer") {
    if (schema.minimum != null && v < schema.minimum) errors.push(`${path}: must be ≥ ${schema.minimum}`);
    if (schema.maximum != null && v > schema.maximum) errors.push(`${path}: must be ≤ ${schema.maximum}`);
  }
  if (t === "array") {
    if (schema.minItems != null && v.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} item(s)`);
    if (schema.uniqueItems) {
      const seen = new Set(v.map((x) => JSON.stringify(x)));
      if (seen.size !== v.length) errors.push(`${path}: items must be unique`);
    }
    if (schema.items) v.forEach((x, i) => check(schema.items, x, `${path}[${i}]`, root, errors));
  }
  if (t === "object") {
    for (const r of schema.required || []) if (!(r in v)) errors.push(`${path}: missing required "${r}"`);
    const props = schema.properties || {};
    for (const [k, x] of Object.entries(v)) {
      if (props[k]) check(props[k], x, `${path}.${k}`, root, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property "${k}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") check(schema.additionalProperties, x, `${path}.${k}`, root, errors);
    }
  }
}

/** Validate `value` against `schema`. Returns a list of error strings (empty when valid). */
export function validateAgainst(schema, value, rootPath = "$") {
  const errors = [];
  check(schema, value, rootPath, schema, errors);
  return errors;
}
