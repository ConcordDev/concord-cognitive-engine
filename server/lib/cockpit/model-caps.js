// What each kind of model can be trusted to do, so the cockpit sizes steps to it (CKPT-02).
import { usesReasoningLevels } from "../ollama-request-guard.js";

export const MODEL_PROFILES = Object.freeze({
  "local-2b":      { slot: "utility",   nativeTools: false, jsonSchemaFormat: true,  contextTokens: 8192,   packetBudgetIn: 2500, maxMenu: 6, reasoningQuirk: null,     think: false },
  "local-9b":      { slot: "conscious", nativeTools: false, jsonSchemaFormat: true,  contextTokens: 16384,  packetBudgetIn: 4000, maxMenu: 8, reasoningQuirk: null,     think: false },
  "local-30b":     { slot: "conscious", nativeTools: false, jsonSchemaFormat: true,  contextTokens: 32768,  packetBudgetIn: 6000, maxMenu: 8, reasoningQuirk: null,     think: false },
  "gpt-oss-cloud": { slot: "conscious", nativeTools: false, jsonSchemaFormat: true,  contextTokens: 32768,  packetBudgetIn: 6000, maxMenu: 8, reasoningQuirk: "effort", think: null  },
  "byo-openai":    { slot: "conscious", nativeTools: true,  jsonSchemaFormat: false, contextTokens: 128000, packetBudgetIn: 8000, maxMenu: 8, reasoningQuirk: null,     think: null  },
  "byo-anthropic": { slot: "conscious", nativeTools: true,  jsonSchemaFormat: false, contextTokens: 200000, packetBudgetIn: 8000, maxMenu: 8, reasoningQuirk: null,     think: null  },
  "marker-only":   { slot: "conscious", nativeTools: false, jsonSchemaFormat: false, contextTokens: 8192,   packetBudgetIn: 2500, maxMenu: 6, reasoningQuirk: null,     think: null  },
});

/** @param {{ provider?: string|null, model?: string|null }} m */
export function profileForModel(m = {}) {
  const model = String(m.model || "").toLowerCase();
  const provider = String(m.provider || "").toLowerCase();
  if (provider === "openai") return "byo-openai";
  if (provider === "anthropic") return "byo-anthropic";
  if (usesReasoningLevels(model)) return "gpt-oss-cloud";
  if (/(^|[:\-_])(1\.5b|1\.7b|2b|3b)\b|utility-2b|core-v\d/.test(model)) return "local-2b";
  if (/(7b|8b|9b)\b/.test(model)) return "local-9b";
  if (/(2\d|3\d)b\b/.test(model)) return "local-30b";
  if (provider === "concord_default" || provider === "ollama") return "local-9b";
  return "marker-only";
}

/** The floor is the default on purpose: a 2B must work. */
export function defaultProfile(env = process.env) {
  const v = env.CONCORD_COCKPIT_MODEL_PROFILE;
  return v && Object.prototype.hasOwnProperty.call(MODEL_PROFILES, v) ? v : "local-2b";
}
