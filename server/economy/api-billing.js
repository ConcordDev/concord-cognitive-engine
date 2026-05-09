/**
 * API Billing Engine — v1.0
 *
 * Metering layer for Concord API.
 * Developers buy Concord Coin and spend it on API calls.
 * Sits between Gate 1 (Auth) and Gate 2 (Macro).
 * Deducts coins atomically through the existing economy module.
 *
 * Key management, endpoint categorization, free allowance,
 * tier determination, usage logging, fee distribution, and alerts.
 */

import { randomUUID, createHash } from "crypto";
import {
  API_CONSTANTS,
  API_PRICING,
  API_KEY_SYSTEM,
} from "../lib/api-billing-constants.js";
import { getApiUsageCache } from "../lib/quota-cache.js";

function uid(prefix = "apk") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function hashKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────
// API Key Management
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate a new API key for a user.
 */
export function createAPIKey(db, { userId, name, isTest = false }) {
  if (!userId) return { ok: false, error: "missing_user_id" };

  // Check key count
  const count = db.prepare(
    "SELECT COUNT(*) as c FROM api_keys WHERE user_id = ? AND status = 'active'"
  ).get(userId).c;

  if (count >= API_CONSTANTS.MAX_KEYS_PER_ACCOUNT) {
    return { ok: false, error: "max_keys_reached", limit: API_CONSTANTS.MAX_KEYS_PER_ACCOUNT };
  }

  const prefix = isTest ? "ck_test_" : "ck_live_";
  const rawKey = prefix + randomUUID().replace(/-/g, "");
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, API_CONSTANTS.KEY_PREFIX_LENGTH);

  const id = uid("apk");
  const now = nowISO();

  db.prepare(`
    INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)
  `).run(id, userId, keyHash, keyPrefix, name || null, now);

  return {
    ok: true,
    key: {
      id,
      rawKey,
      keyPrefix,
      name,
      createdAt: now,
    },
  };
}

/**
 * Revoke an API key.
 */
export function revokeAPIKey(db, { keyId, userId }) {
  if (!keyId || !userId) return { ok: false, error: "missing_required_fields" };

  const result = db.prepare(
    "UPDATE api_keys SET status = 'revoked' WHERE id = ? AND user_id = ? AND status = 'active'"
  ).run(keyId, userId);

  if (result.changes === 0) return { ok: false, error: "key_not_found_or_already_revoked" };
  return { ok: true, keyId, status: "revoked" };
}

/**
 * List API keys for a user (shows prefix only, never the full key).
 */
export function listAPIKeys(db, userId) {
  const rows = db.prepare(
    "SELECT id, key_prefix, name, status, tier, created_at, last_used_at, total_calls FROM api_keys WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId);

  return {
    ok: true,
    keys: rows.map(r => ({
      id: r.id,
      keyPrefix: r.key_prefix,
      name: r.name,
      status: r.status,
      tier: r.tier,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      totalCalls: r.total_calls,
    })),
  };
}

/**
 * Validate an API key and return account info.
 */
export function validateAPIKey(db, rawKey) {
  if (!rawKey) return { ok: false, error: "missing_api_key" };

  const keyHash = hashKey(rawKey);
  const row = db.prepare(
    "SELECT id, user_id, tier, status, key_hash FROM api_keys WHERE key_hash = ? AND status = 'active'"
  ).get(keyHash);

  if (!row) return { ok: false, error: "invalid_api_key" };

  return {
    ok: true,
    keyId: row.id,
    userId: row.user_id,
    tier: row.tier,
    keyHash,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tier Determination
// ─────────────────────────────────────────────────────────────────────

/**
 * Determine API tier based on account balance.
 * Uses the existing economy balance system.
 */
export function determineTier(balance) {
  if (balance >= API_CONSTANTS.TIER_ENTERPRISE) return "enterprise";
  if (balance >= API_CONSTANTS.TIER_STANDARD) return "standard";
  return "free_tier";
}

/**
 * Get rate limits for a tier.
 */
export function getRateLimits(tier) {
  const limits = API_KEY_SYSTEM.rateLimits[tier] || API_KEY_SYSTEM.rateLimits.free_tier;
  return {
    requestsPerMinute: limits.requestsPerMinute,
    requestsPerDay: limits.requestsPerDay,
    concurrentRequests: limits.concurrentRequests,
  };
}

/**
 * Update a key's tier based on current balance.
 */
export function updateKeyTier(db, keyId, balance) {
  const newTier = determineTier(balance);
  db.prepare("UPDATE api_keys SET tier = ? WHERE id = ?").run(newTier, keyId);
  return newTier;
}

// ─────────────────────────────────────────────────────────────────────
// Endpoint Categorization
// ─────────────────────────────────────────────────────────────────────

/**
 * Categorize an API endpoint into a pricing category.
 */
export function categorizeEndpoint(endpoint, method) {
  // CASCADE — marketplace transactions
  if (endpoint.includes("/marketplace/purchase") ||
      endpoint.includes("/cascade/trigger")) {
    return "cascade";
  }

  // COMPUTE — brain operations
  if (endpoint.includes("/brain/") ||
      endpoint.includes("/consolidate") ||
      endpoint.includes("/meta-derive") ||
      endpoint.includes("/entity/create") ||
      endpoint.includes("/entity/decide")) {
    return "compute";
  }

  // STORAGE — vault operations
  if (endpoint.includes("/vault/") ||
      endpoint.includes("/artifact/upload")) {
    return "storage";
  }

  // WRITE — create/update operations
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    return "write";
  }

  // READ — everything else
  return "read";
}

/**
 * Get cost for a category, including per-MB storage costs.
 */
export function getCategoryCost(category, metadata = {}) {
  const pricing = API_PRICING.categories[category];
  if (!pricing) return 0;

  let cost = pricing.costPerCall;

  // Add per-MB cost for storage
  if (category === "storage" && metadata.fileSizeMB) {
    cost += metadata.fileSizeMB * (pricing.costPerMB || 0);
  }

  return cost;
}

// ─────────────────────────────────────────────────────────────────────
// Monthly Usage & Free Allowance
// ─────────────────────────────────────────────────────────────────────

/**
 * Get or create monthly usage record for a user.
 */
export function getMonthlyUsage(db, userId, month) {
  const m = month || currentMonth();
  let row = db.prepare(
    "SELECT * FROM api_monthly_usage WHERE user_id = ? AND month = ?"
  ).get(userId, m);

  if (!row) {
    db.prepare(
      "INSERT INTO api_monthly_usage (user_id, month) VALUES (?, ?)"
    ).run(userId, m);
    row = { user_id: userId, month: m, reads: 0, writes: 0, computes: 0, storage_calls: 0, cascades: 0, total_cost: 0 };
  }

  return {
    userId: row.user_id,
    month: row.month,
    reads: row.reads,
    writes: row.writes,
    computes: row.computes,
    storageCalls: row.storage_calls,
    cascades: row.cascades,
    totalCost: row.total_cost,
  };
}

/**
 * Check how many free calls remain for a category.
 */
export function getFreeRemaining(db, userId, category) {
  const usage = getMonthlyUsage(db, userId);

  const allowanceMap = {
    read: { used: usage.reads, free: API_CONSTANTS.FREE_READS_PER_MONTH },
    write: { used: usage.writes, free: API_CONSTANTS.FREE_WRITES_PER_MONTH },
    compute: { used: usage.computes, free: API_CONSTANTS.FREE_COMPUTES_PER_MONTH },
    storage: { used: usage.storageCalls, free: 0 },
    cascade: { used: usage.cascades, free: 0 },
  };

  const info = allowanceMap[category] || { used: 0, free: 0 };
  return Math.max(0, info.free - info.used);
}

/**
 * Increment monthly usage counter for a category.
 */
function incrementMonthlyUsage(db, userId, category, cost) {
  const m = currentMonth();

  // Ensure row exists
  db.prepare(
    "INSERT OR IGNORE INTO api_monthly_usage (user_id, month) VALUES (?, ?)"
  ).run(userId, m);

  const columnMap = {
    read: "reads",
    write: "writes",
    compute: "computes",
    storage: "storage_calls",
    cascade: "cascades",
  };

  const col = columnMap[category] || "reads";
  db.prepare(
    `UPDATE api_monthly_usage SET ${col} = ${col} + 1, total_cost = total_cost + ? WHERE user_id = ? AND month = ?`
  ).run(cost, userId, m);
}

// ─────────────────────────────────────────────────────────────────────
// Metering Engine (core)
// ─────────────────────────────────────────────────────────────────────

/**
 * Meter an API call. This is the core billing function.
 * Called between Gate 1 (Auth) and Gate 2 (Macro).
 *
 * @param {object} db - database instance
 * @param {object} params - { keyHash, userId, endpoint, method, metadata, balance }
 * @returns {{ allowed: boolean, cost: number, ... }}
 */
export function meterAPICall(db, { keyHash, userId, endpoint, method, metadata = {}, balance }) {
  if (!keyHash || !userId) return { allowed: false, reason: "missing_credentials" };

  const category = categorizeEndpoint(endpoint, method);
  const cost = getCategoryCost(category, metadata);

  // Check free allowance first
  const freeRemaining = getFreeRemaining(db, userId, category);

  if (freeRemaining > 0) {
    // Free call — still record usage
    const usageId = recordUsage(db, {
      userId, keyHash, endpoint, method, category, cost: 0,
      balanceAfter: balance, metadata,
    });
    incrementMonthlyUsage(db, userId, category, 0);

    // Update key stats
    db.prepare(
      "UPDATE api_keys SET last_used_at = datetime('now'), total_calls = total_calls + 1 WHERE key_hash = ?"
    ).run(keyHash);

    return {
      allowed: true,
      cost: 0,
      category,
      freeRemaining: freeRemaining - 1,
      balanceRemaining: balance,
      usageId,
    };
  }

  // Cascade calls are free (marketplace fee applies separately)
  if (category === "cascade") {
    const usageId = recordUsage(db, {
      userId, keyHash, endpoint, method, category, cost: 0,
      balanceAfter: balance, metadata,
    });
    incrementMonthlyUsage(db, userId, category, 0);

    db.prepare(
      "UPDATE api_keys SET last_used_at = datetime('now'), total_calls = total_calls + 1 WHERE key_hash = ?"
    ).run(keyHash);

    return {
      allowed: true,
      cost: 0,
      category,
      freeRemaining: 0,
      balanceRemaining: balance,
      usageId,
      marketplaceFeeApplies: true,
    };
  }

  // Check balance
  if (balance < cost) {
    return {
      allowed: false,
      reason: "insufficient_balance",
      cost,
      balance,
      topUpRequired: cost - balance,
      category,
    };
  }

  // Record the metered usage
  const balanceAfter = Math.round((balance - cost) * 10000) / 10000;
  const usageId = recordUsage(db, {
    userId, keyHash, endpoint, method, category, cost,
    balanceAfter, metadata,
  });
  incrementMonthlyUsage(db, userId, category, cost);

  // Distribute fees
  distributeFees(db, usageId, cost);

  // Update key stats
  db.prepare(
    "UPDATE api_keys SET last_used_at = datetime('now'), total_calls = total_calls + 1 WHERE key_hash = ?"
  ).run(keyHash);

  return {
    allowed: true,
    cost,
    category,
    freeRemaining: 0,
    balanceRemaining: balanceAfter,
    usageId,
  };
}

/**
 * Record a usage entry in the usage log.
 *
 * Phase 7.3: routes through the in-memory quota cache (server/lib/quota-cache.js)
 * which batches inserts on a 5s flush interval. At rest, the heavy-write hot
 * path becomes ≤ 1 DB write per 5 seconds per process, regardless of macro
 * call rate. Cache flushes on SIGTERM/SIGINT/beforeExit so an in-flight
 * buffer never drops calls under graceful shutdown.
 */
function recordUsage(db, { userId, keyHash, endpoint, method, category, cost, balanceAfter, metadata }) {
  const id = uid("usg");
  const now = nowISO();

  getApiUsageCache().enqueue(db, [
    id, userId, keyHash, endpoint, method, category, cost,
    balanceAfter, JSON.stringify(metadata || {}), now,
  ]);

  return id;
}

/**
 * Distribute API fees according to treasury split.
 */
function distributeFees(db, usageId, cost) {
  if (cost <= 0) return;

  const C = API_CONSTANTS;
  const id = uid("afd");
  const treasuryAmount = Math.round(cost * C.TREASURY_SHARE * 10000) / 10000;
  const infraAmount = Math.round(cost * C.INFRA_SHARE * 10000) / 10000;
  const payrollAmount = Math.round(cost * C.PAYROLL_SHARE * 10000) / 10000;
  const opsAmount = Math.round(cost * C.OPS_SHARE * 10000) / 10000;
  const now = nowISO();

  db.prepare(`
    INSERT INTO api_fee_distribution (id, source_usage_id, treasury_amount, infra_amount, payroll_amount, ops_amount, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, usageId, treasuryAmount, infraAmount, payrollAmount, opsAmount, now);
}

// ─────────────────────────────────────────────────────────────────────
// Usage Queries
// ─────────────────────────────────────────────────────────────────────

/**
 * Get usage summary for a user (dashboard overview).
 */
export function getUsageSummary(db, userId) {
  const monthly = getMonthlyUsage(db, userId);
  const C = API_CONSTANTS;

  return {
    ok: true,
    month: monthly.month,
    usage: {
      reads: { count: monthly.reads, cost: monthly.reads > C.FREE_READS_PER_MONTH ? (monthly.reads - C.FREE_READS_PER_MONTH) * C.READ_COST : 0 },
      writes: { count: monthly.writes, cost: monthly.writes > C.FREE_WRITES_PER_MONTH ? (monthly.writes - C.FREE_WRITES_PER_MONTH) * C.WRITE_COST : 0 },
      compute: { count: monthly.computes, cost: monthly.computes > C.FREE_COMPUTES_PER_MONTH ? (monthly.computes - C.FREE_COMPUTES_PER_MONTH) * C.COMPUTE_COST : 0 },
      storage: { count: monthly.storageCalls, cost: 0 },
      cascade: { count: monthly.cascades, cost: 0 },
    },
    totalCost: monthly.totalCost,
    freeRemaining: {
      reads: Math.max(0, C.FREE_READS_PER_MONTH - monthly.reads),
      writes: Math.max(0, C.FREE_WRITES_PER_MONTH - monthly.writes),
      compute: Math.max(0, C.FREE_COMPUTES_PER_MONTH - monthly.computes),
    },
  };
}

/**
 * Get usage log for a user (paginated).
 */
export function getUsageLog(db, userId, { limit = 50, offset = 0, category } = {}) {
  let sql = "SELECT * FROM api_usage_log WHERE user_id = ?";
  const params = [userId];

  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);
  return {
    ok: true,
    entries: rows.map(r => ({
      id: r.id,
      endpoint: r.endpoint,
      method: r.method,
      category: r.category,
      cost: r.cost,
      balanceAfter: r.balance_after,
      createdAt: r.created_at,
    })),
  };
}

/**
 * Get daily usage breakdown for a user.
 */
export function getDailyUsage(db, userId, { days = 30 } = {}) {
  const rows = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as calls, SUM(cost) as cost
    FROM api_usage_log
    WHERE user_id = ? AND created_at >= DATE('now', ?)
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `).all(userId, `-${days} days`);

  return {
    ok: true,
    daily: rows.map(r => ({ date: r.date, calls: r.calls, cost: r.cost })),
  };
}

/**
 * Get per-endpoint usage breakdown.
 */
export function getEndpointUsage(db, userId, { limit = 20 } = {}) {
  const rows = db.prepare(`
    SELECT endpoint, COUNT(*) as calls, SUM(cost) as cost
    FROM api_usage_log
    WHERE user_id = ?
    GROUP BY endpoint
    ORDER BY calls DESC
    LIMIT ?
  `).all(userId, limit);

  return {
    ok: true,
    endpoints: rows.map(r => ({ endpoint: r.endpoint, calls: r.calls, cost: r.cost })),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Balance Alerts
// ─────────────────────────────────────────────────────────────────────

/**
 * Create a balance alert for a user.
 */
export function createAlert(db, { userId, alertType, threshold, webhookUrl, emailEnabled = true }) {
  if (!userId || !alertType) return { ok: false, error: "missing_required_fields" };

  const validTypes = ["low_balance", "high_spend", "tier_change", "free_exhausted"];
  if (!validTypes.includes(alertType)) return { ok: false, error: "invalid_alert_type" };

  const id = uid("alt");
  const now = nowISO();

  db.prepare(`
    INSERT INTO api_balance_alerts (id, user_id, alert_type, threshold, webhook_url, email_enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, alertType, threshold || null, webhookUrl || null, emailEnabled ? 1 : 0, now);

  return { ok: true, alert: { id, userId, alertType, threshold, webhookUrl, emailEnabled, createdAt: now } };
}

/**
 * Get alerts for a user.
 */
export function getAlerts(db, userId) {
  const rows = db.prepare(
    "SELECT * FROM api_balance_alerts WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC"
  ).all(userId);

  return {
    ok: true,
    alerts: rows.map(r => ({
      id: r.id,
      alertType: r.alert_type,
      threshold: r.threshold,
      webhookUrl: r.webhook_url,
      emailEnabled: !!r.email_enabled,
      createdAt: r.created_at,
    })),
  };
}

/**
 * Delete an alert.
 */
export function deleteAlert(db, { alertId, userId }) {
  const result = db.prepare(
    "DELETE FROM api_balance_alerts WHERE id = ? AND user_id = ?"
  ).run(alertId, userId);

  if (result.changes === 0) return { ok: false, error: "alert_not_found" };
  return { ok: true };
}

/**
 * Check alerts that should fire for a given balance/spend.
 */
export function checkAlerts(db, userId, { balance, dailySpend }) {
  const alerts = db.prepare(
    "SELECT * FROM api_balance_alerts WHERE user_id = ? AND status = 'active'"
  ).all(userId);

  const triggered = [];

  for (const alert of alerts) {
    if (alert.alert_type === "low_balance" && balance !== undefined && balance <= alert.threshold) {
      triggered.push({ id: alert.id, type: "low_balance", threshold: alert.threshold, current: balance });
    }
    if (alert.alert_type === "high_spend" && dailySpend !== undefined && dailySpend >= alert.threshold) {
      triggered.push({ id: alert.id, type: "high_spend", threshold: alert.threshold, current: dailySpend });
    }
  }

  return { ok: true, triggered };
}

/**
 * Get fee distribution summary for a user's API usage.
 */
export function getFeeDistributions(db, userId, { limit = 50 } = {}) {
  const rows = db.prepare(`
    SELECT afd.* FROM api_fee_distribution afd
    JOIN api_usage_log aul ON afd.source_usage_id = aul.id
    WHERE aul.user_id = ?
    ORDER BY afd.created_at DESC
    LIMIT ?
  `).all(userId, limit);

  return {
    ok: true,
    distributions: rows.map(r => ({
      id: r.id,
      sourceUsageId: r.source_usage_id,
      treasuryAmount: r.treasury_amount,
      infraAmount: r.infra_amount,
      payrollAmount: r.payroll_amount,
      opsAmount: r.ops_amount,
      createdAt: r.created_at,
    })),
  };
}

// Re-export constants
export {
  API_BILLING_MODEL, API_KEY_SYSTEM, API_PRICING,
  API_DASHBOARD, API_BILLING_HEADERS, API_BALANCE_ALERTS,
  API_CONSTANTS,
} from "../lib/api-billing-constants.js";
