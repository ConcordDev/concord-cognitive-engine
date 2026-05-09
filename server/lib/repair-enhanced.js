/**
 * Concord Repair Brain Enhanced — Code DTU Integration
 *
 * Provides an intelligent, learning repair subsystem that leverages the code DTU
 * substrate for monitoring, diagnosis, predictive repair, and knowledge
 * accumulation. Works against tables created by migration 030.
 *
 * Architecture:
 *   - Pattern Registry: known failure signatures with scored matching
 *   - Diagnosis Engine: token-overlap scoring + knowledge-base fusion
 *   - Repair Executor: records every action; feeds the learning loop
 *   - Predictive Engine: linear regression on metric trends for anomaly detection
 *   - Knowledge Base: accumulated success/failure rates per issue type
 *   - Metric Store: time-series metrics with trend analysis
 *
 * Usage:
 *   import { createRepairBrain } from './lib/repair-enhanced.js';
 *   const brain = createRepairBrain(db);
 *   brain.registerPattern({ category: 'memory', ... });
 *   const diagnosis = brain.diagnose('heap_overflow', ['growing heap', 'gc stalls']);
 *   const result = brain.executeRepair(diagnosis);
 */

import { ValidationError, NotFoundError } from "./errors.js";
import { generateId } from "./id-factory.js";

// ── Constants ────────────────────────────────────────────────────────────────

const PATTERN_CATEGORIES = Object.freeze([
  "memory",
  "cpu",
  "disk",
  "network",
  "database",
  "llm",
  "state",
  "build",
  "security",
  "injection",
  "malware",
  "cve",
]);

const SEVERITY_LEVELS = Object.freeze(["low", "medium", "high", "critical"]);

/** Severity weights for scoring — higher severity patterns match more aggressively. */
const SEVERITY_WEIGHTS = Object.freeze({
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  critical: 1.0,
});

/** Thresholds for prediction confidence triggers per category. */
const PREDICTION_THRESHOLDS = Object.freeze({
  memory: { warn: 0.75, critical: 0.90 },
  cpu: { warn: 0.80, critical: 0.95 },
  disk: { warn: 0.80, critical: 0.95 },
  network: { warn: 0.70, critical: 0.90 },
  database: { warn: 0.60, critical: 0.85 },
  llm: { warn: 0.65, critical: 0.85 },
  state: { warn: 0.50, critical: 0.80 },
  build: { warn: 0.50, critical: 0.80 },
  security: { warn: 0.40, critical: 0.70 },  // Low threshold — security spikes are urgent
  injection: { warn: 0.30, critical: 0.60 },  // Very sensitive — injection attempts escalate fast
  malware: { warn: 0.20, critical: 0.50 },    // Any malware spike is critical
  cve: { warn: 0.50, critical: 0.80 },        // CVE detection rate changes
});

/** Default metric trend window in hours. */
const DEFAULT_TREND_HOURS = 24;

/** Minimum data points required for meaningful linear regression. */
const MIN_REGRESSION_POINTS = 3;

// ── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Tokenize a string into lowercase words for overlap scoring.
 * Strips punctuation and splits on whitespace, underscores, and hyphens.
 * @param {string} text
 * @returns {string[]}
 */
function _tokenize(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/[\s_-]+/)
    .filter(Boolean);
}

/**
 * Compute Jaccard-like overlap score between two token arrays.
 * Returns a value between 0 and 1.
 * @param {string[]} tokensA
 * @param {string[]} tokensB
 * @returns {number}
 */
function _overlapScore(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Safely parse a JSON string, returning a fallback on failure.
 * If the input is already an object, returns it directly.
 * @param {string|object} str
 * @param {*} fallback
 * @returns {*}
 */
function _safeParseJSON(str, fallback = null) {
  if (str === null || str === undefined) return fallback;
  if (typeof str === "object") return str;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/**
 * Simple linear regression on an array of {x, y} points.
 * Returns { slope, intercept, r2 } or null if insufficient data.
 * @param {Array<{x: number, y: number}>} points
 * @returns {{ slope: number, intercept: number, r2: number } | null}
 */
function _linearRegression(points) {
  if (!points || points.length < MIN_REGRESSION_POINTS) return null;

  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (Math.abs(denominator) < 1e-10) return null;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // R-squared (coefficient of determination)
  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const { x, y } of points) {
    ssTot += (y - meanY) ** 2;
    ssRes += (y - (slope * x + intercept)) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}

/**
 * Classify a metric type string into a known pattern category.
 * Falls back to "state" when the type is unrecognisable.
 * @param {string} metricType
 * @returns {string}
 */
function _classifyMetricCategory(metricType) {
  const lower = (metricType || "").toLowerCase();
  if (lower.includes("memory") || lower.includes("heap") || lower.includes("rss")) return "memory";
  if (lower.includes("cpu") || lower.includes("load") || lower.includes("process")) return "cpu";
  if (lower.includes("disk") || lower.includes("storage") || lower.includes("fs")) return "disk";
  if (lower.includes("network") || lower.includes("latency") || lower.includes("http")) return "network";
  if (lower.includes("database") || lower.includes("db") || lower.includes("query")) return "database";
  if (lower.includes("llm") || lower.includes("model") || lower.includes("inference")) return "llm";
  if (lower.includes("state") || lower.includes("consistency")) return "state";
  if (lower.includes("build") || lower.includes("compile") || lower.includes("bundle")) return "build";
  return "state";
}

/**
 * Suggest a preventive action based on the category, trend slope, and current value.
 * @param {string} category
 * @param {number} slope
 * @param {number} currentValue
 * @returns {string}
 */
function _suggestPreventiveAction(category, slope, currentValue) {
  const actions = {
    memory: `Memory trending up (slope: ${slope.toFixed(4)}). Consider triggering GC, checking for leaks, or increasing heap limit.`,
    cpu: `CPU load increasing (slope: ${slope.toFixed(4)}). Review hot code paths, check for infinite loops, or scale horizontally.`,
    disk: `Disk usage growing (slope: ${slope.toFixed(4)}). Clean temp files, rotate logs, or expand storage.`,
    network: `Network latency rising (slope: ${slope.toFixed(4)}). Check connection pool, DNS resolution, or upstream health.`,
    database: `Database performance degrading (slope: ${slope.toFixed(4)}). Analyze slow queries, rebuild indices, or check connection limits.`,
    llm: `LLM inference degrading (slope: ${slope.toFixed(4)}). Check model loading, VRAM pressure, or queue depth.`,
    state: `State anomaly detected (slope: ${slope.toFixed(4)}). Verify state consistency, check serialization, or review recent changes.`,
    build: `Build metric anomaly (slope: ${slope.toFixed(4)}). Check build cache, dependency changes, or compilation errors.`,
  };
  return (
    actions[category] ||
    `Anomalous trend detected in ${category} (slope: ${slope.toFixed(4)}, current: ${currentValue.toFixed(2)}).`
  );
}

/**
 * Estimate time until a value reaches a critical threshold, given slope per hour.
 * @param {number} currentValue
 * @param {number} slope
 * @param {number} threshold
 * @returns {string}
 */
function _estimateTimeToImpact(currentValue, slope, threshold) {
  if (slope <= 0) return "stable";
  const hoursToThreshold = (threshold - currentValue) / slope;
  if (hoursToThreshold <= 0) return "imminent";
  if (hoursToThreshold < 1) return `~${Math.round(hoursToThreshold * 60)} minutes`;
  if (hoursToThreshold < 24) return `~${Math.round(hoursToThreshold)} hours`;
  return `~${Math.round(hoursToThreshold / 24)} days`;
}

/**
 * Get the current time as an ISO-8601 string.
 * @returns {string}
 */
function _nowISO() {
  return new Date().toISOString();
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a new Repair Brain instance bound to the given better-sqlite3 database.
 *
 * The brain lazily prepares and caches all SQL statements on first use
 * (_prepareStatements pattern). Every repair attempt is recorded for learning.
 * The knowledge base accumulates success/failure statistics that feed back
 * into diagnosis and scoring.
 *
 * @param {import("better-sqlite3").Database} db
 * @returns {object} Repair brain public API
 */
export function createRepairBrain(db) {
  const startedAt = _nowISO();

  // ── Lazy Prepared Statements ─────────────────────────────────────────

  /** @type {object|null} Cached prepared statements — populated on first access. */
  let _stmts = null;

  /**
   * Prepare (or return cached) all SQL statements used by the brain.
   * @returns {object}
   */
  function _prepareStatements() {
    if (_stmts) return _stmts;

    _stmts = {
      // ── repair_patterns ──
      insertPattern: db.prepare(`
        INSERT INTO repair_patterns
          (id, category, subcategory, name, signature, is_healthy,
           resolution, typical_time_to_failure, severity, confidence,
           source_dtu_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getAllPatterns: db.prepare(
        `SELECT * FROM repair_patterns ORDER BY created_at DESC`
      ),
      getPatternsByCategory: db.prepare(
        `SELECT * FROM repair_patterns WHERE category = ? ORDER BY created_at DESC`
      ),
      getPatternsBySeverity: db.prepare(
        `SELECT * FROM repair_patterns WHERE severity = ? ORDER BY created_at DESC`
      ),
      getPatternsByCategoryAndSeverity: db.prepare(
        `SELECT * FROM repair_patterns WHERE category = ? AND severity = ? ORDER BY created_at DESC`
      ),
      getPatternById: db.prepare(
        `SELECT * FROM repair_patterns WHERE id = ?`
      ),
      countPatterns: db.prepare(
        `SELECT COUNT(*) as count FROM repair_patterns`
      ),
      countPatternsByCategory: db.prepare(
        `SELECT category, COUNT(*) as count FROM repair_patterns GROUP BY category`
      ),

      // ── repair_history ──
      insertHistory: db.prepare(`
        INSERT INTO repair_history
          (id, issue_type, symptoms, severity, diagnosis, repair_option_used,
           fix_applied, success, repair_time_ms, rollback_needed, verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getHistoryById: db.prepare(
        `SELECT * FROM repair_history WHERE id = ?`
      ),
      getHistory: db.prepare(
        `SELECT * FROM repair_history ORDER BY created_at DESC LIMIT ? OFFSET ?`
      ),
      getHistoryBySuccess: db.prepare(
        `SELECT * FROM repair_history WHERE success = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
      ),
      countHistory: db.prepare(
        `SELECT COUNT(*) as count FROM repair_history`
      ),
      countHistoryBySuccess: db.prepare(
        `SELECT COUNT(*) as count FROM repair_history WHERE success = ?`
      ),
      updateHistorySuccess: db.prepare(
        `UPDATE repair_history SET success = ?, verified = 1, repair_time_ms = ? WHERE id = ?`
      ),
      getSuccessfulRepairs: db.prepare(
        `SELECT COUNT(*) as count FROM repair_history WHERE success = 1`
      ),
      getFailedRepairs: db.prepare(
        `SELECT COUNT(*) as count FROM repair_history WHERE success = 0`
      ),
      getAvgRepairTime: db.prepare(
        `SELECT AVG(repair_time_ms) as avg_time FROM repair_history WHERE repair_time_ms IS NOT NULL AND repair_time_ms > 0`
      ),

      // ── repair_predictions ──
      insertPrediction: db.prepare(`
        INSERT INTO repair_predictions
          (id, predicted_issue, confidence, time_to_impact, preventive_action,
           applied, outcome, source_pattern_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getPredictionById: db.prepare(
        `SELECT * FROM repair_predictions WHERE id = ?`
      ),
      getPredictions: db.prepare(
        `SELECT * FROM repair_predictions ORDER BY confidence DESC, created_at DESC LIMIT ? OFFSET ?`
      ),
      getPredictionsByMinConfidence: db.prepare(
        `SELECT * FROM repair_predictions WHERE confidence >= ? ORDER BY confidence DESC, created_at DESC LIMIT ? OFFSET ?`
      ),
      countPredictions: db.prepare(
        `SELECT COUNT(*) as count FROM repair_predictions`
      ),
      countActivePredictions: db.prepare(
        `SELECT COUNT(*) as count FROM repair_predictions WHERE applied = 0`
      ),
      updatePredictionApplied: db.prepare(
        `UPDATE repair_predictions SET applied = 1, outcome = ? WHERE id = ?`
      ),

      // ── repair_knowledge ──
      insertKnowledge: db.prepare(`
        INSERT INTO repair_knowledge
          (id, category, issue_type, symptoms, fix_description,
           success_count, failure_count, avg_repair_time_ms, last_used_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getKnowledgeByCategory: db.prepare(
        `SELECT * FROM repair_knowledge WHERE category = ? ORDER BY success_count DESC`
      ),
      getAllKnowledge: db.prepare(
        `SELECT * FROM repair_knowledge ORDER BY success_count DESC`
      ),
      getKnowledgeByIssueType: db.prepare(
        `SELECT * FROM repair_knowledge WHERE issue_type = ? ORDER BY success_count DESC`
      ),
      updateKnowledgeSuccess: db.prepare(
        `UPDATE repair_knowledge SET success_count = success_count + 1, last_used_at = ?, avg_repair_time_ms = ? WHERE id = ?`
      ),
      updateKnowledgeFailure: db.prepare(
        `UPDATE repair_knowledge SET failure_count = failure_count + 1, last_used_at = ? WHERE id = ?`
      ),
      countKnowledge: db.prepare(
        `SELECT COUNT(*) as count FROM repair_knowledge`
      ),

      // ── system_metrics_history ──
      insertMetric: db.prepare(
        `INSERT INTO system_metrics_history (metric_type, value, metadata, recorded_at) VALUES (?, ?, ?, ?)`
      ),
      getMetricTrend: db.prepare(
        `SELECT * FROM system_metrics_history WHERE metric_type = ? AND recorded_at >= ? ORDER BY recorded_at ASC`
      ),
      getLatestMetric: db.prepare(
        `SELECT * FROM system_metrics_history WHERE metric_type = ? ORDER BY recorded_at DESC LIMIT 1`
      ),
      countMetrics: db.prepare(
        `SELECT COUNT(*) as count FROM system_metrics_history`
      ),
      getMetricTypes: db.prepare(
        `SELECT DISTINCT metric_type FROM system_metrics_history ORDER BY metric_type`
      ),
    };

    return _stmts;
  }

  // ── 1. registerPattern ───────────────────────────────────────────────

  function registerPattern(pattern) {
    if (!pattern || !pattern.category) {
      throw new ValidationError("Pattern category is required");
    }

    const severity = pattern.severity || "medium";
    if (!SEVERITY_LEVELS.includes(severity)) {
      throw new ValidationError(
        `Invalid severity: ${severity}. Must be one of: ${SEVERITY_LEVELS.join(", ")}`
      );
    }

    const stmts = _prepareStatements();
    const id = generateId("rp");
    const now = _nowISO();

    const record = {
      id,
      category: pattern.category,
      subcategory: pattern.subcategory || "general",
      name: pattern.name || "unnamed",
      signature: pattern.signature || "",
      is_healthy: pattern.isHealthy ? 1 : 0,
      resolution: pattern.resolution || null,
      typical_time_to_failure: pattern.typicalTimeToFailure || null,
      severity,
      confidence: typeof pattern.confidence === "number" ? pattern.confidence : 0.5,
      source_dtu_id: pattern.sourceDtuId || null,
      created_at: now,
    };

    stmts.insertPattern.run(
      record.id, record.category, record.subcategory, record.name,
      record.signature, record.is_healthy, record.resolution,
      record.typical_time_to_failure, record.severity, record.confidence,
      record.source_dtu_id, record.created_at
    );

    return {
      id: record.id, category: record.category, subcategory: record.subcategory,
      name: record.name, signature: record.signature, isHealthy: !!record.is_healthy,
      resolution: record.resolution, typicalTimeToFailure: record.typical_time_to_failure,
      severity: record.severity, confidence: record.confidence,
      sourceDtuId: record.source_dtu_id, createdAt: record.created_at,
    };
  }

  // ── 2. matchSymptoms ─────────────────────────────────────────────────

  function matchSymptoms(symptoms) {
    if (typeof symptoms === "string") symptoms = [symptoms];
    if (!Array.isArray(symptoms)) symptoms = [];

    const stmts = _prepareStatements();
    const patterns = stmts.getAllPatterns.all();

    const symptomTokens = [];
    for (const s of symptoms) symptomTokens.push(..._tokenize(s));
    if (symptomTokens.length === 0) return [];

    const symptomSet = new Set(symptomTokens);
    const matches = [];

    for (const pat of patterns) {
      const patternTokens = [
        ..._tokenize(pat.signature), ..._tokenize(pat.name),
        ..._tokenize(pat.resolution || ""), ..._tokenize(pat.category),
        ..._tokenize(pat.subcategory),
      ];
      if (patternTokens.length === 0) continue;

      const patternSet = new Set(patternTokens);
      const overlap = _overlapScore(symptomTokens, patternTokens);
      if (overlap <= 0) continue;

      const severityWeight = SEVERITY_WEIGHTS[pat.severity] || 0.5;
      const patConfidence = pat.confidence ?? 0.5;
      const score = overlap * 0.6 + severityWeight * 0.2 + patConfidence * 0.2;

      const matchedTokens = [];
      for (const token of symptomSet) {
        if (patternSet.has(token)) matchedTokens.push(token);
      }

      matches.push({
        pattern: {
          id: pat.id, category: pat.category, subcategory: pat.subcategory,
          name: pat.name, signature: pat.signature, severity: pat.severity,
          resolution: pat.resolution, confidence: pat.confidence,
        },
        score: Math.round(score * 1000) / 1000,
        matchedTokens,
      });
    }

    matches.sort((a, b) => b.score - a.score);
    return matches;
  }

  // ── 3. diagnose ──────────────────────────────────────────────────────

  function diagnose(issueType, symptoms) {
    if (!issueType || (typeof issueType === "string" && issueType.trim() === "")) {
      throw new ValidationError("Issue type is required");
    }

    if (typeof symptoms === "string") symptoms = [symptoms];
    if (!Array.isArray(symptoms)) symptoms = [];

    const stmts = _prepareStatements();
    const matchedPatterns = matchSymptoms(symptoms);
    const knowledgeRows = stmts.getKnowledgeByIssueType.all(issueType);
    const repairOptions = _buildRepairOptions(matchedPatterns, knowledgeRows, issueType, symptoms);

    let severity = "medium";
    if (matchedPatterns.length > 0) {
      const topSeverities = matchedPatterns.slice(0, 3).map((m) => m.pattern.severity);
      if (topSeverities.includes("critical")) severity = "critical";
      else if (topSeverities.includes("high")) severity = "high";
      else if (topSeverities.includes("medium")) severity = "medium";
      else severity = "low";
    }

    return {
      issueType, symptoms, severity,
      matchedPatterns: matchedPatterns.slice(0, 10),
      repairOptions,
      knowledgeHits: knowledgeRows.map((k) => ({
        id: k.id, category: k.category, issueType: k.issue_type,
        symptoms: k.symptoms, fixDescription: k.fix_description,
        successCount: k.success_count, failureCount: k.failure_count,
        avgRepairTimeMs: k.avg_repair_time_ms,
      })),
      confidence: matchedPatterns.length > 0 ? matchedPatterns[0].score : 0,
      diagnosedAt: _nowISO(),
    };
  }

  function _buildRepairOptions(matchedPatterns, knowledgeRows, issueType, symptoms) {
    const options = [];
    const seenResolutions = new Set();

    for (const match of matchedPatterns) {
      const resolution = match.pattern.resolution;
      if (resolution && !seenResolutions.has(resolution)) {
        seenResolutions.add(resolution);
        options.push({
          source: "pattern", patternId: match.pattern.id,
          description: resolution, confidence: match.score,
          severity: match.pattern.severity,
        });
      }
    }

    for (const entry of knowledgeRows) {
      const desc = entry.fix_description;
      if (desc && !seenResolutions.has(desc)) {
        seenResolutions.add(desc);
        const total = (entry.success_count || 0) + (entry.failure_count || 0);
        const successRate = total > 0 ? entry.success_count / total : 0;
        options.push({
          source: "knowledge", knowledgeId: entry.id,
          description: desc, confidence: successRate,
          successRate, avgRepairTimeMs: entry.avg_repair_time_ms,
        });
      }
    }

    if (options.length === 0) {
      options.push({
        source: "generic",
        description: `Restart affected subsystem for ${issueType}. Monitor symptoms: ${symptoms.join(", ") || "none specified"}.`,
        confidence: 0.1, severity: "medium",
      });
    }

    options.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    return options;
  }

  // ── 4. executeRepair ─────────────────────────────────────────────────

  function executeRepair(diagnosis, options = {}) {
    const stmts = _prepareStatements();
    const repairId = generateId("repair");
    const now = _nowISO();
    const startTime = Date.now();

    const repairOptions = diagnosis.repairOptions || [];
    let selectedOption = null;
    let optionIndex = 0;

    if (options.preferredOption !== undefined) {
      const idx = Number(options.preferredOption);
      if (!isNaN(idx) && idx >= 0 && idx < repairOptions.length) {
        selectedOption = repairOptions[idx];
        optionIndex = idx;
      }
    }
    if (!selectedOption && repairOptions.length > 0) {
      selectedOption = repairOptions[0];
    }

    const repairOptionUsed = selectedOption ? JSON.stringify(selectedOption) : null;
    const fixApplied = selectedOption ? selectedOption.description : "No applicable fix found";
    const severity = diagnosis.severity || "medium";
    const repairTimeMs = Date.now() - startTime;

    stmts.insertHistory.run(
      repairId, diagnosis.issueType || "unknown",
      JSON.stringify(diagnosis.symptoms || []), severity,
      JSON.stringify(diagnosis), repairOptionUsed, fixApplied,
      0, repairTimeMs, 0, 0, now
    );

    return {
      repairId, id: repairId, issueType: diagnosis.issueType,
      severity, fixApplied, repairOptionUsed: selectedOption,
      optionIndex, dryRun: !!options.dryRun, repairTimeMs, createdAt: now,
    };
  }

  // ── 5. recordOutcome ─────────────────────────────────────────────────

  function recordOutcome(repairId, success, details = {}) {
    const stmts = _prepareStatements();
    const repair = stmts.getHistoryById.get(repairId);
    if (!repair) throw new NotFoundError("Repair", repairId);

    const repairTimeMs = details.repairTimeMs || repair.repair_time_ms || 0;
    stmts.updateHistorySuccess.run(success ? 1 : 0, repairTimeMs, repairId);
    _updateKnowledgeBase(repair, success, repairTimeMs);

    return { repairId, success, verified: true, repairTimeMs, updatedAt: _nowISO() };
  }

  function _updateKnowledgeBase(repair, success, repairTimeMs) {
    const stmts = _prepareStatements();
    const now = _nowISO();
    const issueType = repair.issue_type;
    const category = _classifyMetricCategory(issueType);
    const existing = stmts.getKnowledgeByIssueType.all(issueType);

    if (existing.length > 0) {
      const entry = existing[0];
      if (success) {
        const total = entry.success_count + 1;
        const avgTime = entry.avg_repair_time_ms > 0
          ? (entry.avg_repair_time_ms * entry.success_count + repairTimeMs) / total
          : repairTimeMs;
        stmts.updateKnowledgeSuccess.run(now, avgTime, entry.id);
      } else {
        stmts.updateKnowledgeFailure.run(now, entry.id);
      }
    } else {
      const knowledgeId = generateId("rk");
      const symptomsStr = typeof repair.symptoms === "string"
        ? repair.symptoms : JSON.stringify(repair.symptoms || []);
      stmts.insertKnowledge.run(
        knowledgeId, category, issueType, symptomsStr,
        repair.fix_applied || "", success ? 1 : 0, success ? 0 : 1,
        repairTimeMs || 0, now, now
      );
    }
  }

  // ── 6. predict ───────────────────────────────────────────────────────

  function predict(metrics) {
    if (!metrics || typeof metrics !== "object") return [];

    const stmts = _prepareStatements();
    const predictions = [];
    const now = _nowISO();

    for (const [metricType, currentValue] of Object.entries(metrics)) {
      if (typeof currentValue !== "number") continue;

      const cutoff = new Date(Date.now() - DEFAULT_TREND_HOURS * 60 * 60 * 1000).toISOString();
      const history = stmts.getMetricTrend.all(metricType, cutoff);

      const points = history.map((row, i) => ({ x: i, y: row.value }));
      points.push({ x: points.length, y: currentValue });

      const regression = _linearRegression(points);
      if (!regression) continue;

      const category = _classifyMetricCategory(metricType);
      const thresholds = PREDICTION_THRESHOLDS[category] || PREDICTION_THRESHOLDS.state;
      const { slope, r2 } = regression;

      if (slope <= 0.001 && r2 < 0.3) continue;

      let confidence = 0;
      let severity = "low";

      if (currentValue >= thresholds.critical) {
        confidence = 0.9; severity = "critical";
      } else if (currentValue >= thresholds.warn) {
        confidence = 0.7; severity = "high";
      } else if (slope > 0 && r2 > 0.6) {
        confidence = Math.min(0.8, r2 * slope * 10);
        severity = slope > 0.05 ? "high" : "medium";
      } else if (slope > 0 && r2 > 0.5) {
        confidence = Math.min(0.5, r2 * slope * 5);
        severity = "low";
      } else {
        continue;
      }

      if (confidence < 0.1) continue;

      const timeToImpact = _estimateTimeToImpact(currentValue, slope, thresholds.critical);
      const preventiveAction = _suggestPreventiveAction(category, slope, currentValue);
      const relatedPatterns = stmts.getPatternsByCategory.all(category);
      const sourcePatternId = relatedPatterns.length > 0 ? relatedPatterns[0].id : null;
      const predictionId = generateId("pred");

      stmts.insertPrediction.run(
        predictionId, `${category}_degradation`,
        Math.round(confidence * 1000) / 1000, timeToImpact, preventiveAction,
        0, null, sourcePatternId, now
      );

      predictions.push({
        id: predictionId, predictedIssue: `${category}_degradation`,
        metricType, currentValue,
        confidence: Math.round(confidence * 1000) / 1000,
        severity, timeToImpact, preventiveAction, sourcePatternId,
        regression: {
          slope: Math.round(slope * 10000) / 10000,
          r2: Math.round(r2 * 1000) / 1000,
        },
        createdAt: now,
      });
    }

    predictions.sort((a, b) => b.confidence - a.confidence);
    return predictions;
  }

  // ── 7. applyPrevention ───────────────────────────────────────────────

  function applyPrevention(predictionId) {
    const stmts = _prepareStatements();
    const prediction = stmts.getPredictionById.get(predictionId);
    if (!prediction) throw new NotFoundError("Prediction", predictionId);

    const outcome = `Preventive action applied at ${_nowISO()}: ${prediction.preventive_action || "no action specified"}`;
    stmts.updatePredictionApplied.run(outcome, predictionId);

    return {
      predictionId, predictedIssue: prediction.predicted_issue,
      preventiveAction: prediction.preventive_action,
      applied: true, outcome, appliedAt: _nowISO(),
    };
  }

  // ── 8. recordMetric ──────────────────────────────────────────────────

  function recordMetric(metricType, value, metadata = {}) {
    if (!metricType || (typeof metricType === "string" && metricType.trim() === "")) {
      throw new ValidationError("Metric type is required");
    }

    const stmts = _prepareStatements();
    const now = _nowISO();
    stmts.insertMetric.run(metricType, Number(value) || 0, JSON.stringify(metadata), now);

    return { metricType, value: Number(value) || 0, metadata, recordedAt: now };
  }

  // ── 9. getMetricTrend ────────────────────────────────────────────────

  function getMetricTrend(metricType, hours = DEFAULT_TREND_HOURS) {
    const stmts = _prepareStatements();
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const rows = stmts.getMetricTrend.all(metricType, cutoff);

    const values = rows.map((r) => r.value);
    const points = rows.map((r) => ({
      value: r.value,
      metadata: _safeParseJSON(r.metadata, {}),
      recordedAt: r.recorded_at,
    }));

    let min = Infinity, max = -Infinity, sum = 0;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    const count = values.length;
    const avg = count > 0 ? sum / count : 0;

    let variance = 0;
    for (const v of values) variance += (v - avg) ** 2;
    variance = count > 1 ? variance / (count - 1) : 0;
    const stddev = Math.sqrt(variance);

    const regressionPoints = values.map((y, i) => ({ x: i, y }));
    const regression = _linearRegression(regressionPoints);

    return {
      metricType, hours, points, count,
      stats: {
        min: count > 0 ? Math.round(min * 10000) / 10000 : 0,
        max: count > 0 ? Math.round(max * 10000) / 10000 : 0,
        avg: Math.round(avg * 10000) / 10000,
        stddev: Math.round(stddev * 10000) / 10000,
      },
      regression: regression ? {
        slope: Math.round(regression.slope * 10000) / 10000,
        intercept: Math.round(regression.intercept * 10000) / 10000,
        r2: Math.round(regression.r2 * 1000) / 1000,
        trend: regression.slope > 0.01 ? "increasing"
          : regression.slope < -0.01 ? "decreasing" : "stable",
      } : null,
    };
  }

  // ── 10. getPatterns ──────────────────────────────────────────────────

  function getPatterns(filters = {}) {
    const stmts = _prepareStatements();
    const { category, severity } = filters;

    let rows;
    if (category && severity) rows = stmts.getPatternsByCategoryAndSeverity.all(category, severity);
    else if (category) rows = stmts.getPatternsByCategory.all(category);
    else if (severity) rows = stmts.getPatternsBySeverity.all(severity);
    else rows = stmts.getAllPatterns.all();

    return rows.map((r) => ({
      id: r.id, category: r.category, subcategory: r.subcategory,
      name: r.name, signature: r.signature, isHealthy: !!r.is_healthy,
      resolution: r.resolution, typicalTimeToFailure: r.typical_time_to_failure,
      severity: r.severity, confidence: r.confidence,
      sourceDtuId: r.source_dtu_id, createdAt: r.created_at,
    }));
  }

  // ── 11. getKnowledge ─────────────────────────────────────────────────

  function getKnowledge(category) {
    const stmts = _prepareStatements();
    const rows = category
      ? stmts.getKnowledgeByCategory.all(category)
      : stmts.getAllKnowledge.all();

    return rows.map((r) => ({
      id: r.id, category: r.category, issueType: r.issue_type,
      symptoms: r.symptoms, fixDescription: r.fix_description,
      successCount: r.success_count, failureCount: r.failure_count,
      avgRepairTimeMs: r.avg_repair_time_ms,
      successRate: r.success_count + r.failure_count > 0
        ? Math.round((r.success_count / (r.success_count + r.failure_count)) * 1000) / 1000 : 0,
      lastUsedAt: r.last_used_at, createdAt: r.created_at,
    }));
  }

  // ── 12. getHistory ───────────────────────────────────────────────────

  function getHistory(options = {}) {
    const stmts = _prepareStatements();
    const limit = Math.max(1, Math.min(1000, options.limit || 50));
    const offset = Math.max(0, options.offset || 0);

    let rows, totalResult;
    if (options.success !== undefined) {
      const successVal = options.success ? 1 : 0;
      rows = stmts.getHistoryBySuccess.all(successVal, limit, offset);
      totalResult = stmts.countHistoryBySuccess.get(successVal);
    } else {
      rows = stmts.getHistory.all(limit, offset);
      totalResult = stmts.countHistory.get();
    }

    const total = totalResult ? totalResult.count : 0;
    const items = rows.map((r) => ({
      id: r.id, issueType: r.issue_type,
      symptoms: _safeParseJSON(r.symptoms, []), severity: r.severity,
      diagnosis: _safeParseJSON(r.diagnosis, {}),
      repairOptionUsed: _safeParseJSON(r.repair_option_used, null),
      fixApplied: r.fix_applied, success: !!r.success,
      repairTimeMs: r.repair_time_ms, rollbackNeeded: !!r.rollback_needed,
      verified: !!r.verified, createdAt: r.created_at,
    }));

    return { items, total, limit, offset };
  }

  // ── 13. getPredictions ───────────────────────────────────────────────

  function getPredictions(options = {}) {
    const stmts = _prepareStatements();
    const limit = Math.max(1, Math.min(1000, options.limit || 50));
    const offset = Math.max(0, options.offset || 0);
    const minConfidence = options.minConfidence || 0;

    let rows;
    if (minConfidence > 0) {
      rows = stmts.getPredictionsByMinConfidence.all(minConfidence, limit, offset);
    } else {
      rows = stmts.getPredictions.all(limit, offset);
    }

    const totalResult = stmts.countPredictions.get();
    const activeResult = stmts.countActivePredictions.get();
    const total = totalResult ? totalResult.count : 0;
    const active = activeResult ? activeResult.count : 0;

    const items = rows.map((r) => ({
      id: r.id, predictedIssue: r.predicted_issue,
      confidence: r.confidence, timeToImpact: r.time_to_impact,
      preventiveAction: r.preventive_action, applied: !!r.applied,
      outcome: r.outcome, sourcePatternId: r.source_pattern_id,
      createdAt: r.created_at,
    }));

    return { items, active, total };
  }

  // ── 14. getStats ─────────────────────────────────────────────────────

  function getStats() {
    const stmts = _prepareStatements();

    const patternTotal = stmts.countPatterns.get();
    const patternsByCategory = stmts.countPatternsByCategory.all();
    const byCategoryMap = {};
    for (const row of patternsByCategory) byCategoryMap[row.category] = row.count;

    const repairTotal = stmts.countHistory.get();
    const successfulResult = stmts.getSuccessfulRepairs.get();
    const failedResult = stmts.getFailedRepairs.get();
    const avgTimeResult = stmts.getAvgRepairTime.get();

    const totalRepairs = repairTotal ? repairTotal.count : 0;
    const successful = successfulResult ? successfulResult.count : 0;
    const failed = failedResult ? failedResult.count : 0;
    const avgRepairTimeMs = avgTimeResult && avgTimeResult.avg_time
      ? Math.round(avgTimeResult.avg_time * 100) / 100 : 0;
    const successRate = totalRepairs > 0
      ? Math.round((successful / totalRepairs) * 1000) / 1000 : 0;

    const predictionTotal = stmts.countPredictions.get();
    const predictionActive = stmts.countActivePredictions.get();
    const knowledgeTotal = stmts.countKnowledge.get();
    const metricsTotal = stmts.countMetrics.get();
    const metricTypesRows = stmts.getMetricTypes.all();

    return {
      startedAt,
      patterns: {
        total: patternTotal ? patternTotal.count : 0,
        byCategory: byCategoryMap,
      },
      repairs: { total: totalRepairs, successful, failed, successRate, avgRepairTimeMs },
      predictions: {
        total: predictionTotal ? predictionTotal.count : 0,
        active: predictionActive ? predictionActive.count : 0,
      },
      knowledge: { total: knowledgeTotal ? knowledgeTotal.count : 0 },
      metrics: {
        total: metricsTotal ? metricsTotal.count : 0,
        types: metricTypesRows.map((r) => r.metric_type),
      },
    };
  }

  // ── 15. runHealthCheck ───────────────────────────────────────────────

  function runHealthCheck() {
    const timestamp = _nowISO();
    const checks = [];

    checks.push(_checkSubsystem("database_connectivity", () => {
      db.prepare("SELECT 1 as ok").get();
      return "Database is accessible";
    }));
    checks.push(_checkSubsystem("pattern_registry", () => {
      const count = (_prepareStatements().countPatterns.get() || { count: 0 }).count;
      return `Pattern registry accessible (${count} patterns)`;
    }));
    checks.push(_checkSubsystem("repair_history", () => {
      const count = (_prepareStatements().countHistory.get() || { count: 0 }).count;
      return `Repair history accessible (${count} records)`;
    }));
    checks.push(_checkSubsystem("knowledge_base", () => {
      const count = (_prepareStatements().countKnowledge.get() || { count: 0 }).count;
      return `Knowledge base accessible (${count} entries)`;
    }));
    checks.push(_checkSubsystem("prediction_engine", () => {
      const s = _prepareStatements();
      const count = (s.countPredictions.get() || { count: 0 }).count;
      const active = (s.countActivePredictions.get() || { count: 0 }).count;
      return `Prediction engine ready (${count} total, ${active} active)`;
    }));
    checks.push(_checkSubsystem("metric_store", () => {
      const s = _prepareStatements();
      const count = (s.countMetrics.get() || { count: 0 }).count;
      const types = s.getMetricTypes.all().length;
      return `Metric store accessible (${count} data points, ${types} metric types)`;
    }));

    const passed = checks.filter((c) => c.passed).length;
    const failed = checks.filter((c) => !c.passed).length;

    return {
      healthy: failed === 0,
      timestamp,
      checks,
      summary: { total: checks.length, passed, failed },
    };
  }

  function _checkSubsystem(name, fn) {
    try {
      const message = fn();
      return { name, passed: true, message };
    } catch (err) {
      return { name, passed: false, message: `${name} check failed: ${err.message}` };
    }
  }

  // ── Public API ───────────────────────────────────────────────────────

  // ── Security Knowledge API ────────────────────────────────────────────

  /**
   * Register a security-specific pattern (wraps registerPattern with security fields).
   * @param {Object} signature - Security signature data
   * @returns {Object} Registered pattern
   */
  function registerSecurityPattern(signature) {
    const category = signature.category || "security";
    if (!["security", "injection", "malware", "cve"].includes(category)) {
      throw new ValidationError(`Invalid security category: ${category}`);
    }

    return registerPattern({
      category,
      subcategory: signature.subcategory || signature.vulnerabilityType || "general",
      name: signature.name || `security_${Date.now().toString(36)}`,
      signature: signature.pattern || signature.signature || "",
      isHealthy: false,
      resolution: signature.resolution || signature.afterPattern || "",
      severity: signature.severity || "high",
      confidence: signature.confidence || 0.7,
      sourceDtuId: signature.sourceDtuId || null,
    });
  }

  /**
   * Record a security outcome — tracks success/failure and false positive rates.
   * @param {string} signatureId - Pattern ID
   * @param {boolean} success - Whether the detection/fix was correct
   * @param {boolean} [falsePositive=false] - Whether it was a false positive
   */
  function recordSecurityOutcome(signatureId, success, falsePositive = false) {
    recordOutcome({
      historyId: signatureId,
      success,
      notes: falsePositive ? "false_positive" : undefined,
    });

    // Track security-specific metrics
    recordMetric("security_outcomes_total", 1);
    if (success) recordMetric("security_outcomes_success", 1);
    if (falsePositive) recordMetric("security_false_positives", 1);
  }

  /**
   * Get aggregated security knowledge across all security categories.
   * @param {string} [category] - Specific security category or null for all
   * @returns {Object} Security knowledge summary
   */
  function getSecurityKnowledge(category) {
    const securityCategories = category
      ? [category]
      : ["security", "injection", "malware", "cve"];

    const knowledge = [];
    for (const cat of securityCategories) {
      knowledge.push(...getKnowledge(cat));
    }

    const patterns = [];
    for (const cat of securityCategories) {
      patterns.push(...getPatterns({ category: cat }));
    }

    return {
      categories: securityCategories,
      knowledgeEntries: knowledge.length,
      patternCount: patterns.length,
      knowledge,
      patterns,
      topBySuccessRate: knowledge
        .filter(k => k.successCount + k.failureCount >= 3)
        .sort((a, b) => b.successRate - a.successRate)
        .slice(0, 10),
    };
  }

  return {
    PATTERN_CATEGORIES,
    SEVERITY_LEVELS,

    registerPattern,
    matchSymptoms,
    diagnose,
    executeRepair,
    recordOutcome,

    predict,
    applyPrevention,

    recordMetric,
    getMetricTrend,

    getPatterns,
    getKnowledge,
    getHistory,
    getPredictions,

    getStats,
    runHealthCheck,

    // Security intelligence API
    registerSecurityPattern,
    recordSecurityOutcome,
    getSecurityKnowledge,
  };
}
