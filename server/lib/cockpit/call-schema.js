// Schemas for the one-call-per-step model turn (CKPT-04).
const DROP_KEYS = new Set(["oneOf", "anyOf", "allOf", "$ref", "pattern", "format"]);

/** Phase 1 schema: pick a tool. */
export function pickSchema(menuIds) {
  return {
    type: "object", additionalProperties: false, required: ["tool", "why"],
    properties: { tool: { type: "string", enum: [...menuIds, "ask_user", "done"] }, why: { type: "string" } },
  };
}

export const ASK_USER_SCHEMA = { type: "object", additionalProperties: false, required: ["question"], properties: { question: { type: "string" } } };
export const DONE_SCHEMA = { type: "object", additionalProperties: false, required: ["summary"], properties: { summary: { type: "string" } } };

function clean(node) {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (DROP_KEYS.has(k)) continue;
    out[k] = clean(v);
  }
  if ((out.minimum !== undefined || out.maximum !== undefined) && out.type !== "integer") {
    delete out.minimum; delete out.maximum;
  }
  return out;
}

/**
 * Phase 2 schema: the tool's own input schema, with keys llama.cpp silently
 * skips removed. Strictness (`additionalProperties:false`) is kept as given.
 */
export function fillSchema(spec) {
  const base = spec && spec.inputSchema ? spec.inputSchema : { type: "object", properties: {} };
  return clean(JSON.parse(JSON.stringify(base)));
}

export const safeName = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "_");

/** Native tool list for strict providers. */
export function nativeTools(menu, provider) {
  return menu.map((m) => {
    const strict = m.inputSchema?.additionalProperties === false;
    if (provider === "anthropic") {
      return { name: safeName(m.id), description: m.description, input_schema: m.inputSchema, strict };
    }
    return { type: "function", function: { name: safeName(m.id), description: m.description, parameters: m.inputSchema, strict } };
  });
}
