// server/lib/runtime/dhtp-compiler.js
//
// DHTP compiler — canonical world state → compact cognitive packet → model router.
// Sits between Dila executive cognition and all LLM call sites.

import { applyDHTP, getBlockCache } from "../dhtp.js";
import { loadRecallPack, bumpRecallCounts } from "../dila-recall.js";
import { estimateTokens } from "../token-budget-assembler.js";
import {
  buildCognitiveIR,
  serializeCognitivePacket,
  parseCognitiveDelta,
  validateCognitiveDelta,
} from "../dhtp-cognitive-ir.js";
import { buildCompressionPolicy, minimumRepresentationForTask } from "./dhtp-policy.js";
import { recordDhtpMetric } from "./dhtp-metrics.js";
import { tryCognitiveCache, fingerprintCognition } from "./cognitive-cache.js";
import {
  buildCognitiveSavingsSnapshot,
  recordCognitiveSavings,
  countDtuCorpus,
  estimateRecallPackTokens,
} from "./cognitive-savings-ledger.js";

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
    serialized = serializeCognitivePacket(ir, {
      policyFn: (field, value) => policy[field] || { compressionLevel: "compact", decisionImpact: 0.5 },
    });
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

  const minRep = minimumRepresentationForTask({
    taskClass: route?.taskClass,
    deterministicEligible: step?.tool === "pce_execute",
  });

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
      minimumRepresentation: minRep,
    },
    metrics: {
      fullContextTokens: null,
      dhtpTokens: null,
      tokensSaved: null,
      compressionRatio: null,
      cacheHit: block.fromCache || cognitiveCache.cacheHit,
    },
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
