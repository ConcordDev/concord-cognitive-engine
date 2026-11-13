// One typed description per tool; every later cockpit ticket reads this (CKPT-02).
import { AGENT_TOOL_SPECS } from "./agent-tool-specs.js";
import { MACRO_INPUT_HINTS } from "../macro-input-hints.js";
import { lensActionSpec } from "../lens-action-dispatch.js";
import { classifyLensActionRisk } from "../mcp-hermes-identity.js";
import { getCapabilityDescriptor } from "../runtime/capability-registry.js";

const READ_NAME_RE = /^(get|list|search|find|show|view|read|status|stats|summary|count|lookup|preview|validate|check|describe|export)\b|[-_.](get|list|search|status|stats|summary)$/i;

/** @returns {string[]} ids of the agent tools runs may use */
export function cockpitAgentToolIds() {
  return Object.keys(AGENT_TOOL_SPECS);
}

/** @param {string} id @returns {{ domain: string, action: string }|null} */
export function parseLensToolId(id) {
  const m = /^lens:([^.\s]+)\.(.+)$/.exec(String(id || ""));
  return m ? { domain: m[1], action: m[2] } : null;
}

/** @returns {"read"|"compute"|"write"|"high"} */
export function resolveLensRisk(domain, action) {
  let cap = null;
  let spec = null;
  try { cap = getCapabilityDescriptor(`${domain}.${action}`); } catch { /* registry optional */ }
  try { spec = lensActionSpec(domain, action); } catch { /* spec optional */ }
  const declared = cap?.risk || spec?.risk || null;
  const r = classifyLensActionRisk(domain, action, declared);
  if (!declared && r === "compute" && READ_NAME_RE.test(action)) return "read";
  return r;
}

function hasLensAction(domain, action, lensActions) {
  if (lensActions instanceof Map && lensActions.has(`${domain}.${action}`)) return true;
  try {
    if (globalThis._concordMACROS?.get?.(domain)?.has?.(action) === true) return true;
  } catch { /* no live registry */ }
  return false;
}

/** Build a spec for a lens action from its registered spec and hints. */
export function lensToolSpec(domain, action, ctx = {}) {
  if (ctx.lensActions instanceof Map && !hasLensAction(domain, action, ctx.lensActions)) return null;
  let spec = null;
  try { spec = lensActionSpec(domain, action); } catch { /* spec optional */ }
  const risk = resolveLensRisk(domain, action);
  const title = `${action.replace(/[-_.]/g, " ").replace(/^./, (c) => c.toUpperCase())} (${domain})`;
  const hints = MACRO_INPUT_HINTS[`${domain}.${action}`];
  const properties = {};
  const required = [];
  if (Array.isArray(hints)) {
    for (const h of hints) {
      if (!h || !h.name) continue;
      properties[h.name] = { type: h.type || "string" };
      if (h.optional === false) required.push(h.name);
    }
  }
  return {
    id: `lens:${domain}.${action}`,
    title,
    description: String(spec?.note || title).slice(0, 160),
    inputSchema: { type: "object", additionalProperties: true, required, properties },
    outputSchema: null,
    risk,
    idempotent: risk === "read" || risk === "compute",
    aliases: [],
    fallbacks: ["find_lens_actions"],
    timeoutMs: 60000,
    requiresScopes: [`mcp:lens:${risk}`],
  };
}

/**
 * @param {string} id  "web_search" or "lens:<domain>.<action>"
 * @param {{ lensActions?: Map<string,Function>, role?: string|null, env?: object }} [ctx]
 * @returns {object|null}  null when the tool does not exist or this caller cannot run it
 */
export function getToolSpec(id, ctx = {}) {
  const lens = parseLensToolId(id);
  if (lens) return lensToolSpec(lens.domain, lens.action, ctx);
  if (Object.prototype.hasOwnProperty.call(AGENT_TOOL_SPECS, id)) return { id, ...AGENT_TOOL_SPECS[id] };
  return null;
}
