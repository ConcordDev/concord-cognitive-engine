// Domain acceptance ladder — Gates A–F (spec §6). No I/O except via injected deps.

import { classifyMacro } from "./macro-capability-classifier.js";
import { COMPLETION_STATUS } from "./macro-failure-taxonomy.js";

/**
 * @typedef {object} GateResult
 * @property {boolean} pass
 * @property {string} [reason]
 * @property {string} [failureType]
 */

/**
 * @typedef {object} DomainAcceptanceReport
 * @property {string} domain
 * @property {boolean} complete
 * @property {Record<string, GateResult>} gates
 * @property {string} status
 * @property {string[]} representativeActions
 */

/**
 * Run Gates A–F for one domain.
 * @param {string} domain
 * @param {object} deps
 * @param {Set<string>} deps.registeredKeys — `domain.action` in LENS_ACTIONS ∪ MACROS
 * @param {Set<string>} [deps.discoveredKeys]
 * @param {Map<string, { ok: boolean, verified?: boolean, logged?: boolean, error?: string }>} [deps.invocationByKey]
 * @param {string[]} [deps.representativeActions] — override auto-pick
 */
export function evaluateDomainAcceptance(domain, deps) {
  const actions = [...deps.registeredKeys]
    .filter((k) => k.startsWith(`${domain}.`))
    .map((k) => k.slice(domain.length + 1));

  const reps = deps.representativeActions?.length
    ? deps.representativeActions
    : pickRepresentatives(domain, actions);

  const gates = {};

  // A — Registration
  gates.A_registration = {
    pass: actions.length > 0,
    reason: actions.length > 0 ? `${actions.length} action(s) registered` : "no registered actions",
    ...(actions.length === 0 ? { failureType: "REGISTRATION_FAILURE" } : {}),
  };

  // B — Discovery (optional set; pass if registered ⊆ discovered when provided)
  if (deps.discoveredKeys) {
    const missing = actions.filter((a) => !deps.discoveredKeys.has(`${domain}.${a}`));
    gates.B_discovery = {
      pass: missing.length === 0,
      reason: missing.length === 0 ? "all actions discoverable" : `undiscoverable: ${missing.slice(0, 5).join(", ")}`,
      ...(missing.length ? { failureType: "DISCOVERY_FAILURE" } : {}),
    };
  } else {
    gates.B_discovery = { pass: true, reason: "discovery not checked (static pass)" };
  }

  const inv = deps.invocationByKey || new Map();

  // C — Invocation (at least one representative invoked successfully)
  const invokedRep = reps.find((a) => {
    const row = inv.get(`${domain}.${a}`);
    return row?.ok === true;
  });
  gates.C_invocation = {
    pass: !!invokedRep,
    reason: invokedRep
      ? `representative ${invokedRep} invoked`
      : `no representative invoked (${reps.join(", ") || "none picked"})`,
    ...(!invokedRep ? { failureType: "DISPATCH_FAILURE" } : {}),
  };

  // D — Correctness (verified oracle or explicit verified flag)
  const verifiedRep = reps.find((a) => {
    const row = inv.get(`${domain}.${a}`);
    return row?.verified === true;
  });
  gates.D_correctness = {
    pass: !!verifiedRep,
    reason: verifiedRep
      ? `representative ${verifiedRep} independently verified`
      : "no verified representative output",
    ...(!verifiedRep ? { failureType: "CORRECTNESS_FAILURE" } : {}),
  };

  // E — Logging
  const loggedRep = reps.find((a) => inv.get(`${domain}.${a}`)?.logged === true);
  gates.E_logging = {
    pass: !!loggedRep,
    reason: loggedRep ? `invocation logged for ${loggedRep}` : "no macro_call_log row for representatives",
    ...(!loggedRep ? { failureType: "LOGGING_FAILURE" } : {}),
  };

  // F — Error behavior (invalid input → controlled failure, not throw)
  const errKey = reps[0] ? `${domain}.${reps[0]}` : null;
  const errRow = errKey ? inv.get(`${errKey}@invalid`) : null;
  gates.F_error_behavior = errRow
    ? {
        pass: errRow.ok === false && !errRow.threw,
        reason: errRow.ok === false ? "invalid input returned controlled failure" : "invalid input did not fail cleanly",
        ...(errRow.ok !== false || errRow.threw ? { failureType: "ARGUMENT_FAILURE" } : {}),
      }
    : { pass: false, reason: "error-behavior probe not run", failureType: "VERIFICATION_FAILURE" };

  const complete = Object.values(gates).every((g) => g.pass);
  const status = complete
    ? COMPLETION_STATUS[0]
    : gates.C_invocation.pass
      ? COMPLETION_STATUS[7]
      : COMPLETION_STATUS[8];

  return {
    domain,
    complete,
    gates,
    status,
    representativeActions: reps,
    actionCount: actions.length,
  };
}

function pickRepresentatives(domain, actions) {
  const scored = actions.map((name) => {
    const { class: cls, headlessSafe } = classifyMacro(domain, name);
    const score = cls === "A" ? 3 : cls === "B" ? 2 : 0;
    return { name, score, headlessSafe };
  });
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.filter((s) => s.headlessSafe).slice(0, 3).map((s) => s.name)
    .concat(scored.filter((s) => !s.headlessSafe).slice(0, 1).map((s) => s.name))
    .slice(0, 3);
}

export default { evaluateDomainAcceptance, pickRepresentatives };
