// server/lib/runtime/cognitive-savings-ledger.js
//
// Trustworthy token accounting for the cognitive pipeline:
//   WORLD_STATE → DTU retrieval → DHTP compile → model input
//
// Measurement bug fix (2026-08): prior metrics compared IR field tokens
// against serialized packet tokens (apples-to-oranges). This ledger tracks
// each stage with a consistent estimator.

import crypto from "node:crypto";
import { estimateTokens } from "../token-budget-assembler.js";

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='cognitive_savings_ledger'`).get();
  } catch {
    return false;
  }
}

function safeParse(json, fallback = null) {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

/**
 * Count all hermes_dtus rows as the unfiltered knowledge corpus.
 */
export function countDtuCorpus(db) {
  if (!db) return { candidates: 0, tokens: 0, rows: [] };
  try {
    const rows = db.prepare(`
      SELECT id, title, body_json, memory_kind, tier
      FROM hermes_dtus WHERE user_id = 'hermes'
    `).all();
    let tokens = 0;
    for (const row of rows) {
      const body = safeParse(row.body_json, {});
      const bodyText = typeof body === "string" ? body : JSON.stringify(body);
      tokens += estimateTokens(`${row.title}\n${bodyText}`);
    }
    return { candidates: rows.length, tokens, rows };
  } catch {
    return { candidates: 0, tokens: 0, rows: [] };
  }
}

/**
 * Estimate tokens for DTU rows selected by recall pack (post-filter).
 */
export function estimateRecallPackTokens(db, recallPack) {
  if (!recallPack?.ok || !db) return { selected: 0, tokens: 0 };

  let tokens = 0;
  let selected = 0;
  const ids = new Set();

  if (recallPack.identity_present && recallPack.identity_memo_id) {
    ids.add(recallPack.identity_memo_id);
  }
  for (const r of recallPack.recent || []) ids.add(r.id);
  for (const r of recallPack.pinned || []) ids.add(r.id);

  const idList = [...ids];
  if (!idList.length) return { selected, tokens };
  const placeholders = idList.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT id, title, body_json FROM hermes_dtus WHERE id IN (${placeholders})
  `).all(...idList);

  for (const row of rows) {
    if (!row) continue;
    selected += 1;
    const body = safeParse(row.body_json, {});
    const bodyText = typeof body === "string" ? body : JSON.stringify(body);
    tokens += estimateTokens(`${row.title}\n${bodyText}`);
  }

  return { selected, tokens };
}

/**
 * Estimate full world-state tokens (mission + context + unfiltered corpus).
 */
export function estimateWorldStateTokens({
  db,
  mission,
  step,
  stepIndex,
  route,
  ledger,
  lessons,
  context,
  corpus,
} = {}) {
  const worldPayload = {
    mission: {
      id: mission?.id,
      goal: mission?.goal || mission?.title,
      template: mission?.template,
      status: mission?.status,
      stepIndex,
      stepTool: step?.tool,
      route: route ? { taskClass: route.taskClass, workerId: route.workerId } : null,
    },
    ledger: ledger || context?.ledger,
    lessons: (lessons || context?.lessons || []).slice(0, 5),
    observation: context?.observation,
    priorSteps: context?.priorSteps,
    recentTraces: context?.recentTraces,
    dtuCorpus: (corpus?.rows || []).map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.memory_kind,
      tier: r.tier,
    })),
  };

  const worldTokens = estimateTokens(JSON.stringify(worldPayload));
  const corpusTokens = corpus?.tokens || 0;
  return {
    contextTokensFull: worldTokens + corpusTokens,
    worldStateTokens: worldTokens,
    corpusTokens,
    dtuCandidates: corpus?.candidates || 0,
  };
}

/**
 * Build a savings snapshot for one cognitive invocation.
 */
export function buildCognitiveSavingsSnapshot({
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
  path = "executive",
  cacheHit = false,
  skipLlm = false,
  pceDeterministic = false,
  latencyMs,
  taskSuccess,
  verificationSuccess,
} = {}) {
  const corpus = countDtuCorpus(db);
  const world = estimateWorldStateTokens({
    db, mission, step, stepIndex, route, ledger, lessons, context, corpus,
  });
  const dtuSelected = estimateRecallPackTokens(db, recallPack);

  const tokensAfterDtu = world.worldStateTokens + dtuSelected.tokens;
  const dhtpPacketTokens = serialized?.packetTokens
    ?? estimateTokens(serialized?.packet || "");
  const actualModelInputTokens = estimateTokens(
    `${systemPrompt || ""}\n${userPrompt || ""}`,
  );

  // DHTP layer DTU block compression (separate from IR packet).
  const dhtpDtuOriginal = dhtpLayer?.originalChars
    ? Math.ceil(dhtpLayer.originalChars / 3.8)
    : 0;
  const dhtpDtuCompressed = dhtpLayer?.compressedChars
    ? Math.ceil(dhtpLayer.compressedChars / 3.8)
    : 0;

  const dtuSavings = Math.max(0, world.contextTokensFull - tokensAfterDtu);
  const dhtpSavings = Math.max(0, tokensAfterDtu - dhtpPacketTokens);
  const cacheTokensAvoided = cacheHit || skipLlm ? actualModelInputTokens : 0;
  const pceTokensAvoided = pceDeterministic ? actualModelInputTokens : 0;
  const cacheSavings = cacheTokensAvoided;
  const pceSavings = pceTokensAvoided;
  const totalTokensAvoided = dtuSavings + dhtpSavings + cacheSavings + pceSavings;

  const compressionRatio = actualModelInputTokens > 0
    ? world.contextTokensFull / actualModelInputTokens
    : (dhtpPacketTokens > 0 ? world.contextTokensFull / dhtpPacketTokens : 1);

  return {
    invocationId: `csl_${crypto.randomUUID().slice(0, 12)}`,
    path,
    contextTokensFull: world.contextTokensFull,
    dtuCandidates: world.dtuCandidates,
    dtuSelected: dtuSelected.selected,
    tokensAfterDtu,
    dhtpTokens: dhtpPacketTokens,
    actualModelInputTokens,
    dtuSavings,
    dhtpSavings,
    cacheTokensAvoided,
    pceTokensAvoided,
    cacheSavings,
    pceSavings,
    totalTokensAvoided,
    compressionRatio,
    cacheHit: !!cacheHit,
    skipLlm: !!skipLlm,
    latencyMs: latencyMs ?? null,
    taskSuccess: taskSuccess ? 1 : 0,
    verificationSuccess: verificationSuccess ? 1 : 0,
    detail: {
      worldStateTokens: world.worldStateTokens,
      corpusTokens: world.corpusTokens,
      irFullTokens: serialized?.fullContextTokens ?? null,
      irPacketTokens: serialized?.packetTokens ?? null,
      dhtpDtuOriginal,
      dhtpDtuCompressed,
      dhtpPresetId: dhtpLayer?.presetId ?? null,
      accountingNote: "context_tokens_full = world_state + full_dtu_corpus; tokens_after_dtu = world_state + recall_selected_dtus; dhtp_tokens = IR packet; actual_model_input_tokens = system+user messages",
    },
  };
}

/**
 * Persist savings ledger row.
 */
export function recordCognitiveSavings(db, {
  missionId,
  stepIndex,
  taskClass,
  snapshot,
} = {}) {
  if (!db || !snapshot || !tablesReady(db)) return null;
  try {
    db.prepare(`
      INSERT INTO cognitive_savings_ledger
        (mission_id, step_index, invocation_id, task_class, path,
         context_tokens_full, dtu_candidates, dtu_selected, tokens_after_dtu,
         dhtp_tokens, actual_model_input_tokens,
         dtu_savings, dhtp_savings, cache_tokens_avoided, pce_tokens_avoided,
         cache_savings, pce_savings, total_tokens_avoided,
         compression_ratio, cache_hit, skip_llm,
         latency_ms, task_success, verification_success, detail_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      missionId || null,
      stepIndex ?? null,
      snapshot.invocationId,
      taskClass || null,
      snapshot.path,
      snapshot.contextTokensFull,
      snapshot.dtuCandidates,
      snapshot.dtuSelected,
      snapshot.tokensAfterDtu,
      snapshot.dhtpTokens,
      snapshot.actualModelInputTokens,
      snapshot.dtuSavings,
      snapshot.dhtpSavings,
      snapshot.cacheTokensAvoided,
      snapshot.pceTokensAvoided,
      snapshot.cacheSavings,
      snapshot.pceSavings,
      snapshot.totalTokensAvoided,
      snapshot.compressionRatio,
      snapshot.cacheHit ? 1 : 0,
      snapshot.skipLlm ? 1 : 0,
      snapshot.latencyMs,
      snapshot.taskSuccess ?? null,
      snapshot.verificationSuccess ?? null,
      JSON.stringify(snapshot.detail || {}),
    );
    return { ok: true, invocationId: snapshot.invocationId };
  } catch {
    return null;
  }
}

/**
 * Aggregate savings for reporting.
 */
export function savingsLedgerSummary(db, { missionId, sinceDays = 7, path } = {}) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };

  const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
  const where = missionId
    ? `WHERE mission_id = ?`
    : `WHERE created_at >= ?${path ? " AND path = ?" : ""}`;
  const params = missionId ? [missionId] : (path ? [since, path] : [since]);

  const row = db.prepare(`
    SELECT
      COUNT(*) AS invocations,
      AVG(context_tokens_full) AS avg_context_full,
      AVG(tokens_after_dtu) AS avg_after_dtu,
      AVG(dhtp_tokens) AS avg_dhtp,
      AVG(actual_model_input_tokens) AS avg_model_input,
      SUM(dtu_savings) AS total_dtu_savings,
      SUM(dhtp_savings) AS total_dhtp_savings,
      SUM(cache_savings) AS total_cache_savings,
      SUM(pce_savings) AS total_pce_savings,
      SUM(total_tokens_avoided) AS total_avoided,
      AVG(compression_ratio) AS avg_compression_ratio,
      AVG(cache_hit) AS cache_hit_rate
    FROM cognitive_savings_ledger ${where}
  `).get(...params);

  return {
    ok: true,
    invocations: row?.invocations || 0,
    pipeline: {
      contextTokensFull: row?.avg_context_full,
      tokensAfterDtu: row?.avg_after_dtu,
      dhtpTokens: row?.avg_dhtp,
      actualModelInputTokens: row?.avg_model_input,
    },
    savings: {
      dtu: row?.total_dtu_savings || 0,
      dhtp: row?.total_dhtp_savings || 0,
      cache: row?.total_cache_savings || 0,
      pce: row?.total_pce_savings || 0,
      total: row?.total_avoided || 0,
    },
    avgCompressionRatio: row?.avg_compression_ratio,
    cacheHitRate: row?.cache_hit_rate,
  };
}

/**
 * Seed bench DTU corpus for meaningful path experiments.
 */
export function seedBenchDtuCorpus(db, { count = 50 } = {}) {
  if (!db) return { ok: false };
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hermes_dtus (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'Untitled',
        body_json TEXT NOT NULL DEFAULT '{}',
        tags_json TEXT NOT NULL DEFAULT '[]',
        memory_kind TEXT NOT NULL DEFAULT 'episodic',
        tier TEXT NOT NULL DEFAULT 'small',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    for (let i = 0; i < count; i += 1) {
      db.prepare(`
        INSERT OR IGNORE INTO hermes_dtus (id, user_id, title, body_json, memory_kind)
        VALUES (?, 'hermes', ?, ?, 'semantic')
      `).run(
        `bench_dtu_${i}`,
        `Bench knowledge unit ${i}`,
        JSON.stringify({ summary: `Synthetic operational knowledge chunk ${i} `.repeat(40), index: i }),
      );
    }
    return { ok: true, count };
  } catch {
    return { ok: false };
  }
}
export async function runCognitivePathExperiment({
  db,
  mission,
  step,
  stepIndex,
  route,
  ledger,
  lessons,
  context,
  compileFn,
} = {}) {
  if (!db || typeof compileFn !== "function") {
    return { ok: false, reason: "missing_compile_fn" };
  }

  const variants = [
    { id: "A", path: "raw_json", useRawJson: true, skipDhtp: true, skipCache: true },
    { id: "B", path: "dtu_filtered", useRawJson: false, skipDhtp: true, skipCache: true },
    { id: "C", path: "dtu_dhtp", useRawJson: false, skipDhtp: false, skipCache: true },
    { id: "D", path: "dtu_dhtp_cache", useRawJson: false, skipDhtp: false, skipCache: false },
  ];

  const results = [];
  for (const variant of variants) {
    const started = Date.now();
    const compiled = await compileFn({
      db, mission, step, stepIndex, route, ledger, lessons, context,
      pathVariant: variant.path,
      skipCache: variant.skipCache,
      useRawJson: variant.useRawJson,
      skipDhtp: variant.skipDhtp,
      bumpRecall: false,
    });
    const durationMs = Date.now() - started;
    const savings = compiled?.savings || {};

    results.push({
      variant: variant.id,
      path: variant.path,
      inputTokens: savings.actualModelInputTokens ?? compiled?.metrics?.actualModelInputTokens ?? 0,
      dhtpTokens: savings.dhtpTokens ?? compiled?.metrics?.dhtpTokens ?? 0,
      contextFull: savings.contextTokensFull ?? 0,
      tokensAfterDtu: savings.tokensAfterDtu ?? 0,
      totalAvoided: savings.totalTokensAvoided ?? 0,
      dtuSavings: savings.dtuSavings ?? 0,
      dhtpSavings: savings.dhtpSavings ?? 0,
      cacheSavings: savings.cacheSavings ?? 0,
      compressionRatio: savings.compressionRatio ?? null,
      cacheHit: compiled?.cacheHit ?? false,
      skipLlm: compiled?.skipLlm ?? false,
      latencyMs: durationMs,
      correctness: compiled?.ok !== false,
    });
  }

  const baseline = results[0];
  return {
    ok: true,
    variants: results,
    deltas: results.map((r) => ({
      variant: r.variant,
      inputTokensVsRaw: baseline.inputTokens - r.inputTokens,
      pctOfRaw: baseline.inputTokens > 0 ? (r.inputTokens / baseline.inputTokens) * 100 : 100,
    })),
    conclusion: results[3].inputTokens < results[0].inputTokens
      ? "stack_reduces_model_input"
      : "accounting_needs_review",
  };
}
