/**
 * Concord Conversational Initiative Engine — The Living Chat
 *
 * Proactive outreach system that enables Concord to initiate conversations
 * with users based on triggers, rather than waiting passively for input.
 *
 * Features:
 * 1. Seven trigger types for proactive outreach
 * 2. Double-text engine (follow-ups with 30min minimum gap)
 * 3. Fluidity engine (style matching: length, formality, emoji)
 * 4. Rate limiting (3/day, 10/week, 4h minimum gap between initiatives)
 * 5. Quiet hours enforcement
 * 6. Backoff on no-response (exponential decay)
 * 7. Multi-channel delivery (in-app, push, SMS, email)
 * 8. User style profile learning
 */

import { generateId } from "./id-factory.js";
import { ValidationError, NotFoundError, RateLimitError } from "./errors.js";

// ── Constants ────────────────────────────────────────────────────────────────

const TRIGGER_TYPES = Object.freeze([
  "substrate_discovery",
  "citation_alert",
  "check_in",
  "pending_work",
  "world_event",
  "reflective_followup",
  "morning_context",
]);

const PRIORITY_LEVELS = Object.freeze(["low", "normal", "high", "urgent"]);

const STATUS_VALUES = Object.freeze([
  "pending",
  "delivered",
  "read",
  "responded",
  "dismissed",
  "expired",
]);

const CHANNELS = Object.freeze(["inApp", "push", "sms", "email"]);

/** Priority weights for trigger scoring */
const TRIGGER_PRIORITY_WEIGHTS = Object.freeze({
  substrate_discovery: 0.7,
  citation_alert: 0.8,
  check_in: 0.3,
  pending_work: 0.6,
  world_event: 0.9,
  reflective_followup: 0.5,
  morning_context: 0.4,
});

/** Minimum gap in milliseconds between initiatives (4 hours) */
const MIN_GAP_MS = 4 * 60 * 60 * 1000;

/** Minimum gap for double-text in milliseconds (30 minutes) */
const DOUBLE_TEXT_GAP_MS = 30 * 60 * 1000;

/** Default rate limits */
const DEFAULT_MAX_PER_DAY = 3;
const DEFAULT_MAX_PER_WEEK = 10;

/** Base backoff duration in milliseconds (1 hour) */
const BASE_BACKOFF_MS = 60 * 60 * 1000;

/** Maximum backoff multiplier (caps exponential growth) */
const MAX_BACKOFF_MULTIPLIER = 48;

/** Emoji regex for style detection */
const EMOJI_REGEX = /\p{Emoji}/gu;

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parse a time string "HH:MM" to minutes since midnight.
 * @param {string} timeStr
 * @returns {number}
 */
function _parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return -1;
  const parts = timeStr.split(":");
  if (parts.length !== 2) return -1;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return -1;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return -1;
  return hours * 60 + minutes;
}

/**
 * Check if the current time falls within quiet hours.
 * Handles overnight spans (e.g., 22:00 - 08:00).
 * @param {string} quietStart - "HH:MM"
 * @param {string} quietEnd - "HH:MM"
 * @returns {boolean}
 */
function _isQuietHours(quietStart, quietEnd) {
  const start = _parseTimeToMinutes(quietStart);
  const end = _parseTimeToMinutes(quietEnd);
  if (start < 0 || end < 0) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (start <= end) {
    // Same-day range (e.g., 09:00 - 17:00)
    return currentMinutes >= start && currentMinutes < end;
  }
  // Overnight range (e.g., 22:00 - 08:00)
  return currentMinutes >= start || currentMinutes < end;
}

/**
 * Compute a relevance score for a trigger based on type, priority, and context.
 * @param {string} triggerType
 * @param {string} priority
 * @param {object} context
 * @returns {number} Score between 0 and 1
 */
function _computeScore(triggerType, priority, context) {
  let score = TRIGGER_PRIORITY_WEIGHTS[triggerType] || 0.5;

  // Priority multiplier
  const priorityMultipliers = { low: 0.5, normal: 1.0, high: 1.3, urgent: 1.5 };
  score *= priorityMultipliers[priority] || 1.0;

  // Context-based boosts
  if (context) {
    if (typeof context.relevanceScore === "number") {
      score *= (0.5 + context.relevanceScore * 0.5);
    }
    if (context.userEngagementRecent) {
      score *= 1.1;
    }
    if (context.timeSensitive) {
      score *= 1.2;
    }
  }

  return Math.min(1.0, Math.max(0.0, score));
}

/**
 * Calculate exponential backoff duration based on ignored count.
 * @param {number} ignoredCount
 * @returns {number} Backoff duration in milliseconds
 */
function _calculateBackoffMs(ignoredCount) {
  const multiplier = Math.min(Math.pow(2, ignoredCount), MAX_BACKOFF_MULTIPLIER);
  return BASE_BACKOFF_MS * multiplier;
}

/**
 * Count emojis in a text string.
 * @param {string} text
 * @returns {number}
 */
function _countEmojis(text) {
  if (!text) return 0;
  const matches = text.match(EMOJI_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Estimate formality level of a message (0 = casual, 1 = formal).
 * Uses heuristics: capitalization, punctuation, contractions, slang.
 * @param {string} text
 * @returns {number}
 */
function _estimateFormality(text) {
  if (!text || text.length === 0) return 0.5;

  let formalitySignals = 0;
  let totalSignals = 0;

  // Proper capitalization at sentence starts
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length > 0) {
    const capitalizedSentences = sentences.filter(s => /^\s*[A-Z]/.test(s));
    formalitySignals += capitalizedSentences.length / sentences.length;
    totalSignals += 1;
  }

  // Contractions (informal)
  const contractions = /\b(don't|won't|can't|wouldn't|shouldn't|couldn't|isn't|aren't|wasn't|weren't|i'm|i've|i'd|i'll|we're|they're|you're|he's|she's|it's|that's|there's|here's|what's|who's|how's|let's)\b/gi;
  const contractionCount = (text.match(contractions) || []).length;
  const wordCount = text.split(/\s+/).length;
  if (wordCount > 0) {
    const contractionRate = contractionCount / wordCount;
    formalitySignals += Math.max(0, 1 - contractionRate * 10);
    totalSignals += 1;
  }

  // Proper punctuation at end
  if (/[.!?]$/.test(text.trim())) {
    formalitySignals += 0.7;
  } else {
    formalitySignals += 0.3;
  }
  totalSignals += 1;

  // Emoji usage (informal)
  const emojiCount = _countEmojis(text);
  if (emojiCount === 0) {
    formalitySignals += 0.8;
  } else {
    formalitySignals += Math.max(0, 0.5 - emojiCount * 0.1);
  }
  totalSignals += 1;

  // All-lowercase (informal)
  if (text === text.toLowerCase() && text.length > 10) {
    formalitySignals += 0.1;
  } else {
    formalitySignals += 0.6;
  }
  totalSignals += 1;

  return totalSignals > 0 ? formalitySignals / totalSignals : 0.5;
}

/**
 * Extract vocabulary tokens from a message for style profiling.
 * @param {string} text
 * @returns {string[]}
 */
function _extractVocabulary(text) {
  if (!text) return [];
  const commonWords = new Set([
    "that", "this", "with", "from", "your", "have", "will", "been",
    "they", "them", "than", "then", "what", "when", "where", "which",
    "their", "there", "would", "could", "should", "about", "after",
    "before", "between", "other", "some", "more", "very", "also",
    "just", "into", "over", "such", "only", "like", "make", "made",
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !commonWords.has(w))
    .slice(0, 50);
}

/**
 * Select the best delivery channel based on settings and priority.
 * @param {object} channels - Channel preferences { inApp, push, sms, email }
 * @param {string} priority
 * @returns {string}
 */
function _selectChannel(channels, priority) {
  if (!channels) return "inApp";

  if (priority === "urgent") {
    if (channels.push) return "push";
    if (channels.sms) return "sms";
    if (channels.email) return "email";
    return "inApp";
  }

  if (priority === "high") {
    if (channels.push) return "push";
    if (channels.inApp) return "inApp";
    if (channels.email) return "email";
    return "inApp";
  }

  // Normal/low: in-app preferred
  if (channels.inApp) return "inApp";
  if (channels.email) return "email";
  return "inApp";
}

/**
 * Safely parse JSON with a fallback value.
 * @param {string} str
 * @param {*} fallback
 * @returns {*}
 */
function _safeParseJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch (err) { console.debug('[initiative-engine] JSON parse failed', err?.message); return fallback; }
}

/**
 * Prepare all SQLite statements (lazy, cached per engine instance).
 * @param {object} db
 * @returns {object}
 */
function _prepareStatements(db) {
  return {
    // ── Settings ──────────────────────────────────────────────────────
    getSettings: db.prepare(
      "SELECT * FROM initiative_settings WHERE user_id = ?"
    ),
    insertSettings: db.prepare(`
      INSERT INTO initiative_settings
        (user_id, max_per_day, max_per_week, quiet_start, quiet_end,
         allow_double_text, channels_json, disabled, created_at, updated_at)
      VALUES
        (@user_id, @max_per_day, @max_per_week, @quiet_start, @quiet_end,
         @allow_double_text, @channels_json, @disabled, @created_at, @updated_at)
    `),
    updateSettings: db.prepare(`
      UPDATE initiative_settings SET
        max_per_day = @max_per_day,
        max_per_week = @max_per_week,
        quiet_start = @quiet_start,
        quiet_end = @quiet_end,
        allow_double_text = @allow_double_text,
        channels_json = @channels_json,
        disabled = @disabled,
        updated_at = @updated_at
      WHERE user_id = @user_id
    `),

    // ── Initiatives ───────────────────────────────────────────────────
    insertInitiative: db.prepare(`
      INSERT INTO initiatives
        (id, user_id, trigger_type, message, priority, score, status,
         channel, metadata_json, created_at)
      VALUES
        (@id, @user_id, @trigger_type, @message, @priority, @score,
         @status, @channel, @metadata_json, @created_at)
    `),
    getInitiative: db.prepare(
      "SELECT * FROM initiatives WHERE id = ?"
    ),
    updateInitiativeStatus: db.prepare(`
      UPDATE initiatives SET
        status = @status,
        delivered_at = @delivered_at,
        read_at = @read_at,
        responded_at = @responded_at,
        dismissed_at = @dismissed_at
      WHERE id = @id
    `),
    getPending: db.prepare(
      "SELECT * FROM initiatives WHERE user_id = ? AND status = 'pending' ORDER BY score DESC, created_at ASC"
    ),
    getHistory: db.prepare(
      "SELECT * FROM initiatives WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ),
    getHistoryWithStatus: db.prepare(
      "SELECT * FROM initiatives WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ),
    countHistory: db.prepare(
      "SELECT COUNT(*) as total FROM initiatives WHERE user_id = ?"
    ),
    countHistoryWithStatus: db.prepare(
      "SELECT COUNT(*) as total FROM initiatives WHERE user_id = ? AND status = ?"
    ),
    countToday: db.prepare(
      "SELECT COUNT(*) as count FROM initiatives WHERE user_id = ? AND created_at >= ? AND status != 'expired'"
    ),
    countThisWeek: db.prepare(
      "SELECT COUNT(*) as count FROM initiatives WHERE user_id = ? AND created_at >= ? AND status != 'expired'"
    ),
    getLastInitiative: db.prepare(
      "SELECT * FROM initiatives WHERE user_id = ? AND status != 'expired' ORDER BY created_at DESC LIMIT 1"
    ),
    getLastDelivered: db.prepare(
      "SELECT * FROM initiatives WHERE user_id = ? AND delivered_at IS NOT NULL ORDER BY delivered_at DESC LIMIT 1"
    ),

    // ── Backoff ───────────────────────────────────────────────────────
    getBackoff: db.prepare(
      "SELECT * FROM initiative_backoff WHERE user_id = ?"
    ),
    upsertBackoff: db.prepare(`
      INSERT INTO initiative_backoff
        (user_id, ignored_count, last_initiative_at, backoff_until,
         created_at, updated_at)
      VALUES
        (@user_id, @ignored_count, @last_initiative_at, @backoff_until,
         @created_at, @updated_at)
      ON CONFLICT(user_id) DO UPDATE SET
        ignored_count = @ignored_count,
        last_initiative_at = @last_initiative_at,
        backoff_until = @backoff_until,
        updated_at = @updated_at
    `),

    // ── Style profile ─────────────────────────────────────────────────
    getStyleProfile: db.prepare(
      "SELECT * FROM user_style_profile WHERE user_id = ?"
    ),
    upsertStyleProfile: db.prepare(`
      INSERT INTO user_style_profile
        (user_id, avg_message_length, formality_level, emoji_rate,
         vocabulary_json, shared_context_json, updated_at)
      VALUES
        (@user_id, @avg_message_length, @formality_level, @emoji_rate,
         @vocabulary_json, @shared_context_json, @updated_at)
      ON CONFLICT(user_id) DO UPDATE SET
        avg_message_length = @avg_message_length,
        formality_level = @formality_level,
        emoji_rate = @emoji_rate,
        vocabulary_json = @vocabulary_json,
        shared_context_json = @shared_context_json,
        updated_at = @updated_at
    `),

    // ── Stats ─────────────────────────────────────────────────────────
    totalInitiatives: db.prepare(
      "SELECT COUNT(*) as count FROM initiatives"
    ),
    initiativesByStatus: db.prepare(
      "SELECT status, COUNT(*) as count FROM initiatives GROUP BY status"
    ),
    initiativesByTrigger: db.prepare(
      "SELECT trigger_type, COUNT(*) as count FROM initiatives GROUP BY trigger_type"
    ),
    avgScore: db.prepare(
      "SELECT AVG(score) as avg_score FROM initiatives"
    ),
    responseCount: db.prepare(
      "SELECT COUNT(*) as count FROM initiatives WHERE responded_at IS NOT NULL"
    ),
    uniqueUsers: db.prepare(
      "SELECT COUNT(DISTINCT user_id) as count FROM initiatives"
    ),
  };
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a Conversational Initiative Engine instance.
 *
 * @param {import("better-sqlite3").Database} db - SQLite database handle
 * @returns {object} Engine instance with all public methods
 */
export function createInitiativeEngine(db) {
  if (!db) {
    throw new ValidationError("Database connection is required for initiative engine");
  }

  let _stmts = null;

  /** Lazy-init prepared statements */
  function stmts() {
    if (!_stmts) {
      _stmts = _prepareStatements(db);
    }
    return _stmts;
  }

  // ── Settings ─────────────────────────────────────────────────────────

  /**
   * Get a user's initiative settings, creating defaults if none exist.
   * @param {string} userId
   * @returns {object} Settings object
   */
  function getSettings(userId) {
    if (!userId) throw new ValidationError("userId is required");

    let row = stmts().getSettings.get(userId);
    if (!row) {
      const now = new Date().toISOString();
      stmts().insertSettings.run({
        user_id: userId,
        max_per_day: DEFAULT_MAX_PER_DAY,
        max_per_week: DEFAULT_MAX_PER_WEEK,
        quiet_start: "22:00",
        quiet_end: "08:00",
        allow_double_text: 1,
        channels_json: JSON.stringify({ inApp: true, push: false, sms: false, email: false }),
        disabled: 0,
        created_at: now,
        updated_at: now,
      });
      row = stmts().getSettings.get(userId);
    }

    return {
      userId: row.user_id,
      maxPerDay: row.max_per_day,
      maxPerWeek: row.max_per_week,
      quietStart: row.quiet_start,
      quietEnd: row.quiet_end,
      allowDoubleText: Boolean(row.allow_double_text),
      channels: _safeParseJSON(row.channels_json, { inApp: true, push: false, sms: false, email: false }),
      disabled: Boolean(row.disabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Update a user's initiative settings (partial merge).
   * @param {string} userId
   * @param {object} settings - Partial settings to merge
   * @returns {object} Updated settings
   */
  function updateSettings(userId, settings) {
    if (!userId) throw new ValidationError("userId is required");
    if (!settings || typeof settings !== "object") {
      throw new ValidationError("settings object is required");
    }

    // Ensure defaults exist first
    const current = getSettings(userId);
    const now = new Date().toISOString();

    // Validate individual fields
    if (settings.maxPerDay !== undefined) {
      if (typeof settings.maxPerDay !== "number" || settings.maxPerDay < 0 || settings.maxPerDay > 50) {
        throw new ValidationError("maxPerDay must be a number between 0 and 50");
      }
    }
    if (settings.maxPerWeek !== undefined) {
      if (typeof settings.maxPerWeek !== "number" || settings.maxPerWeek < 0 || settings.maxPerWeek > 200) {
        throw new ValidationError("maxPerWeek must be a number between 0 and 200");
      }
    }
    if (settings.quietStart !== undefined && !/^\d{2}:\d{2}$/.test(settings.quietStart)) {
      throw new ValidationError("quietStart must be in HH:MM format");
    }
    if (settings.quietEnd !== undefined && !/^\d{2}:\d{2}$/.test(settings.quietEnd)) {
      throw new ValidationError("quietEnd must be in HH:MM format");
    }
    if (settings.channels !== undefined) {
      if (typeof settings.channels !== "object") {
        throw new ValidationError("channels must be an object");
      }
      for (const key of Object.keys(settings.channels)) {
        if (!CHANNELS.includes(key)) {
          throw new ValidationError(`Invalid channel: ${key}. Valid channels: ${CHANNELS.join(", ")}`);
        }
      }
    }

    const merged = {
      user_id: userId,
      max_per_day: settings.maxPerDay !== undefined ? settings.maxPerDay : current.maxPerDay,
      max_per_week: settings.maxPerWeek !== undefined ? settings.maxPerWeek : current.maxPerWeek,
      quiet_start: settings.quietStart !== undefined ? settings.quietStart : current.quietStart,
      quiet_end: settings.quietEnd !== undefined ? settings.quietEnd : current.quietEnd,
      allow_double_text: settings.allowDoubleText !== undefined
        ? (settings.allowDoubleText ? 1 : 0)
        : (current.allowDoubleText ? 1 : 0),
      channels_json: JSON.stringify(
        settings.channels !== undefined
          ? { ...current.channels, ...settings.channels }
          : current.channels
      ),
      disabled: settings.disabled !== undefined
        ? (settings.disabled ? 1 : 0)
        : (current.disabled ? 1 : 0),
      updated_at: now,
    };

    stmts().updateSettings.run(merged);
    return getSettings(userId);
  }

  // ── Rate limiting ────────────────────────────────────────────────────

  /**
   * Check whether rate limits allow another initiative for this user.
   * Enforces daily limit, weekly limit, minimum gap, quiet hours, and backoff.
   *
   * @param {string} userId
   * @returns {object} { allowed, reason?, dailyUsed, dailyMax, weeklyUsed, weeklyMax, nextAllowedAt? }
   */
  function checkRateLimits(userId) {
    if (!userId) throw new ValidationError("userId is required");

    const settings = getSettings(userId);

    if (settings.disabled) {
      return {
        allowed: false,
        reason: "initiatives_disabled",
        dailyUsed: 0,
        dailyMax: settings.maxPerDay,
        weeklyUsed: 0,
        weeklyMax: settings.maxPerWeek,
      };
    }

    // Quiet hours
    if (_isQuietHours(settings.quietStart, settings.quietEnd)) {
      return {
        allowed: false,
        reason: "quiet_hours",
        quietStart: settings.quietStart,
        quietEnd: settings.quietEnd,
        dailyUsed: 0,
        dailyMax: settings.maxPerDay,
        weeklyUsed: 0,
        weeklyMax: settings.maxPerWeek,
      };
    }

    // Backoff
    const backoff = getBackoff(userId);
    if (backoff.backoffUntil) {
      const backoffTime = new Date(backoff.backoffUntil).getTime();
      if (backoffTime > Date.now()) {
        return {
          allowed: false,
          reason: "backoff_active",
          backoffUntil: backoff.backoffUntil,
          ignoredCount: backoff.ignoredCount,
          dailyUsed: 0,
          dailyMax: settings.maxPerDay,
          weeklyUsed: 0,
          weeklyMax: settings.maxPerWeek,
        };
      }
    }

    // Minimum 4-hour gap
    const lastInitiative = stmts().getLastInitiative.get(userId);
    if (lastInitiative) {
      const lastTime = new Date(lastInitiative.created_at).getTime();
      const elapsed = Date.now() - lastTime;
      if (elapsed < MIN_GAP_MS) {
        const nextAllowedAt = new Date(lastTime + MIN_GAP_MS).toISOString();
        return {
          allowed: false,
          reason: "min_gap_not_met",
          minGapHours: MIN_GAP_MS / (60 * 60 * 1000),
          nextAllowedAt,
          dailyUsed: 0,
          dailyMax: settings.maxPerDay,
          weeklyUsed: 0,
          weeklyMax: settings.maxPerWeek,
        };
      }
    }

    // Daily count
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const dailyRow = stmts().countToday.get(userId, todayStart.toISOString());
    const dailyUsed = dailyRow?.count || 0;

    if (dailyUsed >= settings.maxPerDay) {
      return {
        allowed: false,
        reason: "daily_limit_reached",
        dailyUsed,
        dailyMax: settings.maxPerDay,
        weeklyUsed: 0,
        weeklyMax: settings.maxPerWeek,
      };
    }

    // Weekly count
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weeklyRow = stmts().countThisWeek.get(userId, weekStart.toISOString());
    const weeklyUsed = weeklyRow?.count || 0;

    if (weeklyUsed >= settings.maxPerWeek) {
      return {
        allowed: false,
        reason: "weekly_limit_reached",
        dailyUsed,
        dailyMax: settings.maxPerDay,
        weeklyUsed,
        weeklyMax: settings.maxPerWeek,
      };
    }

    return {
      allowed: true,
      dailyUsed,
      dailyMax: settings.maxPerDay,
      weeklyUsed,
      weeklyMax: settings.maxPerWeek,
    };
  }

  // ── Trigger evaluation ───────────────────────────────────────────────

  /**
   * Evaluate whether a trigger should fire for a user.
   * Checks rate limits, quiet hours, backoff, and computes a relevance score.
   *
   * @param {string} userId
   * @param {string} triggerType - One of TRIGGER_TYPES
   * @param {object} [context={}] - Additional context for scoring
   * @returns {object} { shouldFire, score, reason?, rateLimits? }
   */
  function evaluateTrigger(userId, triggerType, context = {}) {
    if (!userId) throw new ValidationError("userId is required");
    if (!TRIGGER_TYPES.includes(triggerType)) {
      throw new ValidationError(
        `Invalid trigger type: ${triggerType}. Valid types: ${TRIGGER_TYPES.join(", ")}`
      );
    }

    // Rate limit check first
    const limits = checkRateLimits(userId);
    if (!limits.allowed) {
      return {
        shouldFire: false,
        score: 0,
        reason: limits.reason,
        rateLimits: limits,
      };
    }

    // Score computation
    const priority = context.priority || "normal";
    const score = _computeScore(triggerType, priority, context);

    // Threshold filter: only fire above 0.3
    const threshold = 0.3;
    if (score < threshold) {
      return {
        shouldFire: false,
        score,
        reason: "score_below_threshold",
        threshold,
      };
    }

    return {
      shouldFire: true,
      score,
      triggerType,
      suggestedPriority: priority,
      rateLimits: limits,
    };
  }

  // ── Initiative CRUD ──────────────────────────────────────────────────

  /**
   * Create a new pending initiative.
   *
   * @param {string} userId
   * @param {string} triggerType
   * @param {string} message
   * @param {object} [options={}]
   * @param {string} [options.priority='normal']
   * @param {object} [options.metadata={}]
   * @param {string} [options.channel]
   * @returns {object} Created initiative record
   */
  function createInitiative(userId, triggerType, message, options = {}) {
    if (!userId) throw new ValidationError("userId is required");
    if (!triggerType) throw new ValidationError("triggerType is required");
    if (!message || typeof message !== "string") {
      throw new ValidationError("message is required and must be a string");
    }
    if (!TRIGGER_TYPES.includes(triggerType)) {
      throw new ValidationError(
        `Invalid trigger type: ${triggerType}. Valid types: ${TRIGGER_TYPES.join(", ")}`
      );
    }

    const priority = options.priority || "normal";
    if (!PRIORITY_LEVELS.includes(priority)) {
      throw new ValidationError(
        `Invalid priority: ${priority}. Valid levels: ${PRIORITY_LEVELS.join(", ")}`
      );
    }

    const settings = getSettings(userId);
    const channel = options.channel || _selectChannel(settings.channels, priority);
    const score = _computeScore(triggerType, priority, options.metadata || {});
    const now = new Date().toISOString();
    const id = generateId("init");

    stmts().insertInitiative.run({
      id,
      user_id: userId,
      trigger_type: triggerType,
      message,
      priority,
      score,
      status: "pending",
      channel,
      metadata_json: JSON.stringify(options.metadata || {}),
      created_at: now,
    });

    // Track in backoff state
    const backoff = getBackoff(userId);
    stmts().upsertBackoff.run({
      user_id: userId,
      ignored_count: backoff.ignoredCount,
      last_initiative_at: now,
      backoff_until: backoff.backoffUntil,
      created_at: backoff.createdAt || now,
      updated_at: now,
    });

    return {
      id,
      userId,
      triggerType,
      message,
      priority,
      score,
      status: "pending",
      channel,
      metadata: options.metadata || {},
      createdAt: now,
    };
  }

  /**
   * Mark an initiative as delivered.
   * @param {string} initiativeId
   * @returns {object} { id, status, deliveredAt }
   */
  function deliverInitiative(initiativeId) {
    if (!initiativeId) throw new ValidationError("initiativeId is required");

    const row = stmts().getInitiative.get(initiativeId);
    if (!row) throw new NotFoundError("Initiative", initiativeId);

    if (row.status !== "pending") {
      throw new ValidationError(`Cannot deliver initiative in status: ${row.status}`);
    }

    const now = new Date().toISOString();
    stmts().updateInitiativeStatus.run({
      id: initiativeId,
      status: "delivered",
      delivered_at: now,
      read_at: row.read_at,
      responded_at: row.responded_at,
      dismissed_at: row.dismissed_at,
    });

    return { id: initiativeId, status: "delivered", deliveredAt: now };
  }

  /**
   * Mark an initiative as read.
   * @param {string} initiativeId
   * @returns {object} { id, status, readAt }
   */
  function markRead(initiativeId) {
    if (!initiativeId) throw new ValidationError("initiativeId is required");

    const row = stmts().getInitiative.get(initiativeId);
    if (!row) throw new NotFoundError("Initiative", initiativeId);

    if (!["pending", "delivered"].includes(row.status)) {
      throw new ValidationError(`Cannot mark as read: initiative is in status ${row.status}`);
    }

    const now = new Date().toISOString();
    stmts().updateInitiativeStatus.run({
      id: initiativeId,
      status: "read",
      delivered_at: row.delivered_at || now,
      read_at: now,
      responded_at: row.responded_at,
      dismissed_at: row.dismissed_at,
    });

    return { id: initiativeId, status: "read", readAt: now };
  }

  /**
   * Mark an initiative as responded to (user engaged).
   * Resets backoff counter since user interaction proves engagement.
   * @param {string} initiativeId
   * @returns {object} { id, status, respondedAt }
   */
  function markResponded(initiativeId) {
    if (!initiativeId) throw new ValidationError("initiativeId is required");

    const row = stmts().getInitiative.get(initiativeId);
    if (!row) throw new NotFoundError("Initiative", initiativeId);

    if (!["pending", "delivered", "read"].includes(row.status)) {
      throw new ValidationError(`Cannot mark as responded: initiative is in status ${row.status}`);
    }

    const now = new Date().toISOString();
    stmts().updateInitiativeStatus.run({
      id: initiativeId,
      status: "responded",
      delivered_at: row.delivered_at || now,
      read_at: row.read_at || now,
      responded_at: now,
      dismissed_at: row.dismissed_at,
    });

    // Reset backoff — user is engaged
    stmts().upsertBackoff.run({
      user_id: row.user_id,
      ignored_count: 0,
      last_initiative_at: now,
      backoff_until: null,
      created_at: now,
      updated_at: now,
    });

    return { id: initiativeId, status: "responded", respondedAt: now };
  }

  /**
   * Dismiss an initiative. Increments backoff counter and computes
   * exponential backoff delay before next initiative.
   * @param {string} initiativeId
   * @returns {object} { id, status, dismissedAt, backoff }
   */
  function dismissInitiative(initiativeId) {
    if (!initiativeId) throw new ValidationError("initiativeId is required");

    const row = stmts().getInitiative.get(initiativeId);
    if (!row) throw new NotFoundError("Initiative", initiativeId);

    if (["dismissed", "responded", "expired"].includes(row.status)) {
      throw new ValidationError(`Cannot dismiss initiative in status: ${row.status}`);
    }

    const now = new Date().toISOString();
    stmts().updateInitiativeStatus.run({
      id: initiativeId,
      status: "dismissed",
      delivered_at: row.delivered_at,
      read_at: row.read_at,
      responded_at: row.responded_at,
      dismissed_at: now,
    });

    // Exponential backoff: increase ignored count, compute next allowed time
    const backoff = getBackoff(row.user_id);
    const newIgnoredCount = backoff.ignoredCount + 1;
    const backoffMs = _calculateBackoffMs(newIgnoredCount);
    const backoffUntil = new Date(Date.now() + backoffMs).toISOString();

    stmts().upsertBackoff.run({
      user_id: row.user_id,
      ignored_count: newIgnoredCount,
      last_initiative_at: backoff.lastInitiativeAt || now,
      backoff_until: backoffUntil,
      created_at: backoff.createdAt || now,
      updated_at: now,
    });

    return {
      id: initiativeId,
      status: "dismissed",
      dismissedAt: now,
      backoff: {
        ignoredCount: newIgnoredCount,
        backoffUntil,
      },
    };
  }

  /**
   * Get initiative history for a user with pagination and optional status filter.
   * @param {string} userId
   * @param {object} [options={}]
   * @param {number} [options.limit=20]
   * @param {number} [options.offset=0]
   * @param {string} [options.status] - Filter by status
   * @returns {object} { initiatives, total, limit, offset, hasMore }
   */
  function getHistory(userId, options = {}) {
    if (!userId) throw new ValidationError("userId is required");

    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
    const offset = Math.max(Number(options.offset) || 0, 0);
    const status = options.status || null;

    let rows;
    let totalRow;

    if (status) {
      if (!STATUS_VALUES.includes(status)) {
        throw new ValidationError(
          `Invalid status: ${status}. Valid statuses: ${STATUS_VALUES.join(", ")}`
        );
      }
      rows = stmts().getHistoryWithStatus.all(userId, status, limit, offset);
      totalRow = stmts().countHistoryWithStatus.get(userId, status);
    } else {
      rows = stmts().getHistory.all(userId, limit, offset);
      totalRow = stmts().countHistory.get(userId);
    }

    return {
      initiatives: rows.map(_formatInitiativeRow),
      total: totalRow?.total || 0,
      limit,
      offset,
      hasMore: offset + limit < (totalRow?.total || 0),
    };
  }

  /**
   * Get all pending initiatives for a user, ordered by score descending.
   * @param {string} userId
   * @returns {object} { initiatives, count }
   */
  function getPending(userId) {
    if (!userId) throw new ValidationError("userId is required");

    const rows = stmts().getPending.all(userId);
    return {
      initiatives: rows.map(_formatInitiativeRow),
      count: rows.length,
    };
  }

  // ── Double-text engine ───────────────────────────────────────────────

  /**
   * Generate a follow-up "double text" message.
   * Only allowed if user has allowDoubleText enabled, at least 30 minutes
   * have passed since the last delivered initiative, and rate limits allow it.
   *
   * @param {string} userId
   * @param {string} originalMessage - The original message to follow up on
   * @param {object} [context={}] - Additional context (followUpType, additionalInfo)
   * @returns {object} { allowed, followUp?, reason?, waitMinutes? }
   */
  function generateDoubleText(userId, originalMessage, context = {}) {
    if (!userId) throw new ValidationError("userId is required");
    if (!originalMessage || typeof originalMessage !== "string") {
      throw new ValidationError("originalMessage is required");
    }

    const settings = getSettings(userId);

    if (!settings.allowDoubleText) {
      return { allowed: false, reason: "double_text_disabled" };
    }
    if (settings.disabled) {
      return { allowed: false, reason: "initiatives_disabled" };
    }

    // Enforce 30-minute gap since last delivery
    const lastDelivered = stmts().getLastDelivered.get(userId);
    if (lastDelivered) {
      const deliveredTime = new Date(lastDelivered.delivered_at).getTime();
      const elapsed = Date.now() - deliveredTime;

      if (elapsed < DOUBLE_TEXT_GAP_MS) {
        const waitMs = DOUBLE_TEXT_GAP_MS - elapsed;
        return {
          allowed: false,
          reason: "too_soon",
          waitMinutes: Math.ceil(waitMs / (60 * 1000)),
          minGapMinutes: DOUBLE_TEXT_GAP_MS / (60 * 1000),
        };
      }
    }

    // Rate limit check
    const limits = checkRateLimits(userId);
    if (!limits.allowed) {
      return { allowed: false, reason: limits.reason };
    }

    // Generate the follow-up adapted to user style
    const styleProfile = getStyleProfile(userId);
    const followUp = _generateFollowUpText(originalMessage, context, styleProfile);

    return {
      allowed: true,
      followUp,
      originalMessage,
      gapMinutes: DOUBLE_TEXT_GAP_MS / (60 * 1000),
    };
  }

  // ── Style learning (fluidity engine) ─────────────────────────────────

  /**
   * Learn from a user's message to build/update their style profile.
   * Uses exponential moving average to smooth observations over time.
   *
   * @param {string} userId
   * @param {string} message
   * @returns {object} Updated style profile
   */
  function learnStyle(userId, message) {
    if (!userId) throw new ValidationError("userId is required");
    if (!message || typeof message !== "string") {
      throw new ValidationError("message is required and must be a string");
    }

    const existing = stmts().getStyleProfile.get(userId);
    const now = new Date().toISOString();

    const msgLength = message.length;
    const formality = _estimateFormality(message);
    const emojiCount = _countEmojis(message);
    const wordCount = message.split(/\s+/).filter(w => w.length > 0).length;
    const emojiRate = wordCount > 0 ? emojiCount / wordCount : 0;
    const newVocab = _extractVocabulary(message);

    if (existing) {
      // Exponential moving average (alpha = 0.2 smoothing)
      const alpha = 0.2;
      const avgLength = existing.avg_message_length * (1 - alpha) + msgLength * alpha;
      const avgFormality = existing.formality_level * (1 - alpha) + formality * alpha;
      const avgEmojiRate = existing.emoji_rate * (1 - alpha) + emojiRate * alpha;

      // Merge vocabulary, keep top 200 by frequency
      const vocabMap = _safeParseJSON(existing.vocabulary_json, {});
      for (const word of newVocab) {
        vocabMap[word] = (vocabMap[word] || 0) + 1;
      }
      const trimmedVocab = Object.fromEntries(
        Object.entries(vocabMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 200)
      );

      // Update shared context with recent topics
      const sharedContext = _safeParseJSON(existing.shared_context_json, {});
      if (!sharedContext.recentTopics) sharedContext.recentTopics = [];
      const topWords = newVocab.slice(0, 3);
      if (topWords.length > 0) {
        sharedContext.recentTopics = [...topWords, ...sharedContext.recentTopics].slice(0, 20);
      }
      sharedContext.lastMessageAt = now;
      sharedContext.messageCount = (sharedContext.messageCount || 0) + 1;

      stmts().upsertStyleProfile.run({
        user_id: userId,
        avg_message_length: avgLength,
        formality_level: avgFormality,
        emoji_rate: avgEmojiRate,
        vocabulary_json: JSON.stringify(trimmedVocab),
        shared_context_json: JSON.stringify(sharedContext),
        updated_at: now,
      });
    } else {
      // First message — initialize the profile
      const vocab = {};
      for (const word of newVocab) {
        vocab[word] = (vocab[word] || 0) + 1;
      }

      stmts().upsertStyleProfile.run({
        user_id: userId,
        avg_message_length: msgLength,
        formality_level: formality,
        emoji_rate: emojiRate,
        vocabulary_json: JSON.stringify(vocab),
        shared_context_json: JSON.stringify({
          recentTopics: newVocab.slice(0, 3),
          lastMessageAt: now,
          messageCount: 1,
        }),
        updated_at: now,
      });
    }

    return getStyleProfile(userId);
  }

  /**
   * Get the learned style profile for a user.
   * @param {string} userId
   * @returns {object} Style profile (exists: false if none learned yet)
   */
  function getStyleProfile(userId) {
    if (!userId) throw new ValidationError("userId is required");

    const row = stmts().getStyleProfile.get(userId);
    if (!row) {
      return {
        userId,
        avgMessageLength: 0,
        formalityLevel: 0.5,
        emojiRate: 0.0,
        vocabulary: {},
        sharedContext: {},
        updatedAt: null,
        exists: false,
      };
    }

    return {
      userId: row.user_id,
      avgMessageLength: row.avg_message_length,
      formalityLevel: row.formality_level,
      emojiRate: row.emoji_rate,
      vocabulary: _safeParseJSON(row.vocabulary_json, {}),
      sharedContext: _safeParseJSON(row.shared_context_json, {}),
      updatedAt: row.updated_at,
      exists: true,
    };
  }

  /**
   * Adapt a message to match a user's learned communication style.
   * Adjusts length, formality (contractions), and emoji presence.
   *
   * @param {string} userId
   * @param {string} message
   * @returns {object} { original, adapted, adjustments }
   */
  function adaptMessage(userId, message) {
    if (!userId) throw new ValidationError("userId is required");
    if (!message || typeof message !== "string") {
      throw new ValidationError("message is required");
    }

    const profile = getStyleProfile(userId);
    if (!profile.exists) {
      return { original: message, adapted: message, adjustments: [] };
    }

    let adapted = message;
    const adjustments = [];

    // 1. Length adaptation — shorten if user prefers short messages
    const targetLength = profile.avgMessageLength;
    if (targetLength > 0 && adapted.length > targetLength * 2 && targetLength < 200) {
      const sentences = adapted.match(/[^.!?]+[.!?]+/g) || [adapted];
      let shortened = "";
      for (const sentence of sentences) {
        if ((shortened + sentence).length <= targetLength * 1.5) {
          shortened += sentence;
        } else {
          break;
        }
      }
      if (shortened.length > 0 && shortened.length < adapted.length) {
        adapted = shortened.trim();
        adjustments.push("shortened_to_match_style");
      }
    }

    // 2. Formality adaptation
    if (profile.formalityLevel < 0.3) {
      // Casual user: introduce contractions
      adapted = adapted
        .replace(/\bdo not\b/gi, "don't")
        .replace(/\bcannot\b/gi, "can't")
        .replace(/\bwill not\b/gi, "won't")
        .replace(/\bshould not\b/gi, "shouldn't")
        .replace(/\bwould not\b/gi, "wouldn't")
        .replace(/\bcould not\b/gi, "couldn't")
        .replace(/\bis not\b/gi, "isn't")
        .replace(/\bare not\b/gi, "aren't")
        .replace(/\bI am\b/g, "I'm")
        .replace(/\bI have\b/g, "I've")
        .replace(/\bI will\b/g, "I'll");
      adjustments.push("casualized_contractions");
    } else if (profile.formalityLevel > 0.7) {
      // Formal user: expand contractions
      adapted = adapted
        .replace(/\bdon't\b/gi, "do not")
        .replace(/\bcan't\b/gi, "cannot")
        .replace(/\bwon't\b/gi, "will not")
        .replace(/\bshouldn't\b/gi, "should not")
        .replace(/\bwouldn't\b/gi, "would not")
        .replace(/\bcouldn't\b/gi, "could not")
        .replace(/\bisn't\b/gi, "is not")
        .replace(/\baren't\b/gi, "are not")
        .replace(/\bI'm\b/g, "I am")
        .replace(/\bI've\b/g, "I have")
        .replace(/\bI'll\b/g, "I will");
      adjustments.push("formalized_contractions");
    }

    // 3. Emoji adaptation
    if (profile.emojiRate > 0.05 && _countEmojis(adapted) === 0) {
      // User uses emojis but message has none — note the mismatch
      // (we don't inject emojis as that feels artificial)
      adjustments.push("emoji_mismatch_noted");
    } else if (profile.emojiRate === 0 && _countEmojis(adapted) > 0) {
      // User never uses emojis — strip them
      adapted = adapted.replace(EMOJI_REGEX, "").replace(/\s{2,}/g, " ").trim();
      adjustments.push("emojis_removed");
    }

    return { original: message, adapted, adjustments };
  }

  // ── Backoff ──────────────────────────────────────────────────────────

  /**
   * Get the current backoff state for a user.
   * @param {string} userId
   * @returns {object} Backoff state including isActive flag
   */
  function getBackoff(userId) {
    if (!userId) throw new ValidationError("userId is required");

    const row = stmts().getBackoff.get(userId);
    if (!row) {
      return {
        userId,
        ignoredCount: 0,
        lastInitiativeAt: null,
        backoffUntil: null,
        createdAt: null,
        updatedAt: null,
        isActive: false,
      };
    }

    const isActive = row.backoff_until
      ? new Date(row.backoff_until).getTime() > Date.now()
      : false;

    return {
      userId: row.user_id,
      ignoredCount: row.ignored_count,
      lastInitiativeAt: row.last_initiative_at,
      backoffUntil: row.backoff_until,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isActive,
    };
  }

  // ── Stats ────────────────────────────────────────────────────────────

  /**
   * Get overall initiative engine statistics.
   * @returns {object} Aggregate stats across all users
   */
  function getStats() {
    const totalRow = stmts().totalInitiatives.get();
    const byStatusRows = stmts().initiativesByStatus.all();
    const byTriggerRows = stmts().initiativesByTrigger.all();
    const avgScoreRow = stmts().avgScore.get();
    const responseRow = stmts().responseCount.get();
    const uniqueUsersRow = stmts().uniqueUsers.get();

    const total = totalRow?.count || 0;
    const responded = responseRow?.count || 0;

    const byStatus = {};
    for (const row of byStatusRows) {
      byStatus[row.status] = row.count;
    }

    const byTrigger = {};
    for (const row of byTriggerRows) {
      byTrigger[row.trigger_type] = row.count;
    }

    return {
      total,
      byStatus,
      byTrigger,
      avgScore: avgScoreRow?.avg_score || 0,
      responseRate: total > 0 ? responded / total : 0,
      responded,
      uniqueUsers: uniqueUsersRow?.count || 0,
      triggerTypes: TRIGGER_TYPES,
      priorityLevels: PRIORITY_LEVELS,
      channels: CHANNELS,
    };
  }

  // ── Internal instance helpers ────────────────────────────────────────

  /**
   * Format a raw DB row into a clean initiative object.
   * @param {object} row
   * @returns {object}
   */
  function _formatInitiativeRow(row) {
    return {
      id: row.id,
      userId: row.user_id,
      triggerType: row.trigger_type,
      message: row.message,
      priority: row.priority,
      score: row.score,
      status: row.status,
      channel: row.channel,
      metadata: _safeParseJSON(row.metadata_json, {}),
      deliveredAt: row.delivered_at,
      readAt: row.read_at,
      respondedAt: row.responded_at,
      dismissedAt: row.dismissed_at,
      createdAt: row.created_at,
    };
  }

  /**
   * Generate a follow-up text based on the original message and user style.
   * @param {string} original
   * @param {object} context
   * @param {object} styleProfile
   * @returns {string}
   */
  function _generateFollowUpText(original, context, styleProfile) {
    const casual = styleProfile.exists && styleProfile.formalityLevel < 0.4;
    const formal = styleProfile.exists && styleProfile.formalityLevel > 0.7;

    const templates = {
      reminder: casual
        ? [
          "hey, just circling back on this",
          "following up on what I shared earlier",
          "any thoughts on this?",
        ]
        : formal
          ? [
            "I wanted to follow up on the previous message.",
            "Circling back on the item shared earlier for your review.",
            "I would appreciate your thoughts on the above when convenient.",
          ]
          : [
            "Just following up on this.",
            "Wanted to check if you had a chance to look at this.",
            "Any thoughts on the above?",
          ],
      update: casual
        ? [
          "quick update on that thing I mentioned",
          "got some new info on this",
          "update on what we talked about",
        ]
        : formal
          ? [
            "I have an update regarding the previous topic.",
            "Additional information has become available on this matter.",
            "An update on the previously discussed item.",
          ]
          : [
            "Quick update on the earlier topic.",
            "I have some new information related to this.",
            "Here is an update on what was shared before.",
          ],
    };

    const category = context.followUpType || "reminder";
    const pool = templates[category] || templates.reminder;
    const idx = Math.floor(Math.random() * pool.length);
    let followUp = pool[idx];

    // Append additional info if provided
    if (context.additionalInfo && typeof context.additionalInfo === "string") {
      followUp += " " + context.additionalInfo;
    }

    // Apply style adaptation
    if (styleProfile.exists) {
      const adapted = adaptMessage(styleProfile.userId, followUp);
      followUp = adapted.adapted;
    }

    return followUp;
  }

  // ── Return public API ────────────────────────────────────────────────

  return {
    getSettings,
    updateSettings,
    evaluateTrigger,
    createInitiative,
    deliverInitiative,
    markRead,
    markResponded,
    dismissInitiative,
    getHistory,
    getPending,
    generateDoubleText,
    learnStyle,
    getStyleProfile,
    adaptMessage,
    checkRateLimits,
    getBackoff,
    getStats,

    // Expose constants for consumers
    TRIGGER_TYPES,
    PRIORITY_LEVELS,
    STATUS_VALUES,
    CHANNELS,
  };
}
