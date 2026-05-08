/**
 * Brain-as-a-Service — Multi-Brain Router
 *
 * Directs requests to specialized AI models based on task type.
 * Four brains, each tuned for a specific cognitive workload:
 *
 *   conscious    — qwen2.5:7b   — complex reasoning, design assistance
 *   subconscious — qwen2.5:1.5b — data analysis, pattern recognition
 *   utility      — qwen2.5:3b   — NPC dialogue, quick tasks, classification
 *   repair       — qwen2.5:0.5b — code/system diagnosis, fix suggestions
 *
 * Actual Ollama integration is handled separately (see brain-router.js).
 * This module provides routing logic, request tracking, pricing tiers,
 * and simulated inference for development/testing.
 */

"use strict";

const crypto = require("crypto");

// ── Brain Configurations ───────────────────────────────────────────────────

const BRAIN_CONFIGS = Object.freeze({
  conscious: {
    model: "qwen2.5:7b",
    role: "complex reasoning, design assistance, council deliberation",
    temperature: 0.7,
    timeout: 45000,
    maxConcurrent: 3,
    contextWindow: 32768,
    maxTokens: 4096,
    memoryGB: 4.5,
    avgInferenceMs: 2200,
  },
  subconscious: {
    model: "qwen2.5:1.5b",
    role: "data analysis, pattern recognition, background synthesis",
    temperature: 0.85,
    timeout: 30000,
    maxConcurrent: 4,
    contextWindow: 8192,
    maxTokens: 1200,
    memoryGB: 1.2,
    avgInferenceMs: 800,
  },
  utility: {
    model: "qwen2.5:3b",
    role: "NPC dialogue, quick tasks, classification, support",
    temperature: 0.3,
    timeout: 20000,
    maxConcurrent: 6,
    contextWindow: 16384,
    maxTokens: 800,
    memoryGB: 2.1,
    avgInferenceMs: 1100,
  },
  repair: {
    model: "qwen2.5:0.5b",
    role: "code/system diagnosis, fix suggestions, error detection",
    temperature: 0.1,
    timeout: 10000,
    maxConcurrent: 2,
    contextWindow: 4096,
    maxTokens: 500,
    memoryGB: 0.5,
    avgInferenceMs: 400,
  },
});

// ── Task-to-Brain Routing Map ──────────────────────────────────────────────

const TASK_ROUTING = Object.freeze({
  npc_dialogue:      "utility",
  dialogue:          "utility",
  classification:    "utility",
  quick_task:        "utility",
  entity_action:     "utility",
  design_assistance: "conscious",
  reasoning:         "conscious",
  deliberation:      "conscious",
  planning:          "conscious",
  code_repair:       "repair",
  diagnosis:         "repair",
  error_detection:   "repair",
  fix_suggestion:    "repair",
  data_analysis:     "subconscious",
  pattern_recognition: "subconscious",
  synthesis:         "subconscious",
  background_task:   "subconscious",
});

// ── Pricing Tiers ──────────────────────────────────────────────────────────

const PRICING_TIERS = Object.freeze({
  free: {
    label: "Free",
    dailyLimit: 100,
    allowedBrains: ["utility"],
    batchEnabled: false,
    priceMonthly: 0,
  },
  developer: {
    label: "Developer",
    dailyLimit: 5000,
    allowedBrains: ["conscious", "subconscious", "utility", "repair"],
    batchEnabled: false,
    priceMonthly: 29,
  },
  professional: {
    label: "Professional",
    dailyLimit: 50000,
    allowedBrains: ["conscious", "subconscious", "utility", "repair"],
    batchEnabled: true,
    priceMonthly: 99,
  },
  enterprise: {
    label: "Enterprise",
    dailyLimit: Infinity,
    allowedBrains: ["conscious", "subconscious", "utility", "repair"],
    batchEnabled: true,
    priceMonthly: 499,
  },
});

// ── Simulated Response Templates ───────────────────────────────────────────

const SIMULATED_RESPONSES = {
  npc_dialogue: (req) =>
    `[NPC] "${req.context?.npcName || "Villager"}": ${req.prompt ? "I've considered what you said." : "Greetings, traveler. What brings you here?"}`,
  design_assistance: (req) =>
    `[Design Analysis] Based on the parameters provided, I recommend a load-bearing structure with ${req.context?.material || "reinforced concrete"} foundations. Key considerations: structural integrity, environmental factors, and cost efficiency.`,
  code_repair: (req) =>
    `[Diagnosis] Identified potential issue in ${req.context?.file || "unknown file"}. Suggested fix: verify null checks and add error boundary handling. Confidence: 0.87.`,
  data_analysis: (req) =>
    `[Analysis] Dataset contains ${req.context?.recordCount || "N/A"} records. Detected ${req.context?.patternCount || 3} significant patterns. Correlation coefficient: 0.73. Recommend further investigation of outliers in cluster B.`,
  classification: (req) =>
    `[Classification] Input categorized as: "${req.context?.category || "general"}". Confidence: 0.91. Secondary category: "${req.context?.secondary || "misc"}".`,
  default: (req) =>
    `[Response] Processed request for task type "${req.taskType || "unknown"}". Result generated successfully.`,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function uid(prefix = "req") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function simulateLatency(brain) {
  const base = BRAIN_CONFIGS[brain]?.avgInferenceMs || 1000;
  const jitter = Math.floor(Math.random() * base * 0.3);
  return base + jitter - Math.floor(base * 0.15);
}

// ── BrainService Class ─────────────────────────────────────────────────────

class BrainService {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxLogSize=10000]  — max entries in the request log
   */
  constructor(opts = {}) {
    this._maxLogSize = opts.maxLogSize || 10000;

    /** Per-brain request counters */
    this._counters = {
      conscious: { total: 0, success: 0, failed: 0, totalLatencyMs: 0 },
      subconscious: { total: 0, success: 0, failed: 0, totalLatencyMs: 0 },
      utility: { total: 0, success: 0, failed: 0, totalLatencyMs: 0 },
      repair: { total: 0, success: 0, failed: 0, totalLatencyMs: 0 },
    };

    /** Per-user daily usage: Map<userId, Map<dateStr, { total, byBrain }>> */
    this._userUsage = new Map();

    /** In-memory request log (ring buffer) */
    this._requestLog = [];

    /** Per-brain status overrides (for marking a brain offline, etc.) */
    this._statusOverrides = new Map();
  }

  // ── Routing ────────────────────────────────────────────────────────────

  /**
   * Auto-route a request to the best brain based on task type.
   *
   * @param {object} request
   * @param {string} request.taskType   — e.g. "npc_dialogue", "code_repair"
   * @param {string} [request.prompt]
   * @param {object} [request.context]
   * @param {string} [request.userId]
   * @param {string} [request.tier]     — pricing tier
   * @returns {Promise<object>} response
   */
  async route(request) {
    const taskType = (request.taskType || "").toLowerCase().replace(/\s+/g, "_");
    let brain = TASK_ROUTING[taskType];

    // Ambiguous or unknown task: classify with utility brain first
    if (!brain) {
      const classification = await this._classify(request);
      brain = TASK_ROUTING[classification] || "utility";
    }

    return this.query(brain, { ...request, _routedFrom: taskType });
  }

  /**
   * Send a request to a specific brain.
   *
   * @param {string} brain      — "conscious" | "subconscious" | "utility" | "repair"
   * @param {object} request
   * @returns {Promise<object>}
   */
  async query(brain, request) {
    if (!BRAIN_CONFIGS[brain]) {
      throw new Error(`Unknown brain: "${brain}". Valid: ${Object.keys(BRAIN_CONFIGS).join(", ")}`);
    }

    // Tier enforcement
    const tier = PRICING_TIERS[request.tier || "free"];
    if (!tier.allowedBrains.includes(brain)) {
      return this._error(request, brain, `Brain "${brain}" not available on ${tier.label} tier`);
    }

    const userId = request.userId || "anonymous";
    const dailyCount = this._getDailyCount(userId);
    if (dailyCount >= tier.dailyLimit) {
      return this._error(request, brain, `Daily limit reached (${tier.dailyLimit}) for ${tier.label} tier`);
    }

    const reqId = uid("req");
    const startMs = Date.now();

    try {
      const latencyMs = simulateLatency(brain);
      const config = BRAIN_CONFIGS[brain];

      // Simulated inference
      const taskType = request.taskType || request._routedFrom || "default";
      const generator = SIMULATED_RESPONSES[taskType] || SIMULATED_RESPONSES.default;
      const content = generator(request);

      const response = {
        id: reqId,
        brain,
        model: config.model,
        taskType,
        content,
        usage: {
          promptTokens: Math.floor((request.prompt || "").length / 4),
          completionTokens: Math.floor(content.length / 4),
          totalTokens: 0,
          latencyMs,
        },
        timestamp: nowISO(),
      };
      response.usage.totalTokens = response.usage.promptTokens + response.usage.completionTokens;

      // Track
      this._trackRequest(brain, userId, reqId, latencyMs, true);
      this._logRequest(reqId, brain, request, response, latencyMs, true);

      return response;
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      this._trackRequest(brain, userId, reqId, latencyMs, false);
      this._logRequest(reqId, brain, request, null, latencyMs, false, err.message);
      return this._error(request, brain, err.message);
    }
  }

  // ── Direct Brain Access ────────────────────────────────────────────────

  /**
   * Direct access to the conscious brain (complex reasoning).
   * @param {object} request
   * @returns {Promise<object>}
   */
  async conscious(request) {
    return this.query("conscious", request);
  }

  /**
   * Direct access to the utility brain (quick tasks).
   * @param {object} request
   * @returns {Promise<object>}
   */
  async utility(request) {
    return this.query("utility", request);
  }

  /**
   * Direct access to the repair brain (diagnosis).
   * @param {object} request
   * @returns {Promise<object>}
   */
  async repair(request) {
    return this.query("repair", request);
  }

  /**
   * Direct access to the subconscious brain (analysis).
   * @param {object} request
   * @returns {Promise<object>}
   */
  async subconscious(request) {
    return this.query("subconscious", request);
  }

  // ── Batch ──────────────────────────────────────────────────────────────

  /**
   * Batch multiple requests, auto-routing each.
   *
   * @param {object[]} requests
   * @returns {Promise<object>} { results, summary }
   */
  async batch(requests) {
    if (!Array.isArray(requests) || requests.length === 0) {
      throw new Error("batch() requires a non-empty array of requests");
    }

    // Tier check: batch must be enabled
    const tier = PRICING_TIERS[(requests[0] && requests[0].tier) || "free"];
    if (!tier.batchEnabled) {
      throw new Error(`Batch processing not available on ${tier.label} tier`);
    }

    const results = [];
    const brainCounts = {};
    let totalLatencyMs = 0;

    for (const req of requests) {
      const result = await this.route(req);
      results.push(result);
      const b = result.brain || "unknown";
      brainCounts[b] = (brainCounts[b] || 0) + 1;
      totalLatencyMs += (result.usage && result.usage.latencyMs) || 0;
    }

    return {
      batchId: uid("batch"),
      count: results.length,
      results,
      summary: {
        brainDistribution: brainCounts,
        totalLatencyMs,
        avgLatencyMs: Math.round(totalLatencyMs / results.length),
        timestamp: nowISO(),
      },
    };
  }

  // ── Status & Usage ─────────────────────────────────────────────────────

  /**
   * Return status of all brains.
   *
   * @returns {object} keyed by brain name
   */
  getStatus() {
    const status = {};
    for (const [name, config] of Object.entries(BRAIN_CONFIGS)) {
      const counters = this._counters[name];
      const override = this._statusOverrides.get(name);
      const avgMs = counters.total > 0
        ? Math.round(counters.totalLatencyMs / counters.total)
        : config.avgInferenceMs;

      status[name] = {
        model: config.model,
        status: override || "online",
        memoryGB: config.memoryGB,
        inferenceMs: avgMs,
        requestsPerMin: this._getRequestsPerMin(name),
        totalRequests: counters.total,
        successRate: counters.total > 0
          ? +(counters.success / counters.total).toFixed(3)
          : 1.0,
        role: config.role,
      };
    }
    return status;
  }

  /**
   * Get usage stats for a specific user.
   *
   * @param {string} userId
   * @param {string} [period="today"] — "today" | "all"
   * @returns {object}
   */
  getUsage(userId, period = "today") {
    const userMap = this._userUsage.get(userId);
    if (!userMap) {
      return { userId, period, total: 0, byBrain: {}, days: {} };
    }

    if (period === "today") {
      const day = todayKey();
      const dayData = userMap.get(day) || { total: 0, byBrain: {} };
      return { userId, period, date: day, ...dayData };
    }

    // Aggregate all days
    let total = 0;
    const byBrain = {};
    const days = {};

    for (const [day, data] of userMap.entries()) {
      days[day] = data;
      total += data.total;
      for (const [b, count] of Object.entries(data.byBrain)) {
        byBrain[b] = (byBrain[b] || 0) + count;
      }
    }

    return { userId, period, total, byBrain, days };
  }

  /**
   * Mark a brain as offline/degraded.
   *
   * @param {string} brain
   * @param {string} status — "online" | "offline" | "degraded"
   */
  setBrainStatus(brain, status) {
    if (!BRAIN_CONFIGS[brain]) {
      throw new Error(`Unknown brain: "${brain}"`);
    }
    if (status === "online") {
      this._statusOverrides.delete(brain);
    } else {
      this._statusOverrides.set(brain, status);
    }
  }

  /**
   * Get the in-memory request log.
   *
   * @param {number} [limit=50]
   * @returns {object[]}
   */
  getRequestLog(limit = 50) {
    return this._requestLog.slice(-limit);
  }

  /**
   * Get brain configurations (read-only).
   * @returns {object}
   */
  getBrainConfigs() {
    return { ...BRAIN_CONFIGS };
  }

  /**
   * Get pricing tier details.
   * @param {string} [tierName]
   * @returns {object}
   */
  getPricingTier(tierName) {
    if (tierName) {
      return PRICING_TIERS[tierName] || null;
    }
    return { ...PRICING_TIERS };
  }

  // ── Internal Helpers ───────────────────────────────────────────────────

  /**
   * Classify an ambiguous task by delegating to the utility brain.
   * Returns a known task type string.
   * @private
   */
  async _classify(request) {
    const prompt = request.prompt || request.taskType || "";
    const lower = prompt.toLowerCase();

    // Simple keyword-based classification (simulated — real version calls utility brain)
    if (/\b(npc|dialogue|talk|speak|conversation)\b/.test(lower))  return "npc_dialogue";
    if (/\b(design|architect|plan|blueprint|layout)\b/.test(lower)) return "design_assistance";
    if (/\b(repair|fix|bug|error|crash|diagnos)\b/.test(lower))    return "code_repair";
    if (/\b(analy|pattern|data|statistic|trend)\b/.test(lower))    return "data_analysis";
    if (/\b(classif|categoriz|label|sort)\b/.test(lower))          return "classification";

    return "default";
  }

  /**
   * Track a request in counters and per-user usage.
   * @private
   */
  _trackRequest(brain, userId, reqId, latencyMs, success) {
    const c = this._counters[brain];
    if (c) {
      c.total++;
      if (success) c.success++;
      else c.failed++;
      c.totalLatencyMs += latencyMs;
    }

    // Per-user daily tracking
    if (!this._userUsage.has(userId)) {
      this._userUsage.set(userId, new Map());
    }
    const userMap = this._userUsage.get(userId);
    const day = todayKey();
    if (!userMap.has(day)) {
      userMap.set(day, { total: 0, byBrain: {} });
    }
    const dayData = userMap.get(day);
    dayData.total++;
    dayData.byBrain[brain] = (dayData.byBrain[brain] || 0) + 1;
  }

  /**
   * Append to the in-memory request log (ring buffer).
   * @private
   */
  _logRequest(reqId, brain, request, response, latencyMs, success, error) {
    const entry = {
      id: reqId,
      brain,
      taskType: request.taskType || request._routedFrom || null,
      userId: request.userId || "anonymous",
      latencyMs,
      success,
      error: error || null,
      timestamp: nowISO(),
    };

    this._requestLog.push(entry);
    if (this._requestLog.length > this._maxLogSize) {
      this._requestLog = this._requestLog.slice(-Math.floor(this._maxLogSize * 0.8));
    }
  }

  /**
   * Get the daily request count for a user.
   * @private
   */
  _getDailyCount(userId) {
    const userMap = this._userUsage.get(userId);
    if (!userMap) return 0;
    const dayData = userMap.get(todayKey());
    return dayData ? dayData.total : 0;
  }

  /**
   * Estimate requests per minute for a brain based on recent log entries.
   * @private
   */
  _getRequestsPerMin(brain) {
    const now = Date.now();
    const oneMinAgo = now - 60000;
    let count = 0;

    for (let i = this._requestLog.length - 1; i >= 0; i--) {
      const entry = this._requestLog[i];
      const entryTime = new Date(entry.timestamp).getTime();
      if (entryTime < oneMinAgo) break;
      if (entry.brain === brain) count++;
    }

    return count;
  }

  /**
   * Build an error response object.
   * @private
   */
  _error(request, brain, message) {
    return {
      id: uid("err"),
      brain,
      error: true,
      message,
      taskType: request.taskType || null,
      timestamp: nowISO(),
    };
  }
}

module.exports = BrainService;
