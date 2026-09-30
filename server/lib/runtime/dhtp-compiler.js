// server/lib/runtime/dhtp-compiler.js
//
// DHTP compiler — canonical world state → compact cognitive packet → model router.
// Sits between Dila executive cognition and all LLM call sites.

import { applyDHTP, getBlockCache } from "../dhtp.js";
import { loadRecallPack, bumpRecallCounts } from "../dila-recall.js";
import { estimateTokens } from "../token-budget-assembler.js";
import {
  buildCognitiveIR,
  parseCognitiveDelta,
  validateCognitiveDelta,
} from "../dhtp-cognitive-ir.js";
import { buildCompressionPolicy, minimumRepresentationForTask } from "./dhtp-policy.js";
import { recordDhtpMetric } from "./dhtp-metrics.js";
import { recordFieldOutcomes } from "./dhtp-policy-learner.js";
import { tryCognitiveCache, fingerprintCognition } from "./cognitive-cache.js";
import {
  buildCognitiveSavingsSnapshot,
  recordCognitiveSavings,
  countDtuCorpus,
  estimateRecallPackTokens,
} from "./cognitive-savings-ledger.js";
import { compileCognitivePacket } from "./dhtp-cognitive-compiler.js";
import { compileMinimumSufficientCognition } from "./cognitive-compiler-v2.js";
import { reasoningLevelToRouteHints } from "./reasoning-ladder.js";
import { recordProviderBilling } from "./provider-billing.js";

const DILA_EXECUTIVE_IDENTITY = [
  "You are Dila, Concord's executive agent.",
  "You receive DHTP-2 cognitive packets — typed fields, not prose walls.",
  "Respond with structured deltas: @ACTION @RATIONALE_REF @CONFIDENCE @EXPECTED_RESULT.",
  "You propose cognition. Concord owns reality. Never assume mutations committed.",
].join(" ");

function safeParseBody(json) {
  if (!json) return {};
  try { return JSON.parse(json); } catch { return {}; }
}

/**
 * Map recall pack + executive context → DHTP DTU refs.
 */
function recallToDhtpDtus(recallPack) {
  if (!recallPack?.ok) return [];
  const dtus = [];
  for (const r of recallPack.recent || []) {
    dtus.push({ id: r.id, title: r.title, tier: r.tier || r.memory_kind || "regular", updatedAt: r.created_at });
  }
  for (const r of recallPack.pinned || []) {
    if (!dtus.find((d) => d.id === r.id)) {
      dtus.push({ id: r.id, title: r.title, tier: "pinned", updatedAt: r.created_at });
    }
  }
  return dtus;
}

/**
 * Compile executive world state into DHTP cognitive transport packet.
 */
export async function compileExecutiveCognition({
  db,
  mission,
  step,
  stepIndex,
  route,
  ledger,
  lessons,
  context,
  request,
  expectedOutput,
  bumpRecall = true,
  pathVariant = "executive",
  skipCache = false,
  skipDhtp = false,
  useRawJson = false,
  skipDtuFilter = false,
} = {}) {
  const goal = mission?.goal || mission?.title || step?.tool || "";
  let recallPack = null;
  const useFullCorpus = skipDtuFilter || pathVariant === "dhtp_only";
  if (db) {
    try {
      if (useFullCorpus) {
        const corpus = countDtuCorpus(db);
        recallPack = {
          ok: true,
          recent: corpus.rows.map((r) => ({
            id: r.id,
            title: r.title,
            tier: r.tier,
            memory_kind: r.memory_kind,
            created_at: r.created_at,
          })),
          pinned: [],
        };
      } else {
        recallPack = loadRecallPack(db);
        if (bumpRecall && recallPack?.ok) bumpRecallCounts(db, recallPack);
      }
    } catch { /* optional */ }
  }

  const ir = buildCognitiveIR({
    mission,
    step,
    stepIndex,
    route,
    ledger,
    lessons,
    recallPack,
    observation: context?.observation,
    priorSteps: context?.priorSteps,
    request: request || `execute:${step?.tool || "step"}`,
    expectedOutput: expectedOutput || "structured_delta",
    repoContext: context?.repoContext,
    toolHints: context?.toolHints,
  });

  const fingerprint = fingerprintCognition({ mission, step, ir, goal });
  const cognitiveCache = (!skipCache && db)
    ? tryCognitiveCache(db, { mission, step, ir })
    : { cacheHit: false, fingerprint };

  const policy = buildCompressionPolicy(ir, {
    stepIndex,
    missionAge: mission?.tick_count || 0,
    db,
    taskClass: route?.taskClass,
  });

  let serialized;
  let cognitiveCompilerMeta = null;
  if (useRawJson) {
    const corpus = countDtuCorpus(db);
    const rawPayload = {
      mission: { id: mission?.id, goal, template: mission?.template },
      step: { tool: step?.tool, index: stepIndex },
      ledger,
      lessons,
      context,
      dtuCorpus: corpus.rows.map((r) => ({
        id: r.id,
        title: r.title,
        kind: r.memory_kind,
        body: safeParseBody(r.body_json),
      })),
    };
    const rawText = JSON.stringify(rawPayload, null, 2);
    serialized = {
      packet: rawText,
      fullContextTokens: estimateTokens(rawText),
      packetTokens: estimateTokens(rawText),
      tokensSaved: 0,
      compressionRatio: 1,
    };
  } else if (skipDhtp) {
    const dtuContent = estimateRecallPackTokens(db, recallPack);
    const filteredPayload = {
      mission: { id: mission?.id, goal, template: mission?.template },
      step: { tool: step?.tool, index: stepIndex },
      ir,
      recallPack: recallPack?.ok ? {
        recent: recallPack.recent,
        pinned: recallPack.pinned,
        identity_present: recallPack.identity_present,
      } : null,
    };
    const filteredText = JSON.stringify(filteredPayload, null, 2);
    serialized = {
      packet: filteredText,
      fullContextTokens: estimateTokens(filteredText),
      packetTokens: estimateTokens(filteredText),
      tokensSaved: 0,
      compressionRatio: 1,
    };
  } else {
    const policyFn = (field, value) => {
      const p = policy[field];
      if (p) return p;
      return { compressionLevel: "compact", decisionImpact: 0.5, importance: 0.5, freshness: 0.5 };
    };
    const v2 = compileMinimumSufficientCognition({
      ir,
      mission,
      step,
      stepIndex,
      route,
      db,
      recallPack,
      context,
      cacheHit: cognitiveCache.cacheHit,
      pceEligible: step?.tool === "pce_execute",
    });
    serialized = v2.compiled || compileCognitivePacket(ir, { policyFn });
    cognitiveCompilerMeta = {
      version: v2.version || "v1",
      tierCounts: serialized.tierCounts,
      forbiddenCount: serialized.forbiddenCount,
      fieldTiers: serialized.fieldTiers,
      recoveryContracts: v2.recoveryContracts,
      recoverableFieldCount: v2.recoverableFieldCount,
      anticipation: v2.anticipation?.predictiveGraph,
      governor: v2.governor ? {
        promoted: v2.governor.promoted,
        tokenSavingsPct: v2.governor.metrics?.tokenSavingsPct,
      } : null,
      reasoningLadder: v2.reasoningLadder,
      selfModel: v2.selfModel,
      optimization: v2.optimization,
    };
  }

  const workingSetDtus = recallToDhtpDtus(recallPack);
  const dtuBlockCache = getBlockCache();
  const block = dtuBlockCache.get(workingSetDtus);

  const dhtpLayer = skipDhtp
    ? { presetId: null, compressed: false, originalChars: 0, compressedChars: 0 }
    : applyDHTP({
      prompt: goal,
      workingSetDtus,
      baseSystemPrompt: DILA_EXECUTIVE_IDENTITY,
    });

  const cognitivePacket = skipDhtp ? serialized.packet : serialized.packet;
  const systemPrompt = useRawJson
    ? `RAW_CONTEXT\n${serialized.packet}`
    : [
      skipDhtp ? DILA_EXECUTIVE_IDENTITY : (dhtpLayer.compressed ? dhtpLayer.systemPrompt.split("\n")[0] : DILA_EXECUTIVE_IDENTITY),
      "",
      cognitivePacket,
      block.refs ? `[MEM]${block.refs}` : "",
    ].filter(Boolean).join("\n");

  const userPrompt = useRawJson
    ? `@REQUEST execute\n@OBJECTIVE ${goal}`
    : `@REQUEST ${ir.REQUEST}\n@OBJECTIVE ${ir.OBJECTIVE}`;

  const minRep = cognitiveCompilerMeta?.reasoningLadder
    ? cognitiveCompilerMeta.reasoningLadder
    : minimumRepresentationForTask({
      taskClass: route?.taskClass,
      deterministicEligible: step?.tool === "pce_execute",
    });

  const routeHintsFromLadder = cognitiveCompilerMeta?.reasoningLadder
    ? reasoningLevelToRouteHints(cognitiveCompilerMeta.reasoningLadder)
    : null;

  const compiled = {
    ok: true,
    systemPrompt,
    userPrompt,
    cognitivePacket,
    ir,
    policy,
    fingerprint,
    cacheHit: cognitiveCache.cacheHit,
    cachedSolution: cognitiveCache.cacheHit ? cognitiveCache : null,
    pathVariant,
    dhtp: {
      ...dhtpLayer,
      executive: true,
      presetId: dhtpLayer.presetId || (skipDhtp ? "skipped" : "executive_cognitive_ir"),
      blockHash: block.hash,
      cacheHit: block.fromCache,
    },
    routeHints: {
      maxResponseTokens: dhtpLayer.maxResponseTokens || 800,
      dtuBudgetPct: dhtpLayer.dtuBudgetPct || 35,
      taskClass: route?.taskClass,
      minimumRepresentation: routeHintsFromLadder?.minimumRepresentation || minRep,
      reasoningLevel: routeHintsFromLadder?.reasoningLevel,
      reasoningPath: routeHintsFromLadder?.reasoningPath,
      llmRequired: routeHintsFromLadder?.llmRequired,
      escalate: routeHintsFromLadder?.escalate,
    },
    metrics: {
      fullContextTokens: null,
      dhtpTokens: null,
      tokensSaved: null,
      compressionRatio: null,
      cacheHit: block.fromCache || cognitiveCache.cacheHit,
    },
    cognitiveCompiler: cognitiveCompilerMeta,
  };

  const savingsSnapshot = buildCognitiveSavingsSnapshot({
    db,
    mission,
    step,
    stepIndex,
    route,
    ledger,
    lessons,
    context,
    recallPack,
    serialized,
    dhtpLayer,
    systemPrompt,
    userPrompt,
    path: pathVariant,
    cacheHit: cognitiveCache.cacheHit,
    skipLlm: false,
    pceDeterministic: step?.tool === "pce_execute",
  });

  compiled.savings = savingsSnapshot;
  compiled.metrics = {
    fullContextTokens: savingsSnapshot.contextTokensFull,
    dhtpTokens: savingsSnapshot.dhtpTokens,
    tokensAfterDtu: savingsSnapshot.tokensAfterDtu,
    actualModelInputTokens: savingsSnapshot.actualModelInputTokens,
    tokensSaved: savingsSnapshot.totalTokensAvoided,
    compressionRatio: savingsSnapshot.compressionRatio,
    dtuSavings: savingsSnapshot.dtuSavings,
    dhtpSavings: savingsSnapshot.dhtpSavings,
    cacheSavings: savingsSnapshot.cacheSavings,
    pceSavings: savingsSnapshot.pceSavings,
    totalTokensAvoided: savingsSnapshot.totalTokensAvoided,
    cacheHit: block.fromCache || cognitiveCache.cacheHit,
  };

  if (cognitiveCache.cacheHit) {
    compiled.skipLlm = true;
    compiled.reasoningCost = "zero";
    compiled.reuseDelta = cognitiveCache.delta;
    compiled.reuseSolution = cognitiveCache.solution;
    savingsSnapshot.cacheHit = true;
    savingsSnapshot.skipLlm = true;
    savingsSnapshot.cacheTokensAvoided = savingsSnapshot.actualModelInputTokens;
    savingsSnapshot.cacheSavings = savingsSnapshot.cacheTokensAvoided;
    savingsSnapshot.totalTokensAvoided = savingsSnapshot.dtuSavings
      + savingsSnapshot.dhtpSavings
      + savingsSnapshot.cacheSavings
      + savingsSnapshot.pceSavings;
    compiled.metrics.cacheSavings = savingsSnapshot.cacheSavings;
    compiled.metrics.totalTokensAvoided = savingsSnapshot.totalTokensAvoided;
    compiled.metrics.tokensSaved = savingsSnapshot.totalTokensAvoided;
  }

  if (db) {
    recordCognitiveSavings(db, {
      missionId: mission?.id,
      stepIndex,
      taskClass: route?.taskClass,
      snapshot: savingsSnapshot,
    });

    recordDhtpMetric(db, {
      missionId: mission?.id,
      stepIndex,
      taskClass: route?.taskClass,
      fullContextTokens: savingsSnapshot.contextTokensFull,
      dhtpTokens: savingsSnapshot.dhtpTokens,
      tokensSaved: savingsSnapshot.totalTokensAvoided,
      compressionRatio: savingsSnapshot.compressionRatio,
      cacheHit: block.fromCache || cognitiveCache.cacheHit,
      presetId: compiled.dhtp.presetId,
      path: cognitiveCache.cacheHit ? "cognitive_cache_reuse" : pathVariant,
      policyJson: policy,
      contextTokensFull: savingsSnapshot.contextTokensFull,
      dtuCandidates: savingsSnapshot.dtuCandidates,
      dtuSelected: savingsSnapshot.dtuSelected,
      tokensAfterDtu: savingsSnapshot.tokensAfterDtu,
      actualModelInputTokens: savingsSnapshot.actualModelInputTokens,
      totalTokensAvoided: savingsSnapshot.totalTokensAvoided,
    });

    // Adaptive Field Compression: record per-field outcomes at compile time
    // so dhtp_field_outcomes fills even when delta execution is skipped.
    if (policy) {
      recordFieldOutcomes(db, {
        missionId: mission?.id,
        stepIndex,
        taskClass: route?.taskClass,
        policy,
        taskSuccess: true, // compile succeeded; execution outcome may refine later
        recoveryRequired: false,
      });
    }
  }

  if (db && process.env.COGNITIVE_ECON_MODE === "billed" && savingsSnapshot.actualModelInputTokens > 0) {
    recordProviderBilling(db, {
      missionId: mission?.id,
      stepIndex,
      path: pathVariant,
      promptTokens: savingsSnapshot.actualModelInputTokens,
      completionTokens: cognitiveCache.cacheHit ? 0 : (compiled.routeHints?.maxResponseTokens || 120),
      cachedPromptTokens: cognitiveCache.cacheHit ? savingsSnapshot.actualModelInputTokens : 0,
      latencyMs: savingsSnapshot.latencyMs,
      billingSource: cognitiveCache.cacheHit ? "cache_zero_cost" : "compile_derived",
    });
  }

  return compiled;
}

/**
 * Parse and validate model response as cognitive delta (bidirectional DHTP).
 */
export function processCognitiveResponse(text, { f0Authorized = false } = {}) {
  const parsed = parseCognitiveDelta(text);
  if (!parsed.ok) return parsed;
  const validation = validateCognitiveDelta(parsed.delta, { f0Authorized });
  return {
    ...parsed,
    validation,
    ok: validation.ok,
  };
}

/**
 * Build LLM messages from compiled cognition.
 */
export function buildDhtpMessages(compiled, { userContent } = {}) {
  return [
    { role: "system", content: compiled.systemPrompt },
    { role: "user", content: userContent || compiled.userPrompt },
  ];
}
