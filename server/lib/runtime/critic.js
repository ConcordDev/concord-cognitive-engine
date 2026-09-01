// server/lib/runtime/critic.js
//
// Adversarial internal reviewer — controls mission step progression.

export const EXECUTION_OUTCOMES = Object.freeze([
  "SUCCESS", "PARTIAL", "FAILED", "INVALID", "REGRESSION", "UNKNOWN",
]);

export function classifyExecutionResult({ gateResult, stepOk } = {}) {
  const res = gateResult?.result ?? gateResult ?? {};
  const reason = String(res?.reason || gateResult?.reason || "");
  if (!stepOk && gateResult?.ok === false && /denied|forbidden|not_allowed/i.test(reason)) {
    return "INVALID";
  }
  if (!stepOk && /regression|broke|degraded/i.test(reason)) return "REGRESSION";
  if (!stepOk) return "FAILED";
  if (res?.partial === true || res?.status === "partial") return "PARTIAL";
  if (res?.ok === false) return "FAILED";
  if (!res || (typeof res === "object" && Object.keys(res).length === 0)) return "UNKNOWN";
  return "SUCCESS";
}

export function critiqueResult({
  objective,
  result,
  evidence = [],
  testsPassed,
  intentVerified,
  executionOutcome,
} = {}) {
  const issues = [];
  const obj = String(objective || "").trim();
  const res = result && typeof result === "object" ? result : { value: result };
  const outcome = executionOutcome || (res?.ok === false ? "FAILED" : "SUCCESS");

  if (!obj) issues.push({ severity: "high", code: "missing_objective", message: "No objective to verify against." });
  if (outcome === "FAILED" || outcome === "INVALID") {
    issues.push({ severity: "high", code: "execution_failed", message: `Execution outcome: ${outcome}.` });
  }
  if (outcome === "REGRESSION") {
    issues.push({ severity: "critical", code: "regression", message: "Regression detected — prior working state may be broken." });
  }
  if (outcome === "UNKNOWN") {
    issues.push({ severity: "medium", code: "unknown_outcome", message: "Outcome could not be classified with confidence." });
  }
  if (outcome === "PARTIAL") {
    issues.push({ severity: "medium", code: "partial_completion", message: "Step partially completed — repair or continue required." });
  }
  if (testsPassed === false) {
    issues.push({ severity: "high", code: "tests_failed", message: "Tests did not pass — result may be accidental." });
  }
  if (intentVerified === false) {
    issues.push({ severity: "critical", code: "intent_unverified", message: "Behavior may match tests but intent not verified." });
  }
  if (!evidence?.length && outcome === "SUCCESS") {
    issues.push({ severity: "low", code: "no_evidence", message: "No independent evidence attached." });
  }
  if (res?.reason && /timeout|unavailable|stub|not_implemented/i.test(String(res.reason))) {
    issues.push({ severity: "high", code: "degraded_path", message: `Degraded execution: ${res.reason}` });
  }

  const critical = issues.filter((i) => i.severity === "critical").length;
  const high = issues.filter((i) => i.severity === "high").length;
  let verdict = "accept";
  if (critical > 0 || high > 0 || outcome === "FAILED" || outcome === "INVALID" || outcome === "REGRESSION") {
    verdict = "reject";
  } else if (issues.length > 0 || outcome === "PARTIAL" || outcome === "UNKNOWN") {
    verdict = "caution";
  }

  let progression = "advance";
  if (verdict === "reject") {
    progression = outcome === "REGRESSION" ? "rollback" : "recover";
  } else if (verdict === "caution") {
    progression = outcome === "PARTIAL" ? "repair" : "verify_more";
  }

  return {
    ok: true,
    verdict,
    executionOutcome: outcome,
    issues,
    issueCount: issues.length,
    recommendation: progression === "advance" ? "continue" : progression,
    progression,
    confidence: verdict === "accept" ? 0.85 : verdict === "caution" ? 0.55 : 0.25,
  };
}

export async function runCriticPass({ db, mission, stepResult, dispatchMCP, executionOutcome } = {}) {
  const objective = mission?.goal || mission?.title;
  const evidence = [];
  if (typeof dispatchMCP === "function" && mission?.trace_id) {
    try {
      const trace = await dispatchMCP("trace_recent", { limit: 5, trace_id: mission.trace_id }, { db });
      const rows = trace?.result?.observation?.traces || trace?.result?.traces || [];
      evidence.push(...rows.slice(0, 5));
    } catch { /* optional */ }
  }
  return critiqueResult({
    objective,
    result: stepResult,
    evidence,
    testsPassed: stepResult?.testsPassed ?? stepResult?.verify?.testsPassed,
    intentVerified: stepResult?.intentVerified,
    executionOutcome,
  });
}
