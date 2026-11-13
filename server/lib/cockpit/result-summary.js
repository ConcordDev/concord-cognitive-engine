// Flatten a tool result into a few scalar values a later step can use (CKPT-07).
const KEY_RE = /id$|Id$|^id$|title|name|url|count|total|status|result|value|answer|pass|margin|unit|key|date|amount/;
const SECRET_RE = /token|secret|password|cookie|authorization|b64|dataUrl|embedding/i;
export const INSTRUCTION_RE = /ignore (all|previous)|system prompt|you are now|<\/?(system|assistant)>/i;

/** Replace a string that looks like an instruction to a model. */
export function defang(text) {
  return INSTRUCTION_RE.test(String(text)) ? "[removed]" : String(text);
}

function maybeParse(v) {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try { return JSON.parse(t); } catch { return v; }
  }
  return v;
}

/**
 * @param {object|null} result @param {{ tool: string }} [meta]
 * @returns {{ values: Record<string, string|number|boolean>, text: string }}
 */
export function summarizeResult(result, meta = {}) { // eslint-disable-line no-unused-vars
  const values = {};
  if (!result || typeof result !== "object") return { values, text: "" };
  let level = [result];
  for (let depth = 0; depth <= 3 && level.length && Object.keys(values).length < 12; depth++) {
    const next = [];
    for (const node of level) {
      const entries = Array.isArray(node) ? node.slice(0, 5).map((v, i) => [String(i), v]) : Object.entries(node);
      for (const [k, raw] of entries) {
        if (SECRET_RE.test(k)) continue;
        const v = maybeParse(raw);
        if (v && typeof v === "object") { next.push(v); continue; }
        if (!KEY_RE.test(k)) continue;
        if (v === undefined || v === null) continue;
        if (!["string", "number", "boolean"].includes(typeof v)) continue;
        if (Object.prototype.hasOwnProperty.call(values, k)) continue;
        if (Object.keys(values).length >= 12) break;
        values[k] = typeof v === "string" ? defang(v.slice(0, 120)) : v;
      }
    }
    level = next;
  }
  const text = Object.entries(values).map(([k, v]) => `${k}=${v}`).join(", ").slice(0, 600);
  return { values, text };
}
