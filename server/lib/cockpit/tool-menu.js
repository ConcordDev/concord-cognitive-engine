// A short, per-step tool menu (CKPT-06). At most MODEL_PROFILES[profile].maxMenu tools.
import { findLensActions } from "../chat-agent.js";
import { compileToolUniverse } from "../runtime/tool-universe-compiler.js";
import { MODEL_PROFILES } from "./model-caps.js";
import { cockpitAgentToolIds, getToolSpec } from "./tool-spec.js";

const LENS_INTENT_RE = /\b(lens|log|add|create|schedule|track|record|plan)\b/i;
const ALWAYS_LENS = new Set(["find_lens_actions", "list_lens_actions", "run_lens_action"]);

/**
 * @param {{ goal: string, runGoal?: string, declaredTool?: string|null, lensContext?: string|null,
 *           profile: string, lensActions?: Map<string,Function>, role?: string|null, exclude?: string[] }} a
 * @returns {Promise<{ menu: Array<{id:string,description:string,inputSchema:object}>, reasons: Record<string,string> }>}
 */
export async function buildToolMenu(a) {
  const max = (MODEL_PROFILES[a.profile] || MODEL_PROFILES["marker-only"]).maxMenu;
  const exclude = new Set(a.exclude || []);
  const ids = [];
  const reasons = {};
  const specs = new Map();
  const add = (id, why) => {
    if (!id || ids.includes(id) || exclude.has(id)) return;
    let spec = specs.get(id);
    if (!spec) {
      spec = getToolSpec(id, { lensActions: a.lensActions, role: a.role });
      if (!spec) return;
      specs.set(id, spec);
    }
    ids.push(id);
    reasons[id] = why;
  };
  const goal = String(a.goal || "");

  // 1-2. The step's own tool and its first fallback.
  if (a.declaredTool) {
    add(a.declaredTool, "declared");
    const d = getToolSpec(a.declaredTool, { lensActions: a.lensActions, role: a.role });
    if (d?.fallbacks?.[0]) add(d.fallbacks[0], "fallback");
  }
  // 3. Actions of the lens the person is in.
  if (a.lensContext && a.lensActions) {
    let n = 0;
    for (const h of await findLensActions(goal, a.lensActions, { limit: 12 })) {
      if (h.domain !== a.lensContext) continue;
      add(`lens:${h.domain}.${h.action}`, "lens");
      if (++n >= 3) break;
    }
  }
  // 4. Keyword matches over the agent tools.
  try {
    const handTools = cockpitAgentToolIds().map((id) => getToolSpec(id)).map((t) => ({ name: t.id, description: t.description, inputSchema: t.inputSchema }));
    const compiled = compileToolUniverse(goal, { budget: 6, includeReflected: false, handTools });
    let n = 0;
    for (const t of compiled.tools || []) {
      if (t.score >= 3) { add(t.name, "keyword"); if (++n >= 3) break; }
    }
  } catch { /* keyword scoring is best-effort */ }
  // 5. Lens search when the goal sounds like a lens task.
  if (a.lensActions && LENS_INTENT_RE.test(goal)) {
    let n = 0;
    for (const h of await findLensActions(goal, a.lensActions, { limit: 6 })) {
      add(`lens:${h.domain}.${h.action}`, "lens-search");
      if (++n >= 2) break;
    }
  }
  // 6. Defaults.
  if (ids.length < 3) { add("find_lens_actions", "default"); add("web_search", "default"); }

  const cut = ids.slice(0, max);
  const menu = cut.map((id) => ({ id, description: specs.get(id).description, inputSchema: specs.get(id).inputSchema }));
  const kept = {};
  for (const id of cut) kept[id] = reasons[id];
  return { menu, reasons: kept };
}

/**
 * Narrow the prompt's full tool block to the menu. Returns null when fewer than
 * three tool entries would survive, so the caller keeps the full block.
 */
export function menuSchemaBlock(menu, fullBlock) {
  const keep = new Set([...menu.map((m) => m.id), ...ALWAYS_LENS]);
  const lines = String(fullBlock || "").split("\n");
  const entryRe = /^- ([a-z0-9_]+):/;
  const out = [];
  let inTools = false;
  let keepCurrent = false;
  let survivors = 0;
  for (const line of lines) {
    const m = entryRe.exec(line);
    if (m) {
      inTools = true;
      keepCurrent = keep.has(m[1]);
      if (keepCurrent) { out.push(line); survivors += 1; }
    } else if (!inTools) {
      out.push(line);
    } else if (/^\s/.test(line)) {
      if (keepCurrent) out.push(line);
    } else {
      // A non-indented, non-entry line after the entries is trailing prose: keep it.
      keepCurrent = false;
      out.push(line);
    }
  }
  return survivors < 3 ? null : out.join("\n");
}
