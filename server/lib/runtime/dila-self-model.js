// server/lib/runtime/dila-self-model.js
//
// Operational self-model — empirical knowledge of strengths, weaknesses, compression harm.

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dila_operational_self_model'`).get();
  } catch {
    return false;
  }
}

const DEFAULT_SELF = Object.freeze({
  strengths: {},
  weaknesses: {},
  uncertainties: {},
  compressionHarm: {},
  modelPreferences: {},
  memoryReliability: {},
  strategyTrends: {},
  lastUpdated: null,
});

/**
 * Load operational self-model for a task class (or global).
 */
export function getOperationalSelfModel(db, taskClass = "*") {
  if (!db || !tablesReady(db)) return { ok: true, ...DEFAULT_SELF, source: "default" };

  try {
    const row = db.prepare(`
      SELECT * FROM dila_operational_self_model WHERE task_class = ?
    `).get(taskClass);

    if (!row) {
      const wildcard = db.prepare(`
        SELECT * FROM dila_operational_self_model WHERE task_class = '*'
      `).get();
      if (!wildcard) return { ok: true, ...DEFAULT_SELF, source: "empty" };
      return parseSelfModelRow(wildcard);
    }
    return parseSelfModelRow(row);
  } catch {
    return { ok: true, ...DEFAULT_SELF, source: "error" };
  }
}

function parseSelfModelRow(row) {
  const parse = (j) => { try { return JSON.parse(j || "{}"); } catch { return {}; } };
  return {
    ok: true,
    taskClass: row.task_class,
    strengths: parse(row.strengths_json),
    weaknesses: parse(row.weaknesses_json),
    uncertainties: parse(row.uncertainties_json),
    compressionHarm: parse(row.compression_harm_json),
    modelPreferences: parse(row.model_preferences_json),
    memoryReliability: parse(row.memory_reliability_json),
    strategyTrends: parse(row.strategy_trends_json),
    sampleCount: row.sample_count || 0,
    lastUpdated: row.updated_at,
    source: "db",
  };
}

/**
 * Update self-model from one mission outcome.
 */
export function updateSelfModelFromOutcome(db, {
  taskClass = "*",
  taskSuccess,
  verificationPassed,
  recoveryRequired,
  compressionGovernor,
  reasoningLevel,
  modelRoute,
  tokenCost,
  qualityScore,
} = {}) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "table_missing" };

  const current = getOperationalSelfModel(db, taskClass);
  const strengths = { ...current.strengths };
  const weaknesses = { ...current.weaknesses };
  const compressionHarm = { ...current.compressionHarm };
  const modelPreferences = { ...current.modelPreferences };
  const strategyTrends = { ...current.strategyTrends };

  const key = modelRoute?.taskClass || taskClass;
  const success = taskSuccess && verificationPassed;

  if (success) {
    strengths[key] = (strengths[key] || 0) + 1;
  } else {
    weaknesses[key] = (weaknesses[key] || 0) + 1;
  }

  if (recoveryRequired && compressionGovernor && !compressionGovernor.promoted) {
    const harmKey = `${key}_compression`;
    compressionHarm[harmKey] = (compressionHarm[harmKey] || 0) + 1;
  }

  if (modelRoute?.model) {
    const pref = modelPreferences[modelRoute.model] || { success: 0, fail: 0 };
    if (success) pref.success += 1;
    else pref.fail += 1;
    modelPreferences[modelRoute.model] = pref;
  }

  if (reasoningLevel != null) {
    const trend = strategyTrends[`level_${reasoningLevel}`] || { success: 0, fail: 0 };
    if (success) trend.success += 1;
    else trend.fail += 1;
    strategyTrends[`level_${reasoningLevel}`] = trend;
  }

  const sampleCount = (current.sampleCount || 0) + 1;
  const now = Math.floor(Date.now() / 1000);

  try {
    db.prepare(`
      INSERT INTO dila_operational_self_model
        (task_class, strengths_json, weaknesses_json, uncertainties_json,
         compression_harm_json, model_preferences_json, memory_reliability_json,
         strategy_trends_json, sample_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_class) DO UPDATE SET
        strengths_json = excluded.strengths_json,
        weaknesses_json = excluded.weaknesses_json,
        uncertainties_json = excluded.uncertainties_json,
        compression_harm_json = excluded.compression_harm_json,
        model_preferences_json = excluded.model_preferences_json,
        memory_reliability_json = excluded.memory_reliability_json,
        strategy_trends_json = excluded.strategy_trends_json,
        sample_count = excluded.sample_count,
        updated_at = excluded.updated_at
    `).run(
      taskClass,
      JSON.stringify(strengths),
      JSON.stringify(weaknesses),
      JSON.stringify(current.uncertainties),
      JSON.stringify(compressionHarm),
      JSON.stringify(modelPreferences),
      JSON.stringify(current.memoryReliability),
      JSON.stringify(strategyTrends),
      sampleCount,
      now,
    );
    return { ok: true, sampleCount, shouldEscalate: shouldEscalateFromSelfModel({ weaknesses, key, sampleCount }) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Should executive escalate based on empirical self-knowledge?
 */
export function shouldEscalateFromSelfModel({ weaknesses, key, sampleCount, threshold = 3 } = {}) {
  const failCount = weaknesses?.[key] || 0;
  const successNeeded = sampleCount || 1;
  const failRate = failCount / Math.max(1, successNeeded);
  return failCount >= threshold && failRate > 0.5;
}

/**
 * Confidence in ability to solve task class from self-model.
 */
export function selfModelConfidence(db, taskClass) {
  const model = getOperationalSelfModel(db, taskClass);
  const s = model.strengths?.[taskClass] || Object.values(model.strengths).reduce((a, b) => a + b, 0);
  const w = model.weaknesses?.[taskClass] || Object.values(model.weaknesses).reduce((a, b) => a + b, 0);
  const total = s + w;
  if (total < 3) return { confidence: 0.5, samples: total, reason: "insufficient_data" };
  return {
    confidence: s / total,
    samples: total,
    shouldEscalate: shouldEscalateFromSelfModel({ weaknesses: model.weaknesses, key: taskClass, sampleCount: total }),
    compressionHarms: model.compressionHarm,
  };
}
