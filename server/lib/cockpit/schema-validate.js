// Validator for the strict JSON-schema subset cockpit tool specs use (CKPT-03):
// type, properties, required, enum, items, minimum, maximum, additionalProperties.

function typeOk(type, v) {
  switch (type) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    case "object": return v !== null && typeof v === "object" && !Array.isArray(v);
    case "array": return Array.isArray(v);
    default: return true;
  }
}

function join(path, key) {
  return path ? `${path}.${key}` : String(key);
}

/**
 * @returns {{ ok: boolean, errors: Array<{ path: string, code: "missing"|"type"|"enum"|"range"|"extra", expected?: string, allowed?: any[] }> }}
 */
export function validateAgainstSchema(schema, value, path = "") {
  const errors = [];
  walk(schema, value, path, errors);
  return { ok: errors.length === 0, errors };
}

function walk(schema, value, path, errors) {
  if (!schema || typeof schema !== "object") return;
  if (schema.type && !typeOk(schema.type, value)) {
    errors.push({ path, code: "type", expected: schema.type });
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push({ path, code: "enum", allowed: schema.enum });
    return;
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push({ path, code: "range", expected: `>= ${schema.minimum}` });
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push({ path, code: "range", expected: `<= ${schema.maximum}` });
  }
  if (schema.type === "object" && typeOk("object", value)) {
    const props = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (value[key] === undefined || value[key] === null) errors.push({ path: join(path, key), code: "missing" });
    }
    for (const key of Object.keys(value)) {
      if (Object.prototype.hasOwnProperty.call(props, key)) walk(props[key], value[key], join(path, key), errors);
      else if (schema.additionalProperties === false) errors.push({ path: join(path, key), code: "extra" });
    }
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, i) => walk(schema.items, item, `${path}[${i}]`, errors));
  }
}
