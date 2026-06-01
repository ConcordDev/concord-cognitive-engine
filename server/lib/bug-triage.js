// server/lib/bug-triage.js
//
// E3 — severity-triage router (the "right half" of the bug-class diagram).
//
// One pure classifier that every user-bug source funnels through: the client-error
// intake (E4), the economy-anomaly cycle (E2), and the in-app feedback bug_report path.
// It maps a {source, kind, signals} envelope to a {severity, route} so Critical issues
// (data-loss / exploit / security) page immediately via error-alerting while the rest
// land on a board. No I/O — callers do the routing; this just decides.
//
// The taxonomy mirrors the user-bug research: Critical / Major / Moderate / Minor.

export const SEVERITY = Object.freeze({
  CRITICAL: "critical",
  MAJOR: "major",
  MODERATE: "moderate",
  MINOR: "minor",
});

export const ROUTE = Object.freeze({
  PAGE: "page",   // immediate alert (error-alerting webhook)
  BOARD: "board", // triage board / DTU record
});

// Kinds that are ALWAYS critical regardless of source — the three classes Concordia's
// design most exposes (economy exploit, data-loss, security/access-control) plus the
// runtime forms that mean a player lost work or money.
const CRITICAL_KINDS = new Set([
  "data_loss", "dtu_loss", "save_loss", "progression_loss",
  "exploit", "dupe", "wash_trade", "collusion_ring", "negative_balance", "balance_overflow",
  "security", "access_control", "idor", "privilege_escalation", "secret_leak",
  "economy_anomaly",
]);

// Kinds that are typically major (broken feature / blocked flow, no data/$ loss).
const MAJOR_KINDS = new Set([
  "white_screen", "hydration", "uncaught_throw", "route_500", "soft_lock",
  "quest_stuck", "reward_not_granted", "desync", "auth_failure", "payment_failed",
  "dupe_citation",
]);

// Kinds that are usually moderate (degraded but usable).
const MODERATE_KINDS = new Set([
  "slow", "timeout", "perf", "visual_glitch", "animation", "console_error",
  "localization", "tz", "currency",
]);

/**
 * Classify a bug/anomaly envelope into a severity + route.
 *
 * @param {object} input
 * @param {string} [input.source]   where it came from (client_error|econ_anomaly|feedback|...)
 * @param {string} [input.kind]     the bug kind (see *_KINDS sets above)
 * @param {object} [input.signals]  optional escalators: { dataLoss, moneyMoved, security, affectedUsers }
 * @returns {{ severity:string, route:string, reasons:string[] }}
 */
export function classify({ source = "unknown", kind = "unknown", signals = {} } = {}) {
  const reasons = [];
  const k = String(kind).toLowerCase();

  // Hard escalators — any of these forces Critical regardless of kind.
  if (signals.dataLoss) reasons.push("data_loss_signal");
  if (signals.security) reasons.push("security_signal");
  if (signals.moneyMoved) reasons.push("money_moved_signal");
  const escalated = reasons.length > 0;

  let severity;
  if (escalated || CRITICAL_KINDS.has(k)) {
    severity = SEVERITY.CRITICAL;
    if (CRITICAL_KINDS.has(k)) reasons.push(`critical_kind:${k}`);
  } else if (MAJOR_KINDS.has(k)) {
    severity = SEVERITY.MAJOR;
    reasons.push(`major_kind:${k}`);
  } else if (MODERATE_KINDS.has(k)) {
    severity = SEVERITY.MODERATE;
    reasons.push(`moderate_kind:${k}`);
  } else {
    severity = SEVERITY.MINOR;
    reasons.push("unclassified_or_minor");
  }

  // Blast-radius bump: a Major affecting many users escalates one notch to Critical.
  if (severity === SEVERITY.MAJOR && Number(signals.affectedUsers) >= 25) {
    severity = SEVERITY.CRITICAL;
    reasons.push(`blast_radius:${signals.affectedUsers}`);
  }

  const route = severity === SEVERITY.CRITICAL ? ROUTE.PAGE : ROUTE.BOARD;
  return { severity, route, reasons };
}

/** Convenience predicate for callers that only care whether to page. */
export function shouldPage(input) {
  return classify(input).route === ROUTE.PAGE;
}

export default classify;
