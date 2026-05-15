/**
 * API Billing Test Suite — v1.0
 *
 * Tests:
 *   - Constants (pricing, tiers, fee splits, rate limits)
 *   - API key creation, validation, revocation, limits
 *   - Tier determination by balance
 *   - Endpoint categorization (read/write/compute/storage/cascade)
 *   - Cost calculation (per-call and per-MB storage)
 *   - Free allowance tracking and exhaustion
 *   - Metering engine (deduct, reject insufficient, free calls)
 *   - Fee distribution (treasury/infra/payroll/ops split)
 *   - Usage summary and logging
 *   - Balance alerts (create, check, trigger)
 *   - Economic invariants (API spending = marketplace activity)
 *
 * Run: node --test server/tests/api-billing.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  API_BILLING_MODEL, API_KEY_SYSTEM, API_PRICING,
  API_DASHBOARD, API_BILLING_HEADERS, API_BALANCE_ALERTS,
  API_CONSTANTS,
} from "../lib/api-billing-constants.js";

import {
  createAPIKey, revokeAPIKey, listAPIKeys, validateAPIKey,
  determineTier, getRateLimits, updateKeyTier,
  categorizeEndpoint, getCategoryCost,
  getMonthlyUsage, getFreeRemaining,
  meterAPICall,
  getUsageSummary, getUsageLog, getDailyUsage, getEndpointUsage,
  createAlert, getAlerts, deleteAlert, checkAlerts,
  getFeeDistributions,
} from "../economy/api-billing.js";

import { createHash } from "crypto";

// ── In-Memory SQLite Helper ─────────────────────────────────────────

let Database;
try {
  Database = (await import("better-sqlite3")).default;
} catch {
  // skip DB tests if sqlite not available
}

function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    -- API keys
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      name TEXT,
      status TEXT DEFAULT 'active'
        CHECK (status IN ('active', 'revoked', 'expired')),
      tier TEXT DEFAULT 'free_tier'
        CHECK (tier IN ('free_tier', 'standard', 'enterprise')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      total_calls INTEGER DEFAULT 0
    );

    CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
    CREATE INDEX idx_api_keys_user ON api_keys(user_id);

    -- API usage log
    CREATE TABLE api_usage_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      category TEXT NOT NULL
        CHECK (category IN ('read', 'write', 'compute', 'storage', 'cascade')),
      cost REAL NOT NULL DEFAULT 0,
      balance_after REAL,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_api_usage_user ON api_usage_log(user_id, created_at);
    CREATE INDEX idx_api_usage_category ON api_usage_log(category, created_at);
    CREATE INDEX idx_api_usage_endpoint ON api_usage_log(endpoint, created_at);

    -- Monthly usage aggregates
    CREATE TABLE api_monthly_usage (
      user_id TEXT NOT NULL,
      month TEXT NOT NULL,
      reads INTEGER DEFAULT 0,
      writes INTEGER DEFAULT 0,
      computes INTEGER DEFAULT 0,
      storage_calls INTEGER DEFAULT 0,
      cascades INTEGER DEFAULT 0,
      total_cost REAL DEFAULT 0,
      PRIMARY KEY (user_id, month)
    );

    -- Balance alerts
    CREATE TABLE api_balance_alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      alert_type TEXT NOT NULL
        CHECK (alert_type IN ('low_balance', 'high_spend', 'tier_change', 'free_exhausted')),
      threshold REAL,
      webhook_url TEXT,
      email_enabled INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_api_alerts_user ON api_balance_alerts(user_id);

    -- Fee distribution tracking
    CREATE TABLE api_fee_distribution (
      id TEXT PRIMARY KEY,
      source_usage_id TEXT NOT NULL,
      treasury_amount REAL NOT NULL,
      infra_amount REAL NOT NULL,
      payroll_amount REAL NOT NULL,
      ops_amount REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_api_fee_dist_source ON api_fee_distribution(source_usage_id);
  `);

  return db;
}

// ═════════════════════════════════════════════════════════════════════
// 1. API Billing Constants
// ═════════════════════════════════════════════════════════════════════

describe("API Billing Constants", () => {
  it("billing model uses concord_coin", () => {
    assert.equal(API_BILLING_MODEL.currency, "concord_coin");
  });

  it("has 5 pricing categories", () => {
    const cats = Object.keys(API_PRICING.categories);
    assert.deepEqual(cats.sort(), ["cascade", "compute", "read", "storage", "write"]);
  });

  it("read is cheapest, compute is most expensive", () => {
    assert.ok(API_CONSTANTS.READ_COST < API_CONSTANTS.WRITE_COST);
    assert.ok(API_CONSTANTS.WRITE_COST < API_CONSTANTS.COMPUTE_COST);
    assert.equal(API_CONSTANTS.CASCADE_COST, 0);
  });

  // Tiered pricing anchored to GPT-4.1-mini token rates: read $0.0002,
  // write $0.001, compute $0.005 per call.
  it("pricing: 10,000 reads = 2 coins", () => {
    assert.equal(10000 * API_CONSTANTS.READ_COST, 2);
  });

  it("pricing: 1,000 writes = 1 coin", () => {
    assert.equal(1000 * API_CONSTANTS.WRITE_COST, 1);
  });

  it("pricing: 100 computes = 0.5 coin", () => {
    assert.equal(100 * API_CONSTANTS.COMPUTE_COST, 0.5);
  });

  it("has 3 tier thresholds", () => {
    assert.equal(API_CONSTANTS.TIER_FREE, 0);
    assert.equal(API_CONSTANTS.TIER_STANDARD, 100);
    assert.equal(API_CONSTANTS.TIER_ENTERPRISE, 10000);
  });

  it("fee split totals 100%", () => {
    const total = API_CONSTANTS.TREASURY_SHARE + API_CONSTANTS.INFRA_SHARE
      + API_CONSTANTS.PAYROLL_SHARE + API_CONSTANTS.OPS_SHARE;
    assert.equal(total, 1.0);
  });

  it("max 5 keys per account", () => {
    assert.equal(API_CONSTANTS.MAX_KEYS_PER_ACCOUNT, 5);
  });

  it("has free allowance for reads, writes, and compute", () => {
    assert.equal(API_CONSTANTS.FREE_READS_PER_MONTH, 10000);
    assert.equal(API_CONSTANTS.FREE_WRITES_PER_MONTH, 100);
    assert.equal(API_CONSTANTS.FREE_COMPUTES_PER_MONTH, 10);
  });

  it("rate limits increase with tier", () => {
    assert.ok(API_CONSTANTS.FREE_RPM < API_CONSTANTS.STANDARD_RPM);
    assert.ok(API_CONSTANTS.STANDARD_RPM < API_CONSTANTS.ENTERPRISE_RPM);
  });

  it("key system requires concord_account", () => {
    assert.equal(API_KEY_SYSTEM.registration.requires, "concord_account");
    assert.equal(API_KEY_SYSTEM.registration.approval, "automatic");
  });

  it("billing headers include cost, balance, tier", () => {
    const headers = API_BILLING_HEADERS.headers;
    assert.ok(headers["X-Concord-Cost"]);
    assert.ok(headers["X-Concord-Balance"]);
    assert.ok(headers["X-Concord-Tier"]);
  });

  it("has 4 alert types", () => {
    const types = Object.keys(API_BALANCE_ALERTS.alerts);
    assert.deepEqual(types.sort(), ["free_exhausted", "high_spend", "low_balance", "tier_change"]);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 2. Tier Determination
// ═════════════════════════════════════════════════════════════════════

describe("Tier Determination", () => {
  it("balance 0 → free_tier", () => {
    assert.equal(determineTier(0), "free_tier");
  });

  it("balance 50 → free_tier", () => {
    assert.equal(determineTier(50), "free_tier");
  });

  it("balance 100 → standard", () => {
    assert.equal(determineTier(100), "standard");
  });

  it("balance 9999 → standard", () => {
    assert.equal(determineTier(9999), "standard");
  });

  it("balance 10000 → enterprise", () => {
    assert.equal(determineTier(10000), "enterprise");
  });

  it("balance 999999 → enterprise", () => {
    assert.equal(determineTier(999999), "enterprise");
  });

  it("rate limits match tier", () => {
    const free = getRateLimits("free_tier");
    const std = getRateLimits("standard");
    const ent = getRateLimits("enterprise");

    assert.equal(free.requestsPerMinute, 30);
    assert.equal(std.requestsPerMinute, 300);
    assert.equal(ent.requestsPerMinute, 3000);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 3. Endpoint Categorization
// ═════════════════════════════════════════════════════════════════════

describe("Endpoint Categorization", () => {
  it("GET requests → read", () => {
    assert.equal(categorizeEndpoint("/api/dtu/123", "GET"), "read");
  });

  it("POST requests → write", () => {
    assert.equal(categorizeEndpoint("/api/dtu/create", "POST"), "write");
  });

  it("brain operations → compute", () => {
    assert.equal(categorizeEndpoint("/api/brain/conscious/query", "POST"), "compute");
  });

  it("consolidate → compute", () => {
    assert.equal(categorizeEndpoint("/api/consolidate", "POST"), "compute");
  });

  it("entity/create → compute", () => {
    assert.equal(categorizeEndpoint("/api/entity/create", "POST"), "compute");
  });

  it("vault operations → storage", () => {
    assert.equal(categorizeEndpoint("/api/vault/store", "POST"), "storage");
  });

  it("artifact upload → storage", () => {
    assert.equal(categorizeEndpoint("/api/artifact/upload", "POST"), "storage");
  });

  it("marketplace purchase → cascade", () => {
    assert.equal(categorizeEndpoint("/api/marketplace/purchase", "POST"), "cascade");
  });

  it("cascade trigger → cascade", () => {
    assert.equal(categorizeEndpoint("/api/cascade/trigger", "POST"), "cascade");
  });

  it("storage cost includes per-MB", () => {
    const baseCost = getCategoryCost("storage");
    const withFile = getCategoryCost("storage", { fileSizeMB: 100 });
    assert.equal(baseCost, API_CONSTANTS.STORAGE_CALL_COST);
    assert.equal(withFile, API_CONSTANTS.STORAGE_CALL_COST + 100 * API_CONSTANTS.STORAGE_PER_MB_COST);
  });

  it("cascade cost is zero", () => {
    assert.equal(getCategoryCost("cascade"), 0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 4. API Key Management
// ═════════════════════════════════════════════════════════════════════

describe("API Key Management", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("creates a live API key", () => {
    const result = createAPIKey(db, { userId: "dev1", name: "My App" });
    assert.equal(result.ok, true);
    assert.ok(result.key.rawKey.startsWith("ck_live_"));
    assert.equal(result.key.name, "My App");
  });

  it("creates a test API key", () => {
    const result = createAPIKey(db, { userId: "dev1", name: "Test", isTest: true });
    assert.equal(result.ok, true);
    assert.ok(result.key.rawKey.startsWith("ck_test_"));
  });

  it("enforces max keys per account", () => {
    for (let i = 0; i < 5; i++) {
      const r = createAPIKey(db, { userId: "dev1" });
      assert.equal(r.ok, true);
    }
    const sixth = createAPIKey(db, { userId: "dev1" });
    assert.equal(sixth.ok, false);
    assert.equal(sixth.error, "max_keys_reached");
  });

  it("validates a key", () => {
    const created = createAPIKey(db, { userId: "dev1" });
    const validated = validateAPIKey(db, created.key.rawKey);
    assert.equal(validated.ok, true);
    assert.equal(validated.userId, "dev1");
  });

  it("rejects invalid key", () => {
    const result = validateAPIKey(db, "ck_live_nonexistent");
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_api_key");
  });

  it("revokes a key", () => {
    const created = createAPIKey(db, { userId: "dev1" });
    const revoked = revokeAPIKey(db, { keyId: created.key.id, userId: "dev1" });
    assert.equal(revoked.ok, true);

    const validated = validateAPIKey(db, created.key.rawKey);
    assert.equal(validated.ok, false);
  });

  it("lists keys for a user", () => {
    createAPIKey(db, { userId: "dev1", name: "Key A" });
    createAPIKey(db, { userId: "dev1", name: "Key B" });
    const list = listAPIKeys(db, "dev1");
    assert.equal(list.ok, true);
    assert.equal(list.keys.length, 2);
    assert.ok(list.keys[0].keyPrefix.startsWith("ck_"));
  });

  it("rejects missing userId", () => {
    const result = createAPIKey(db, {});
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_user_id");
  });
});

// ═════════════════════════════════════════════════════════════════════
// 5. Free Allowance
// ═════════════════════════════════════════════════════════════════════

describe("Free Allowance", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("starts with full free allowance", () => {
    const remaining = getFreeRemaining(db, "dev1", "read");
    assert.equal(remaining, API_CONSTANTS.FREE_READS_PER_MONTH);
  });

  it("tracks monthly usage", () => {
    const usage = getMonthlyUsage(db, "dev1");
    assert.equal(usage.reads, 0);
    assert.equal(usage.writes, 0);
    assert.equal(usage.computes, 0);
  });

  it("no free allowance for storage", () => {
    const remaining = getFreeRemaining(db, "dev1", "storage");
    assert.equal(remaining, 0);
  });

  it("no free allowance for cascade", () => {
    const remaining = getFreeRemaining(db, "dev1", "cascade");
    assert.equal(remaining, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 6. Metering Engine
// ═════════════════════════════════════════════════════════════════════

describe("Metering Engine", () => {
  let db;
  let keyHash;
  beforeEach(() => {
    db = createTestDb();
    const created = createAPIKey(db, { userId: "dev1" });
    keyHash = createHash("sha256").update(created.key.rawKey).digest("hex");
  });

  it("allows free read within allowance", () => {
    const result = meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/dtu/123", method: "GET",
      balance: 10,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.cost, 0);
    assert.equal(result.category, "read");
    assert.equal(result.freeRemaining, API_CONSTANTS.FREE_READS_PER_MONTH - 1);
  });

  it("deducts coin for paid read (after free exhausted)", () => {
    // Exhaust free reads by setting monthly usage
    const month = new Date().toISOString().slice(0, 7);
    db.prepare(
      "INSERT INTO api_monthly_usage (user_id, month, reads) VALUES (?, ?, ?)"
    ).run("dev1", month, API_CONSTANTS.FREE_READS_PER_MONTH);

    const result = meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/dtu/123", method: "GET",
      balance: 10,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.cost, API_CONSTANTS.READ_COST);
    assert.equal(result.freeRemaining, 0);
  });

  it("rejects when balance insufficient", () => {
    // Exhaust free reads
    const month = new Date().toISOString().slice(0, 7);
    db.prepare(
      "INSERT INTO api_monthly_usage (user_id, month, reads) VALUES (?, ?, ?)"
    ).run("dev1", month, API_CONSTANTS.FREE_READS_PER_MONTH);

    const result = meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/dtu/123", method: "GET",
      balance: 0,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "insufficient_balance");
  });

  it("meters write calls correctly", () => {
    // Exhaust free writes
    const month = new Date().toISOString().slice(0, 7);
    db.prepare(
      "INSERT INTO api_monthly_usage (user_id, month, writes) VALUES (?, ?, ?)"
    ).run("dev1", month, API_CONSTANTS.FREE_WRITES_PER_MONTH);

    const result = meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/dtu/create", method: "POST",
      balance: 100,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.cost, API_CONSTANTS.WRITE_COST);
  });

  it("meters compute calls correctly", () => {
    // Exhaust free computes
    const month = new Date().toISOString().slice(0, 7);
    db.prepare(
      "INSERT INTO api_monthly_usage (user_id, month, computes) VALUES (?, ?, ?)"
    ).run("dev1", month, API_CONSTANTS.FREE_COMPUTES_PER_MONTH);

    const result = meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/brain/conscious/query", method: "POST",
      balance: 100,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.cost, API_CONSTANTS.COMPUTE_COST);
  });

  it("cascade calls are always free (marketplace fee applies)", () => {
    const result = meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/marketplace/purchase", method: "POST",
      balance: 0,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.cost, 0);
    assert.equal(result.marketplaceFeeApplies, true);
  });

  it("records usage in log", () => {
    meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/dtu/123", method: "GET",
      balance: 10,
    });

    const log = getUsageLog(db, "dev1");
    assert.equal(log.ok, true);
    assert.equal(log.entries.length, 1);
    assert.equal(log.entries[0].category, "read");
  });

  it("increments key total_calls", () => {
    meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/dtu/123", method: "GET",
      balance: 10,
    });

    const row = db.prepare("SELECT total_calls FROM api_keys WHERE key_hash = ?").get(keyHash);
    assert.equal(row.total_calls, 1);
  });

  it("rejects missing credentials", () => {
    const result = meterAPICall(db, {});
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "missing_credentials");
  });
});

// ═════════════════════════════════════════════════════════════════════
// 7. Fee Distribution
// ═════════════════════════════════════════════════════════════════════

describe("Fee Distribution", () => {
  let db;
  let keyHash;
  beforeEach(() => {
    db = createTestDb();
    const created = createAPIKey(db, { userId: "dev1" });
    keyHash = createHash("sha256").update(created.key.rawKey).digest("hex");
  });

  it("distributes fees on paid calls", () => {
    // Exhaust free reads
    const month = new Date().toISOString().slice(0, 7);
    db.prepare(
      "INSERT INTO api_monthly_usage (user_id, month, reads) VALUES (?, ?, ?)"
    ).run("dev1", month, API_CONSTANTS.FREE_READS_PER_MONTH);

    const result = meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/dtu/123", method: "GET",
      balance: 10,
    });

    const dists = getFeeDistributions(db, "dev1");
    assert.equal(dists.ok, true);
    assert.equal(dists.distributions.length, 1);

    const d = dists.distributions[0];
    const cost = API_CONSTANTS.READ_COST;
    // Treasury gets 75%
    assert.equal(d.treasuryAmount, Math.round(cost * 0.75 * 10000) / 10000);
    // Infra gets 10%
    assert.equal(d.infraAmount, Math.round(cost * 0.10 * 10000) / 10000);
    // Payroll gets 10%
    assert.equal(d.payrollAmount, Math.round(cost * 0.10 * 10000) / 10000);
    // Ops gets 5%
    assert.equal(d.opsAmount, Math.round(cost * 0.05 * 10000) / 10000);
  });

  it("no fee distribution on free calls", () => {
    meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/dtu/123", method: "GET",
      balance: 10,
    });

    const dists = getFeeDistributions(db, "dev1");
    assert.equal(dists.distributions.length, 0);
  });

  it("fee split sums to total cost", () => {
    const month = new Date().toISOString().slice(0, 7);
    db.prepare(
      "INSERT INTO api_monthly_usage (user_id, month, computes) VALUES (?, ?, ?)"
    ).run("dev1", month, API_CONSTANTS.FREE_COMPUTES_PER_MONTH);

    meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/brain/conscious/query", method: "POST",
      balance: 100,
    });

    const dists = getFeeDistributions(db, "dev1");
    const d = dists.distributions[0];
    const total = d.treasuryAmount + d.infraAmount + d.payrollAmount + d.opsAmount;
    assert.ok(Math.abs(total - API_CONSTANTS.COMPUTE_COST) < 0.0001);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 8. Usage Dashboard
// ═════════════════════════════════════════════════════════════════════

describe("Usage Dashboard", () => {
  let db;
  let keyHash;
  beforeEach(() => {
    db = createTestDb();
    const created = createAPIKey(db, { userId: "dev1" });
    keyHash = createHash("sha256").update(created.key.rawKey).digest("hex");
  });

  it("returns usage summary", () => {
    meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/dtu/123", method: "GET",
      balance: 10,
    });

    const summary = getUsageSummary(db, "dev1");
    assert.equal(summary.ok, true);
    assert.equal(summary.usage.reads.count, 1);
    assert.equal(summary.freeRemaining.reads, API_CONSTANTS.FREE_READS_PER_MONTH - 1);
  });

  it("returns daily usage", () => {
    meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/dtu/123", method: "GET",
      balance: 10,
    });

    const daily = getDailyUsage(db, "dev1");
    assert.equal(daily.ok, true);
    assert.ok(daily.daily.length >= 1);
  });

  it("returns per-endpoint usage", () => {
    meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/dtu/123", method: "GET",
      balance: 10,
    });
    meterAPICall(db, {
      keyHash, userId: "dev1",
      endpoint: "/api/dtu/456", method: "GET",
      balance: 10,
    });

    const endpoints = getEndpointUsage(db, "dev1");
    assert.equal(endpoints.ok, true);
    assert.ok(endpoints.endpoints.length >= 1);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 9. Balance Alerts
// ═════════════════════════════════════════════════════════════════════

describe("Balance Alerts", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("creates a low_balance alert", () => {
    const result = createAlert(db, {
      userId: "dev1",
      alertType: "low_balance",
      threshold: 10,
      webhookUrl: "https://example.com/hook",
    });
    assert.equal(result.ok, true);
    assert.equal(result.alert.alertType, "low_balance");
    assert.equal(result.alert.threshold, 10);
  });

  it("creates a high_spend alert", () => {
    const result = createAlert(db, {
      userId: "dev1",
      alertType: "high_spend",
      threshold: 100,
    });
    assert.equal(result.ok, true);
  });

  it("rejects invalid alert type", () => {
    const result = createAlert(db, { userId: "dev1", alertType: "invalid_type" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_alert_type");
  });

  it("lists user alerts", () => {
    createAlert(db, { userId: "dev1", alertType: "low_balance", threshold: 10 });
    createAlert(db, { userId: "dev1", alertType: "high_spend", threshold: 100 });

    const list = getAlerts(db, "dev1");
    assert.equal(list.ok, true);
    assert.equal(list.alerts.length, 2);
  });

  it("deletes an alert", () => {
    const created = createAlert(db, { userId: "dev1", alertType: "low_balance", threshold: 10 });
    const deleted = deleteAlert(db, { alertId: created.alert.id, userId: "dev1" });
    assert.equal(deleted.ok, true);

    const list = getAlerts(db, "dev1");
    assert.equal(list.alerts.length, 0);
  });

  it("triggers low_balance alert when balance drops", () => {
    createAlert(db, { userId: "dev1", alertType: "low_balance", threshold: 10 });

    const check = checkAlerts(db, "dev1", { balance: 5 });
    assert.equal(check.ok, true);
    assert.equal(check.triggered.length, 1);
    assert.equal(check.triggered[0].type, "low_balance");
  });

  it("does not trigger when above threshold", () => {
    createAlert(db, { userId: "dev1", alertType: "low_balance", threshold: 10 });

    const check = checkAlerts(db, "dev1", { balance: 50 });
    assert.equal(check.triggered.length, 0);
  });

  it("triggers high_spend alert", () => {
    createAlert(db, { userId: "dev1", alertType: "high_spend", threshold: 100 });

    const check = checkAlerts(db, "dev1", { dailySpend: 150 });
    assert.equal(check.triggered.length, 1);
    assert.equal(check.triggered[0].type, "high_spend");
  });
});

// ═════════════════════════════════════════════════════════════════════
// 10. Economic Invariants
// ═════════════════════════════════════════════════════════════════════

describe("Economic Invariants", () => {
  it("API spending uses same coin as marketplace", () => {
    assert.equal(API_BILLING_MODEL.currency, "concord_coin");
    assert.ok(API_BILLING_MODEL.principle.includes("marketplace participants"));
  });

  it("fee split matches company treasury structure", () => {
    const total = API_CONSTANTS.TREASURY_SHARE + API_CONSTANTS.INFRA_SHARE
      + API_CONSTANTS.PAYROLL_SHARE + API_CONSTANTS.OPS_SHARE;
    assert.equal(total, 1.0);
  });

  it("tier determination is automatic by balance", () => {
    assert.equal(API_KEY_SYSTEM.rateLimits.tierDetermination, "account_balance");
  });

  it("cascade calls charge zero — marketplace fee handles revenue", () => {
    assert.equal(API_PRICING.categories.cascade.costPerCall, 0);
    assert.equal(API_PRICING.categories.cascade.marketplaceFeeApplies, true);
  });

  it("registration is automatic — no gatekeeping", () => {
    assert.equal(API_KEY_SYSTEM.registration.approval, "automatic");
  });

  it("auth integrates with existing gate system", () => {
    assert.equal(API_KEY_SYSTEM.auth.gateIntegration, true);
  });
});
