// @sync-fs-ok: quota check + budget mutation must be atomic — sync write prevents race
/**
 * Artifact Budget — Daily Storage Budget for Emergent Entity Artifacts
 *
 * Emergent entities (AI agents) create artifacts autonomously — music, art,
 * video, text. This module prevents them from filling the disk by enforcing
 * a daily byte budget that scales down as storage fills up.
 *
 * Key insight: text DTU creation is unlimited (negligible storage). Only binary
 * artifact generation gets budgeted. The organism keeps thinking 24/7 — it just
 * gets more economical about what it materializes when storage is tight.
 */

import fs from "fs";
import path from "path";
import logger from "../logger.js";

// ── Constants ────────────────────────────────────────────────────────

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const KB = 1024;

const DEFAULT_VOLUME_SIZE = 100 * GB;
const RESERVED_BYTES = 40 * GB; // db, state, backups, user uploads

const ARTIFACT_ROOT = process.env.ARTIFACT_DIR
  || (fs.existsSync("/workspace/concord-data")
    ? "/workspace/concord-data/artifacts"
    : path.join("data", "artifacts"));

const LOG_SOURCE = "artifact-budget";

// ── Size Estimates (domain → action → bytes) ────────────────────────

const SIZE_TABLE = {
  music:        { audio: 5 * MB, midi: 50 * KB, _default: 5 * MB },
  audio:        { audio: 5 * MB, midi: 50 * KB, _default: 5 * MB },
  art:          { full: 500 * KB, thumbnail: 50 * KB, _default: 500 * KB },
  photography:  { full: 500 * KB, thumbnail: 50 * KB, _default: 500 * KB },
  image:        { full: 500 * KB, thumbnail: 50 * KB, _default: 500 * KB },
  studio:       { video: 500 * MB, thumbnail: 1 * MB, _default: 500 * MB },
  video:        { video: 500 * MB, thumbnail: 1 * MB, _default: 500 * MB },
};

const TEXT_DOMAIN_PREFIX = "text";
const TEXT_SIZE = 10 * KB;
const DEFAULT_SIZE = 100 * KB;

// ── Budget Tiers ─────────────────────────────────────────────────────

const BUDGET_TIERS = [
  { maxFillRatio: 0.30, dailyBytes: 500 * MB },
  { maxFillRatio: 0.60, dailyBytes: 200 * MB },
  { maxFillRatio: 0.80, dailyBytes:  50 * MB },
  { maxFillRatio: 1.00, dailyBytes:  10 * MB },
];

// ── Helpers ──────────────────────────────────────────────────────────

function structuredLog(level, message, meta = {}) {
  if (typeof logger?.log === "function") {
    logger.log(level, LOG_SOURCE, message, meta);
  } else if (typeof logger?.[level] === "function") {
    logger[level](`[${LOG_SOURCE}] ${message}`, meta);
  } else {
    console.log(`[${LOG_SOURCE}] [${level.toUpperCase()}] ${message}`, meta);
  }
}

/**
 * Walk a directory tree and sum all file sizes.
 * Returns 0 if the directory does not exist.
 */
function dirSizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += dirSizeBytes(full);
      } else if (entry.isFile()) {
        total += fs.statSync(full).size;
      }
    } catch {
      // permission error or vanished file — skip
    }
  }
  return total;
}

// ── Exports ──────────────────────────────────────────────────────────

/**
 * Calculate today's artifact budget based on volume fill ratio.
 *
 * @returns {{ budgetBytes: number, fillRatio: number, usedBytes: number, totalBytes: number }}
 */
export function getDailyArtifactBudget() {
  const totalBytes = parseInt(process.env.ARTIFACT_VOLUME_SIZE, 10) || DEFAULT_VOLUME_SIZE;
  const usableBytes = totalBytes - RESERVED_BYTES;
  const usedBytes = dirSizeBytes(ARTIFACT_ROOT);
  const fillRatio = usableBytes > 0 ? usedBytes / usableBytes : 1;

  const tier = BUDGET_TIERS.find(t => fillRatio < t.maxFillRatio) || BUDGET_TIERS[BUDGET_TIERS.length - 1];

  structuredLog("info", `Daily budget calculated: ${(tier.dailyBytes / MB).toFixed(0)}MB (fill ${(fillRatio * 100).toFixed(1)}%)`, {
    fillRatio,
    usedBytes,
    totalBytes,
    budgetBytes: tier.dailyBytes,
  });

  return {
    budgetBytes: tier.dailyBytes,
    fillRatio,
    usedBytes,
    totalBytes,
  };
}

/**
 * Estimate the byte cost of a given domain + action combination.
 *
 * @param {string} domain - e.g. "music", "art", "studio", "text/markdown"
 * @param {string} action - e.g. "audio", "midi", "full", "thumbnail", "video"
 * @returns {number} estimated bytes
 */
export function estimateArtifactSize(domain, action) {
  // Text domains are negligible — always allowed
  if (domain && domain.startsWith(TEXT_DOMAIN_PREFIX)) return TEXT_SIZE;

  const domainTable = SIZE_TABLE[domain];
  if (domainTable) {
    return domainTable[action] ?? domainTable._default;
  }
  return DEFAULT_SIZE;
}

/**
 * Check whether the current daily budget allows another artifact.
 *
 * @param {object} STATE - shared state object with dailyArtifactBytes
 * @returns {{ allowed: boolean, remainingBytes: number, budgetBytes: number, usedTodayBytes: number, fillRatio: number }}
 */
export function checkBudget(STATE) {
  const { budgetBytes, fillRatio } = getDailyArtifactBudget();
  const usedTodayBytes = STATE.dailyArtifactBytes || 0;
  const remainingBytes = Math.max(0, budgetBytes - usedTodayBytes);

  return {
    allowed: remainingBytes > 0,
    remainingBytes,
    budgetBytes,
    usedTodayBytes,
    fillRatio,
  };
}

/**
 * Return modified params for graceful degradation when budget is tight.
 * Returns null if no downgrade is needed (remaining budget exceeds estimate).
 *
 * @param {string} domain
 * @param {string} action
 * @param {number} remainingBytes
 * @returns {object|null} downgraded params, or null if within budget
 */
export function downgradePlan(domain, action, remainingBytes) {
  const estimated = estimateArtifactSize(domain, action);

  // No downgrade needed — plenty of room
  if (remainingBytes > estimated) return null;

  structuredLog("warn", `Budget tight — downgrading ${domain}/${action}`, {
    estimated,
    remainingBytes,
  });

  if (domain === "music" || domain === "audio" || domain === "studio" || domain === "video") {
    return { format: "midi" };
  }
  if (domain === "art" || domain === "photography" || domain === "image") {
    return { maxResolution: 512 };
  }
  return { textOnly: true };
}

/**
 * Reset the daily artifact usage counter.
 *
 * @param {object} STATE - shared state object
 */
export function resetDailyUsage(STATE) {
  STATE.dailyArtifactBytes = 0;
  STATE.dailyArtifactResetAt = new Date().toISOString();
  structuredLog("info", "Daily artifact budget reset", {
    resetAt: STATE.dailyArtifactResetAt,
  });
}

/**
 * Set up a recurring timer that resets the daily budget at midnight UTC.
 * Returns the interval ID so the caller can clear it on shutdown.
 *
 * @param {object} STATE - shared state object
 * @returns {NodeJS.Timeout} interval ID
 */
export function initBudgetTimer(STATE) {
  // Reset immediately on boot so STATE is initialized
  resetDailyUsage(STATE);

  // Calculate ms until next midnight UTC
  const now = new Date();
  const nextMidnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  const msUntilMidnight = nextMidnight.getTime() - now.getTime();

  structuredLog("info", `Budget timer armed — next reset in ${(msUntilMidnight / 1000 / 60).toFixed(0)} minutes`);

  // First timeout aligns to midnight, then repeats every 24h
  const DAY_MS = 24 * 60 * 60 * 1000;

  const timeoutId = setTimeout(() => {
    resetDailyUsage(STATE);

    // Now start the 24h repeating interval
    const intervalId = setInterval(() => {
      resetDailyUsage(STATE);
    }, DAY_MS);

    // Stash the interval ID on STATE so the caller can clean up both
    STATE._budgetIntervalId = intervalId;
  }, msUntilMidnight);

  // Return the initial timeout ID; caller should also check STATE._budgetIntervalId
  return timeoutId;
}
