// Classify macros for bulk coverage (spec §11). Pure heuristics — no I/O.

import { LLM_HINT_RE, EXTERNAL_IO_HINT_RE, DESTRUCTIVE_HINT_RE, SKIP_DOMAINS_DEFAULT } from "../../../scripts/contracts/harness.mjs";

/** @typedef {'A'|'B'|'C'|'D'|'E'} CapabilityClass */

const INTERACTIVE_RE = /^(create|update|delete|save|publish|install|checkout|purchase|send|post|upload|claim|mint|spawn|start|stop|pause|resume|join|leave|invite|accept|reject|vote|submit|execute|deploy|transfer|withdraw|deposit|stake|unstake|open|close|merge|split|fork|clone|restore|rollback|commit|push|pull|checkout|merge|rebase)/i;

const STATEFUL_DOMAINS = new Set([
  "world", "concordia", "crafting", "marketplace", "wallet", "chat", "personas",
  "courtship", "housing", "guild", "party", "combat", "quests",
]);

/**
 * @param {string} domain
 * @param {string} name
 * @returns {{ class: CapabilityClass, reason: string, headlessSafe: boolean }}
 */
export function classifyMacro(domain, name) {
  if (SKIP_DOMAINS_DEFAULT.has(domain)) {
    return { class: "E", reason: "skip_domain", headlessSafe: false };
  }
  if (DESTRUCTIVE_HINT_RE.test(name)) {
    return { class: "E", reason: "destructive", headlessSafe: false };
  }
  if (EXTERNAL_IO_HINT_RE.test(name) || /^live_/i.test(name)) {
    return { class: "C", reason: "external_io", headlessSafe: false };
  }
  if (LLM_HINT_RE.test(name)) {
    return { class: "C", reason: "llm_brain", headlessSafe: false };
  }
  if (STATEFUL_DOMAINS.has(domain) && INTERACTIVE_RE.test(name)) {
    return { class: "D", reason: "stateful_domain_mutation", headlessSafe: false };
  }
  if (INTERACTIVE_RE.test(name) && !/^(get|list|search|preview|validate|check|calc|compute|analyze|analyse|convert|solve|run|sim|plot|balance|trial|profit|budget|mesh|fea)/i.test(name)) {
    return { class: "B", reason: "structured_mutation", headlessSafe: false };
  }
  // Deterministic calculators / transforms / analysis
  if (/^(calc|compute|solve|run|sim|analyze|analyse|convert|balance|trial|profit|budget|mesh|symbolic|unit|derivative|integral|simplify|ohms|ideal|projectile|kinematics|circuit|fea|thermal|stress|tolerance|molarity|formula|parse|stringify)/i.test(name)) {
    return { class: "A", reason: "deterministic_calculator", headlessSafe: true };
  }
  if (/^(get|list|search|status|stats|count|facet|browse|catalog|preview|validate|check|describe|export|history|recent)/i.test(name)) {
    return { class: "A", reason: "read_only", headlessSafe: true };
  }
  return { class: "B", reason: "default_structured", headlessSafe: false };
}

export default { classifyMacro };
