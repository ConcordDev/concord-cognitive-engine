/**
 * Per-User Constitutional AI
 *
 * Users define personal constitutional principles that the repair brain
 * checks all outputs against before delivery. Layered on top of the
 * system-wide constitution (constitution.js).
 *
 * Hierarchy: System Immutable > System Constitutional > User Constitutional > System Policy
 *
 * A user's personal constitution CANNOT override system immutable or
 * constitutional rules. It can only ADD constraints within the policy tier.
 *
 * Examples:
 *   - "Never recommend solutions involving X technology"
 *   - "Always cite primary sources, not secondary"
 *   - "Prefer conservative financial advice"
 *   - "Flag any output that assumes gender"
 *   - "Avoid military/defense industry references"
 */

import { v4 as uuid } from "uuid";
import logger from "../logger.js";
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Configuration ────────────────────────────────────────────────────────────

const MAX_RULES_PER_USER = 25;
const MAX_RULE_LENGTH = 500;

/** Categories of personal constitutional rules */
const USER_RULE_CATEGORIES = {
  TONE:        "tone",        // How responses should sound
  CONTENT:     "content",     // What topics to include/exclude
  SOURCING:    "sourcing",    // Citation and evidence preferences
  BIAS:        "bias",        // Bias detection preferences
  DOMAIN:      "domain",      // Domain-specific constraints
  PRIVACY:     "privacy",     // Personal data handling preferences
  FORMAT:      "format",      // Output format preferences
  ETHICS:      "ethics",      // Personal ethical constraints
};

/** Actions to take on rule violation */
const VIOLATION_ACTIONS = {
  BLOCK:   "block",   // Prevent output from being delivered
  FLAG:    "flag",    // Deliver with warning flag
  REWRITE: "rewrite", // Attempt to rewrite output to comply
  LOG:     "log",     // Log violation but deliver anyway
};

// ── State ────────────────────────────────────────────────────────────────────

/** @type {Map<string, object[]>} userId → user rules[] */
const _userConstitutions = new LruMap();

/** @type {Map<string, object[]>} userId → violation history[] */
const _violationHistory = new LruMap();

const _metrics = {
  totalRules: 0,
  totalChecks: 0,
  totalViolations: 0,
  totalBlocks: 0,
  totalFlags: 0,
  totalRewrites: 0,
};

// ── Rule Management ──────────────────────────────────────────────────────────

/**
 * Add a personal constitutional rule.
 *
 * @param {string} userId
 * @param {object} rule
 * @param {string} rule.statement - The rule in plain language
 * @param {string} [rule.category] - From USER_RULE_CATEGORIES
 * @param {string} [rule.action] - From VIOLATION_ACTIONS (default: "flag")
 * @param {Function|string} [rule.predicate] - Keyword or function to check output
 * @param {string[]} [rule.keywords] - Keywords that trigger this rule
 * @param {string[]} [rule.domains] - Which lenses/domains this applies to (null = all)
 * @returns {{ ok: boolean, ruleId?: string, error?: string }}
 */
export function addUserRule(userId, { statement, category = "content", action = "flag", predicate = null, keywords = [], domains = null } = {}) {
  if (!userId) return { ok: false, error: "userId required" };
  if (!statement || typeof statement !== "string") return { ok: false, error: "Rule statement required" };
  if (statement.length > MAX_RULE_LENGTH) return { ok: false, error: `Rule exceeds ${MAX_RULE_LENGTH} characters` };

  if (!_userConstitutions.has(userId)) _userConstitutions.set(userId, []);
  const rules = _userConstitutions.get(userId);

  if (rules.length >= MAX_RULES_PER_USER) {
    return { ok: false, error: `Maximum ${MAX_RULES_PER_USER} rules per user` };
  }

  const rule = {
    id: uuid(),
    userId,
    statement,
    category: USER_RULE_CATEGORIES[category?.toUpperCase()] || category || "content",
    action: VIOLATION_ACTIONS[action?.toUpperCase()] || action || "flag",
    keywords: Array.isArray(keywords) ? keywords.map(k => k.toLowerCase()) : [],
    domains: domains ? (Array.isArray(domains) ? domains : [domains]) : null,
    predicate: typeof predicate === "function" ? predicate : null,
    enabled: true,
    createdAt: new Date().toISOString(),
    violations: 0,
  };

  rules.push(rule);
  _metrics.totalRules++;

  logger.info("user-constitution", `User ${userId} added rule: "${statement.slice(0, 80)}"`);

  return { ok: true, ruleId: rule.id };
}

/**
 * Remove a personal constitutional rule.
 */
export function removeUserRule(userId, ruleId) {
  const rules = _userConstitutions.get(userId);
  if (!rules) return { ok: false, error: "No rules found for user" };

  const idx = rules.findIndex(r => r.id === ruleId);
  if (idx === -1) return { ok: false, error: "Rule not found" };

  rules.splice(idx, 1);
  _metrics.totalRules--;

  return { ok: true };
}

/**
 * Toggle a rule on/off.
 */
export function toggleUserRule(userId, ruleId, enabled) {
  const rules = _userConstitutions.get(userId);
  if (!rules) return { ok: false, error: "No rules found" };

  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return { ok: false, error: "Rule not found" };

  rule.enabled = !!enabled;
  return { ok: true, ruleId, enabled: rule.enabled };
}

/**
 * Get all rules for a user.
 */
export function getUserRules(userId) {
  return (_userConstitutions.get(userId) || []).map(r => ({
    id: r.id,
    statement: r.statement,
    category: r.category,
    action: r.action,
    keywords: r.keywords,
    domains: r.domains,
    enabled: r.enabled,
    violations: r.violations,
    createdAt: r.createdAt,
  }));
}

/**
 * Update a rule's action or statement.
 */
export function updateUserRule(userId, ruleId, updates = {}) {
  const rules = _userConstitutions.get(userId);
  if (!rules) return { ok: false, error: "No rules found" };

  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return { ok: false, error: "Rule not found" };

  if (updates.statement) rule.statement = String(updates.statement).slice(0, MAX_RULE_LENGTH);
  if (updates.action && VIOLATION_ACTIONS[updates.action?.toUpperCase()]) rule.action = updates.action;
  if (updates.category) rule.category = updates.category;
  if (updates.keywords) rule.keywords = updates.keywords.map(k => k.toLowerCase());
  if (updates.domains !== undefined) rule.domains = updates.domains;

  return { ok: true, rule: getUserRules(userId).find(r => r.id === ruleId) };
}

// ── Output Checking ──────────────────────────────────────────────────────────

/**
 * Check an AI output against a user's personal constitution.
 * Called by the repair brain before delivering any output.
 *
 * @param {string} userId
 * @param {string} output - The text output to check
 * @param {object} [context]
 * @param {string} [context.lens] - Current lens
 * @param {string} [context.domain] - Current domain
 * @param {string[]} [context.tags] - Context tags
 * @returns {{ pass: boolean, violations: object[], action: string }}
 */
export function checkOutput(userId, output, context = {}) {
  _metrics.totalChecks++;

  const rules = _userConstitutions.get(userId);
  if (!rules || rules.length === 0) {
    return { pass: true, violations: [], action: "none" };
  }

  const outputLower = output.toLowerCase();
  const violations = [];
  let highestAction = "log"; // Escalation order: log < flag < rewrite < block

  const actionPriority = { log: 0, flag: 1, rewrite: 2, block: 3 };

  for (const rule of rules) {
    if (!rule.enabled) continue;

    // Check domain applicability
    if (rule.domains && rule.domains.length > 0) {
      const currentDomain = context.lens || context.domain;
      if (currentDomain && !rule.domains.includes(currentDomain)) continue;
    }

    let violated = false;
    let evidence = null;

    // Check via keywords
    if (rule.keywords.length > 0) {
      const matched = rule.keywords.filter(kw => outputLower.includes(kw));
      if (matched.length > 0) {
        violated = true;
        evidence = { type: "keyword", matched };
      }
    }

    // Check via custom predicate
    if (!violated && rule.predicate) {
      try {
        const result = rule.predicate(output, context);
        if (result) {
          violated = true;
          evidence = { type: "predicate", result };
        }
      } catch (_) {
        // Ignore predicate errors
      }
    }

    if (violated) {
      rule.violations++;
      _metrics.totalViolations++;

      violations.push({
        ruleId: rule.id,
        statement: rule.statement,
        category: rule.category,
        action: rule.action,
        evidence,
      });

      if (actionPriority[rule.action] > actionPriority[highestAction]) {
        highestAction = rule.action;
      }
    }
  }

  if (violations.length > 0) {
    // Track in violation history
    if (!_violationHistory.has(userId)) _violationHistory.set(userId, []);
    const history = _violationHistory.get(userId);
    history.push({
      ts: new Date().toISOString(),
      violations: violations.map(v => v.ruleId),
      action: highestAction,
      outputSnippet: output.slice(0, 100),
    });
    // Keep last 100
    if (history.length > 100) _violationHistory.set(userId, history.slice(-100));

    if (highestAction === "block") _metrics.totalBlocks++;
    if (highestAction === "flag") _metrics.totalFlags++;
    if (highestAction === "rewrite") _metrics.totalRewrites++;
  }

  return {
    pass: violations.length === 0,
    violations,
    action: violations.length === 0 ? "none" : highestAction,
  };
}

/**
 * Get violation history for a user.
 */
export function getViolationHistory(userId, limit = 20) {
  return (_violationHistory.get(userId) || []).slice(-limit);
}

/**
 * Get global metrics.
 */
export function getConstitutionMetrics() {
  return {
    ..._metrics,
    usersWithRules: _userConstitutions.size,
  };
}

// ── Presets ──────────────────────────────────────────────────────────────────

/**
 * Preset rule bundles users can activate with one click.
 */
export const RULE_PRESETS = {
  academic: {
    name: "Academic Rigor",
    description: "Enforce citation standards and evidence-based outputs",
    rules: [
      { statement: "Always cite primary sources when available", category: "sourcing", action: "flag", keywords: [] },
      { statement: "Flag speculative claims not backed by evidence", category: "sourcing", action: "flag", keywords: ["might", "possibly", "perhaps"] },
      { statement: "Prefer peer-reviewed sources over blogs or news", category: "sourcing", action: "log", keywords: [] },
    ],
  },
  conservative_finance: {
    name: "Conservative Finance",
    description: "Conservative financial advice and risk warnings",
    rules: [
      { statement: "Always include risk warnings with investment advice", category: "domain", action: "flag", keywords: ["invest", "stock", "crypto", "trade"], domains: ["finance", "market"] },
      { statement: "Flag high-risk recommendations", category: "domain", action: "flag", keywords: ["guaranteed", "risk-free", "can't lose"] },
    ],
  },
  inclusive_language: {
    name: "Inclusive Language",
    description: "Flag potentially non-inclusive language",
    rules: [
      { statement: "Avoid gendered assumptions", category: "bias", action: "flag", keywords: ["mankind", "manmade", "policeman", "fireman", "chairman"] },
      { statement: "Use person-first language", category: "bias", action: "log", keywords: [] },
    ],
  },
  privacy_focused: {
    name: "Privacy Focused",
    description: "Extra privacy protections on outputs",
    rules: [
      { statement: "Never include personal identifiers in outputs", category: "privacy", action: "block", keywords: ["ssn", "social security", "credit card", "passport number"] },
      { statement: "Warn when outputs reference specific individuals", category: "privacy", action: "flag", keywords: [] },
    ],
  },
};

/**
 * Apply a preset rule bundle to a user.
 */
export function applyPreset(userId, presetId) {
  const preset = RULE_PRESETS[presetId];
  if (!preset) return { ok: false, error: `Unknown preset: ${presetId}` };

  const results = [];
  for (const rule of preset.rules) {
    const result = addUserRule(userId, rule);
    results.push(result);
  }

  return { ok: true, preset: presetId, rulesAdded: results.filter(r => r.ok).length };
}

// ── Exports ──────────────────────────────────────────────────────────────────

export { USER_RULE_CATEGORIES, VIOLATION_ACTIONS, MAX_RULES_PER_USER };

export default {
  addUserRule,
  removeUserRule,
  toggleUserRule,
  getUserRules,
  updateUserRule,
  checkOutput,
  getViolationHistory,
  getConstitutionMetrics,
  applyPreset,
  RULE_PRESETS,
};
