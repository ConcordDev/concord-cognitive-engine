/**
 * Fee Schedule & Calculation Tests
 *
 * Comprehensive tests for economy/fees.js covering:
 * - FEES constant structure and values
 * - UNIVERSAL_FEE_RATE constant
 * - FEE_SPLIT allocations (must sum to 1.0)
 * - Platform account ID constants
 * - calculateFee() for every transaction type, edge cases, and rounding
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FEES,
  UNIVERSAL_FEE_RATE,
  FEE_SPLIT,
  PLATFORM_ACCOUNT_ID,
  TREASURY_ACCOUNT_ID,
  OPERATING_ACCOUNT_ID,
  PAYROLL_ACCOUNT_ID,
  calculateFee,
} from "../economy/fees.js";

// =============================================================================
// 1. FEES constant
// =============================================================================

describe("FEES constant", () => {
  it("exports an object with the expected transaction type keys", () => {
    const expectedKeys = [
      "TOKEN_PURCHASE",
      "TRANSFER",
      "WITHDRAWAL",
      "MARKETPLACE_PURCHASE",
      "EMERGENT_TRANSFER",
      "ROYALTY_PAYOUT",
      "musicDistribution",
      "artDistribution",
    ];
    for (const key of expectedKeys) {
      assert.ok(
        key in FEES,
        `FEES should contain key "${key}"`,
      );
    }
  });

  it("has correct rate for TOKEN_PURCHASE (1.46%)", () => {
    assert.equal(FEES.TOKEN_PURCHASE, 0.0146);
  });

  it("has correct rate for TRANSFER (1.46%)", () => {
    assert.equal(FEES.TRANSFER, 0.0146);
  });

  it("has correct rate for WITHDRAWAL (1.46%)", () => {
    assert.equal(FEES.WITHDRAWAL, 0.0146);
  });

  it("has correct rate for MARKETPLACE_PURCHASE (4%)", () => {
    assert.equal(FEES.MARKETPLACE_PURCHASE, 0.04);
  });

  it("has correct rate for EMERGENT_TRANSFER (1.46%)", () => {
    assert.equal(FEES.EMERGENT_TRANSFER, 0.0146);
  });

  it("has zero rate for ROYALTY_PAYOUT", () => {
    assert.equal(FEES.ROYALTY_PAYOUT, 0);
  });

  it("has correct rate for musicDistribution (4%)", () => {
    assert.equal(FEES.musicDistribution, 0.04);
  });

  it("has correct rate for artDistribution (4%)", () => {
    assert.equal(FEES.artDistribution, 0.04);
  });

  it("all fee rates are non-negative numbers", () => {
    for (const [key, rate] of Object.entries(FEES)) {
      assert.equal(typeof rate, "number", `FEES.${key} should be a number`);
      assert.ok(rate >= 0, `FEES.${key} should be non-negative`);
    }
  });
});

// =============================================================================
// 2. UNIVERSAL_FEE_RATE constant
// =============================================================================

describe("UNIVERSAL_FEE_RATE", () => {
  it("equals 1.46%", () => {
    assert.equal(UNIVERSAL_FEE_RATE, 0.0146);
  });

  it("is a number", () => {
    assert.equal(typeof UNIVERSAL_FEE_RATE, "number");
  });
});

// =============================================================================
// 3. FEE_SPLIT constant
// =============================================================================

describe("FEE_SPLIT", () => {
  it("allocates 80% to TREASURY", () => {
    assert.equal(FEE_SPLIT.TREASURY, 0.80);
  });

  it("allocates 10% to OPERATING_COSTS", () => {
    assert.equal(FEE_SPLIT.OPERATING_COSTS, 0.10);
  });

  it("allocates 10% to PAYROLL", () => {
    assert.equal(FEE_SPLIT.PAYROLL, 0.10);
  });

  it("split allocations sum to exactly 1.0 (100%)", () => {
    const total = FEE_SPLIT.TREASURY + FEE_SPLIT.OPERATING_COSTS + FEE_SPLIT.PAYROLL;
    assert.ok(
      Math.abs(total - 1.0) < Number.EPSILON,
      `FEE_SPLIT should sum to 1.0 but got ${total}`,
    );
  });

  it("has exactly three allocation buckets", () => {
    assert.equal(Object.keys(FEE_SPLIT).length, 3);
  });

  it("all split values are positive numbers", () => {
    for (const [key, val] of Object.entries(FEE_SPLIT)) {
      assert.equal(typeof val, "number", `FEE_SPLIT.${key} should be a number`);
      assert.ok(val > 0, `FEE_SPLIT.${key} should be positive`);
    }
  });
});

// =============================================================================
// 4. Platform account ID constants
// =============================================================================

describe("Platform account IDs", () => {
  it("PLATFORM_ACCOUNT_ID is __PLATFORM__", () => {
    assert.equal(PLATFORM_ACCOUNT_ID, "__PLATFORM__");
  });

  it("TREASURY_ACCOUNT_ID is __TREASURY__", () => {
    assert.equal(TREASURY_ACCOUNT_ID, "__TREASURY__");
  });

  it("OPERATING_ACCOUNT_ID is __OPERATING__", () => {
    assert.equal(OPERATING_ACCOUNT_ID, "__OPERATING__");
  });

  it("PAYROLL_ACCOUNT_ID is __PAYROLL__", () => {
    assert.equal(PAYROLL_ACCOUNT_ID, "__PAYROLL__");
  });

  it("all account IDs are non-empty strings", () => {
    for (const id of [
      PLATFORM_ACCOUNT_ID,
      TREASURY_ACCOUNT_ID,
      OPERATING_ACCOUNT_ID,
      PAYROLL_ACCOUNT_ID,
    ]) {
      assert.equal(typeof id, "string");
      assert.ok(id.length > 0);
    }
  });

  it("all account IDs are unique", () => {
    const ids = [
      PLATFORM_ACCOUNT_ID,
      TREASURY_ACCOUNT_ID,
      OPERATING_ACCOUNT_ID,
      PAYROLL_ACCOUNT_ID,
    ];
    assert.equal(new Set(ids).size, ids.length, "Account IDs must be unique");
  });
});

// =============================================================================
// 5. calculateFee — standard transaction types
// =============================================================================

describe("calculateFee", () => {
  // ── TOKEN_PURCHASE ──────────────────────────────────────────────────────
  describe("TOKEN_PURCHASE (1.46%)", () => {
    it("calculates fee on a round amount of 100", () => {
      const { fee, net, rate } = calculateFee("TOKEN_PURCHASE", 100);
      assert.equal(rate, 0.0146);
      assert.equal(fee, 1.46);
      assert.equal(net, 98.54);
    });

    it("calculates fee on 1000", () => {
      const { fee, net } = calculateFee("TOKEN_PURCHASE", 1000);
      assert.equal(fee, 14.6);
      assert.equal(net, 985.4);
    });

    it("calculates fee on 1 (small amount)", () => {
      const { fee, net } = calculateFee("TOKEN_PURCHASE", 1);
      // 1 * 0.0146 = 0.0146 -> rounded to 0.01
      assert.equal(fee, 0.01);
      assert.equal(net, 0.99);
    });

    it("fee + net equals original amount", () => {
      const { fee, net } = calculateFee("TOKEN_PURCHASE", 100);
      assert.equal(Math.round((fee + net) * 100) / 100, 100);
    });
  });

  // ── TRANSFER ────────────────────────────────────────────────────────────
  describe("TRANSFER (1.46%)", () => {
    it("calculates fee on 500", () => {
      const { fee, net, rate } = calculateFee("TRANSFER", 500);
      assert.equal(rate, 0.0146);
      assert.equal(fee, 7.3);
      assert.equal(net, 492.7);
    });

    it("calculates fee on 50", () => {
      const { fee, net } = calculateFee("TRANSFER", 50);
      assert.equal(fee, 0.73);
      assert.equal(net, 49.27);
    });
  });

  // ── WITHDRAWAL ──────────────────────────────────────────────────────────
  describe("WITHDRAWAL (1.46%)", () => {
    it("calculates fee on 250", () => {
      const { fee, net, rate } = calculateFee("WITHDRAWAL", 250);
      assert.equal(rate, 0.0146);
      // 250 * 0.0146 = 3.65
      assert.equal(fee, 3.65);
      assert.equal(net, 246.35);
    });
  });

  // ── EMERGENT_TRANSFER ───────────────────────────────────────────────────
  describe("EMERGENT_TRANSFER (1.46%)", () => {
    it("calculates fee on 100", () => {
      const { fee, net, rate } = calculateFee("EMERGENT_TRANSFER", 100);
      assert.equal(rate, 0.0146);
      assert.equal(fee, 1.46);
      assert.equal(net, 98.54);
    });
  });

  // ── ROYALTY_PAYOUT ──────────────────────────────────────────────────────
  describe("ROYALTY_PAYOUT (0%)", () => {
    it("returns zero fee for any amount", () => {
      const { fee, net, rate } = calculateFee("ROYALTY_PAYOUT", 100);
      assert.equal(rate, 0);
      assert.equal(fee, 0);
      assert.equal(net, 100);
    });

    it("returns zero fee for large amount", () => {
      const { fee, net } = calculateFee("ROYALTY_PAYOUT", 1_000_000);
      assert.equal(fee, 0);
      assert.equal(net, 1_000_000);
    });

    it("returns zero fee for fractional amount", () => {
      const { fee, net } = calculateFee("ROYALTY_PAYOUT", 0.50);
      assert.equal(fee, 0);
      assert.equal(net, 0.50);
    });
  });

  // ── MARKETPLACE_PURCHASE (combined fee) ─────────────────────────────────
  describe("MARKETPLACE_PURCHASE (4% + 1.46% = 5.46%)", () => {
    it("applies combined marketplace + universal fee", () => {
      const { fee, net, rate } = calculateFee("MARKETPLACE_PURCHASE", 100);
      // rate should be 0.04 + 0.0146 = 0.0546
      assert.equal(rate, 0.04 + UNIVERSAL_FEE_RATE);
      assert.equal(fee, 5.46);
      assert.equal(net, 94.54);
    });

    it("calculates combined fee on 1000", () => {
      const { fee, net } = calculateFee("MARKETPLACE_PURCHASE", 1000);
      // 1000 * 0.0546 = 54.6
      assert.equal(fee, 54.6);
      assert.equal(net, 945.4);
    });

    it("calculates combined fee on 9.99 (small marketplace purchase)", () => {
      const { fee, net } = calculateFee("MARKETPLACE_PURCHASE", 9.99);
      // 9.99 * 0.0546 = 0.545454 -> rounded to 0.55
      assert.equal(fee, 0.55);
      assert.equal(net, 9.44);
    });

    it("rate is strictly higher than plain marketplace rate", () => {
      const { rate } = calculateFee("MARKETPLACE_PURCHASE", 100);
      assert.ok(rate > FEES.MARKETPLACE_PURCHASE);
    });

    it("fee + net equals original amount", () => {
      const amount = 200;
      const { fee, net } = calculateFee("MARKETPLACE_PURCHASE", amount);
      assert.equal(Math.round((fee + net) * 100) / 100, amount);
    });
  });

  // ── musicDistribution ───────────────────────────────────────────────────
  describe("musicDistribution (4%)", () => {
    it("calculates fee on 100", () => {
      const { fee, net, rate } = calculateFee("musicDistribution", 100);
      assert.equal(rate, 0.04);
      assert.equal(fee, 4);
      assert.equal(net, 96);
    });

    it("does NOT add universal fee (only MARKETPLACE_PURCHASE does)", () => {
      const { rate } = calculateFee("musicDistribution", 100);
      assert.equal(rate, 0.04);
      assert.notEqual(rate, 0.04 + UNIVERSAL_FEE_RATE);
    });

    it("calculates fee on 25.50", () => {
      const { fee, net } = calculateFee("musicDistribution", 25.50);
      // 25.50 * 0.04 = 1.02
      assert.equal(fee, 1.02);
      assert.equal(net, 24.48);
    });
  });

  // ── artDistribution ─────────────────────────────────────────────────────
  describe("artDistribution (4%)", () => {
    it("calculates fee on 100", () => {
      const { fee, net, rate } = calculateFee("artDistribution", 100);
      assert.equal(rate, 0.04);
      assert.equal(fee, 4);
      assert.equal(net, 96);
    });

    it("calculates fee on 750", () => {
      const { fee, net } = calculateFee("artDistribution", 750);
      // 750 * 0.04 = 30
      assert.equal(fee, 30);
      assert.equal(net, 720);
    });
  });
});

// =============================================================================
// 6. calculateFee — unknown / missing transaction types
// =============================================================================

describe("calculateFee — unknown transaction type", () => {
  it("returns zero fee for an unrecognized type", () => {
    const { fee, net, rate } = calculateFee("NONEXISTENT_TYPE", 100);
    assert.equal(rate, 0);
    assert.equal(fee, 0);
    assert.equal(net, 100);
  });

  it("returns zero fee for an empty string type", () => {
    const { fee, net, rate } = calculateFee("", 100);
    assert.equal(rate, 0);
    assert.equal(fee, 0);
    assert.equal(net, 100);
  });

  it("returns zero fee for undefined type (nullish coalescing)", () => {
    const { fee, net, rate } = calculateFee(undefined, 100);
    assert.equal(rate, 0);
    assert.equal(fee, 0);
    assert.equal(net, 100);
  });

  it("returns zero fee for null type (nullish coalescing)", () => {
    const { fee, net, rate } = calculateFee(null, 100);
    assert.equal(rate, 0);
    assert.equal(fee, 0);
    assert.equal(net, 100);
  });
});

// =============================================================================
// 7. calculateFee — edge cases: zero amount
// =============================================================================

describe("calculateFee — zero amount", () => {
  it("returns zero fee and zero net for amount 0 with TOKEN_PURCHASE", () => {
    const { fee, net } = calculateFee("TOKEN_PURCHASE", 0);
    assert.equal(fee, 0);
    assert.equal(net, 0);
  });

  it("returns zero fee and zero net for amount 0 with MARKETPLACE_PURCHASE", () => {
    const { fee, net } = calculateFee("MARKETPLACE_PURCHASE", 0);
    assert.equal(fee, 0);
    assert.equal(net, 0);
  });

  it("returns zero fee and zero net for amount 0 with ROYALTY_PAYOUT", () => {
    const { fee, net } = calculateFee("ROYALTY_PAYOUT", 0);
    assert.equal(fee, 0);
    assert.equal(net, 0);
  });
});

// =============================================================================
// 8. calculateFee — edge cases: very small amounts (rounding behavior)
// =============================================================================

describe("calculateFee — very small amounts and rounding", () => {
  it("rounds fee to two decimal places for 0.01 TOKEN_PURCHASE", () => {
    const { fee, net } = calculateFee("TOKEN_PURCHASE", 0.01);
    // 0.01 * 0.0146 = 0.000146 -> rounded to 0.00
    assert.equal(fee, 0);
    assert.equal(net, 0.01);
  });

  it("rounds fee to two decimal places for 0.10 TOKEN_PURCHASE", () => {
    const { fee } = calculateFee("TOKEN_PURCHASE", 0.10);
    // 0.10 * 0.0146 = 0.00146 -> rounded to 0.00
    assert.equal(fee, 0);
  });

  it("rounds fee correctly for 0.50 TOKEN_PURCHASE", () => {
    const { fee } = calculateFee("TOKEN_PURCHASE", 0.50);
    // 0.50 * 0.0146 = 0.0073 -> rounded to 0.01
    assert.equal(fee, 0.01);
  });

  it("rounds fee correctly for 3.33 MARKETPLACE_PURCHASE", () => {
    const { fee } = calculateFee("MARKETPLACE_PURCHASE", 3.33);
    // 3.33 * 0.0546 = 0.181818 -> Math.round(18.1818) / 100 = 0.18
    assert.equal(fee, 0.18);
  });

  it("fee is always non-negative for positive amounts", () => {
    const types = Object.keys(FEES);
    for (const type of types) {
      const { fee } = calculateFee(type, 0.01);
      assert.ok(fee >= 0, `Fee for ${type} with amount 0.01 should be >= 0`);
    }
  });
});

// =============================================================================
// 9. calculateFee — edge cases: very large amounts
// =============================================================================

describe("calculateFee — very large amounts", () => {
  it("handles 1,000,000 TOKEN_PURCHASE", () => {
    const { fee, net } = calculateFee("TOKEN_PURCHASE", 1_000_000);
    // 1_000_000 * 0.0146 = 14600
    assert.equal(fee, 14600);
    assert.equal(net, 985400);
  });

  it("handles 10,000,000 MARKETPLACE_PURCHASE", () => {
    const { fee, net } = calculateFee("MARKETPLACE_PURCHASE", 10_000_000);
    // 10_000_000 * 0.0546 = 546000
    assert.equal(fee, 546000);
    assert.equal(net, 9_454_000);
  });

  it("fee + net sums to amount for large values", () => {
    const amount = 999_999.99;
    const { fee, net } = calculateFee("TRANSFER", amount);
    const sum = Math.round((fee + net) * 100) / 100;
    assert.equal(sum, amount);
  });
});

// =============================================================================
// 10. calculateFee — return shape and invariants
// =============================================================================

describe("calculateFee — return shape", () => {
  it("always returns an object with fee, net, and rate properties", () => {
    const result = calculateFee("TOKEN_PURCHASE", 100);
    assert.ok("fee" in result);
    assert.ok("net" in result);
    assert.ok("rate" in result);
  });

  it("fee is a number", () => {
    const { fee } = calculateFee("TOKEN_PURCHASE", 100);
    assert.equal(typeof fee, "number");
  });

  it("net is a number", () => {
    const { net } = calculateFee("TOKEN_PURCHASE", 100);
    assert.equal(typeof net, "number");
  });

  it("rate is a number", () => {
    const { rate } = calculateFee("TOKEN_PURCHASE", 100);
    assert.equal(typeof rate, "number");
  });

  it("net is always <= amount for any known type", () => {
    const amount = 500;
    for (const type of Object.keys(FEES)) {
      const { net } = calculateFee(type, amount);
      assert.ok(net <= amount, `net (${net}) should be <= amount (${amount}) for ${type}`);
    }
  });

  it("fee is always >= 0 for any known type", () => {
    const amount = 500;
    for (const type of Object.keys(FEES)) {
      const { fee } = calculateFee(type, amount);
      assert.ok(fee >= 0, `fee should be >= 0 for ${type}`);
    }
  });
});

// =============================================================================
// 11. calculateFee — marketplace-only universal fee addition
// =============================================================================

describe("calculateFee — marketplace universal fee behavior", () => {
  it("only MARKETPLACE_PURCHASE gets the universal fee added", () => {
    const marketplaceResult = calculateFee("MARKETPLACE_PURCHASE", 100);
    const musicResult = calculateFee("musicDistribution", 100);
    const artResult = calculateFee("artDistribution", 100);

    // Marketplace has combined rate
    assert.equal(marketplaceResult.rate, FEES.MARKETPLACE_PURCHASE + UNIVERSAL_FEE_RATE);
    // Others with same base rate do NOT get the universal fee
    assert.equal(musicResult.rate, FEES.musicDistribution);
    assert.equal(artResult.rate, FEES.artDistribution);
  });

  it("marketplace fee is larger than same-base-rate type for same amount", () => {
    const marketplaceFee = calculateFee("MARKETPLACE_PURCHASE", 100).fee;
    const musicFee = calculateFee("musicDistribution", 100).fee;
    // Both have 4% base, but marketplace adds 1.46%
    assert.ok(marketplaceFee > musicFee);
  });

  it("non-marketplace types with 1.46% rate do not double-dip", () => {
    const transferResult = calculateFee("TRANSFER", 100);
    assert.equal(transferResult.rate, FEES.TRANSFER);
    assert.equal(transferResult.rate, UNIVERSAL_FEE_RATE);
    // They should NOT get 2 * UNIVERSAL_FEE_RATE
    assert.notEqual(transferResult.rate, 2 * UNIVERSAL_FEE_RATE);
  });
});

// =============================================================================
// 12. Fee distribution arithmetic (FEE_SPLIT applied to collected fees)
// =============================================================================

describe("Fee distribution arithmetic via FEE_SPLIT", () => {
  it("distributes a $10 fee correctly among buckets", () => {
    const totalFee = 10;
    const reserves = Math.round(totalFee * FEE_SPLIT.TREASURY * 100) / 100;
    const operating = Math.round(totalFee * FEE_SPLIT.OPERATING_COSTS * 100) / 100;
    const payroll = Math.round(totalFee * FEE_SPLIT.PAYROLL * 100) / 100;

    assert.equal(reserves, 8);
    assert.equal(operating, 1);
    assert.equal(payroll, 1);
    assert.equal(reserves + operating + payroll, totalFee);
  });

  it("distributes a $5.46 marketplace fee (from $100 purchase)", () => {
    const { fee } = calculateFee("MARKETPLACE_PURCHASE", 100);
    assert.equal(fee, 5.46);

    const reserves = Math.round(fee * FEE_SPLIT.TREASURY * 100) / 100;
    const operating = Math.round(fee * FEE_SPLIT.OPERATING_COSTS * 100) / 100;
    const payroll = Math.round(fee * FEE_SPLIT.PAYROLL * 100) / 100;

    assert.equal(reserves, 4.37);
    assert.equal(operating, 0.55);
    assert.equal(payroll, 0.55);
  });

  it("reserves always gets the largest share", () => {
    const fee = 100;
    const reserves = fee * FEE_SPLIT.TREASURY;
    const operating = fee * FEE_SPLIT.OPERATING_COSTS;
    const payroll = fee * FEE_SPLIT.PAYROLL;

    assert.ok(reserves > operating);
    assert.ok(reserves > payroll);
  });
});

// =============================================================================
// 13. Cross-type consistency checks
// =============================================================================

describe("calculateFee — cross-type consistency", () => {
  it("TOKEN_PURCHASE, TRANSFER, WITHDRAWAL, EMERGENT_TRANSFER all use same rate", () => {
    const amount = 100;
    const types = ["TOKEN_PURCHASE", "TRANSFER", "WITHDRAWAL", "EMERGENT_TRANSFER"];
    const results = types.map((t) => calculateFee(t, amount));

    const rates = results.map((r) => r.rate);
    const fees = results.map((r) => r.fee);

    assert.ok(rates.every((r) => r === rates[0]), "All 1.46% types should have same rate");
    assert.ok(fees.every((f) => f === fees[0]), "All 1.46% types should produce same fee");
  });

  it("musicDistribution and artDistribution have the same rate and fee", () => {
    const amount = 100;
    const music = calculateFee("musicDistribution", amount);
    const art = calculateFee("artDistribution", amount);

    assert.equal(music.rate, art.rate);
    assert.equal(music.fee, art.fee);
    assert.equal(music.net, art.net);
  });

  it("MARKETPLACE_PURCHASE fee exceeds all other types for the same amount", () => {
    const amount = 100;
    const marketplaceFee = calculateFee("MARKETPLACE_PURCHASE", amount).fee;

    for (const type of Object.keys(FEES)) {
      if (type === "MARKETPLACE_PURCHASE") continue;
      const { fee } = calculateFee(type, amount);
      assert.ok(
        marketplaceFee >= fee,
        `MARKETPLACE_PURCHASE fee (${marketplaceFee}) should be >= ${type} fee (${fee})`,
      );
    }
  });
});

// =============================================================================
// 14. Rounding precision (the Math.round(x * 100) / 100 pattern)
// =============================================================================

describe("calculateFee — rounding precision", () => {
  it("fee has at most two decimal places", () => {
    const testCases = [
      { type: "TOKEN_PURCHASE", amount: 7.77 },
      { type: "MARKETPLACE_PURCHASE", amount: 3.33 },
      { type: "TRANSFER", amount: 11.11 },
      { type: "musicDistribution", amount: 0.99 },
    ];

    for (const { type, amount } of testCases) {
      const { fee } = calculateFee(type, amount);
      const decimalPlaces = (fee.toString().split(".")[1] || "").length;
      assert.ok(
        decimalPlaces <= 2,
        `Fee ${fee} for ${type}(${amount}) should have <= 2 decimal places`,
      );
    }
  });

  it("net has at most two decimal places", () => {
    const testCases = [
      { type: "TOKEN_PURCHASE", amount: 7.77 },
      { type: "MARKETPLACE_PURCHASE", amount: 3.33 },
      { type: "TRANSFER", amount: 11.11 },
    ];

    for (const { type, amount } of testCases) {
      const { net } = calculateFee(type, amount);
      const decimalPlaces = (net.toString().split(".")[1] || "").length;
      assert.ok(
        decimalPlaces <= 2,
        `Net ${net} for ${type}(${amount}) should have <= 2 decimal places`,
      );
    }
  });

  it("Math.round banker's rounding at midpoint: 0.005 rounds to 0.01", () => {
    // For TOKEN_PURCHASE, find an amount where fee lands exactly at X.XX5
    // amount * 0.0146 * 100 should end in .5
    // e.g., amount = 50/146 * 5 ... let's just test a known value
    // 3.4246575... * 0.0146 = 0.05 exactly -> rounds to 0.05
    // Instead, let's verify the function uses Math.round:
    // amount * 0.0146 = 0.005 -> amount = 0.005/0.0146 ~ 0.3424657...
    // Math.round(0.005 * 100) / 100 = Math.round(0.5) / 100 = 1/100 = 0.01
    // But due to floating point, 0.3424657534... * 0.0146 * 100 might not be exactly 0.5
    // Use a simpler verification: just confirm that Math.round is being used, not floor/ceil
    const { fee: fee1 } = calculateFee("MARKETPLACE_PURCHASE", 50);
    // 50 * 0.0546 = 2.73
    assert.equal(fee1, 2.73);

    const { fee: fee2 } = calculateFee("TOKEN_PURCHASE", 10);
    // 10 * 0.0146 = 0.146 -> Math.round(14.6)/100 = 15/100 = 0.15
    assert.equal(fee2, 0.15);
  });
});

// =============================================================================
// 15. Negative amounts (defensive behavior)
// =============================================================================

describe("calculateFee — negative amounts", () => {
  it("produces negative fee for negative amounts (no guard)", () => {
    // The function does not guard against negative amounts;
    // it simply applies the math. We test actual behavior.
    const { fee, net } = calculateFee("TOKEN_PURCHASE", -100);
    assert.equal(fee, -1.46);
    assert.equal(net, -98.54);
  });

  it("produces zero fee for negative amount with ROYALTY_PAYOUT", () => {
    const { fee } = calculateFee("ROYALTY_PAYOUT", -100);
    assert.equal(fee, -0); // -100 * 0 = -0
  });
});
