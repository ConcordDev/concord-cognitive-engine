// server/lib/runtime/representation-sufficiency-bench.js
//
// Blind repeated benchmark: representation sufficiency across cognitive probes.
// Conditions: raw full · matched-budget truncated · random-budget sampled · DHTP packet.
//
// EVALUATOR NOTE: "blind" means the scorer never sees which condition produced
// the output. It is NOT automatically "independent" — the rubric-based scorer here
// is deterministic/heuristic. Publishable-grade evidence needs human spot-checks.

import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { compileExecutiveCognition } from "./dhtp-compiler.js";
import { getBlindPathConfig } from "./cognitive-economics.js";
import { estimateInvocationCost, resolvePricingConfig } from "./cognitive-economics.js";
import { estimateTokens } from "../token-budget-assembler.js";
import { countDtuCorpus } from "./cognitive-savings-ledger.js";
import { providerChat } from "../byo-providers.js";
import {
  SPEC_ID,
  BENCHMARK_VERSION,
  RUBRIC_VERSION,
  EVALUATOR_VERSION,
  FAILURE_CATEGORIES,
  ABLATION_CONDITIONS,
} from "./dhtp-rs-spec.js";
import { buildStatisticalReport } from "./dhtp-rs-statistics.js";

export const EVALUATOR_CAVEAT = Object.freeze({
  blind: true,
  independent: false,
  method: "deterministic_rubric",
  note: "Blind to condition, but not independent — add human scoring on a randomized subset for publishable evidence.",
});

export const REPRESENTATION_CONDITIONS = Object.freeze({
  raw_corpus: {
    id: "raw_corpus",
    label: "Raw corpus",
    pathId: "A",
    description: "Full DTU corpus serialized to JSON — no DHTP selection",
  },
  dhtp_packet: {
    id: "dhtp_packet",
    label: "DHTP packet",
    pathId: "C",
    description: "Task-sufficient cognitive packet via DHTP compiler",
  },
  matched_budget_raw: {
    id: "matched_budget_raw",
    label: "Matched-budget raw",
    pathId: "A",
    description: "Raw corpus head-truncated to same char budget as DHTP",
    truncateToDhtpBudget: true,
  },
  random_budget_raw: {
    id: "random_budget_raw",
    label: "Random-budget raw",
    pathId: "A",
    description: "Random DTU sample constrained to same char budget as DHTP",
    randomSampleToDhtpBudget: true,
  },
  // Ablation conditions (spec §11) — Step 3
  dhtp_full: {
    id: "dhtp_full",
    label: "DHTP full",
    pathId: "D",
    description: "DTU retrieval + DHTP cognitive packet (selection + structure)",
    ablation: "full",
  },
  selection_only: {
    id: "selection_only",
    label: "Selection only",
    pathId: "B",
    description: "Task-relevant DTU pack without DHTP compression",
    ablation: "selection",
  },
  structure_only: {
    id: "structure_only",
    label: "Structure only",
    pathId: "C",
    description: "DHTP structure on full corpus without DTU filter",
    ablation: "structure",
  },
});

export { ABLATION_CONDITIONS, FAILURE_CATEGORIES, SPEC_ID, BENCHMARK_VERSION };

export const DEFAULT_CONDITIONS = Object.freeze([
  "dhtp_packet",
  "matched_budget_raw",
  "random_budget_raw",
  "raw_corpus",
]);

const DELTA_BASE = `@RATIONALE_REF ledger:verified\n@CONFIDENCE 0.85`;

export const COGNITIVE_PROBES = Object.freeze({
  fleet_health: {
    id: "fleet_health",
    label: "Fleet health",
    goal: "Analyze fleet organ health via DHTP cognitive delta",
    template: "cognitive_probe",
    taskClass: "classification",
    delta: `@ACTION analyze\n${DELTA_BASE}\n@EXPECTED_RESULT structured_observation`,
    rubric: {
      taskKeywords: ["fleet", "organ", "health", "dhtp", "cognitive", "delta", "analy", "stable", "status"],
      schemaMarkers: ["summary", "assessment", "observation", "structured", "confidence", "stable"],
      failureMarkers: ["no schema", "cannot", "unable", "overload", "context length", "error parsing"],
      requiredConcepts: ["organ", "health"],
      minUsefulLength: 48,
    },
  },
  contradiction_detection: {
    id: "contradiction_detection",
    label: "Contradiction detection",
    goal: "Find conflicting DTUs in the corpus and determine which evidence is more reliable",
    template: "cognitive_probe",
    taskClass: "verification",
    delta: `@ACTION verify\n${DELTA_BASE}\n@EXPECTED_RESULT contradiction_report`,
    rubric: {
      taskKeywords: ["contradict", "conflict", "inconsist", "evidence", "reliable", "trust", "source"],
      schemaMarkers: ["report", "finding", "confidence", "because", "therefore", "compare"],
      failureMarkers: ["no schema", "cannot", "unable", "no contradict"],
      requiredConcepts: ["evidence", "reliable"],
      minUsefulLength: 40,
    },
  },
  decision: {
    id: "decision",
    label: "Decision",
    goal: "Choose between competing actions for fleet remediation and explain why",
    template: "cognitive_probe",
    taskClass: "decision",
    delta: `@ACTION decide\n${DELTA_BASE}\n@EXPECTED_RESULT decision_with_rationale`,
    rubric: {
      taskKeywords: ["decide", "choose", "action", "recommend", "because", "rationale", "tradeoff", "priority"],
      schemaMarkers: ["decision", "recommend", "rationale", "confidence", "action"],
      failureMarkers: ["no schema", "cannot decide", "unclear"],
      requiredConcepts: ["action", "because"],
      minUsefulLength: 40,
    },
  },
  temporal_reasoning: {
    id: "temporal_reasoning",
    label: "Temporal reasoning",
    goal: "Identify what changed in fleet state and distinguish current from historical observations",
    template: "cognitive_probe",
    taskClass: "temporal",
    delta: `@ACTION analyze\n${DELTA_BASE}\n@EXPECTED_RESULT temporal_delta_summary`,
    rubric: {
      taskKeywords: ["change", "current", "histor", "before", "after", "delta", "temporal", "recent", "prior"],
      schemaMarkers: ["summary", "changed", "current", "historical", "timeline"],
      failureMarkers: ["no schema", "cannot", "unable"],
      requiredConcepts: ["change", "current"],
      minUsefulLength: 40,
    },
  },
  anomaly_detection: {
    id: "anomaly_detection",
    label: "Anomaly detection",
    goal: "Find unusual behavior in fleet telemetry and identify supporting DTUs",
    template: "cognitive_probe",
    taskClass: "anomaly",
    delta: `@ACTION analyze\n${DELTA_BASE}\n@EXPECTED_RESULT anomaly_report`,
    rubric: {
      taskKeywords: ["anomal", "unusual", "outlier", "abnormal", "support", "evidence", "dtu", "detect"],
      schemaMarkers: ["report", "anomal", "finding", "evidence", "support"],
      failureMarkers: ["no schema", "no anomal", "nothing unusual"],
      requiredConcepts: ["anomal", "evidence"],
      minUsefulLength: 40,
    },
  },
  planning: {
    id: "planning",
    label: "Planning",
    goal: "Generate next actions from distributed fleet state and order them by priority",
    template: "cognitive_probe",
    taskClass: "planning",
    delta: `@ACTION plan\n${DELTA_BASE}\n@EXPECTED_RESULT action_plan`,
    rubric: {
      taskKeywords: ["plan", "next", "action", "step", "priority", "order", "sequence", "execute"],
      schemaMarkers: ["plan", "step", "priority", "action", "order"],
      failureMarkers: ["no schema", "cannot plan", "no actions"],
      requiredConcepts: ["action", "priority"],
      minUsefulLength: 40,
    },
  },
});

/** @deprecated use COGNITIVE_PROBES.fleet_health.rubric */
export const COGNITIVE_PROBE_RUBRIC = COGNITIVE_PROBES.fleet_health.rubric;

function benchRunId() {
  return `rsb_${crypto.randomUUID().slice(0, 12)}`;
}

function hashText(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);
}

/** Classify failed or low-quality trials (spec §18). */
export function classifyTrialFailure(run) {
  if (!run?.ok) {
    return { category: "harness_error", detail: run?.reason || "run_not_ok" };
  }
  const live = run.live || {};
  const ev = run.evaluation || {};
  if (live.apiFailure) {
    return { category: "api_failure", detail: live.error || "provider_error" };
  }
  if (live.timedOut) {
    return { category: "timeout", detail: "request_timeout" };
  }
  if (ev.empty || !live.preview) {
    return { category: "malformed_response", detail: "empty_or_trivial" };
  }
  const preview = String(live.preview || "").toLowerCase();
  if (preview.includes("no schema") || ev.dimensions?.schemaAdherence < 0.15) {
    return { category: "schema_failure", detail: "schema_not_adhered" };
  }
  if (ev.composite < 0.35) {
    if (ev.dimensions?.hallucinationScore < 0.5) {
      return { category: "hallucination", detail: "unsupported_claims" };
    }
    if (ev.dimensions?.factualCoverage < 0.3) {
      return { category: "missing_information", detail: "low_factual_coverage" };
    }
    return { category: "model_reasoning_failure", detail: "low_composite_score" };
  }
  return null;
}

export function summarizeFailureBreakdown(runs) {
  const breakdown = Object.fromEntries(FAILURE_CATEGORIES.map((c) => [c, 0]));
  for (const run of runs) {
    const failure = classifyTrialFailure(run);
    if (failure) breakdown[failure.category] = (breakdown[failure.category] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(breakdown).filter(([, n]) => n > 0),
  );
}

export function buildReproducibilityManifest({
  runId,
  trials,
  conditions,
  probes,
  seed = 0,
  provider = "google",
  model = null,
  temperature = 0.3,
  repoRoot,
} = {}) {
  let gitCommit = "unknown";
  try {
    gitCommit = execSync("git rev-parse HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { /* offline or no git */ }

  const sampleProbe = COGNITIVE_PROBES[probes?.[0]] || COGNITIVE_PROBES.fleet_health;
  const systemPromptHash = hashText("representation_sufficiency_bench_v1");
  const taskPromptHash = hashText(`${sampleProbe.goal}\n${sampleProbe.delta}`);

  return {
    specId: SPEC_ID,
    benchmarkVersion: BENCHMARK_VERSION,
    rubricVersion: RUBRIC_VERSION,
    evaluatorVersion: EVALUATOR_VERSION,
    runId,
    gitCommit,
    timestamp: new Date().toISOString(),
    trials,
    conditions,
    probes,
    corpusIdentifier: "cognitive_savings_ledger_bench_seed_50",
    randomSeed: seed,
    provider,
    model: model || "gemini-3.6-flash",
    temperature,
    systemPromptHash,
    taskPromptHash,
    evaluatorBlind: true,
    evaluatorIndependent: false,
  };
}

function anonymizeSubmission() {
  return `sub_${crypto.randomUUID().slice(0, 10)}`;
}

function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function safeParseBody(json) {
  try { return JSON.parse(json); } catch { return {}; }
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Retry provider calls on rate-limit / transient failures. */
export async function callProviderWithRetry(providerChatFn, args, {
  maxRetries = 5,
  baseDelayMs = 3000,
  maxDelayMs = 60_000,
} = {}) {
  let last = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    last = await providerChatFn(args);
    const err = String(last?.error || "");
    const retryable = !last.ok && (
      /429|rate.?limit|quota|resource.?exhaust|too many|overloaded|503|502|500/i.test(err)
      || (last.tokensIn === 0 && !last.text && err.length > 0)
    );
    if (!retryable || attempt === maxRetries) return last;
    const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
    await sleep(delay);
  }
  return last;
}

function buildRandomSamplePayload(db, ctx, budgetChars, seed) {
  const corpus = countDtuCorpus(db);
  const rows = seededShuffle(corpus.rows || [], seed);
  const prefix = "RAW_CONTEXT\n";
  const suffix = "\n[RANDOM_SAMPLE_TO_MATCH_DHTP_BUDGET]";
  const overhead = prefix.length + suffix.length + 80;
  const budget = Math.max(200, budgetChars - overhead);

  const selected = [];
  let used = 0;
  for (const row of rows) {
    const entry = {
      id: row.id,
      title: row.title,
      kind: row.memory_kind,
      body: safeParseBody(row.body_json),
    };
    const snippet = JSON.stringify(entry);
    if (used + snippet.length > budget) break;
    selected.push(entry);
    used += snippet.length + 1;
  }

  const payload = JSON.stringify({
    mission: { id: ctx.mission.id, goal: ctx.mission.goal, template: ctx.mission.template },
    sampleMethod: "random_dtu_selection",
    dtuSample: selected,
    sampleCount: selected.length,
    corpusSize: corpus.candidates,
  }, null, 2);

  return `${prefix}${payload.slice(0, budget)}${suffix}`;
}

/**
 * Blind rubric evaluator — scores text against task rubric only.
 * Does NOT receive condition identity. See EVALUATOR_CAVEAT.
 */
export function evaluateRepresentationOutput({
  submissionId,
  task,
  responseText,
  timedOut = false,
  empty = false,
  apiFailure = false,
} = {}) {
  const rubric = task?.rubric || COGNITIVE_PROBES.fleet_health.rubric;
  const text = String(responseText || "").trim();
  const lower = text.toLowerCase();

  if (timedOut || empty || apiFailure || text.length < 8) {
    return {
      ok: true,
      submissionId: submissionId || anonymizeSubmission(),
      timedOut: !!timedOut,
      empty: empty || text.length < 8,
      apiFailure: !!apiFailure,
      dimensions: {
        taskCorrectness: 0,
        factualCoverage: 0,
        hallucinationScore: 0,
        importantFactRecall: 0,
        schemaAdherence: 0,
      },
      composite: 0,
      failureReason: timedOut ? "timeout" : apiFailure ? "api_failure" : "empty_or_trivial",
    };
  }

  const taskHits = rubric.taskKeywords.filter((k) => lower.includes(k.toLowerCase()));
  const taskCorrectness = Math.min(1, taskHits.length / Math.max(3, rubric.taskKeywords.length * 0.4));

  const schemaHits = rubric.schemaMarkers.filter((m) => lower.includes(m.toLowerCase()));
  const schemaAdherence = Math.min(1, schemaHits.length / 3);

  const conceptHits = rubric.requiredConcepts.filter((c) => lower.includes(c.toLowerCase()));
  const importantFactRecall = conceptHits.length / rubric.requiredConcepts.length;

  const failureHits = rubric.failureMarkers.filter((m) => lower.includes(m.toLowerCase()));
  const hallucinationScore = Math.max(0, 1 - failureHits.length * 0.35);

  const lengthFactor = Math.min(1, text.length / rubric.minUsefulLength);
  const relevanceFactor = taskHits.length > 0 ? 1 : 0.2;
  const factualCoverage = lengthFactor * relevanceFactor * (1 - failureHits.length * 0.15);

  const composite = (
    taskCorrectness * 0.30
    + schemaAdherence * 0.20
    + importantFactRecall * 0.20
    + hallucinationScore * 0.15
    + factualCoverage * 0.15
  );

  return {
    ok: true,
    submissionId: submissionId || anonymizeSubmission(),
    timedOut: false,
    empty: false,
    apiFailure: false,
    dimensions: {
      taskCorrectness,
      factualCoverage,
      hallucinationScore,
      importantFactRecall,
      schemaAdherence,
    },
    composite: Math.min(1, Math.max(0, composite)),
    taskKeywordHits: taskHits.length,
    schemaMarkerHits: schemaHits.length,
    responseLength: text.length,
  };
}

export function buildMissionContext(probeId, trialIndex) {
  const probe = COGNITIVE_PROBES[probeId] || COGNITIVE_PROBES.fleet_health;
  return {
    probeId: probe.id,
    mission: {
      id: `mis_rsb_${probe.id}_${trialIndex}`,
      goal: probe.goal,
      template: probe.template,
      status: "running",
    },
    step: {
      tool: "cognitive_delta_execute",
      args: { text: probe.delta },
    },
    route: { taskClass: probe.taskClass },
    context: {
      observation: {
        missions_running: 1 + (trialIndex % 3),
        alerts_open: trialIndex % 2,
        probe: probe.id,
      },
    },
    rubric: probe.rubric,
  };
}

async function compileForCondition(db, conditionId, ctx, { dhtpBudgetChars, trialIndex = 0 } = {}) {
  const cond = REPRESENTATION_CONDITIONS[conditionId];
  if (!cond) return { ok: false, reason: "unknown_condition" };

  const path = getBlindPathConfig(cond.pathId);
  const compiled = await compileExecutiveCognition({
    db,
    mission: ctx.mission,
    step: ctx.step,
    stepIndex: 1,
    route: ctx.route,
    ledger: {},
    lessons: [],
    context: ctx.context,
    bumpRecall: false,
    ...path.compile,
  });

  let systemPrompt = compiled.systemPrompt;
  let userPrompt = compiled.userPrompt;

  if (cond.truncateToDhtpBudget && dhtpBudgetChars > 0) {
    const rawPrefix = "RAW_CONTEXT\n";
    const payload = systemPrompt.startsWith(rawPrefix)
      ? systemPrompt.slice(rawPrefix.length)
      : systemPrompt;
    const budget = Math.max(200, dhtpBudgetChars - rawPrefix.length);
    systemPrompt = `${rawPrefix}${payload.slice(0, budget)}\n[TRUNCATED_TO_MATCH_DHTP_BUDGET]`;
  } else if (cond.randomSampleToDhtpBudget && dhtpBudgetChars > 0) {
    const seed = trialIndex * 997 + ctx.probeId.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
    systemPrompt = buildRandomSamplePayload(db, ctx, dhtpBudgetChars, seed);
    userPrompt = `@REQUEST execute\n@OBJECTIVE ${ctx.mission.goal}`;
  }

  const promptChars = systemPrompt.length + userPrompt.length;
  const estTokens = estimateTokens(`${systemPrompt}\n${userPrompt}`);

  return {
    ok: true,
    conditionId,
    systemPrompt,
    userPrompt,
    savings: compiled.savings || {},
    promptChars,
    estInputTokens: compiled.savings?.actualModelInputTokens ?? estTokens,
  };
}

/**
 * Run one trial for one condition + probe — compile, call provider, blind-evaluate.
 */
export async function runRepresentationTrial({
  db,
  conditionId,
  probeId = "fleet_health",
  trialIndex = 0,
  provider = "google",
  apiKey,
  dhtpBudgetChars,
  pricing,
  timeoutMs = 120_000,
  maxOutputTokens = 256,
  callProvider = providerChat,
  interCallDelayMs = 0,
  maxRetries = 5,
} = {}) {
  if (!db || (!apiKey && !callProvider)) return { ok: false, reason: "missing_db_or_key" };

  const ctx = buildMissionContext(probeId, trialIndex);
  const compiled = await compileForCondition(db, conditionId, ctx, { dhtpBudgetChars, trialIndex });
  if (!compiled.ok) return compiled;

  const priceConfig = pricing || resolvePricingConfig({ mode: "billed" });
  const started = Date.now();
  let timedOut = false;
  let apiFailure = false;
  let chat;

  if (interCallDelayMs > 0) await sleep(interCallDelayMs);

  try {
    chat = await callProviderWithRetry(callProvider, {
      provider,
      apiKey,
      slot: conditionId === "raw_corpus" ? "conscious" : "utility",
      messages: [
        { role: "system", content: compiled.systemPrompt },
        { role: "user", content: compiled.userPrompt },
      ],
      opts: { maxTokens: maxOutputTokens, temperature: 0.3, timeoutMs },
    }, { maxRetries });
  } catch (e) {
    timedOut = /timeout|aborted/i.test(e?.message || "");
    apiFailure = !timedOut;
    chat = { ok: false, text: "", error: e?.message, tokensIn: 0, tokensOut: 0 };
  }

  const latencyMs = Date.now() - started;
  if (!chat.ok) {
    if (/timeout|aborted/i.test(chat.error || "")) timedOut = true;
    else if (!chat.text?.trim()) apiFailure = true;
  }

  const usage = chat.usage || { prompt_tokens: chat.tokensIn, completion_tokens: chat.tokensOut };
  const tokensIn = usage.prompt_tokens || 0;
  const tokensOut = usage.completion_tokens || 0;
  const cost = estimateInvocationCost({ inputTokens: tokensIn, outputTokens: tokensOut, pricing: priceConfig });

  const evaluation = evaluateRepresentationOutput({
    submissionId: anonymizeSubmission(),
    task: { rubric: ctx.rubric, goal: ctx.mission.goal },
    responseText: chat.text || "",
    timedOut,
    empty: !chat.text?.trim(),
    apiFailure,
  });

  const composite = evaluation.composite;
  const usefulPerToken = composite / Math.max(tokensIn, 1);
  const usefulPerDollar = composite / Math.max(cost.totalUsd, 1e-9);
  const usefulPerSecond = composite / Math.max(latencyMs / 1000, 0.001);

  return {
    ok: true,
    probeId,
    trialIndex,
    conditionId,
    compile: {
      promptChars: compiled.promptChars,
      estInputTokens: compiled.estInputTokens,
      dhtpPacketTokens: compiled.savings?.dhtpTokens,
    },
    live: {
      ok: chat.ok !== false && !timedOut && !apiFailure,
      model: chat.model,
      tokensIn,
      tokensOut,
      costUsd: cost.totalUsd,
      latencyMs,
      timedOut,
      apiFailure,
      preview: (chat.text || "").slice(0, 160).replace(/\s+/g, " "),
      error: chat.error,
    },
    evaluation,
    efficiency: {
      usefulPerToken,
      usefulPerDollar,
      usefulPerSecond,
    },
  };
}

export function aggregateConditionRuns(runs) {
  const n = runs.length || 1;
  const sum = (fn) => runs.reduce((s, r) => s + fn(r), 0);
  const avg = (fn) => sum(fn) / n;
  const timeouts = runs.filter((r) => r.live?.timedOut).length;
  const apiFailures = runs.filter((r) => r.live?.apiFailure).length;
  const successes = runs.filter((r) => r.live?.ok).length;

  return {
    trials: n,
    successRate: successes / n,
    timeoutRate: timeouts / n,
    apiFailureRate: apiFailures / n,
    avgComposite: avg((r) => r.evaluation?.composite ?? 0),
    avgTaskCorrectness: avg((r) => r.evaluation?.dimensions?.taskCorrectness ?? 0),
    avgFactualCoverage: avg((r) => r.evaluation?.dimensions?.factualCoverage ?? 0),
    avgHallucinationScore: avg((r) => r.evaluation?.dimensions?.hallucinationScore ?? 0),
    avgImportantFactRecall: avg((r) => r.evaluation?.dimensions?.importantFactRecall ?? 0),
    avgSchemaAdherence: avg((r) => r.evaluation?.dimensions?.schemaAdherence ?? 0),
    avgTokensIn: avg((r) => r.live?.tokensIn ?? 0),
    avgTokensOut: avg((r) => r.live?.tokensOut ?? 0),
    avgCostUsd: avg((r) => r.live?.costUsd ?? 0),
    avgLatencyMs: avg((r) => r.live?.latencyMs ?? 0),
    avgUsefulPerToken: avg((r) => r.efficiency?.usefulPerToken ?? 0),
    avgUsefulPerDollar: avg((r) => r.efficiency?.usefulPerDollar ?? 0),
    avgUsefulPerSecond: avg((r) => r.efficiency?.usefulPerSecond ?? 0),
    totalCostUsd: sum((r) => r.live?.costUsd ?? 0),
  };
}

export function confidenceInterval95(values) {
  const n = values.length;
  if (n < 2) return { low: values[0] ?? 0, high: values[0] ?? 0, mean: values[0] ?? 0, n };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance) / Math.sqrt(n);
  return { low: mean - 1.96 * se, high: mean + 1.96 * se, mean, n };
}

function buildHeadline(aggregates) {
  const raw = aggregates.raw_corpus;
  const dhtp = aggregates.dhtp_packet;
  const matched = aggregates.matched_budget_raw;
  const random = aggregates.random_budget_raw;

  return {
    thesis: "Concord compiles distributed cognitive state into a task-sufficient representation before inference.",
    primaryClaim: raw && dhtp
      ? `${(dhtp.avgComposite * 100).toFixed(1)}% task quality at ~${Math.round(dhtp.avgTokensIn)} tokens vs ${(raw.avgComposite * 100).toFixed(1)}% at ~${Math.round(raw.avgTokensIn)} tokens`
      : null,
    controlClaim: matched && dhtp
      ? `${(dhtp.avgComposite * 100).toFixed(1)}% vs ${(matched.avgComposite * 100).toFixed(1)}% at matched char budget (truncated raw)`
      : null,
    randomControlClaim: random && dhtp
      ? `${(dhtp.avgComposite * 100).toFixed(1)}% vs ${(random.avgComposite * 100).toFixed(1)}% at matched char budget (random DTU sample)`
      : null,
    dhtpVsRaw: raw && dhtp ? {
      qualityDelta: dhtp.avgComposite - raw.avgComposite,
      tokenReductionPct: raw.avgTokensIn > 0 ? ((raw.avgTokensIn - dhtp.avgTokensIn) / raw.avgTokensIn) * 100 : null,
      dhtpQualityGteRaw: dhtp.avgComposite >= raw.avgComposite - 0.05,
      rawApiFailureRate: raw.apiFailureRate,
      rawTimeoutRate: raw.timeoutRate,
    } : null,
    dhtpVsMatchedBudget: matched && dhtp ? {
      qualityDelta: dhtp.avgComposite - matched.avgComposite,
      sameBudgetQualityWin: dhtp.avgComposite > matched.avgComposite + 0.05,
    } : null,
    dhtpVsRandomBudget: random && dhtp ? {
      qualityDelta: dhtp.avgComposite - random.avgComposite,
      selectionBeatsRandom: dhtp.avgComposite > random.avgComposite + 0.05,
    } : null,
    secondaryMetric: raw && dhtp && raw.avgUsefulPerToken > 0 ? {
      usefulPerTokenMultiplier: dhtp.avgUsefulPerToken / raw.avgUsefulPerToken,
      note: "Secondary efficiency metric — not the primary scientific claim",
    } : null,
    evaluatorCaveat: EVALUATOR_CAVEAT,
  };
}

/**
 * Run blind repeated benchmark for one probe across conditions.
 */
export async function runProbeBench({
  db,
  probeId = "fleet_health",
  trials = 10,
  conditions = DEFAULT_CONDITIONS,
  provider = "google",
  apiKey,
  pricing,
  timeoutMs = 120_000,
  callProvider = providerChat,
  interCallDelayMs = 0,
  maxRetries = 5,
  onTrialComplete,
} = {}) {
  const sampleCtx = buildMissionContext(probeId, 0);
  const dhtpCompiled = await compileForCondition(db, "dhtp_packet", sampleCtx, { trialIndex: 0 });
  const dhtpBudgetChars = dhtpCompiled.promptChars || 900;
  const priceConfig = pricing || resolvePricingConfig({ mode: "billed" });

  const byCondition = {};
  const allRuns = [];

  for (const conditionId of conditions) {
    byCondition[conditionId] = [];
    for (let t = 0; t < trials; t += 1) {
      const run = await runRepresentationTrial({
        db,
        conditionId,
        probeId,
        trialIndex: t,
        provider,
        apiKey,
        dhtpBudgetChars,
        pricing: priceConfig,
        timeoutMs,
        callProvider,
        interCallDelayMs,
        maxRetries,
      });
      byCondition[conditionId].push(run);
      allRuns.push(run);
      if (typeof onTrialComplete === "function") {
        onTrialComplete({ run, probeId, conditionId, trialIndex: t });
      }
    }
  }

  const aggregates = {};
  const aggregatesSuccessfulOnly = {};
  for (const [cond, runs] of Object.entries(byCondition)) {
    const okRuns = runs.filter((r) => r.ok);
    aggregates[cond] = aggregateConditionRuns(okRuns);
    aggregatesSuccessfulOnly[cond] = aggregateConditionRuns(
      okRuns.filter((r) => r.live?.ok && !r.live?.apiFailure),
    );
  }

  const compositeCIs = {};
  for (const cond of conditions) {
    const scores = (byCondition[cond] || []).map((r) => r.evaluation?.composite ?? 0);
    compositeCIs[cond] = confidenceInterval95(scores);
  }

  return {
    probeId,
    probeLabel: COGNITIVE_PROBES[probeId]?.label || probeId,
    trials,
    conditions,
    dhtpBudgetChars,
    aggregates,
    aggregatesSuccessfulOnly,
    compositeCIs,
    headline: buildHeadline(aggregates),
    headlineSuccessfulOnly: buildHeadline(aggregatesSuccessfulOnly),
    runs: byCondition,
    totalCostUsd: allRuns.reduce((s, r) => s + (r.live?.costUsd ?? 0), 0),
  };
}

/**
 * Full benchmark: N trials × conditions × probes.
 */
export async function runRepresentationSufficiencyBench({
  db,
  trials = 10,
  conditions = DEFAULT_CONDITIONS,
  probes = ["fleet_health"],
  provider = "google",
  apiKey,
  pricing,
  timeoutMs = 120_000,
  callProvider = providerChat,
  interCallDelayMs = 2000,
  maxRetries = 5,
  onTrialComplete,
} = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!apiKey && !callProvider) return { ok: false, reason: "api_key_missing" };

  const runId = benchRunId();
  const started = Date.now();
  const probeResults = {};

  for (const probeId of probes) {
    probeResults[probeId] = await runProbeBench({
      db,
      probeId,
      trials,
      conditions,
      provider,
      apiKey,
      pricing,
      timeoutMs,
      callProvider,
      interCallDelayMs,
      maxRetries,
      onTrialComplete,
    });
  }

  const allRuns = Object.values(probeResults).flatMap((p) =>
    Object.values(p.runs || {}).flat(),
  );
  const overallAggregates = {};
  const overallSuccessfulOnly = {};
  for (const cond of conditions) {
    const condRuns = allRuns.filter((r) => r.conditionId === cond && r.ok);
    overallAggregates[cond] = aggregateConditionRuns(condRuns);
    overallSuccessfulOnly[cond] = aggregateConditionRuns(
      condRuns.filter((r) => r.live?.ok && !r.live?.apiFailure),
    );
  }

  const headline = buildHeadline(overallAggregates);
  const headlineSuccessfulOnly = buildHeadline(overallSuccessfulOnly);
  const targetMet = headline.dhtpVsRaw?.dhtpQualityGteRaw
    && (headline.dhtpVsMatchedBudget?.sameBudgetQualityWin ?? false)
    && (headline.dhtpVsRandomBudget?.selectionBeatsRandom ?? false);

  const runsByCondition = {};
  for (const cond of conditions) runsByCondition[cond] = [];
  for (const run of allRuns) {
    if (run.conditionId) runsByCondition[run.conditionId].push(run);
  }

  const statistics = buildStatisticalReport({ runsByCondition, conditions });
  const failureBreakdown = summarizeFailureBreakdown(allRuns);
  const sampleModel = allRuns.find((r) => r.live?.model)?.live?.model || null;
  const manifest = buildReproducibilityManifest({
    runId,
    trials,
    conditions,
    probes,
    provider,
    model: sampleModel,
    repoRoot: process.env.CONCORD_REPO_ROOT || undefined,
  });

  return {
    ok: true,
    runId,
    durationMs: Date.now() - started,
    trials,
    conditions,
    probes,
    probeResults,
    overall: {
      aggregates: overallAggregates,
      aggregatesSuccessfulOnly: overallSuccessfulOnly,
      headline,
      headlineSuccessfulOnly,
    },
    headline,
    headlineSuccessfulOnly,
    targetMet,
    evaluatorCaveat: EVALUATOR_CAVEAT,
    totalCostUsd: allRuns.reduce((s, r) => s + (r.live?.costUsd ?? 0), 0),
    statistics,
    failureBreakdown,
    manifest,
  };
}
