// server/lib/runtime/dhtp-metrics.js
//
// DHTP compression metrics — optimize minimum tokens subject to success + recoverability.

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dhtp_metrics'`).get();
  } catch {
    return false;
  }
}

/**
 * Record a DHTP compile/execute cycle for policy optimization.
 */
export function recordDhtpMetric(db, {
  missionId,
  stepIndex,
  taskClass,
  fullContextTokens,
  dhtpTokens,
  taskSuccess,
  verificationSuccess,
  latencyMs,
  cacheHit,
  recoveryRequired,
  compressionRatio,
  presetId,
  path,
  policyJson,
  contextTokensFull,
  dtuCandidates,
  dtuSelected,
  tokensAfterDtu,
  actualModelInputTokens,
  totalTokensAvoided,
} = {}) {
  if (!db || !tablesReady(db)) return null;
  const tokensSaved = totalTokensAvoided != null
    ? totalTokensAvoided
    : (fullContextTokens != null && dhtpTokens != null ? Math.max(0, fullContextTokens - dhtpTokens) : null);
  try {
    db.prepare(`
      INSERT INTO dhtp_metrics
        (mission_id, step_index, task_class, full_context_tokens, dhtp_tokens, tokens_saved,
         task_success, verification_success, latency_ms, cache_hit, recovery_required,
         compression_ratio, preset_id, path, policy_json,
         context_tokens_full, dtu_candidates, dtu_selected, tokens_after_dtu,
         actual_model_input_tokens, total_tokens_avoided)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      missionId || null,
      stepIndex ?? null,
      taskClass || null,
      fullContextTokens ?? contextTokensFull ?? null,
      dhtpTokens ?? null,
      tokensSaved,
      taskSuccess ? 1 : 0,
      verificationSuccess ? 1 : 0,
      latencyMs ?? null,
      cacheHit ? 1 : 0,
      recoveryRequired ? 1 : 0,
      compressionRatio ?? null,
      presetId || null,
      path || "executive",
      policyJson ? JSON.stringify(policyJson) : null,
      contextTokensFull ?? fullContextTokens ?? null,
      dtuCandidates ?? null,
      dtuSelected ?? null,
      tokensAfterDtu ?? null,
      actualModelInputTokens ?? null,
      totalTokensAvoided ?? tokensSaved,
    );
    return { ok: true };
  } catch {
    return null;
  }
}

export function dhtpMetricsSummary(db, { sinceDays = 7 } = {}) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      AVG(full_context_tokens) AS avg_full_tokens,
      AVG(dhtp_tokens) AS avg_dhtp_tokens,
      AVG(tokens_saved) AS avg_tokens_saved,
      AVG(compression_ratio) AS avg_compression_ratio,
      AVG(task_success) AS task_success_rate,
      AVG(verification_success) AS verification_success_rate,
      AVG(cache_hit) AS cache_hit_rate,
      AVG(recovery_required) AS recovery_rate
    FROM dhtp_metrics WHERE created_at >= ?
  `).get(since);

  return {
    ok: true,
    windowDays: sinceDays,
    total: row?.total || 0,
    avgFullTokens: row?.avg_full_tokens,
    avgDhtpTokens: row?.avg_dhtp_tokens,
    avgTokensSaved: row?.avg_tokens_saved,
    avgCompressionRatio: row?.avg_compression_ratio,
    taskSuccessRate: row?.task_success_rate,
    verificationSuccessRate: row?.verification_success_rate,
    cacheHitRate: row?.cache_hit_rate,
    recoveryRate: row?.recovery_rate,
    killerMetric: {
      label: "minimum_tokens_with_success",
      objective: "minimize dhtp_tokens subject to task_success and recoverability",
      avgCompressionRatio: row?.avg_compression_ratio,
      taskSuccessRate: row?.task_success_rate,
    },
  };
}
