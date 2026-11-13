// Turn a wrong-but-close tool call into a valid one in code (CKPT-03), and when
// that fails, return precise errors with the allowed values for one re-ask.
import { closestNames } from "../chat-agent.js";
import { validateAgainstSchema } from "./schema-validate.js";

const CONTROL_KEYS = ["approval", "approval_token", "approvalToken", "idempotency_key", "dry_run", "preview"];

const KEY_ALIASES = {
  q: "query", search: "query", term: "query", text: "query",
  link: "url", href: "url", expression: "input", fn: "key", function: "key",
  name: "title", lens: "domain", actionname: "action",
  args: "params", arguments: "params", input: "params",
};

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

function levenshtein(a, b) {
  a = String(a); b = String(b);
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function reaskText(errors) {
  return "Your call was not valid.\n" +
    errors.map((e) => `- ${e.path}: ${e.code}` +
      (e.expected ? ` (expected ${e.expected})` : "") +
      (e.allowed ? ` (allowed: ${e.allowed.slice(0, 25).join(", ")})` : "")).join("\n") +
    "\nSend the call again with only these problems fixed.";
}

function stripControl(obj) {
  if (!obj || typeof obj !== "object") return;
  for (const k of CONTROL_KEYS) delete obj[k];
}

/**
 * @param {{ tool: string, args: object }} call
 * @param {{ menuIds: string[], getSpec: (id:string)=>object|null, prior?: Array<{values:object}>, hints?: object }} ctx
 */
export function validateAndRepair(call, ctx) {
  const repairs = [];
  const c = { tool: String(call?.tool || ""), args: { ...(call?.args || {}) } };
  const snap = () => JSON.stringify({ tool: c.tool, args: c.args });
  const note = (kind, before, errors = []) => {
    repairs.push({ n: repairs.length + 1, kind, before, after: snap(), errors, fixed: true });
  };
  const menu = Array.isArray(ctx.menuIds) ? ctx.menuIds : [];

  // 1. Strip control keys (hygiene; CKPT-13 relies on it).
  stripControl(c.args);
  if (c.args.params && typeof c.args.params === "object") {
    c.args.params = { ...c.args.params };
    stripControl(c.args.params);
  }

  // 2. Alias.
  if (!menu.includes(c.tool)) {
    const lower = c.tool.toLowerCase();
    for (const id of menu) {
      const s = ctx.getSpec(id);
      if (s && Array.isArray(s.aliases) && s.aliases.includes(lower)) {
        const before = snap(); c.tool = id; note("alias", before); break;
      }
    }
  }
  // 3. Lens shorthand.
  if (!menu.includes(c.tool) && /^[a-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(c.tool) && menu.includes(`lens:${c.tool}`)) {
    const before = snap(); c.tool = `lens:${c.tool}`; note("alias", before);
  }
  // 4. Fuzzy name.
  if (!menu.includes(c.tool) && c.tool) {
    const [best] = closestNames(c.tool, menu, 1);
    if (best && (levenshtein(best, c.tool) <= 2 || best.includes(c.tool) || c.tool.includes(best.replace(/^lens:/, "")))) {
      const before = snap(); c.tool = best; note("fuzzy_name", before);
    }
  }
  // 5. Still unknown.
  if (!menu.includes(c.tool)) {
    const errors = [{ path: "tool", code: "enum", allowed: menu }];
    return { ok: false, call: c, repairs, errors, reask: reaskText(errors) };
  }

  const spec = ctx.getSpec(c.tool);
  const schema = spec?.inputSchema || {};
  const props = schema.properties || {};

  // 7. Key normalize.
  if (c.tool === "run_compute" && c.args.input === undefined && typeof c.args.expression === "string") {
    const before = snap();
    c.args.input = { expression: c.args.expression };
    delete c.args.expression;
    note("key_normalize", before);
  }
  for (const k of Object.keys(c.args)) {
    if (Object.prototype.hasOwnProperty.call(props, k)) continue;
    if (c.tool === "run_compute" && norm(k) === "expression") continue;
    let target = Object.keys(props).find((p) => norm(p) === norm(k));
    if (!target) {
      const aliased = KEY_ALIASES[norm(k)];
      if (aliased && Object.prototype.hasOwnProperty.call(props, aliased)) target = aliased;
    }
    if (target && c.args[target] === undefined) {
      const before = snap();
      c.args[target] = c.args[k];
      delete c.args[k];
      note("key_normalize", before);
    }
  }

  // 8. Coerce.
  for (const [k, def] of Object.entries(props)) {
    if (c.args[k] === undefined || !def || !def.type) continue;
    const v = c.args[k];
    let next = v;
    if ((def.type === "number" || def.type === "integer") && typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) next = Number(v.trim());
    else if (def.type === "boolean" && (v === "true" || v === "false")) next = v === "true";
    else if (def.type === "array" && !Array.isArray(v)) next = [v];
    else if (def.type === "object" && typeof v === "string") { try { const p = JSON.parse(v); if (p && typeof p === "object" && !Array.isArray(p)) next = p; } catch { /* leave */ } }
    else if (def.type === "string" && typeof v === "number") next = String(v);
    if (next !== v) { const before = snap(); c.args[k] = next; note("coerce", before); }
  }

  // 9. Default.
  let check = validateAgainstSchema(schema, c.args);
  for (const e of check.errors) {
    if (e.code === "missing") {
      const k = e.path;
      let val;
      for (const p of ctx.prior || []) { if (p?.values && p.values[k] !== undefined) { val = p.values[k]; break; } }
      if (val === undefined && ctx.hints?.[k]?.default !== undefined) val = ctx.hints[k].default;
      if (val !== undefined) { const before = snap(); c.args[k] = val; note("default", before, [e.code]); }
    } else if (e.code === "extra") {
      const before = snap(); delete c.args[e.path]; note("key_normalize", before, ["extra"]);
    }
  }

  // 10. Validate again.
  check = validateAgainstSchema(schema, c.args);
  if (check.ok) return { ok: true, call: c, repairs, errors: [], reask: null };
  return { ok: false, call: c, repairs, errors: check.errors, reask: reaskText(check.errors) };
}
