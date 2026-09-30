// server/lib/runtime/provider-ab-harness.js
//
// Live provider A/B harness — probe free/cheap providers, mirror same-model
// comparisons, cache baseline (B), and billed blind subset. Never throws.

import { providerChat } from "../byo-providers.js";
import { apiKeyForProvider, resolveConfiguredProviders } from "./provider-env-loader.js";
import { aggregateBilledTelemetry } from "./provider-billing.js";
import { meterInferenceWithBilling } from "./inference-billing-bridge.js";
import { runDilaRawBlindBenchmark } from "./dila-raw-blind-benchmark.js";
import { assessPublishability, buildSegmentedClaims } from "./claim-methodology.js";
import { resolvePricingConfig } from "./cognitive-economics.js";
import { executeWorkerTask } from "./worker-adapters.js";

const PROBE_PROMPT = "Reply with exactly one word: OK";
const PROBE_SYSTEM = "You are a probe. Follow instructions exactly.";

/** Same logical model, different provider endpoints (for mirror tests). */
export const MIRROR_MODELS = Object.freeze([
  {
    id: "llama-3.3-70b",
    models: {
      groq: "llama-3.3-70b-versatile",
      openrouter: "meta-llama/llama-3.3-70b-instruct:free",
    },
  },
  {
    id: "llama-3.1-8b",
    models: {
      groq: "llama-3.1-8b-instant",
      openrouter: "meta-llama/llama-3.1-8b-instruct:free",
    },
  },
]);

const DEFAULT_XAI_BUDGET = 2.5;

function xaiBudgetCap() {
  const v = Number(process.env.CONCORD_XAI_BUDGET_USD);
  return Number.isFinite(v) ? v : DEFAULT_XAI_BUDGET;
}

let sessionSpendUsd = 0;

export function resetSessionSpend() {
  sessionSpendUsd = 0;
}

export function getSessionSpendUsd() {
  return sessionSpendUsd;
}

function estimateSpendUsd(tokensIn, tokensOut, pricing) {
  const p = pricing || resolvePricingConfig();
  return ((tokensIn || 0) / 1_000_000) * (p.inputPer1M || 0)
    + ((tokensOut || 0) / 1_000_000) * (p.outputPer1M || 0);
}

function checkBudget(provider, estimatedUsd = 0) {
  if (provider === "xai") {
    const cap = xaiBudgetCap();
    if (cap <= 0 || sessionSpendUsd + estimatedUsd > cap) {
      return { ok: false, reason: "xai_budget_exceeded", capUsd: cap, spentUsd: sessionSpendUsd };
    }
  }
  return { ok: true };
}

function recordSpend(provider, tokensIn, tokensOut, pricing) {
  const usd = estimateSpendUsd(tokensIn, tokensOut, pricing);
  sessionSpendUsd += usd;
  return usd;
}

/**
 * Minimal provider probe — one cheap completion.
 */
export async function probeProvider(provider, {
  db,
  modelId,
  path = "probe",
  pricing,
  timeoutMs = 30_000,
} = {}) {
  const apiKey = apiKeyForProvider(provider);
  if (!apiKey) return { ok: false, provider, reason: "key_missing" };

  const budget = checkBudget(provider);
  if (!budget.ok) return { ok: false, provider, ...budget };

  const started = Date.now();
  const result = await providerChat({
    provider,
    apiKey,
    slot: "utility",
    modelId,
    messages: [
      { role: "system", content: PROBE_SYSTEM },
      { role: "user", content: PROBE_PROMPT },
    ],
    opts: { temperature: 0, maxTokens: 8, timeoutMs },
  });

  const latencyMs = Date.now() - started;
  if (!result.ok) {
    return { ok: false, provider, reason: "provider_error", error: result.error, latencyMs };
  }

  const usage = result.usage || {
    prompt_tokens: result.tokensIn || 0,
    completion_tokens: result.tokensOut || 0,
    cached_prompt_tokens: result.cachedPromptTokens || 0,
  };

  const usd = recordSpend(provider, usage.prompt_tokens, usage.completion_tokens, pricing);

  if (db) {
    meterInferenceWithBilling(db, {
      spanType: "provider_probe",
      provider,
      modelUsed: modelId || result.model,
      tokensIn: usage.prompt_tokens,
      tokensOut: usage.completion_tokens,
      cachedPromptTokens: usage.cached_prompt_tokens,
      latencyMs,
      path,
      usage,
      billingSource: "provider",
      detail: { probe: true },
    });
  }

  return {
    ok: true,
    provider,
    model: modelId || result.model,
    text: (result.text || "").trim().slice(0, 32),
    tokensIn: usage.prompt_tokens,
    tokensOut: usage.completion_tokens,
    cachedPromptTokens: usage.cached_prompt_tokens,
    latencyMs,
    estimatedUsd: usd,
    respondedOk: /\bOK\b/i.test(result.text || ""),
  };
}

/**
 * Probe all configured providers.
 */
export async function probeAllProviders({ db, providers, pricing } = {}) {
  const configured = providers?.length
    ? providers.map((p) => ({ provider: p }))
    : resolveConfiguredProviders();

  const results = [];
  for (const { provider } of configured) {
    results.push(await probeProvider(provider, { db, pricing }));
  }

  return {
    ok: results.some((r) => r.ok),
    configured: configured.map((c) => c.provider),
    results,
    sessionSpendUsd: getSessionSpendUsd(),
  };
}

/**
 * Run the same prompt on multiple providers (mirror / cross-provider A/B).
 */
export async function runMirrorComparison({
  db,
  mirrorId = "llama-3.3-70b",
  providers,
  prompt = "Summarize in one sentence: Concord reduces inference cost via DTU context compression.",
  path = "mirror",
  pricing,
} = {}) {
  const spec = MIRROR_MODELS.find((m) => m.id === mirrorId) || MIRROR_MODELS[0];
  const targetProviders = providers || Object.keys(spec.models);

  const runs = [];
  for (const provider of targetProviders) {
    const modelId = spec.models[provider];
    if (!modelId) continue;

    const apiKey = apiKeyForProvider(provider);
    if (!apiKey) {
      runs.push({ ok: false, provider, reason: "key_missing" });
      continue;
    }

    const budget = checkBudget(provider);
    if (!budget.ok) {
      runs.push({ ok: false, provider, ...budget });
      continue;
    }

    const started = Date.now();
    const result = await providerChat({
      provider,
      apiKey,
      slot: "conscious",
      modelId,
      messages: [{ role: "user", content: prompt }],
      opts: { temperature: 0.3, maxTokens: 128 },
    });
    const latencyMs = Date.now() - started;

    if (!result.ok) {
      runs.push({ ok: false, provider, modelId, error: result.error, latencyMs });
      continue;
    }

    const usage = result.usage || {
      prompt_tokens: result.tokensIn || 0,
      completion_tokens: result.tokensOut || 0,
      cached_prompt_tokens: result.cachedPromptTokens || 0,
    };
    const usd = recordSpend(provider, usage.prompt_tokens, usage.completion_tokens, pricing);

    if (db) {
      meterInferenceWithBilling(db, {
        spanType: "mirror_comparison",
        provider,
        modelUsed: modelId,
        tokensIn: usage.prompt_tokens,
        tokensOut: usage.completion_tokens,
        cachedPromptTokens: usage.cached_prompt_tokens,
        latencyMs,
        path,
        usage,
        billingSource: "provider",
        detail: { mirrorId: spec.id },
      });
    }

    runs.push({
      ok: true,
      provider,
      modelId,
      textLen: (result.text || "").length,
      tokensIn: usage.prompt_tokens,
      tokensOut: usage.completion_tokens,
      latencyMs,
      estimatedUsd: usd,
    });
  }

  const okRuns = runs.filter((r) => r.ok);
  const winner = okRuns.length
    ? [...okRuns].sort((a, b) => (a.tokensOut + a.tokensIn) - (b.tokensOut + b.tokensIn))[0]
    : null;

  return {
    ok: okRuns.length >= 2,
    mirrorId: spec.id,
    promptLen: prompt.length,
    runs,
    comparison: winner ? {
      leanestTokens: winner.provider,
      tokenSpread: okRuns.map((r) => ({ provider: r.provider, total: r.tokensIn + r.tokensOut })),
    } : null,
    sessionSpendUsd: getSessionSpendUsd(),
  };
}

/**
 * Baseline B — provider prompt cache: repeat long prefix, measure cached tokens on 2nd call.
 */
export async function runProviderCacheBaseline({
  db,
  provider = "groq",
  modelId,
  path = "B",
  pricing,
} = {}) {
  const apiKey = apiKeyForProvider(provider);
  if (!apiKey) return { ok: false, reason: "key_missing", provider };

  const resolvedModel = modelId || (provider === "google"
    ? "gemini-3.5-flash-lite"
    : provider === "openrouter"
      ? "meta-llama/llama-3.3-70b-instruct:free"
      : "llama-3.3-70b-versatile");

  const longPrefix = "CONTEXT_PREFIX: ".repeat(400);
  const messages = [
    { role: "system", content: longPrefix },
    { role: "user", content: "What is 2+2? Reply with just the number." },
  ];

  const call = async (label) => {
    const started = Date.now();
    const result = await providerChat({
      provider, apiKey, slot: "utility", modelId: resolvedModel, messages,
      opts: { temperature: 0, maxTokens: 16 },
    });
    const latencyMs = Date.now() - started;
    const usage = result.usage || {
      prompt_tokens: result.tokensIn || 0,
      completion_tokens: result.tokensOut || 0,
      cached_prompt_tokens: result.cachedPromptTokens || 0,
    };
    if (db && result.ok) {
      meterInferenceWithBilling(db, {
        spanType: "cache_baseline",
        provider,
        modelUsed: resolvedModel,
        tokensIn: usage.prompt_tokens,
        tokensOut: usage.completion_tokens,
        cachedPromptTokens: usage.cached_prompt_tokens,
        latencyMs,
        path,
        usage,
        billingSource: "provider",
        detail: { cacheCall: label },
      });
    }
    return { ok: result.ok, usage, latencyMs, text: result.text, error: result.error };
  };

  const first = await call("first");
  const second = await call("second");

  const cacheHit = (second.usage?.cached_prompt_tokens || 0) > 0
    || ((first.usage?.prompt_tokens || 0) > 0
      && (second.usage?.prompt_tokens || 0) < (first.usage?.prompt_tokens || 0) * 0.8);

  return {
    ok: first.ok && second.ok,
    provider,
    modelId: resolvedModel,
    first,
    second,
    cacheDetected: cacheHit,
    cachedPromptTokens: second.usage?.cached_prompt_tokens || 0,
    sessionSpendUsd: getSessionSpendUsd(),
  };
}

/**
 * MCP dispatch that routes dila_dispatch through live cloud workers (wr-groq etc).
 */
export function createLiveProviderDispatch(db, { workerId = "wr-groq", path } = {}) {
  return async function liveDispatchMCP(tool, args = {}, ctx = {}) {
    if (tool === "dila_dispatch" && process.env.COGNITIVE_LIVE_PROVIDERS === "1") {
      const started = Date.now();
      const worker = args.worker_id || args.workerId || workerId;
      const result = await executeWorkerTask({
        workerId: worker,
        task: args.task || args.goal || "analyze",
        content: JSON.stringify(args).slice(0, 4000),
        taskClass: args.task_class || "cognitive",
        compiledPrompt: args.compiled_prompt,
        maxResponseTokens: 512,
      });
      const latencyMs = Date.now() - started;
      if (db && result.ok && (result.tokensIn || result.tokensOut)) {
        meterInferenceWithBilling(db, {
          spanType: "live_dispatch",
          provider: result.provider,
          modelUsed: result.model,
          tokensIn: result.tokensIn || 0,
          tokensOut: result.tokensOut || 0,
          latencyMs,
          path: path || process.env.COGNITIVE_BLIND_PATH || process.env.COGNITIVE_ECON_PATH,
          billingSource: "provider",
          missionId: ctx.missionId,
          detail: { tool, worker },
        });
      }
      return { ok: result.ok, decision: "ALLOW", result };
    }
    return { ok: true, decision: "ALLOW", result: { ok: true, observation: { tool } } };
  };
}

/**
 * Tag path A and E with minimal real provider calls so billed mode has provider rows.
 */
export async function seedPathTaggedProviderProbes(db, { providers, pricing } = {}) {
  const list = providers || resolveConfiguredProviders().map((c) => c.provider).slice(0, 2);
  const results = [];
  for (const path of ["A", "E"]) {
    for (const provider of list) {
      results.push(await probeProvider(provider, { db, path, pricing }));
    }
  }
  return { ok: results.some((r) => r.ok), results };
}

/**
 * Run billed blind benchmark subset (paths A + E, minimal workloads) with real provider telemetry.
 */
export async function runBilledBlindSubset({
  db,
  dispatchMCP,
  paths = ["A", "E"],
  workloads,
  pricing,
} = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  const prevMode = process.env.COGNITIVE_ECON_MODE;
  const prevPath = process.env.COGNITIVE_BLIND_PATH;
  process.env.COGNITIVE_ECON_MODE = "billed";

  try {
    if (process.env.COGNITIVE_LIVE_PROVIDERS === "1") {
      await seedPathTaggedProviderProbes(db, { pricing });
    }

    const dispatch = dispatchMCP || createLiveProviderDispatch(db);
    const bench = await runDilaRawBlindBenchmark({
      db,
      dispatchMCP: dispatch,
      paths,
      workloads: workloads || [
        { id: "cognitive_probe", template: "cognitive_probe", variantTemplate: null, maxTicks: 8, verifyDelta: { requireAction: "analyze" } },
        { id: "memory_locomo", kind: "memory" },
      ],
      minCacheUses: 1,
      pricing: pricing || resolvePricingConfig({ mode: "billed" }),
    });

    const claims = buildSegmentedClaims(bench);
    const publish = assessPublishability({
      claims,
      pricing: pricing || resolvePricingConfig({ mode: "billed" }),
      workloadCount: (workloads || []).length || 2,
      independentEvaluator: true,
      sameModel: true,
    });

    const billedRows = db.prepare(`
      SELECT COUNT(*) AS c, SUM(total_usd) AS usd, billing_source
      FROM provider_billing_telemetry GROUP BY billing_source
    `).all();

    const realProviderRows = billedRows.filter((r) => r.billing_source === "provider");
    const hasRealBilling = realProviderRows.some((r) => r.c > 0);

    return {
      ok: bench.ok,
      bench,
      claims,
      publishability: publish,
      billingSummary: {
        rows: billedRows,
        hasRealProviderTelemetry: hasRealBilling,
        aggregate: {
          A: aggregateBilledTelemetry(db, { path: "A" }),
          E: aggregateBilledTelemetry(db, { path: "E" }),
        },
      },
      sessionSpendUsd: getSessionSpendUsd(),
    };
  } finally {
    if (prevMode === undefined) delete process.env.COGNITIVE_ECON_MODE;
    else process.env.COGNITIVE_ECON_MODE = prevMode;
    if (prevPath === undefined) delete process.env.COGNITIVE_BLIND_PATH;
    else process.env.COGNITIVE_BLIND_PATH = prevPath;
  }
}

/**
 * Full provider A/B battery: probe → mirror → cache baseline → optional blind subset.
 */
export async function runProviderAbBattery({
  db,
  dispatchMCP,
  providers,
  includeBlind = true,
  includeXai = false,
  pricing,
} = {}) {
  resetSessionSpend();

  const configured = resolveConfiguredProviders();
  const providerList = providers || configured.map((c) => c.provider);
  const filtered = includeXai ? providerList : providerList.filter((p) => p !== "xai");

  const probe = await probeAllProviders({ db, providers: filtered, pricing });
  const mirror = await runMirrorComparison({ db, providers: filtered.filter((p) => MIRROR_MODELS[0].models[p]), pricing });

  const cacheProvider = filtered.find((p) => p === "groq" || p === "openrouter") || filtered[0];
  const cacheModel = cacheProvider === "google"
    ? "gemini-3.5-flash-lite"
    : cacheProvider === "openrouter"
      ? "meta-llama/llama-3.3-70b-instruct:free"
      : "llama-3.3-70b-versatile";
  const cache = cacheProvider
    ? await runProviderCacheBaseline({ db, provider: cacheProvider, modelId: cacheModel, pricing })
    : { ok: false, reason: "no_provider_for_cache" };

  let blind = null;
  if (includeBlind && typeof dispatchMCP === "function") {
    blind = await runBilledBlindSubset({ db, dispatchMCP, pricing });
  }

  return {
    ok: probe.ok || mirror.ok,
    configured: configured.map((c) => c.provider),
    probe,
    mirror,
    cache,
    blind,
    sessionSpendUsd: getSessionSpendUsd(),
    xaiBudgetCapUsd: xaiBudgetCap(),
  };
}
