// server/lib/pce/pattern-ir.js
//
// PCE-2 — Pattern IR registry with empirical confidence tracking.

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pce_patterns'`).get();
  } catch {
    return false;
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function registerPattern(db, pattern) {
  if (!db || !pattern?.pattern_id) return { ok: false, reason: "missing_inputs" };
  if (!tablesReady(db)) return { ok: false, reason: "migration_required" };

  const ts = nowSec();
  db.prepare(`
    INSERT INTO pce_patterns
      (pattern_id, intent, category, structural_shape_json, behavioral_contract_json,
       preconditions_json, invariants_json, verification_json, provenance_json,
       license, confidence, status, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pattern_id) DO UPDATE SET
      intent = excluded.intent,
      category = excluded.category,
      structural_shape_json = excluded.structural_shape_json,
      behavioral_contract_json = excluded.behavioral_contract_json,
      preconditions_json = excluded.preconditions_json,
      invariants_json = excluded.invariants_json,
      verification_json = excluded.verification_json,
      provenance_json = excluded.provenance_json,
      license = excluded.license,
      confidence = excluded.confidence,
      status = excluded.status,
      version = excluded.version,
      updated_at = excluded.updated_at
  `).run(
    pattern.pattern_id,
    pattern.intent,
    pattern.category || null,
    JSON.stringify(pattern.structural_shape || {}),
    JSON.stringify(pattern.behavioral_contract || {}),
    JSON.stringify(pattern.preconditions || []),
    JSON.stringify(pattern.invariants || []),
    JSON.stringify(pattern.verification || {}),
    JSON.stringify(pattern.provenance || {}),
    pattern.license || "Concord-internal",
    pattern.confidence ?? 0.5,
    pattern.status || "active",
    pattern.version || "1.0.0",
    ts,
    ts,
  );

  db.prepare(`
    INSERT INTO pce_pattern_stats (pattern_id, updated_at) VALUES (?, ?)
    ON CONFLICT(pattern_id) DO NOTHING
  `).run(pattern.pattern_id, ts);

  return { ok: true, patternId: pattern.pattern_id };
}

export function getPattern(db, patternId) {
  if (!db || !tablesReady(db)) return null;
  const row = db.prepare(`SELECT * FROM pce_patterns WHERE pattern_id = ?`).get(patternId);
  if (!row) return null;
  return {
    ...row,
    structural_shape: JSON.parse(row.structural_shape_json || "{}"),
    behavioral_contract: JSON.parse(row.behavioral_contract_json || "{}"),
    preconditions: JSON.parse(row.preconditions_json || "[]"),
    invariants: JSON.parse(row.invariants_json || "[]"),
    verification: JSON.parse(row.verification_json || "{}"),
    provenance: JSON.parse(row.provenance_json || "{}"),
  };
}

export function findPatternsForIntent(db, intent, { limit = 5, minConfidence = 0.3 } = {}) {
  if (!db || !tablesReady(db)) return [];
  const q = String(intent || "").toLowerCase();
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  const rows = db.prepare(`
    SELECT p.*, s.applications, s.successes, s.failures
    FROM pce_patterns p
    LEFT JOIN pce_pattern_stats s ON s.pattern_id = p.pattern_id
    WHERE p.status IN ('active', 'registered', 'testing')
      AND p.confidence >= ?
    ORDER BY p.confidence DESC
    LIMIT 50
  `).all(minConfidence);

  const scored = rows.map((row) => {
    const intentLower = String(row.intent || "").toLowerCase();
    let wordScore = 0;
    for (const w of words) {
      if (intentLower.includes(w)) wordScore += 0.2;
    }
    if (wordScore === 0) return null;
    const apps = row.applications || 0;
    const succ = row.successes || 0;
    const empirical = apps > 0 ? (succ / apps) * 0.15 : 0;
    const matchScore = Math.min(1, wordScore + (row.confidence || 0) * 0.2 + empirical);
    return {
      patternId: row.pattern_id,
      intent: row.intent,
      category: row.category,
      license: row.license,
      confidence: row.confidence,
      matchScore,
      stats: {
        applications: apps,
        successes: succ,
        failures: row.failures || 0,
        successRate: apps ? succ / apps : null,
      },
      structural_shape: JSON.parse(row.structural_shape_json || "{}"),
      verification: JSON.parse(row.verification_json || "{}"),
      provenance: JSON.parse(row.provenance_json || "{}"),
    };
  }).filter(Boolean);

  return scored
    .filter((row) => row.matchScore >= 0.45)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}

export function recordPatternOutcome(db, patternId, { success, durationMs, securityIncident = false, regression = false } = {}) {
  if (!db || !patternId || !tablesReady(db)) return { ok: false };
  const ts = nowSec();
  db.prepare(`
    INSERT INTO pce_pattern_stats (pattern_id, applications, successes, failures, security_incidents, regressions, median_transform_ms, updated_at)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pattern_id) DO UPDATE SET
      applications = applications + 1,
      successes = successes + ?,
      failures = failures + ?,
      security_incidents = security_incidents + ?,
      regressions = regressions + ?,
      median_transform_ms = COALESCE(?, median_transform_ms),
      updated_at = ?
  `).run(
    patternId,
    success ? 1 : 0,
    success ? 0 : 1,
    securityIncident ? 1 : 0,
    regression ? 1 : 0,
    durationMs ?? null,
    ts,
    success ? 1 : 0,
    success ? 0 : 1,
    securityIncident ? 1 : 0,
    regression ? 1 : 0,
    durationMs ?? null,
    ts,
  );
  return { ok: true };
}

export function patternToTransformPlan(pattern, params = {}) {
  const shape = pattern.structural_shape || pattern.structural_shape_json
    ? (typeof pattern.structural_shape === "object" ? pattern.structural_shape : JSON.parse(pattern.structural_shape_json || "{}"))
    : {};
  const steps = (shape.transforms || []).map((t) => ({
    primitive: t.primitive,
    args: { ...t.args, ...params },
  }));
  return {
    ok: steps.length > 0,
    mode: "deterministic",
    patternId: pattern.pattern_id || pattern.patternId,
    steps,
    verification: pattern.verification || {},
  };
}
