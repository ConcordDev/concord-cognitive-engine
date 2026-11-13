// Test-and-desk seams (CKPT-22). Both are refused when NODE_ENV is "production".
//  - CONCORD_COCKPIT_DESK_FIXTURE=1 lets POST /api/cockpit/runs take a fixed `steps` plan.
//  - CONCORD_COCKPIT_DESK_SLOW_TOOL=<tool id> makes that tool's first call in a run run out of time.
import { newStepId } from "./run-store.js";

const isProd = (env) => String(env.NODE_ENV || "").toLowerCase() === "production";

export function deskFixtureAllowed(env = process.env) {
  return !isProd(env) && env.CONCORD_COCKPIT_DESK_FIXTURE === "1";
}

const slowed = new Set();
/** True once per (run, tool) when the slow-tool seam names this tool and we are not in production. */
export function deskSlowThisCall(runId, tool, env = process.env) {
  if (isProd(env)) return false;
  const want = String(env.CONCORD_COCKPIT_DESK_SLOW_TOOL || "").trim();
  if (!want || want !== tool) return false;
  const k = `${runId}|${tool}`;
  if (slowed.has(k)) return false;
  slowed.add(k);
  return true;
}

const remapRefs = (v, idMap) => {
  if (Array.isArray(v)) return v.map((x) => remapRefs(x, idMap));
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === "$ref" && typeof v.$ref === "string") {
      const dot = v.$ref.indexOf(".");
      const head = dot < 0 ? v.$ref : v.$ref.slice(0, dot);
      return { $ref: `${idMap.get(head) || head}${dot < 0 ? "" : v.$ref.slice(dot)}` };
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remapRefs(x, idMap)]));
  }
  return v;
};

/**
 * Turn a posted fixture plan into plan steps materializePlan can store. Each posted step has `key`
 * (and optionally `id`); `dependsOn` and `$ref` heads may name either. Returns null when it is malformed.
 */
export function planFromFixtureSteps(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 60) return null;
  const idMap = new Map();
  for (const s of raw) {
    if (!s || typeof s.key !== "string" || !s.key) return null;
    const fresh = newStepId();
    idMap.set(s.key, fresh);
    if (typeof s.id === "string") idMap.set(s.id, fresh);
  }
  const keyOf = new Map();
  for (const s of raw) { keyOf.set(s.key, s.key); if (typeof s.id === "string") keyOf.set(s.id, s.key); }
  return raw.map((s) => ({
    key: s.key, id: idMap.get(s.key), goal: String(s.goal || "").slice(0, 200),
    tool: typeof s.tool === "string" && s.tool ? s.tool : null,
    args: s.args === null || s.args === undefined ? null : remapRefs(s.args, idMap),
    expects: Array.isArray(s.expects) ? s.expects : [],
    dependsOn: (Array.isArray(s.dependsOn) ? s.dependsOn : []).map((d) => keyOf.get(d)).filter(Boolean),
    required: s.required !== false,
  }));
}
