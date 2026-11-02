// economy/fees.js
// Fee schedule and calculation. All fees flow to the PLATFORM_ACCOUNT.

export const FEES = {
  TOKEN_PURCHASE: 0.0146,
  TRANSFER: 0.0146,
  WITHDRAWAL: 0.0146,
  MARKETPLACE_PURCHASE: 0.04,
  EMERGENT_TRANSFER: 0.0146,
  ROYALTY_PAYOUT: 0,
  musicDistribution: 0.04,
  artDistribution: 0.04,
};

// Universal transaction fee applied to all non-royalty transactions
export const UNIVERSAL_FEE_RATE = 0.0146;

// Fee revenue split: how collected fees are allocated
export const FEE_SPLIT = {
  TREASURY: 0.80,
  OPERATING_COSTS: 0.10,
  PAYROLL: 0.10,
};

// Platform account IDs
export const PLATFORM_ACCOUNT_ID = "__PLATFORM__";
export const TREASURY_ACCOUNT_ID = "__TREASURY__";
export const OPERATING_ACCOUNT_ID = "__OPERATING__";
export const PAYROLL_ACCOUNT_ID = "__PAYROLL__";

/**
 * Calculate fee for a transaction type and amount.
 * For marketplace transactions, this calculates the combined
 * universal (1.46%) + marketplace (4%) fee = 5.46% total.
 * @param {string} type — transaction type
 * @param {number} amount — gross amount
 * @returns {{ fee: number, net: number, rate: number }}
 */
export function calculateFee(type, amount) {
  const rate = FEES[type] ?? 0;
  let totalRate = rate;

  // Marketplace purchases incur both the marketplace fee AND the universal fee
  if (type === "MARKETPLACE_PURCHASE") {
    totalRate = rate + UNIVERSAL_FEE_RATE;
  }

  const fee = Math.round(amount * totalRate * 100) / 100;
  const net = Math.round((amount - fee) * 100) / 100;
  return { fee, net, rate: totalRate };
}
