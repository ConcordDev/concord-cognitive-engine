// server/lib/viability/institution-design.js
//
// Wave 5 #20 — institution design: procedurally derive a governance STRUCTURE
// from a group's parameters, the way the other procgen derives terrain/NPCs from
// seeds. Grounded in institutional-contingency + Ostrom-style intuitions:
//   - group SIZE picks the decision rule (small+cohesive → consensus; mid →
//     majority; large → a representative council; only tiny+threatened →
//     centralised),
//   - external THREAT centralises (speed beats deliberation in crisis) and
//     thins checks toward a floor (never zero — captured institutions die),
//   - COHESION gates whether consensus is even feasible,
//   - quorum + term limits fall out of the same dials.
// Pure + deterministic. A realm/org can adopt the returned structure at founding.

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

export const DECISION_RULES = ["consensus", "majority", "council", "autocracy"];

/**
 * @param {{ memberCount?:number, cohesion?:number, externalThreat?:number }} params
 * @returns {{ decisionRule:string, council:{seats:number}|null, quorum:number,
 *             checks:string[], termLimitDays:number, centralization:number }}
 */
export function designInstitution(params = {}) {
  const n = Math.max(1, Math.floor(Number(params.memberCount) || 1));
  const cohesion = clamp01(params.cohesion ?? 0.5);
  const threat = clamp01(params.externalThreat ?? 0.2);

  // Centralization rises with threat, falls with cohesion (a trusting group can
  // stay flat under pressure). 0 = flat/consensual, 1 = autocratic.
  const centralization = clamp01(0.15 + 0.7 * threat - 0.25 * cohesion + (n > 50 ? 0.15 : 0));

  let decisionRule;
  if (threat > 0.8 && n <= 12) decisionRule = "autocracy";       // tiny war-council under siege
  else if (n <= 8 && cohesion >= 0.6) decisionRule = "consensus"; // small + trusting
  else if (n <= 40) decisionRule = "majority";
  else decisionRule = "council";                                 // scale → representation

  // A representative council for large bodies: ~√n seats, bounded.
  const council = decisionRule === "council"
    ? { seats: Math.max(5, Math.min(50, Math.round(Math.sqrt(n) * 2))) }
    : null;

  // Quorum: consensus needs near-everyone; centralised bodies need less.
  const quorum = decisionRule === "consensus"
    ? Math.ceil(n * 0.9)
    : Math.max(1, Math.ceil((council ? council.seats : n) * (0.6 - 0.2 * centralization)));

  // Checks-and-balances thin under threat but never vanish (floor 1).
  const allChecks = ["term_limit", "judicial_review", "recall_vote", "public_ledger", "second_chamber"];
  const keep = Math.max(1, Math.round(allChecks.length * (1 - 0.6 * centralization)));
  const checks = allChecks.slice(0, keep);

  // Term limits shorten as centralization rises (guard against entrenchment).
  const termLimitDays = Math.round(360 * (1 - 0.5 * centralization));

  return { decisionRule, council, quorum, checks, termLimitDays, centralization };
}
