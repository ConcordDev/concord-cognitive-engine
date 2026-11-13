// Cockpit feature flags (GB-1500). Every cockpit behaviour change reads its
// switch through cockpitFlag(); nothing reads CONCORD_COCKPIT_* directly.
const DEFAULTS = Object.freeze({
  TELEMETRY: "1", REPAIR: "0", RETRY: "0", MENU: "0", RUNS: "0",
  CONSTRAINED: "1", STRIP_APPROVAL: "1", ROUTE: "0", ASK_CONTEXT: "0", LONG_TASK: "0",
});

/**
 * @param {keyof typeof DEFAULTS} name
 * @param {Record<string,string|undefined>} [env]
 * @returns {boolean}
 */
export function cockpitFlag(name, env = process.env) {
  const raw = env[`CONCORD_COCKPIT_${name}`];
  const v = String(raw ?? DEFAULTS[name] ?? "0").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

export const COCKPIT_FLAG_DEFAULTS = DEFAULTS;
