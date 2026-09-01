// server/lib/runtime/cognitive-cache.js
//
// Cognitive caching — fingerprint reasoning problems, reuse verified solutions.

import crypto from "node:crypto";

const MIN_SUCCESS_RATE = Number(process.env.COGNITIVE_CACHE_MIN_SUCCESS) || 0.85;
const MIN_USE_COUNT = Number(process.env.COGNITIVE_CACHE_MIN_USES) || 3;

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='cognitive_solution_cache'`).get();
  } catch {
    return false;
  }
}

/**
 * Deterministic fingerprint from cognitive IR / mission shape.
 */
export function fingerprintCognition({
  mission, step, ir, goal,
} = {}) {
  const parts = [
    mission?.template || "",
    step?.tool || "",
    String(goal || mission?.goal || ir?.OBJECTIVE || "")
      .toLowerCase()
      .replace(/\d+/g, "#")
      .slice(0, 120),
    ir?.DEPENDENCIES || "",
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

/**
 * Lookup verified cognitive solution by fingerprint.
 */
export function lookupCognitiveCache(db, fingerprint, { minSuccessRate = MIN_SUCCESS_RATE } = {}) {
  if (!db || !tablesReady(db) || !fingerprint) {
    return { ok: false, reason: "no_db_or_fingerprint", hit: false };
  }

  const row = db.prepare(`
    SELECT * FROM cognitive_solution_cache WHERE fingerprint_hash = ?
  `).get(fingerprint);

  if (!row) return { ok: true, hit: false, reason: "miss" };

  const successRate = row.use_count > 0 ? row.success_count / row.use_count : 0;
  if (row.success_count < MIN_USE_COUNT || successRate < minSuccessRate) {
    return { ok: true, hit: false, reason: "unverified", successRate, useCount: row.use_count };
  }

  let solution = null;
  let delta = null;
  try { solution = JSON.parse(row.solution_json); } catch { /* optional */ }
  try { delta = row.delta_json ? JSON.parse(row.delta_json) : null; } catch { /* optional */ }

  db.prepare(`
    UPDATE cognitive_solution_cache
    SET use_count = use_count + 1,
        success_count = success_count + 1,
        last_used_at = ?
    WHERE fingerprint_hash = ?
  `).run(Math.floor(Date.now() / 1000), fingerprint);

  return {
    ok: true,
    hit: true,
    fingerprint,
    solution,
    delta,
    useCount: row.use_count + 1,
    successCount: row.success_count + 1,
    successRate,
    verified: true,
    reasoningCost: "zero",
  };
}

/**
 * Store or update a verified cognitive solution.
 */
export function storeCognitiveSolution(db, {
  fingerprint, mission, step, goal, solution, delta, verified = false,
} = {}) {
  if (!db || !tablesReady(db) || !fingerprint || !solution) {
    return { ok: false, reason: "missing_inputs" };
  }

  const existing = db.prepare(`SELECT use_count, success_count FROM cognitive_solution_cache WHERE fingerprint_hash = ?`)
    .get(fingerprint);

  const now = Math.floor(Date.now() / 1000);
  if (existing) {
    db.prepare(`
      UPDATE cognitive_solution_cache
      SET solution_json = ?, delta_json = ?, use_count = use_count + 1,
          success_count = success_count + ?, last_used_at = ?,
          verified_at = CASE WHEN ? = 1 THEN ? ELSE verified_at END
      WHERE fingerprint_hash = ?
    `).run(
      JSON.stringify(solution),
      delta ? JSON.stringify(delta) : null,
      verified ? 1 : 0,
      now,
      verified ? 1 : 0,
      verified ? now : null,
      fingerprint,
    );
    return { ok: true, action: "updated", fingerprint };
  }

  db.prepare(`
    INSERT INTO cognitive_solution_cache
      (fingerprint_hash, mission_template, step_tool, goal_signature, solution_json, delta_json,
       use_count, success_count, verified_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    fingerprint,
    mission?.template || null,
    step?.tool || null,
    String(goal || mission?.goal || "").slice(0, 200),
    JSON.stringify(solution),
    delta ? JSON.stringify(delta) : null,
    verified ? 1 : 0,
    verified ? now : null,
    now,
  );
  return { ok: true, action: "created", fingerprint };
}

export function cognitiveCacheStats(db) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(use_count) AS total_uses,
           SUM(success_count) AS total_successes,
           AVG(CASE WHEN use_count > 0 THEN 1.0 * success_count / use_count END) AS avg_success_rate
    FROM cognitive_solution_cache
  `).get();
  const top = db.prepare(`
    SELECT fingerprint_hash, step_tool, use_count, success_count, verified_at
    FROM cognitive_solution_cache
    ORDER BY use_count DESC LIMIT 10
  `).all();

  return {
    ok: true,
    total: row?.total || 0,
    totalUses: row?.total_uses || 0,
    totalSuccesses: row?.total_successes || 0,
    avgSuccessRate: row?.avg_success_rate,
    topSolutions: top.map((r) => ({
      fingerprint: r.fingerprint_hash,
      tool: r.step_tool,
      uses: r.use_count,
      successes: r.success_count,
      rate: r.use_count ? r.success_count / r.use_count : 0,
    })),
  };
}

/**
 * Try cognitive cache before LLM reasoning.
 */
export function tryCognitiveCache(db, { mission, step, ir } = {}) {
  const fingerprint = fingerprintCognition({ mission, step, ir, goal: mission?.goal });
  const hit = lookupCognitiveCache(db, fingerprint);
  if (!hit.hit) {
    return { ok: true, cacheHit: false, fingerprint, lookup: hit };
  }
  return {
    ok: true,
    cacheHit: true,
    fingerprint,
    solution: hit.solution,
    delta: hit.delta,
    useCount: hit.useCount,
    successRate: hit.successRate,
    reasoningCost: "zero",
    message: `Solved ${hit.useCount} times before — reusing verified pattern`,
  };
}
