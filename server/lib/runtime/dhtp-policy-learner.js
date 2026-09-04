// server/lib/runtime/dhtp-policy-learner.js
//
// Empirical DHTP policy learning — discover which fields compress safely per task class.

import { COGNITIVE_IR_FIELDS } from "../dhtp-cognitive-ir.js";

const LEVEL_ORDER = Object.freeze([
  "verbatim", "compact", "hash", "archive", "forget", "recover_on_demand",
]);
const LEVEL_RANK = Object.fromEntries(LEVEL_ORDER.map((l, i) => [l, i]));
const MIN_SAMPLES = Number(process.env.DHTP_LEARN_MIN_SAMPLES) || 5;
const SUCCESS_THRESHOLD = Number(process.env.DHTP_LEARN_SUCCESS_THRESHOLD) || 0.75;

function tablesReady(db, table) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  } catch {
    return false;
  }
}

/**
 * Record per-field compression outcome for learning.
 */
export function recordFieldOutcomes(db, {
  missionId, stepIndex, taskClass, policy, taskSuccess, recoveryRequired,
} = {}) {
  if (!db || !tablesReady(db, "dhtp_field_outcomes") || !policy) return { ok: false };

  let recorded = 0;
  for (const [field, meta] of Object.entries(policy)) {
    if (!meta?.compressionLevel) continue;
    try {
      db.prepare(`
        INSERT INTO dhtp_field_outcomes
          (mission_id, step_index, task_class, field, compression_level, task_success, recovery_required)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        missionId || null,
        stepIndex ?? null,
        taskClass || "*",
        field,
        meta.compressionLevel,
        taskSuccess ? 1 : 0,
        recoveryRequired ? 1 : 0,
      );
      recorded += 1;
    } catch { /* optional */ }
  }
  return { ok: true, recorded };
}

/**
 * Analyze field outcomes and update learned policies.
 */
export function learnDhtpPolicies(db, { sinceDays = 14 } = {}) {
  if (!db || !tablesReady(db, "dhtp_field_outcomes")) {
    return { ok: false, reason: "migration_required" };
  }

  const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
  const rows = db.prepare(`
    SELECT field, task_class, compression_level,
           COUNT(*) AS n,
           AVG(task_success) AS success_rate,
           AVG(recovery_required) AS recovery_rate
    FROM dhtp_field_outcomes
    WHERE created_at >= ?
    GROUP BY field, task_class, compression_level
    HAVING n >= ?
  `).all(since, MIN_SAMPLES);

  const updated = [];
  const demoted = [];

  for (const row of rows) {
    const safe = row.success_rate >= SUCCESS_THRESHOLD && row.recovery_rate < 0.2;
    const current = db.prepare(`
      SELECT compression_level, success_rate, sample_count FROM dhtp_learned_policies
      WHERE field = ? AND task_class = ?
    `).get(row.field, row.task_class || "*");

    let newLevel = row.compression_level;
    if (!safe) {
      const rank = LEVEL_RANK[row.compression_level] ?? 2;
      newLevel = LEVEL_ORDER[Math.max(0, rank - 1)] || "verbatim";
      demoted.push({ field: row.field, from: row.compression_level, to: newLevel, successRate: row.success_rate });
    }

    const sampleCount = (current?.sample_count || 0) + row.n;
    const successRate = current
      ? (current.success_rate * current.sample_count + row.success_rate * row.n) / sampleCount
      : row.success_rate;

    db.prepare(`
      INSERT INTO dhtp_learned_policies (field, task_class, compression_level, success_rate, sample_count, confidence, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(field, task_class) DO UPDATE SET
        compression_level = excluded.compression_level,
        success_rate = excluded.success_rate,
        sample_count = excluded.sample_count,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `).run(
      row.field,
      row.task_class || "*",
      newLevel,
      successRate,
      sampleCount,
      Math.min(1, sampleCount / 50),
      Math.floor(Date.now() / 1000),
    );
    updated.push({ field: row.field, taskClass: row.task_class, level: newLevel, successRate, samples: sampleCount });
  }

  return { ok: true, analyzed: rows.length, updated, demoted };
}

/**
 * Load learned field policies for a task class (falls back to wildcard).
 */
export function getLearnedPolicies(db, taskClass) {
  if (!db || !tablesReady(db, "dhtp_learned_policies")) return {};
  const policies = {};
  try {
    const specific = db.prepare(`
      SELECT field, compression_level, success_rate, confidence, sample_count
      FROM dhtp_learned_policies WHERE task_class = ?
    `).all(taskClass || "*");
    const wildcard = db.prepare(`
      SELECT field, compression_level, success_rate, confidence, sample_count
      FROM dhtp_learned_policies WHERE task_class = '*'
    `).all();

    for (const row of wildcard) policies[row.field] = row;
    for (const row of specific) policies[row.field] = row;
  } catch { /* optional */ }
  return policies;
}

/**
 * Full learning cycle — analyze outcomes, update policies, return report.
 */
export function runDhtpPolicyLearningCycle(db, { sinceDays = 14 } = {}) {
  const learned = learnDhtpPolicies(db, { sinceDays });
  const policies = {};
  for (const field of COGNITIVE_IR_FIELDS) {
    policies[field] = getLearnedPolicies(db, "*")[field] || null;
  }
  return {
    ok: learned.ok !== false,
    cycle: "dhtp_policy_learning",
    ...learned,
    activePolicies: Object.entries(policies).filter(([, v]) => v).map(([f, v]) => ({
      field: f,
      level: v.compression_level,
      successRate: v.success_rate,
      samples: v.sample_count,
    })),
  };
}
