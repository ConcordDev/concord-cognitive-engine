// What a lens is and what it holds right now, as evidence for an Ask (CKPT-18).
// Read-only by construction: only an action whose resolved risk is "read" is ever run.
import { getManifest as realGetManifest } from "../lens-manifest.js";
import { resolveLensRisk } from "./tool-spec.js";
import { summarizeResult, defang } from "./result-summary.js";

export const CONTEXT_ACTION_NAMES = Object.freeze(["context", "overview", "summary", "dashboard", "status", "list"]);
const CONTEXT_TIMEOUT_MS = 5000;

/** "reasoning-traces" -> "Reasoning traces" */
export function lensDisplayName(lensId) {
  const s = String(lensId || "").replace(/[-_]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "this";
}

/** The read action this lens offers for its own state, or null. */
export function pickContextAction(lensId, lensActions, deps = {}) {
  const risk = deps.resolveRisk || resolveLensRisk;
  if (!(lensActions instanceof Map)) return null;
  for (const name of CONTEXT_ACTION_NAMES) {
    if (!lensActions.has(`${lensId}.${name}`)) continue;
    let r;
    try { r = risk(lensId, name); } catch { r = null; }
    if (r === "read") return name;
  }
  return null;
}

/**
 * @param {{ lensId: string, exec: Function, lensActions: Map, deps?: { getManifest?: Function, resolveRisk?: Function, timeoutMs?: number } }} a
 * @returns {Promise<{ ok: boolean, evidence: object[], reason?: string }>} at most 2 items
 */
export async function lensContextEvidence(a) {
  const getManifest = a.deps?.getManifest || realGetManifest;
  let manifest = null;
  try { manifest = getManifest(a.lensId); } catch { /* treated as unknown */ }
  if (!manifest) return { ok: false, evidence: [], reason: "unknown_lens" };

  const name = lensDisplayName(a.lensId);
  const described = String(manifest.description || "").trim()
    || [manifest.category, ...(manifest.domainTags || [])].filter(Boolean).join(", ");
  const evidence = [{ id: `lens:${a.lensId}`, title: name, snippet: defang(described.slice(0, 240)), source: "lens" }];

  const action = pickContextAction(a.lensId, a.lensActions, a.deps);
  if (!action || typeof a.exec !== "function") return { ok: true, evidence };

  const limit = a.deps?.timeoutMs ?? CONTEXT_TIMEOUT_MS;
  let timer;
  try {
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), limit);
      if (typeof timer.unref === "function") timer.unref();
    });
    const r = await Promise.race([
      Promise.resolve(a.exec({ tool: "run_lens_action", params: { domain: a.lensId, action, params: {} } })),
      timeout,
    ]);
    if (r && r.ok) {
      const text = summarizeResult(r.result ?? r, { tool: `${a.lensId}.${action}` }).text;
      if (text) evidence.push({ id: `lens:${a.lensId}:state`, title: `Current ${name}`, snippet: text.slice(0, 240), source: "lens" });
      return { ok: true, evidence };
    }
    return { ok: true, evidence, reason: String(r?.reason || r?.errorClass || "tool_error") };
  } catch {
    return { ok: true, evidence, reason: "handler_threw" };
  } finally {
    clearTimeout(timer);
  }
}
