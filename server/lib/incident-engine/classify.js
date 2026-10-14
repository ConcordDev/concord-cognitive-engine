// Pure classification — mirrors ~/.local/bin/incident-engine.py KNOWN_CLASSES.
// No I/O. Same match order / fields as the Python organ.

/**
 * @typedef {{ incidentClass: string|null, severity: string|null, recovery: string|null, escalateTo: string|null }} ClassResult
 */

const KNOWN_CLASSES = [
  {
    name: "concord_backend_down",
    match: (sig) =>
      (sig?.source === "concord_health" && !sig?.ok) ||
      sig?.kind === "concord_backend_down",
    severity: "critical",
    recovery: null,
    escalateTo: "operator",
  },
  {
    name: "browser_organ_observation_stale",
    match: (sig) => sig?.kind === "browser_organ_observation_stale",
    severity: "warn",
    recovery: "re_run_browser_organ",
    escalateTo: null,
  },
  {
    name: "sentinel_state_growing_fast",
    match: (sig) => sig?.kind === "sentinel_state_growing_fast",
    severity: "warn",
    recovery: null,
    escalateTo: "operator",
  },
  {
    name: "f0_idempotency_cache_miss",
    match: (sig) =>
      sig?.kind === "f0_idempotency_cache_miss" ||
      (sig?.source === "trace_fabric_error" &&
        sig?.payload?.reason_code === "replay_detected"),
    severity: "warn",
    recovery: null,
    escalateTo: "operator",
  },
  {
    name: "concord_gate_diff_ci_failing",
    match: (sig) =>
      (sig?.source === "sentinel_alert" &&
        sig?.kind === "concord_gate" &&
        String(sig?.message || "").includes("ci_failed")) ||
      sig?.kind === "concord_gate_diff_ci_failing",
    severity: "warn",
    recovery: null,
    escalateTo: "operator",
  },
  {
    name: "coinbase_balance_low",
    match: (sig) =>
      (sig?.source === "sentinel_alert" &&
        sig?.kind === "browser_organ" &&
        String(sig?.message || "").includes("balance_low")) ||
      sig?.kind === "coinbase_balance_low",
    severity: "warn",
    recovery: null,
    escalateTo: "operator",
  },
  {
    name: "browser_organ_consecutive_warns",
    match: (sig) =>
      sig?.source === "sentinel_alert" &&
      sig?.kind === "browser_organ" &&
      String(sig?.message || "").includes("consecutive"),
    severity: "info",
    recovery: null,
    escalateTo: null,
  },
  {
    name: "refusal_field_active",
    match: (sig) => sig?.kind === "refusal_field_active",
    severity: "warn",
    recovery: null,
    escalateTo: "sovereign",
  },
  {
    name: "telegram_delivery_failing",
    match: (sig) => sig?.kind === "telegram_delivery_failing",
    severity: "info",
    recovery: "retry_telegram",
    escalateTo: null,
  },
  {
    name: "launchd_daemon_stuck",
    match: (sig) => sig?.kind === "launchd_daemon_stuck",
    severity: "warn",
    recovery: "restart_daemon",
    escalateTo: null,
  },
];

/** @returns {ClassResult} */
export function classifySignal(signal) {
  for (const def of KNOWN_CLASSES) {
    try {
      if (def.match(signal)) {
        return {
          incidentClass: def.name,
          severity: def.severity,
          recovery: def.recovery,
          escalateTo: def.escalateTo,
        };
      }
    } catch {
      /* match predicate threw — skip, same as Python */
    }
  }
  return {
    incidentClass: null,
    severity: null,
    recovery: null,
    escalateTo: null,
  };
}

/**
 * Watch-path normalize: unknown → unknown_class + escalate operator.
 * Mirrors tool_incident_watch / tool_incident_classify in the Python organ.
 */
export function classifyForWatch(signal) {
  const r = classifySignal(signal);
  if (!r.incidentClass) {
    return {
      incidentClass: "unknown_class",
      severity: signal?.severity || "info",
      recovery: null,
      escalateTo: "operator",
    };
  }
  return r;
}

export { KNOWN_CLASSES };
