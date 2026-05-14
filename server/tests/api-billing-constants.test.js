import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  API_BILLING_MODEL,
  API_KEY_SYSTEM,
  API_PRICING,
  API_DASHBOARD,
  API_BILLING_HEADERS,
  API_BALANCE_ALERTS,
  API_CONSTANTS,
} from "../lib/api-billing-constants.js";
import logger from '../logger.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function assertFrozen(obj, label) {
  assert.ok(Object.isFrozen(obj), `${label} should be frozen`);
}

function assertCannotMutate(obj, key, label) {
  const original = obj[key];
  try { obj[key] = "__MUTATED__"; } catch (_e) { logger.debug('api-billing-constants.test', 'strict mode throws', { error: _e?.message }); }
  assert.deepStrictEqual(obj[key], original, `${label}.${key} should be immutable`);
}

function assertCannotAdd(obj, label) {
  try { obj.__newProp = true; } catch (_e) { logger.debug('api-billing-constants.test', 'strict mode throws', { error: _e?.message }); }
  assert.strictEqual(obj.__newProp, undefined, `${label} should not allow new properties`);
}

function assertCannotDelete(obj, key, label) {
  try { delete obj[key]; } catch (_e) { logger.debug('api-billing-constants.test', 'strict mode throws', { error: _e?.message }); }
  assert.notStrictEqual(obj[key], undefined, `${label}.${key} should not be deletable`);
}

// ── API_BILLING_MODEL ────────────────────────────────────────────────────────

describe("API_BILLING_MODEL", () => {
  it("is frozen", () => assertFrozen(API_BILLING_MODEL, "API_BILLING_MODEL"));

  it("uses concord_coin as currency", () => {
    assert.strictEqual(API_BILLING_MODEL.currency, "concord_coin");
  });

  it("contains principle string", () => {
    assert.strictEqual(typeof API_BILLING_MODEL.principle, "string");
    assert.ok(API_BILLING_MODEL.principle.length > 0);
  });

  it("cannot be mutated", () => {
    assertCannotMutate(API_BILLING_MODEL, "currency", "API_BILLING_MODEL");
    assertCannotAdd(API_BILLING_MODEL, "API_BILLING_MODEL");
    assertCannotDelete(API_BILLING_MODEL, "currency", "API_BILLING_MODEL");
  });
});

// ── API_KEY_SYSTEM ───────────────────────────────────────────────────────────

describe("API_KEY_SYSTEM", () => {
  it("is frozen", () => assertFrozen(API_KEY_SYSTEM, "API_KEY_SYSTEM"));

  describe("registration", () => {
    const reg = API_KEY_SYSTEM.registration;

    it("requires concord_account", () => {
      assert.strictEqual(reg.requires, "concord_account");
    });

    it("has automatic approval", () => {
      assert.strictEqual(reg.approval, "automatic");
    });

    it("defines key formats with expected prefixes", () => {
      assert.ok(reg.keyFormat.startsWith("ck_live_"));
      assert.ok(reg.testKeyFormat.startsWith("ck_test_"));
    });

    it("allows 5 keys per account", () => {
      assert.strictEqual(reg.keysPerAccount, 5);
    });
  });

  describe("auth", () => {
    const auth = API_KEY_SYSTEM.auth;

    it("uses bearer_token method", () => {
      assert.strictEqual(auth.method, "bearer_token");
    });

    it("has gate integration enabled", () => {
      assert.strictEqual(auth.gateIntegration, true);
    });

    it("defines authorization header format", () => {
      assert.ok(auth.header.startsWith("Authorization: Bearer"));
    });
  });

  describe("rateLimits", () => {
    const rl = API_KEY_SYSTEM.rateLimits;

    it("defines three tiers", () => {
      assert.ok(rl.free_tier);
      assert.ok(rl.standard);
      assert.ok(rl.enterprise);
    });

    it("free_tier has correct limits", () => {
      assert.strictEqual(rl.free_tier.requestsPerMinute, 30);
      assert.strictEqual(rl.free_tier.requestsPerDay, 1000);
      assert.strictEqual(rl.free_tier.concurrentRequests, 5);
    });

    it("standard has higher limits than free_tier", () => {
      assert.ok(rl.standard.requestsPerMinute > rl.free_tier.requestsPerMinute);
      assert.ok(rl.standard.requestsPerDay > rl.free_tier.requestsPerDay);
      assert.ok(rl.standard.concurrentRequests > rl.free_tier.concurrentRequests);
    });

    it("enterprise has highest limits", () => {
      assert.ok(rl.enterprise.requestsPerMinute > rl.standard.requestsPerMinute);
      assert.ok(rl.enterprise.requestsPerDay > rl.standard.requestsPerDay);
      assert.ok(rl.enterprise.concurrentRequests > rl.standard.concurrentRequests);
    });

    it("standard limits: 300/min, 50000/day, 25 concurrent", () => {
      assert.strictEqual(rl.standard.requestsPerMinute, 300);
      assert.strictEqual(rl.standard.requestsPerDay, 50000);
      assert.strictEqual(rl.standard.concurrentRequests, 25);
    });

    it("enterprise limits: 3000/min, 1000000/day, 100 concurrent", () => {
      assert.strictEqual(rl.enterprise.requestsPerMinute, 3000);
      assert.strictEqual(rl.enterprise.requestsPerDay, 1000000);
      assert.strictEqual(rl.enterprise.concurrentRequests, 100);
    });

    it("tier determination is by account_balance", () => {
      assert.strictEqual(rl.tierDetermination, "account_balance");
    });

    it("tier thresholds are ascending", () => {
      assert.ok(rl.tierThresholds.free_tier < rl.tierThresholds.standard);
      assert.ok(rl.tierThresholds.standard < rl.tierThresholds.enterprise);
    });

    it("tier thresholds match exact values", () => {
      assert.strictEqual(rl.tierThresholds.free_tier, 0);
      assert.strictEqual(rl.tierThresholds.standard, 100);
      assert.strictEqual(rl.tierThresholds.enterprise, 10000);
    });
  });

  it("cannot be mutated", () => {
    assertCannotMutate(API_KEY_SYSTEM, "registration", "API_KEY_SYSTEM");
    assertCannotAdd(API_KEY_SYSTEM, "API_KEY_SYSTEM");
  });
});

// ── API_PRICING ──────────────────────────────────────────────────────────────

describe("API_PRICING", () => {
  it("is frozen", () => assertFrozen(API_PRICING, "API_PRICING"));

  describe("categories", () => {
    const cats = API_PRICING.categories;

    it("defines 5 categories: read, write, compute, storage, cascade", () => {
      const expected = ["read", "write", "compute", "storage", "cascade"];
      expected.forEach((cat) => assert.ok(cats[cat], `category ${cat} missing`));
    });

    it("read cost is lowest non-zero", () => {
      assert.strictEqual(cats.read.costPerCall, 0.0002);
    });

    it("write cost is higher than read", () => {
      assert.ok(cats.write.costPerCall > cats.read.costPerCall);
      assert.strictEqual(cats.write.costPerCall, 0.001);
    });

    it("compute cost is highest", () => {
      assert.ok(cats.compute.costPerCall > cats.write.costPerCall);
      assert.strictEqual(cats.compute.costPerCall, 0.005);
    });

    it("storage has both per-call and per-MB cost", () => {
      assert.strictEqual(cats.storage.costPerCall, 0.0005);
      assert.strictEqual(cats.storage.costPerMB, 0.001);
    });

    it("cascade cost is zero (marketplace fee applies instead)", () => {
      assert.strictEqual(cats.cascade.costPerCall, 0);
      assert.strictEqual(cats.cascade.marketplaceFeeApplies, true);
    });

    it("every category has examples array", () => {
      for (const [key, val] of Object.entries(cats)) {
        assert.ok(Array.isArray(val.examples), `${key}.examples should be array`);
        assert.ok(val.examples.length > 0, `${key}.examples should be non-empty`);
      }
    });
  });

  describe("freeAllowance", () => {
    it("provides monthly free reads, writes, and compute", () => {
      assert.strictEqual(API_PRICING.freeAllowance.readsPerMonth, 10000);
      assert.strictEqual(API_PRICING.freeAllowance.writesPerMonth, 100);
      assert.strictEqual(API_PRICING.freeAllowance.computePerMonth, 10);
    });
  });

  it("cannot be mutated", () => {
    assertCannotMutate(API_PRICING, "categories", "API_PRICING");
    assertCannotAdd(API_PRICING, "API_PRICING");
  });
});

// ── API_DASHBOARD ────────────────────────────────────────────────────────────

describe("API_DASHBOARD", () => {
  it("is frozen", () => assertFrozen(API_DASHBOARD, "API_DASHBOARD"));

  it("has overview, usage, history, and keys views", () => {
    const views = API_DASHBOARD.views;
    assert.ok(views.overview);
    assert.ok(views.usage);
    assert.ok(views.history);
    assert.ok(views.keys);
  });

  it("overview includes expected fields", () => {
    const fields = API_DASHBOARD.views.overview.fields;
    assert.ok(fields.includes("currentBalance"));
    assert.ok(fields.includes("monthlySpend"));
    assert.ok(fields.includes("currentTier"));
  });

  it("usage categories match pricing categories", () => {
    const cats = API_DASHBOARD.views.usage.categories;
    assert.ok(cats.includes("reads"));
    assert.ok(cats.includes("writes"));
    assert.ok(cats.includes("compute"));
    assert.ok(cats.includes("storage"));
    assert.ok(cats.includes("cascade"));
  });

  it("history has daily and endpoints sub-views", () => {
    assert.ok(API_DASHBOARD.views.history.daily);
    assert.ok(API_DASHBOARD.views.history.endpoints);
  });

  it("keys view has expected fields", () => {
    const fields = API_DASHBOARD.views.keys.fields;
    assert.ok(fields.includes("keyPrefix"));
    assert.ok(fields.includes("created"));
  });

  it("cannot be mutated", () => {
    assertCannotMutate(API_DASHBOARD, "views", "API_DASHBOARD");
    assertCannotAdd(API_DASHBOARD, "API_DASHBOARD");
  });
});

// ── API_BILLING_HEADERS ──────────────────────────────────────────────────────

describe("API_BILLING_HEADERS", () => {
  it("is frozen", () => assertFrozen(API_BILLING_HEADERS, "API_BILLING_HEADERS"));

  it("defines 6 X-Concord- headers", () => {
    const headers = API_BILLING_HEADERS.headers;
    const keys = Object.keys(headers);
    assert.strictEqual(keys.length, 6);
    keys.forEach((k) => assert.ok(k.startsWith("X-Concord-"), `${k} should start with X-Concord-`));
  });

  it("includes cost, balance, tier, rate-remaining, free-remaining, monthly-spend", () => {
    const h = API_BILLING_HEADERS.headers;
    assert.ok(h["X-Concord-Cost"]);
    assert.ok(h["X-Concord-Balance"]);
    assert.ok(h["X-Concord-Tier"]);
    assert.ok(h["X-Concord-Rate-Remaining"]);
    assert.ok(h["X-Concord-Free-Remaining"]);
    assert.ok(h["X-Concord-Monthly-Spend"]);
  });

  it("cannot be mutated", () => {
    assertCannotMutate(API_BILLING_HEADERS, "headers", "API_BILLING_HEADERS");
  });
});

// ── API_BALANCE_ALERTS ───────────────────────────────────────────────────────

describe("API_BALANCE_ALERTS", () => {
  it("is frozen", () => assertFrozen(API_BALANCE_ALERTS, "API_BALANCE_ALERTS"));

  it("defines 4 alert types", () => {
    const alerts = API_BALANCE_ALERTS.alerts;
    const keys = Object.keys(alerts);
    assert.strictEqual(keys.length, 4);
    assert.ok(alerts.low_balance);
    assert.ok(alerts.high_spend);
    assert.ok(alerts.tier_change);
    assert.ok(alerts.free_exhausted);
  });

  it("low_balance has threshold of 10", () => {
    assert.strictEqual(API_BALANCE_ALERTS.alerts.low_balance.defaultThreshold, 10);
  });

  it("high_spend has threshold of 100", () => {
    assert.strictEqual(API_BALANCE_ALERTS.alerts.high_spend.defaultThreshold, 100);
  });

  it("all alerts support webhook and email", () => {
    for (const [key, alert] of Object.entries(API_BALANCE_ALERTS.alerts)) {
      assert.strictEqual(alert.webhook, true, `${key}.webhook should be true`);
      assert.strictEqual(alert.email, true, `${key}.email should be true`);
    }
  });

  it("cannot be mutated", () => {
    assertCannotMutate(API_BALANCE_ALERTS, "alerts", "API_BALANCE_ALERTS");
    assertCannotAdd(API_BALANCE_ALERTS, "API_BALANCE_ALERTS");
  });
});

// ── API_CONSTANTS (flat) ─────────────────────────────────────────────────────

describe("API_CONSTANTS", () => {
  it("is frozen", () => assertFrozen(API_CONSTANTS, "API_CONSTANTS"));

  describe("pricing constants", () => {
    it("READ_COST matches API_PRICING.categories.read.costPerCall", () => {
      assert.strictEqual(API_CONSTANTS.READ_COST, API_PRICING.categories.read.costPerCall);
    });

    it("WRITE_COST matches API_PRICING", () => {
      assert.strictEqual(API_CONSTANTS.WRITE_COST, API_PRICING.categories.write.costPerCall);
    });

    it("COMPUTE_COST matches API_PRICING", () => {
      assert.strictEqual(API_CONSTANTS.COMPUTE_COST, API_PRICING.categories.compute.costPerCall);
    });

    it("STORAGE_CALL_COST matches API_PRICING", () => {
      assert.strictEqual(API_CONSTANTS.STORAGE_CALL_COST, API_PRICING.categories.storage.costPerCall);
    });

    it("STORAGE_PER_MB_COST matches API_PRICING", () => {
      assert.strictEqual(API_CONSTANTS.STORAGE_PER_MB_COST, API_PRICING.categories.storage.costPerMB);
    });

    it("CASCADE_COST matches API_PRICING", () => {
      assert.strictEqual(API_CONSTANTS.CASCADE_COST, API_PRICING.categories.cascade.costPerCall);
    });
  });

  describe("free allowance constants", () => {
    it("FREE_READS_PER_MONTH matches API_PRICING", () => {
      assert.strictEqual(API_CONSTANTS.FREE_READS_PER_MONTH, API_PRICING.freeAllowance.readsPerMonth);
    });

    it("FREE_WRITES_PER_MONTH matches API_PRICING", () => {
      assert.strictEqual(API_CONSTANTS.FREE_WRITES_PER_MONTH, API_PRICING.freeAllowance.writesPerMonth);
    });

    it("FREE_COMPUTES_PER_MONTH matches API_PRICING", () => {
      assert.strictEqual(API_CONSTANTS.FREE_COMPUTES_PER_MONTH, API_PRICING.freeAllowance.computePerMonth);
    });
  });

  describe("tier thresholds", () => {
    it("match API_KEY_SYSTEM tier thresholds", () => {
      assert.strictEqual(API_CONSTANTS.TIER_FREE, API_KEY_SYSTEM.rateLimits.tierThresholds.free_tier);
      assert.strictEqual(API_CONSTANTS.TIER_STANDARD, API_KEY_SYSTEM.rateLimits.tierThresholds.standard);
      assert.strictEqual(API_CONSTANTS.TIER_ENTERPRISE, API_KEY_SYSTEM.rateLimits.tierThresholds.enterprise);
    });
  });

  describe("rate limits", () => {
    it("match API_KEY_SYSTEM rate limits", () => {
      assert.strictEqual(API_CONSTANTS.FREE_RPM, API_KEY_SYSTEM.rateLimits.free_tier.requestsPerMinute);
      assert.strictEqual(API_CONSTANTS.STANDARD_RPM, API_KEY_SYSTEM.rateLimits.standard.requestsPerMinute);
      assert.strictEqual(API_CONSTANTS.ENTERPRISE_RPM, API_KEY_SYSTEM.rateLimits.enterprise.requestsPerMinute);
      assert.strictEqual(API_CONSTANTS.FREE_RPD, API_KEY_SYSTEM.rateLimits.free_tier.requestsPerDay);
      assert.strictEqual(API_CONSTANTS.STANDARD_RPD, API_KEY_SYSTEM.rateLimits.standard.requestsPerDay);
      assert.strictEqual(API_CONSTANTS.ENTERPRISE_RPD, API_KEY_SYSTEM.rateLimits.enterprise.requestsPerDay);
    });
  });

  describe("fee split", () => {
    it("sums to 1.0", () => {
      const sum = API_CONSTANTS.TREASURY_SHARE
        + API_CONSTANTS.INFRA_SHARE
        + API_CONSTANTS.PAYROLL_SHARE
        + API_CONSTANTS.OPS_SHARE;
      assert.strictEqual(sum, 1.0);
    });

    it("has correct values", () => {
      assert.strictEqual(API_CONSTANTS.TREASURY_SHARE, 0.75);
      assert.strictEqual(API_CONSTANTS.INFRA_SHARE, 0.10);
      assert.strictEqual(API_CONSTANTS.PAYROLL_SHARE, 0.10);
      assert.strictEqual(API_CONSTANTS.OPS_SHARE, 0.05);
    });
  });

  describe("key constants", () => {
    it("MAX_KEYS_PER_ACCOUNT matches registration keysPerAccount", () => {
      assert.strictEqual(API_CONSTANTS.MAX_KEYS_PER_ACCOUNT, API_KEY_SYSTEM.registration.keysPerAccount);
    });

    it("KEY_PREFIX_LENGTH is 8", () => {
      assert.strictEqual(API_CONSTANTS.KEY_PREFIX_LENGTH, 8);
    });
  });

  it("cannot be mutated", () => {
    assertCannotMutate(API_CONSTANTS, "READ_COST", "API_CONSTANTS");
    assertCannotAdd(API_CONSTANTS, "API_CONSTANTS");
    assertCannotDelete(API_CONSTANTS, "READ_COST", "API_CONSTANTS");
  });
});
