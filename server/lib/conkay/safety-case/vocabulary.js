// server/lib/conkay/safety-case/vocabulary.js
//
// The only status words a ConKay safety-case output may carry. ConKay
// screens; it never determines safety. Qualified engineers and regulators
// decide and approve (CONKAY-NUCLEAR-TOPTIER-ROADMAP-2026-10-09.md, rule 1).

export const STATUSES = Object.freeze(["incomplete", "screening_pass", "screening_fail", "needs_review"]);
export const PROPOSAL_STATUS = "pending_human_decision";
export const FORBIDDEN_VERDICT_WORDS = Object.freeze(["safe", "approved", "compliant", "certified", "licensed"]);
export const BANNER = "Screening analysis only. Not a safety determination. Decisions and approvals belong to qualified engineers and regulators.";

const FORBIDDEN_RX = new RegExp(`\\b(${FORBIDDEN_VERDICT_WORDS.join("|")})\\b`, "i");

/** Returns the status unchanged, or throws if it is outside the screening vocabulary. */
export function screeningStatus(s) {
  if (!STATUSES.includes(s)) throw new Error(`status "${s}" is not a screening status (${STATUSES.join(", ")})`);
  return s;
}

/** Every status/verdict/decision-like field anywhere in a value, as [path, value]. */
export function verdictFields(v, path = "$", out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => verdictFields(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (/^(status|verdict|decision|outcome|result|screening)$/i.test(k) && typeof x === "string") out.push([`${path}.${k}`, x]);
      verdictFields(x, `${path}.${k}`, out);
    }
  }
  return out;
}

/** Fields whose value uses a forbidden verdict word (should always be empty). */
export function forbiddenVerdicts(v) {
  return verdictFields(v).filter(([, x]) => FORBIDDEN_RX.test(x));
}

// Actors: a requirement owner, reviewer, verifier or anyone accepting a
// proposal must be a named human. ConKay (or any tool) is refused.
const TOOL_RX = /\b(conkay|grok|bot|ai|llm|gpt|claude|copilot|system|automated|auto|tool)\b/i;

export function humanNameError(name, role) {
  if (typeof name !== "string" || name.trim().length < 2) return `${role}: a named human is required`;
  if (TOOL_RX.test(name)) return `${role}: "${name}" is not a human; ConKay and other tools cannot hold this role`;
  return null;
}
