// server/lib/runtime/inference-billing-bridge.js
//
// Live provider A/B billing bridge — unifies inference_spans + provider_billing_telemetry
// at every LLM call site. Never throws.

import { recordInferenceSpan } from "../inference-metering.js";
import {
  recordProviderBilling,
  recordProviderBillingFromUsage,
} from "./provider-billing.js";

/**
 * Resolve A/B path tag for billing attribution.
 */
export function resolveAbTestPath(span = {}) {
  return span.path
    || process.env.COGNITIVE_BLIND_PATH
    || process.env.COGNITIVE_ECON_PATH
    || "live";
}

/**
 * Record inference span + provider billing in one chokepoint.
 * Used by ctx.llm.chat, infer(), and callBrain wrappers.
 */
export function meterInferenceWithBilling(db, span = {}) {
  let spanResult = { ok: false };
  try {
    spanResult = recordInferenceSpan(db, span);
  } catch { /* never throw */ }

  if (!db) return spanResult;

  const path = resolveAbTestPath(span);
  const tokensIn = Number(span.tokensIn) || 0;
  const tokensOut = Number(span.tokensOut) || 0;
  const billedMode = process.env.COGNITIVE_ECON_MODE === "billed";

  try {
    if (span.usage) {
      recordProviderBillingFromUsage(db, span.usage, {
        missionId: span.missionId,
        stepIndex: span.stepIndex,
        path,
        model: span.modelUsed,
        provider: span.provider || span.brainUsed,
        latencyMs: span.latencyMs,
        detail: { ...span.detail, abPath: path, source: span.spanType || "inference" },
      });
    } else if (tokensIn > 0 || tokensOut > 0 || billedMode) {
      recordProviderBilling(db, {
        missionId: span.missionId,
        stepIndex: span.stepIndex,
        path,
        model: span.modelUsed,
        provider: span.provider || span.brainUsed,
        promptTokens: tokensIn,
        completionTokens: tokensOut,
        cachedPromptTokens: span.cachedPromptTokens || 0,
        reasoningTokens: span.reasoningTokens || 0,
        latencyMs: span.latencyMs,
        billingSource: span.billingSource || (billedMode ? "inference_span" : "estimate"),
        detail: { ...span.detail, abPath: path, source: span.spanType || "inference" },
      });
    }
  } catch { /* billing must never break inference */ }

  return spanResult;
}

/**
 * Meter a callBrain Ollama result. Only records tokens Ollama actually reported.
 */
export function meterCallBrainResult(db, result, {
  brainName,
  model,
  promptEvalCount,
  evalCount,
  latencyMs,
  options = {},
} = {}) {
  if (!db) return;
  const tokensIn = Number(promptEvalCount) || 0;
  const tokensOut = Number(evalCount) || 0;
  if (tokensIn === 0 && tokensOut === 0 && process.env.COGNITIVE_ECON_MODE !== "billed") return;

  meterInferenceWithBilling(db, {
    inferenceId: result?._interactionId || `cb_${brainName}_${Date.now()}`,
    spanType: "call_brain",
    brainUsed: brainName,
    modelUsed: model,
    provider: "ollama",
    tokensIn,
    tokensOut,
    latencyMs,
    callerId: options._userId,
    lensId: options._domain,
    path: options._econPath || options._blindPath,
    missionId: options._missionId,
    stepIndex: options._stepIndex,
    billingSource: tokensIn || tokensOut ? "provider" : "none",
  });
}

/**
 * Meter a brainChat / platform provider result.
 */
export function meterBrainChatResult(db, result, {
  slot,
  userId,
  latencyMs,
  opts = {},
} = {}) {
  if (!db || !result?.ok) return;
  meterInferenceWithBilling(db, {
    spanType: "brain_chat",
    brainUsed: slot,
    modelUsed: result.model,
    provider: result.provider,
    tokensIn: result.tokensIn || 0,
    tokensOut: result.tokensOut || 0,
    latencyMs,
    callerId: userId,
    path: opts.econPath || opts.blindPath,
    missionId: opts.missionId,
    stepIndex: opts.stepIndex,
    usage: result.usage,
    billingSource: (result.tokensIn || result.tokensOut) ? "provider" : "estimate",
  });
}
export function compareAbBillingPaths(db, { pathA, pathB, sinceHours = 24 } = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  const sinceSec = Math.floor(Date.now() / 1000) - Math.max(1, sinceHours) * 3600;
  const query = (path) => {
    try {
      return db.prepare(`
        SELECT COUNT(*) AS invocations,
               SUM(prompt_tokens) AS prompt_tokens,
               SUM(completion_tokens) AS completion_tokens,
               SUM(total_usd) AS total_usd
        FROM provider_billing_telemetry
        WHERE path = ? AND created_at >= ?
      `).get(path, sinceSec);
    } catch {
      return null;
    }
  };

  const a = query(pathA);
  const b = query(pathB);

  return {
    ok: true,
    pathA: { path: pathA, ...(a || {}) },
    pathB: { path: pathB, ...(b || {}) },
    deltaUsd: (b?.total_usd || 0) - (a?.total_usd || 0),
    sinceHours,
  };
}
