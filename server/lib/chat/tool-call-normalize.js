// server/lib/chat/tool-call-normalize.js
//
// Models do not always emit run_lens_action in the schema's exact shape.
// Seen and plausible variants:
//   {"tool":"run_lens_action","params":{"lens":"fitness","actionName":"plan-create"}}
//   {"tool":"run_lens_action","params":{"action":"fitness.plan-create"}}
//   {"tool":"run_lens_action","arguments":"{\"domain\":\"fitness\",\"action\":\"plan-create\"}"}
//   {"tool":"run_lens_action","domain":"fitness","action":"plan-create"}   (no params wrapper)
//   {"tool":"lens.action", ...} / {"tool":"fitness.plan-create", ...}
// Before this, those resolved domain/action to "" or undefined, and the turn
// failed with "No handler for undefined.undefined" or an unknown tool. This
// maps them onto the canonical {domain, action, params} shape. Pure; never throws.

const LENS_TOOL_ALIASES = new Set([
  "run_lens_action", "lens.action", "lens_action", "lensaction", "run_lens", "runlensaction",
  "lens.run", "lens_run", "run_lens_tool", "lens_tool", "use_lens",
]);
const DOMAIN_KEYS = ["domain", "lens", "lensId", "lens_id", "lensName", "lens_name", "domainId", "domain_id", "lensDomain"];
const ACTION_KEYS = ["action", "actionName", "action_name", "actionId", "action_id", "macro", "macroName", "method", "operation", "op", "name"];
const COMBINED_KEYS = ["key", "lensAction", "lens_action", "actionKey", "action_key", "fullAction", "qualified"];
const INPUT_KEYS = ["params", "input", "inputs", "args", "arguments", "payload", "data", "body", "parameters"];
// Fields the tool itself reads beside domain/action/params.
const CONTROL_KEYS = new Set(["dry_run", "preview", "approval", "approval_token", "approvalToken", "idempotency_key"]);

const DOTTED = /^([a-z][\w-]{0,63})\.([\w][\w.-]{0,127})$/i;

function parseMaybeJson(v) {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!(s.startsWith("{") && s.endsWith("}"))) return v;
  try { return JSON.parse(s); } catch { return v; }
}

const str = (v) => (typeof v === "string" ? v.trim() : (typeof v === "number" ? String(v) : ""));

/** Top-level params of any tool call: params, else arguments/args/input (object or JSON string), else stray top-level keys. */
export function normalizeCallParams(parsed) {
  if (!parsed || typeof parsed !== "object") return {};
  for (const k of ["params", "arguments", "args", "input", "parameters"]) {
    const v = parseMaybeJson(parsed[k]);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  }
  const rest = {};
  for (const [k, v] of Object.entries(parsed)) if (!["tool", "name", "raw", "params", "arguments", "args", "input", "parameters"].includes(k)) rest[k] = v;
  return rest;
}

/**
 * Canonical run_lens_action params from whatever the model sent.
 * @returns {{ domain: string, action: string, params: object, [k: string]: unknown }}
 */
export function normalizeLensActionParams(raw) {
  let p = parseMaybeJson(raw);
  if (!p || typeof p !== "object" || Array.isArray(p)) p = {};
  // A nested arguments/args blob that itself carries domain/action.
  for (const k of ["arguments", "args"]) {
    const inner = parseMaybeJson(p[k]);
    if (inner && typeof inner === "object" && !Array.isArray(inner) && (DOMAIN_KEYS.some((d) => inner[d]) || ACTION_KEYS.some((a) => inner[a]))) {
      p = { ...inner, ...Object.fromEntries(Object.entries(p).filter(([kk]) => kk !== k)) };
    }
  }
  const used = new Set();
  let domain = "";
  let action = "";
  for (const k of DOMAIN_KEYS) {
    const v = p[k];
    domain = v && typeof v === "object" ? str(v.id ?? v.name ?? v.domain) : str(v);
    if (domain) { used.add(k); break; }
  }
  for (const k of ACTION_KEYS) {
    action = str(p[k]);
    if (action) { used.add(k); break; }
  }
  let combined = "";
  for (const k of COMBINED_KEYS) { combined = str(p[k]); if (combined) { used.add(k); break; } }
  // "fitness.plan-create" in action, domain or a combined key.
  const split = (s) => { const m = String(s || "").match(DOTTED); return m ? [m[1], m[2]] : null; };
  if (action && !domain) { const s = split(action); if (s) [domain, action] = s; }
  if (domain && !action) { const s = split(domain); if (s) [domain, action] = s; }
  if ((!domain || !action) && combined) { const s = split(combined); if (s) { domain ||= s[0]; action ||= s[1]; } }
  // "fitness" + "fitness.plan-create": drop the repeated domain prefix.
  if (domain && action.toLowerCase().startsWith(`${domain.toLowerCase()}.`)) action = action.slice(domain.length + 1);
  domain = domain.replace(/^lens[:/]/i, "").replace(/\s+lens$/i, "").trim().toLowerCase();

  let input = null;
  for (const k of INPUT_KEYS) {
    const v = parseMaybeJson(p[k]);
    if (v && typeof v === "object" && !Array.isArray(v)) { input = v; break; }
  }
  if (!input) {
    // Flat shape: everything not used for routing is the action's input.
    input = Object.fromEntries(Object.entries(p).filter(([k]) => !used.has(k) && !CONTROL_KEYS.has(k)
      && !DOMAIN_KEYS.includes(k) && !COMBINED_KEYS.includes(k) && !INPUT_KEYS.includes(k)
      && !(ACTION_KEYS.includes(k) && k !== "name")));
  }
  const control = Object.fromEntries(Object.entries(p).filter(([k]) => CONTROL_KEYS.has(k)));
  return { ...control, domain, action, params: input };
}

/**
 * Map a parsed tool call onto canonical tool names and params.
 * @param {{tool: string, params?: object}} call
 * @param {Set<string>|string[]} [knownTools] real tool names (a dotted unknown name becomes run_lens_action)
 */
export function normalizeToolCall(call, knownTools = null) {
  if (!call || typeof call !== "object") return call;
  const rawTool = String(call.tool || "").trim();
  const lower = rawTool.toLowerCase();
  const known = knownTools ? new Set(knownTools) : null;
  let tool = rawTool;
  let params = call.params && typeof call.params === "object" ? call.params : normalizeCallParams(call);
  if (typeof call.params === "string") params = parseMaybeJson(call.params);
  if (LENS_TOOL_ALIASES.has(lower)) {
    tool = "run_lens_action";
  } else if (known && !known.has(rawTool) && DOTTED.test(rawTool)) {
    // {"tool":"fitness.plan-create","params":{...}} — the model named the action as the tool.
    const [, d, a] = rawTool.match(DOTTED);
    tool = "run_lens_action";
    const pp = params && typeof params === "object" ? params : {};
    params = { domain: d, action: a, params: pp.params && typeof pp.params === "object" ? pp.params : pp };
  }
  if (tool === "run_lens_action") params = normalizeLensActionParams(params);
  if (tool === rawTool && params === call.params) return call;
  return { ...call, tool, params, ...(tool !== rawTool ? { aliasOf: rawTool } : {}) };
}

/** The "domain.action" label for a lens call or record, or "" — never "undefined". */
export function lensActionLabel(rec) {
  if (!rec || typeof rec !== "object") return "";
  const d = str(rec.domain) || str(rec.params?.domain);
  const a = str(rec.action) || str(rec.params?.action);
  if (d && a) return `${d}.${a}`;
  const k = str(rec.key);
  return DOTTED.test(k) ? k : (d || a || "");
}

/**
 * The small tool-call record saved with a chat message (and returned to the
 * client). Keeps what a tool card needs to label itself after a reload —
 * domain/action for lens calls, the query/url/title for the others — so a
 * reloaded card never reads "Lens Action undefined.undefined".
 */
export function persistToolCall(t) {
  if (!t || typeof t !== "object") return t;
  const label = t.tool === "run_lens_action" ? lensActionLabel(t) : "";
  const [domain, ...rest] = label.includes(".") ? label.split(".") : [label];
  const action = rest.join(".");
  const params = {};
  if (domain) params.domain = domain;
  if (action) params.action = action;
  for (const k of ["query", "url", "title"]) {
    const v = t.params?.[k] ?? t[k];
    if (typeof v === "string" && v) params[k] = v.slice(0, 300);
  }
  const key = typeof t.key === "string" && t.key ? t.key : (t.params && typeof t.params.key === "string" ? t.params.key : "");
  return {
    tool: t.tool, ok: t.ok !== false,
    ...(Object.keys(params).length ? { params } : { params: {} }),
    ...(key ? { key: key.slice(0, 120) } : {}),
    ...(t.error ? { error: String(t.error).slice(0, 300) } : {}),
  };
}
