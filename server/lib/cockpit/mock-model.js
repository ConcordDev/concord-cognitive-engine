// File-driven mock model for CI (CKPT-04). Never loads in production.
import fs from "node:fs";

/**
 * Fixture: { "steps": { "<step goal or *>": [ <reply>, ... ] } }
 * reply: { tool, args, why } | { malformed: "text" } | { empty: true } | { timeout: true }
 * Replies for a step are consumed in order; the last one repeats.
 */
export function createMockModel(fixture) {
  const steps = (fixture && fixture.steps) || {};
  const cursor = new Map();
  const calls = [];
  const base = { transport: "mock", modelCalls: 1, tokensIn: 0, tokensOut: 0 };
  return {
    calls,
    next(a) {
      calls.push(a);
      const goal = a?.packet?.goal;
      const key = Object.prototype.hasOwnProperty.call(steps, goal) ? goal : "*";
      const list = steps[key];
      if (!Array.isArray(list) || !list.length) return { ok: false, errorClass: "model_empty", ...base };
      const i = cursor.get(key) || 0;
      cursor.set(key, Math.min(i + 1, list.length - 1));
      const r = list[Math.min(i, list.length - 1)];
      if (r.malformed !== undefined) return { ok: false, errorClass: "model_malformed", raw: String(r.malformed), ...base };
      if (r.empty) return { ok: false, errorClass: "model_empty", ...base };
      if (r.timeout) return { ok: false, errorClass: "timeout", ...base };
      return {
        ok: true, call: { tool: r.tool, args: r.args || {}, why: r.why || "" },
        provider: "mock", model: "mock", ...base,
      };
    },
  };
}

let cached = null;
let cachedPath = null;

export function loadMockFromEnv(env = process.env) {
  const path = env.CONCORD_COCKPIT_MOCK_MODEL;
  if (!path) return null;
  if (env.NODE_ENV === "production") throw new Error("mock model refused in production");
  if (cached && cachedPath === path) return cached;
  cached = createMockModel(JSON.parse(fs.readFileSync(path, "utf8")));
  cachedPath = path;
  return cached;
}
