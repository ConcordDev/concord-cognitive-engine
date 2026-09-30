// server/lib/runtime/provider-billing.js
//
// Real provider billing telemetry — records actual prompt/completion/cached tokens
// from provider responses. COGNITIVE_ECON_MODE=billed prefers this over estimates.

import crypto from "node:crypto";
import { resolvePricingConfig, estimateInvocationCost } from "./cognitive-economics.js";

function invocationId() {
  return `pbt_${crypto.randomUUID().slice(0, 12)}`;
}

/**
 * Record billed usage from a real provider response.
 */
export function recordProviderBilling(db, {
  missionId,
  stepIndex,
  path,
  model,
  provider,
  promptTokens = 0,
  completionTokens = 0,
  cachedPromptTokens = 0,
  reasoningTokens = 0,
  latencyMs,
  pricing,
  billingSource = "provider",
  detail,
} = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  const p = pricing || resolvePricingConfig();
  const uncachedPrompt = Math.max(0, promptTokens - cachedPromptTokens);
  const cachedFrac = promptTokens > 0 ? cachedPromptTokens / promptTokens : 0;
  const cacheDiscount = Number(process.env.COGNITIVE_PROVIDER_CACHE_DISCOUNT ?? 0.75);

  const inputUsd = (uncachedPrompt / 1_000_000) * p.inputPer1M
    + (cachedPromptTokens / 1_000_000) * p.inputPer1M * (1 - cacheDiscount);
  const outputUsd = (completionTokens / 1_000_000) * p.outputPer1M
    + (reasoningTokens / 1_000_000) * (p.outputPer1M ?? p.inputPer1M);
  const totalUsd = inputUsd + outputUsd;

  const id = invocationId();
  try {
    db.prepare(`
      INSERT INTO provider_billing_telemetry (
        invocation_id, mission_id, step_index, path, model, provider,
        prompt_tokens, completion_tokens, cached_prompt_tokens, reasoning_tokens,
        input_usd, output_usd, total_usd, latency_ms, billing_source, detail_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      missionId || null,
      stepIndex ?? null,
      path || null,
      model || p.model,
      provider || null,
      promptTokens,
      completionTokens,
      cachedPromptTokens,
      reasoningTokens,
      inputUsd,
      outputUsd,
      totalUsd,
      latencyMs ?? null,
      billingSource,
      detail ? JSON.stringify(detail) : null,
    );
  } catch (e) {
    return { ok: false, reason: e.message };
  }

  return {
    ok: true,
    invocationId: id,
    promptTokens,
    completionTokens,
    cachedPromptTokens,
    totalUsd,
    billingSource,
  };
}

/**
 * Record billing from standard provider usage object shape.
 */
export function recordProviderBillingFromUsage(db, usage, ctx = {}) {
  if (!usage) return { ok: false, reason: "no_usage" };
  return recordProviderBilling(db, {
    ...ctx,
    promptTokens: usage.prompt_tokens ?? usage.promptTokens ?? 0,
    completionTokens: usage.completion_tokens ?? usage.completionTokens ?? 0,
    cachedPromptTokens: usage.cached_prompt_tokens ?? usage.cachedPromptTokens ?? 0,
    reasoningTokens: usage.reasoning_tokens ?? usage.reasoningTokens ?? 0,
    billingSource: "provider",
  });
}

/**
 * Aggregate billed telemetry for a mission or path.
 */
export function aggregateBilledTelemetry(db, { missionId, path } = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  let sql = `
    SELECT
      COUNT(*) AS invocations,
      SUM(prompt_tokens) AS prompt_tokens,
      SUM(completion_tokens) AS completion_tokens,
      SUM(cached_prompt_tokens) AS cached_prompt_tokens,
      SUM(total_usd) AS total_usd,
      AVG(latency_ms) AS avg_latency_ms
    FROM provider_billing_telemetry WHERE 1=1
  `;
  const params = [];
  if (missionId) { sql += " AND mission_id = ?"; params.push(missionId); }
  if (path) { sql += " AND path = ?"; params.push(path); }

  try {
    const row = db.prepare(sql).get(...params);
    return {
      ok: true,
      invocations: row?.invocations || 0,
      promptTokens: row?.prompt_tokens || 0,
      completionTokens: row?.completion_tokens || 0,
      cachedPromptTokens: row?.cached_prompt_tokens || 0,
      totalUsd: row?.total_usd || 0,
      avgLatencyMs: row?.avg_latency_ms || 0,
      billingSource: row?.invocations > 0 ? "provider" : "none",
    };
  } catch {
    return { ok: false, reason: "table_missing" };
  }
}

/**
 * Resolve cost for one invocation — prefers real telemetry, then ledger, then estimate.
 */
export function resolveInvocationBilling({
  db,
  missionId,
  stepIndex,
  metrics = {},
  pricing,
} = {}) {
  const p = pricing || resolvePricingConfig();
  const mode = p.mode || process.env.COGNITIVE_ECON_MODE || "estimated";

  if (db && missionId != null) {
    try {
      const row = db.prepare(`
        SELECT * FROM provider_billing_telemetry
        WHERE mission_id = ? AND (step_index = ? OR step_index IS NULL)
        ORDER BY step_index DESC LIMIT 1
      `).get(missionId, stepIndex ?? -1);

      if (row) {
        return {
          ok: true,
          source: "provider",
          mode: "billed",
          promptTokens: row.prompt_tokens,
          completionTokens: row.completion_tokens,
          cachedPromptTokens: row.cached_prompt_tokens,
          totalUsd: row.total_usd,
          inputUsd: row.input_usd,
          outputUsd: row.output_usd,
        };
      }
    } catch { /* table optional */ }
  }

  if (mode === "billed" && db && missionId) {
    try {
      const ledger = db.prepare(`
        SELECT actual_model_input_tokens, total_tokens_avoided, cache_hit, skip_llm
        FROM cognitive_savings_ledger
        WHERE mission_id = ? ORDER BY id DESC LIMIT 1
      `).get(missionId);
      if (ledger) {
        const inputTok = ledger.actual_model_input_tokens || 0;
        const cost = estimateInvocationCost({
          inputTokens: inputTok,
          cacheHit: ledger.cache_hit === 1,
          skipLlm: ledger.skip_llm === 1,
          pricing: p,
        });
        return {
          ok: true,
          source: "ledger",
          mode: "billed",
          promptTokens: inputTok,
          completionTokens: cost.outputTokens,
          totalUsd: cost.totalUsd,
          note: "Billed from cognitive_savings_ledger token counts — wire provider response for true telemetry",
        };
      }
    } catch { /* optional */ }
  }

  const inputTok = metrics?.efficiency?.actualModelInputTokens || 0;
  const cacheHit = metrics?.intelligence?.cacheHit === 1;
  const cost = estimateInvocationCost({
    inputTokens: inputTok,
    cacheHit,
    skipLlm: metrics?.efficiency?.skipLlm === 1,
    pricing: p,
  });

  return {
    ok: true,
    source: "estimated",
    mode: "estimated",
    promptTokens: cost.inputTokens,
    completionTokens: cost.outputTokens,
    totalUsd: cost.totalUsd,
  };
}

/**
 * Seed billed telemetry from savings ledger for bench integration tests.
 */
export function seedBilledTelemetryFromLedger(db, { missionId, path, model, pricing } = {}) {
  if (!db || !missionId) return { ok: false, reason: "no_db_or_mission" };

  const row = db.prepare(`
    SELECT step_index, actual_model_input_tokens, cache_hit, skip_llm, latency_ms
    FROM cognitive_savings_ledger WHERE mission_id = ? ORDER BY id DESC LIMIT 1
  `).get(missionId);

  if (!row) return { ok: false, reason: "no_ledger_row" };

  const defaultOutput = Number(process.env.COGNITIVE_ECON_DEFAULT_OUTPUT_TOKENS ?? 120);
  return recordProviderBilling(db, {
    missionId,
    stepIndex: row.step_index,
    path,
    model,
    promptTokens: row.actual_model_input_tokens || 0,
    completionTokens: row.skip_llm ? 0 : defaultOutput,
    cachedPromptTokens: row.cache_hit ? Math.floor((row.actual_model_input_tokens || 0) * 0.5) : 0,
    latencyMs: row.latency_ms,
    pricing,
    billingSource: "ledger_derived",
  });
}
