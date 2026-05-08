/**
 * Concord Moderate — Content Moderation Pipeline
 *
 * Text, name, and DTU moderation with policy-based analysis.
 * Supports multiple policy levels (standard, strict, permissive),
 * batch moderation, report/review queue management, and resolution tracking.
 *
 * Features:
 *   - Text content moderation with confidence scoring
 *   - Name moderation with stricter validation rules
 *   - DTU metadata moderation (name, description, tags)
 *   - Batch moderation for bulk operations
 *   - Report submission and review queue
 *   - Resolution actions (approve, remove, warn, ban)
 *   - Policy retrieval and stats
 */

'use strict';

const crypto = require('crypto');

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = 'mod') {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

function nowISO() {
  return new Date().toISOString();
}

// ── Blocked Word Lists ──────────────────────────────────────────────────────

const SLURS = Object.freeze([
  'slur_placeholder_1', 'slur_placeholder_2', 'slur_placeholder_3',
  'slur_placeholder_4', 'slur_placeholder_5',
]);

const PROFANITY = Object.freeze([
  'damn', 'hell', 'crap', 'ass', 'bastard',
  'shit', 'fuck', 'bitch', 'dick', 'piss',
]);

const THREATS = Object.freeze([
  'kill you', 'murder you', 'gonna die', 'death threat',
  'bomb threat', 'shoot you',
]);

const SUGGESTIVE = Object.freeze([
  'suggestive_placeholder_1', 'suggestive_placeholder_2',
  'suggestive_placeholder_3',
]);

const AGGRESSIVE = Object.freeze([
  'shut up', 'idiot', 'moron', 'stupid', 'loser',
]);

// ── Policies ────────────────────────────────────────────────────────────────

const POLICIES = {
  standard: {
    name: 'standard',
    description: 'Default moderation policy. Blocks profanity and slurs.',
    blockedLists: ['profanity', 'slurs'],
    flags: ['threats'],
    maxNameLength: 30,
    minNameLength: 2,
    allowUnicode: true,
    allowNumbers: true,
  },
  strict: {
    name: 'strict',
    description: 'Strict moderation. Blocks profanity, slurs, suggestive, and aggressive content.',
    blockedLists: ['profanity', 'slurs', 'suggestive', 'aggressive'],
    flags: ['threats'],
    maxNameLength: 24,
    minNameLength: 3,
    allowUnicode: false,
    allowNumbers: false,
  },
  permissive: {
    name: 'permissive',
    description: 'Permissive moderation. Only blocks slurs and threats.',
    blockedLists: ['slurs'],
    flags: ['threats'],
    maxNameLength: 40,
    minNameLength: 1,
    allowUnicode: true,
    allowNumbers: true,
  },
};

function getBlockedWords(policy) {
  const lists = {
    profanity: PROFANITY,
    slurs: SLURS,
    suggestive: SUGGESTIVE,
    aggressive: AGGRESSIVE,
    threats: THREATS,
  };

  const blocked = [];
  for (const listName of (policy.blockedLists || [])) {
    if (lists[listName]) blocked.push(...lists[listName]);
  }
  return blocked;
}

function getFlagWords(policy) {
  const lists = { threats: THREATS, aggressive: AGGRESSIVE, suggestive: SUGGESTIVE };
  const flagged = [];
  for (const listName of (policy.flags || [])) {
    if (lists[listName]) flagged.push(...lists[listName]);
  }
  return flagged;
}

function scanContent(text, blocked, flagged) {
  const lower = text.toLowerCase();
  const foundBlocked = [];
  const foundFlagged = [];

  for (const word of blocked) {
    if (lower.includes(word)) foundBlocked.push(word);
  }
  for (const word of flagged) {
    if (lower.includes(word)) foundFlagged.push(word);
  }

  return { foundBlocked, foundFlagged };
}

// ── ConcordModerate ─────────────────────────────────────────────────────────

class ConcordModerate {
  constructor() {
    this.reviewQueue = [];
    this.resolvedReports = [];
    this.stats = {
      totalReports: 0,
      totalResolved: 0,
      totalAutoBlocked: 0,
      createdAt: nowISO(),
    };
  }

  /**
   * Moderate text content against a policy.
   * @param {string} content
   * @param {string} policy — 'standard', 'strict', 'permissive'
   * @returns {object}
   */
  text(content, policy = 'standard') {
    if (!content || typeof content !== 'string') {
      return { pass: false, flags: ['empty_content'], confidence: 1.0, suggestion: 'Content is empty or invalid.' };
    }

    const policyDef = POLICIES[policy] || POLICIES.standard;
    const blocked = getBlockedWords(policyDef);
    const flagged = getFlagWords(policyDef);
    const { foundBlocked, foundFlagged } = scanContent(content, blocked, flagged);

    const flags = [];
    if (foundBlocked.length > 0) flags.push('blocked_words');
    if (foundFlagged.length > 0) flags.push('flagged_content');

    const pass = foundBlocked.length === 0;
    const confidence = pass
      ? (foundFlagged.length > 0 ? 0.75 : 0.95)
      : 0.9;

    let suggestion = null;
    if (!pass) {
      suggestion = `Content contains blocked terms. Please remove or rephrase: ${foundBlocked.join(', ')}`;
      this.stats.totalAutoBlocked++;
    } else if (foundFlagged.length > 0) {
      suggestion = `Content contains potentially sensitive language. Review recommended.`;
    }

    return {
      pass,
      flags,
      confidence,
      suggestion,
      policy: policyDef.name,
      blockedTermsFound: foundBlocked.length,
      flaggedTermsFound: foundFlagged.length,
    };
  }

  /**
   * Moderate a name/username with stricter rules.
   * @param {string} content — the name to check
   * @param {string} policy
   * @returns {object}
   */
  name(content, policy = 'standard') {
    if (!content || typeof content !== 'string') {
      return { pass: false, flags: ['empty_name'], confidence: 1.0, suggestion: 'Name is empty or invalid.' };
    }

    const policyDef = POLICIES[policy] || POLICIES.standard;
    const trimmed = content.trim();
    const flags = [];
    let pass = true;
    let suggestion = null;

    // Length checks
    if (trimmed.length < policyDef.minNameLength) {
      flags.push('too_short');
      pass = false;
      suggestion = `Name must be at least ${policyDef.minNameLength} characters.`;
    }
    if (trimmed.length > policyDef.maxNameLength) {
      flags.push('too_long');
      pass = false;
      suggestion = `Name must be at most ${policyDef.maxNameLength} characters.`;
    }

    // Unicode check
    if (!policyDef.allowUnicode && /[^\x20-\x7E]/.test(trimmed)) {
      flags.push('unicode_not_allowed');
      pass = false;
      suggestion = 'Name must contain only ASCII characters under this policy.';
    }

    // Number check
    if (!policyDef.allowNumbers && /\d/.test(trimmed)) {
      flags.push('numbers_not_allowed');
      pass = false;
      suggestion = 'Name must not contain numbers under this policy.';
    }

    // Blocked word scan (names are checked against all blocked + flagged lists)
    const allBlocked = [...getBlockedWords(policyDef), ...getFlagWords(policyDef)];
    const lower = trimmed.toLowerCase();
    for (const word of allBlocked) {
      if (lower.includes(word)) {
        flags.push('inappropriate_name');
        pass = false;
        suggestion = 'Name contains inappropriate content.';
        break;
      }
    }

    // Impersonation patterns
    const impersonation = /^(admin|moderator|system|concord|official)/i;
    if (impersonation.test(trimmed)) {
      flags.push('impersonation_risk');
      pass = false;
      suggestion = 'Name resembles an official/admin identity.';
    }

    return {
      pass,
      flags,
      confidence: pass ? 0.92 : 0.88,
      suggestion,
      policy: policyDef.name,
    };
  }

  /**
   * Moderate a DTU document's metadata (name, description, tags).
   * @param {object} dtuDoc
   * @param {string} policy
   * @returns {object}
   */
  dtu(dtuDoc, policy = 'standard') {
    if (!dtuDoc || typeof dtuDoc !== 'object') {
      return { pass: false, flags: ['invalid_dtu'], confidence: 1.0, suggestion: 'DTU document is invalid.' };
    }

    const results = [];

    if (dtuDoc.name) {
      results.push({ field: 'name', result: this.name(dtuDoc.name, policy) });
    }
    if (dtuDoc.description) {
      results.push({ field: 'description', result: this.text(dtuDoc.description, policy) });
    }
    if (Array.isArray(dtuDoc.tags)) {
      for (let i = 0; i < dtuDoc.tags.length; i++) {
        results.push({ field: `tags[${i}]`, result: this.text(dtuDoc.tags[i], policy) });
      }
    }

    const allPass = results.every(r => r.result.pass);
    const allFlags = results.flatMap(r => r.result.flags);
    const avgConfidence = results.length > 0
      ? parseFloat((results.reduce((s, r) => s + r.result.confidence, 0) / results.length).toFixed(3))
      : 1.0;

    return {
      pass: allPass,
      flags: [...new Set(allFlags)],
      confidence: avgConfidence,
      suggestion: allPass ? null : 'One or more DTU metadata fields failed moderation.',
      fieldResults: results,
      policy,
    };
  }

  /**
   * Batch moderate an array of items.
   * @param {object[]} items — each has { type: 'text'|'name'|'dtu', content, policy }
   * @returns {object[]}
   */
  batch(items) {
    if (!Array.isArray(items)) return [];

    return items.map((item, index) => {
      const policy = item.policy || 'standard';
      let result;

      switch (item.type) {
        case 'text':
          result = this.text(item.content, policy);
          break;
        case 'name':
          result = this.name(item.content, policy);
          break;
        case 'dtu':
          result = this.dtu(item.content, policy);
          break;
        default:
          result = { pass: false, flags: ['unknown_type'], confidence: 0, suggestion: `Unknown item type: ${item.type}` };
      }

      return { index, type: item.type, result };
    });
  }

  /**
   * Submit a moderation report.
   * @param {object} reportData — contentId, contentType, reason, reporterId, details
   * @returns {object}
   */
  report(reportData) {
    if (!reportData || !reportData.contentId) {
      return { ok: false, error: 'contentId is required.' };
    }

    const report = {
      id: uid('report'),
      contentId: reportData.contentId,
      contentType: reportData.contentType || 'unknown',
      reason: reportData.reason || 'unspecified',
      reporterId: reportData.reporterId || 'anonymous',
      details: reportData.details || '',
      status: 'pending',
      createdAt: nowISO(),
      resolvedAt: null,
      resolution: null,
    };

    this.reviewQueue.push(report);
    this.stats.totalReports++;
    return { ok: true, report };
  }

  /**
   * Get the review queue with optional filters.
   * @param {object} filters — status, reason, contentType
   * @returns {object[]}
   */
  getReviewQueue(filters = {}) {
    let queue = [...this.reviewQueue];

    if (filters.status) {
      queue = queue.filter(r => r.status === filters.status);
    }
    if (filters.reason) {
      queue = queue.filter(r => r.reason === filters.reason);
    }
    if (filters.contentType) {
      queue = queue.filter(r => r.contentType === filters.contentType);
    }

    return queue.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Resolve a report with an action.
   * @param {string} itemId — report ID
   * @param {string} action — 'approve', 'remove', 'warn', 'ban'
   * @returns {object}
   */
  resolve(itemId, action) {
    const validActions = ['approve', 'remove', 'warn', 'ban'];
    if (!validActions.includes(action)) {
      return { ok: false, error: `Invalid action. Must be one of: ${validActions.join(', ')}` };
    }

    const idx = this.reviewQueue.findIndex(r => r.id === itemId);
    if (idx === -1) {
      return { ok: false, error: `Report ${itemId} not found in review queue.` };
    }

    const report = this.reviewQueue[idx];
    report.status = 'resolved';
    report.resolution = action;
    report.resolvedAt = nowISO();

    this.reviewQueue.splice(idx, 1);
    this.resolvedReports.push(report);
    this.stats.totalResolved++;

    return { ok: true, report };
  }

  /**
   * Get a named policy definition.
   * @param {string} name — 'standard', 'strict', 'permissive'
   * @returns {object|null}
   */
  getPolicy(name) {
    return POLICIES[name] || null;
  }

  /**
   * Get moderation statistics.
   * @returns {object}
   */
  getStats() {
    const pending = this.reviewQueue.filter(r => r.status === 'pending').length;
    const avgResolutionMs = this.resolvedReports.length > 0
      ? this.resolvedReports.reduce((sum, r) => {
          return sum + (new Date(r.resolvedAt) - new Date(r.createdAt));
        }, 0) / this.resolvedReports.length
      : 0;

    return {
      totalReports: this.stats.totalReports,
      totalResolved: this.stats.totalResolved,
      totalAutoBlocked: this.stats.totalAutoBlocked,
      pendingReports: pending,
      avgResolutionTimeMs: Math.round(avgResolutionMs),
      queueDepth: this.reviewQueue.length,
      generatedAt: nowISO(),
    };
  }
}

module.exports = ConcordModerate;
