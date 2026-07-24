// server/lib/verification/invariant-specs.js
//
// Abstract, checkable models of Concord's real money invariants, built for
// server/lib/verification/model-checker.js. These are hand-specified
// abstractions of the logic in:
//   - server/economy/balances.js        (CREDIT_ROW_PREDICATE)
//   - server/economy/royalty-cascade.js (MAX_ROYALTY_RATE, ROYALTY_FLOOR, MAX_CASCADE_DEPTH)
//   - server/economy/coin-service.js    (verifyTreasuryInvariant)
//
// A model here is NOT the real database — it's a small in-memory state
// machine whose transition semantics mirror the real ledger row shapes and
// the real payout formulas closely enough that a bug in those shapes (like
// the double-credit bug CREDIT_ROW_PREDICATE exists to fix) reproduces as a
// reachable, checkable violation. See the model-checker.js header for the
// standing honest-boundary disclaimer: passing here means the ABSTRACTION
// held up within the explored bound, not that the real system is correct.

import { formulaInvariant } from "./model-checker.js";

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Ledger conservation model (money.balances.getBalance / treasury invariant)
// ---------------------------------------------------------------------------
//
// Mirrors the real two-row TRANSFER/MARKETPLACE_PURCHASE pattern exactly:
//   debit row:  { type, from: sender,   to: recipient, amount: gross, net: netAfterFee }
//   credit row: { type, from: null,     to: recipient, amount: netAfterFee, net: netAfterFee }
//   fee row:    { type: 'FEE', from: null, to: platform, amount: fee, net: fee }
// (see server/economy/transfer.js#executeTransfer — the debit row's `net`
// column carries the SAME fee-adjusted value as the credit row; that's
// exactly why a naive "sum net for every row where to=user" double-counts.)

/** The real, correct predicate — mirrors economy/balances.js#CREDIT_ROW_PREDICATE. */
export function correctCreditPredicate(row) {
  return !(row.from !== null && (row.type === "TRANSFER" || row.type === "MARKETPLACE_PURCHASE"));
}

/**
 * The historical bug this repo actually shipped: "every row with a to_user_id
 * is a credit" — no exclusion of the redundant debit-half row. Exported so
 * tests can prove the checker catches it via a real counterexample trace.
 */
export function buggyCreditPredicateDoubleCounts(row) {
  return row.to !== null;
}

const FEE_RATES = {
  TRANSFER: 0.0146, // matches the TOKEN_PURCHASE_FEE-derived transfer fee used in tests/economy/ledger-conservation.test.js
  MARKETPLACE_PURCHASE: 0.0546, // PLATFORM_FEE_RATE (0.0146) + MARKETPLACE_FEE_RATE (0.04)
};

/**
 * Build a bounded model of mint/transfer/marketplace-purchase/withdraw
 * sequences over a small set of accounts, with the invariant that total
 * circulating balance (summed via `creditPredicate`, across every known
 * account including the platform account) never exceeds total minted USD.
 *
 * @param {object} opts
 * @param {(row) => boolean} [opts.creditPredicate] — which rows count as a real credit to their `to` account
 * @param {string[]} [opts.users]
 * @param {string} [opts.platformAccount]
 * @param {number[]} [opts.transferAmounts]
 * @param {number[]} [opts.mintAmounts]
 * @param {number} [opts.maxRows] — caps ledger-row growth so the state space stays finite
 */
export function buildLedgerConservationModel({
  creditPredicate = correctCreditPredicate,
  users = ["alice", "bob"],
  platformAccount = "__PLATFORM__",
  transferAmounts = [100],
  mintAmounts = [500],
  maxRows = 5,
} = {}) {
  const allAccounts = [...users, platformAccount];

  function balanceOf(rows, user) {
    let bal = 0;
    for (const row of rows) {
      if (row.to === user && creditPredicate(row)) bal += row.net;
      if (row.from === user) bal -= row.amount;
    }
    return round2(bal);
  }

  function circulating(rows) {
    let total = 0;
    for (const user of allAccounts) total += balanceOf(rows, user);
    return round2(total);
  }

  const actions = [];

  for (const user of users) {
    for (const amt of mintAmounts) {
      actions.push({
        name: `mint(${user},${amt})`,
        guard: (s) => s.rows.length < maxRows,
        apply: (s) => ({
          rows: [...s.rows, { type: "MINT", from: null, to: user, amount: amt, net: amt }],
          mintedUsd: round2(s.mintedUsd + amt),
        }),
      });
    }
  }

  for (const from of users) {
    for (const to of users) {
      if (from === to) continue;
      for (const amt of transferAmounts) {
        for (const kind of ["TRANSFER", "MARKETPLACE_PURCHASE"]) {
          actions.push({
            name: `${kind.toLowerCase()}(${from}->${to},${amt})`,
            // Needs room for up to 3 new rows (debit, credit, fee).
            guard: (s) => s.rows.length <= maxRows - 3 && balanceOf(s.rows, from) >= amt,
            apply: (s) => {
              const fee = round2(amt * FEE_RATES[kind]);
              const net = round2(amt - fee);
              const rows = [
                ...s.rows,
                { type: kind, from, to, amount: amt, net }, // debit-half: carries BOTH from and to
                { type: kind, from: null, to, amount: net, net }, // credit-half: from is null
              ];
              if (fee > 0) rows.push({ type: "FEE", from: null, to: platformAccount, amount: fee, net: fee });
              return { rows, mintedUsd: s.mintedUsd };
            },
          });
        }
      }
    }
  }

  for (const user of users) {
    for (const amt of transferAmounts) {
      actions.push({
        name: `withdraw(${user},${amt})`,
        guard: (s) => s.rows.length < maxRows && balanceOf(s.rows, user) >= amt,
        apply: (s) => ({
          rows: [...s.rows, { type: "WITHDRAWAL", from: user, to: null, amount: amt, net: 0 }],
          mintedUsd: s.mintedUsd,
        }),
      });
    }
  }

  const EPS = 0.02; // cent-rounding slack across chained fee arithmetic

  const invariants = [
    formulaInvariant({
      name: "circulating_never_exceeds_minted",
      formula: "circulatingWithinMinted",
      atoms: (s) => ({ circulatingWithinMinted: circulating(s.rows) <= s.mintedUsd + EPS }),
      message: (s) =>
        `circulating balance ${circulating(s.rows)} exceeds total minted USD ${s.mintedUsd} — this is currency created from nothing (the double-credit bug CREDIT_ROW_PREDICATE exists to prevent).`,
    }),
  ];

  return {
    initialState: { rows: [], mintedUsd: 0 },
    actions,
    invariants,
    // exposed for tests/inspection only — not read by the checker
    _abstraction: { balanceOf, circulating },
  };
}

/**
 * Treasury invariant model — same underlying ledger abstraction as
 * buildLedgerConservationModel (mint = deposit backing USD, marketplace
 * purchase = spend already-minted money, withdraw = burn/cash-out), framed
 * for coin-service.js#verifyTreasuryInvariant's "circulating <= total_usd"
 * check. Kept as a distinct export so intent at call sites is legible even
 * though the model itself is shared.
 */
export function buildTreasuryInvariantModel(opts = {}) {
  return buildLedgerConservationModel(opts);
}

// ---------------------------------------------------------------------------
// Royalty cascade model (economy/royalty-cascade.js#distributeRoyalties)
// ---------------------------------------------------------------------------
//
// Mirrors the real algorithm: ancestors sorted by generation ascending,
// rate(gen) = max(initialRate / 2^gen, ROYALTY_FLOOR), payouts accumulate
// until the running total would exceed MAX_ROYALTY_RATE * saleAmount, at
// which point the payout is either clipped to the remaining pool
// (enforceCap: true, the real behavior) or left unclipped (enforceCap:
// false, the historical-shape bug this model can also catch — many direct
// citations at low generation can blow well past 30% without the cap).
//
// Generation is bounded at MAX_CASCADE_DEPTH exactly like
// getAncestorChain(db, contentId, maxDepth) bounds lineage traversal — an
// attempted generation far beyond the real cap is clamped, not looped.

const MAX_CASCADE_DEPTH = 50; // economy/royalty-cascade.js
const ROYALTY_FLOOR = 0.0005; // economy/royalty-cascade.js
const MAX_ROYALTY_RATE = 0.30; // economy/royalty-cascade.js
const DEFAULT_INITIAL_RATE = 0.21; // economy/royalty-cascade.js

function payoutForAncestors(ancestors, amount, { initialRate, floor, capRate, enforceCap }) {
  const maxPool = round2(amount * capRate);
  const sorted = [...ancestors].sort((a, b) => a.generation - b.generation);
  let total = 0;
  for (const anc of sorted) {
    const rate = Math.max(initialRate / Math.pow(2, anc.generation), floor);
    let amt = round2(amount * rate);
    if (amt < 0.01) continue;
    if (enforceCap) {
      if (total + amt > maxPool) {
        amt = round2(maxPool - total);
        if (amt < 0.01) break;
      }
    }
    total = round2(total + amt);
    if (enforceCap && total >= maxPool) break;
  }
  return round2(total);
}

/**
 * Build a bounded model of citation events building an ancestor set (breadth
 * — multiple direct citations at low generation, the realistic way the 30%
 * cap actually binds, since a single linear chain's geometric decay alone
 * stays well under 30% within 50 generations) followed by a purchase that
 * triggers the cascade payout.
 *
 * @param {object} opts
 * @param {boolean} [opts.enforceCap=true] — true = real behavior (clip at 30%); false = the bug this model can also catch
 * @param {number} [opts.saleAmount=1000]
 * @param {number} [opts.breadthCap=4] — max ancestors addable, bounds the state space
 * @param {number[]} [opts.generationChoices=[1,2,9999]] — 9999 models an attempted runaway/deep reference, clamped at MAX_CASCADE_DEPTH
 */
export function buildRoyaltyCascadeModel({
  enforceCap = true,
  saleAmount = 1000,
  breadthCap = 4,
  generationChoices = [1, 2, 9999],
  initialRate = DEFAULT_INITIAL_RATE,
  floor = ROYALTY_FLOOR,
  capRate = MAX_ROYALTY_RATE,
} = {}) {
  const actions = generationChoices.map((requestedGeneration) => ({
    name: `citeAncestor(gen=${requestedGeneration})`,
    guard: (s) => s.ancestors.length < breadthCap,
    apply: (s) => ({
      ...s,
      // Mirrors getAncestorChain(db, contentId, maxDepth) — the real lineage
      // query never returns entries beyond maxDepth; an attempted deeper
      // reference is bounded, not looped.
      ancestors: [...s.ancestors, { generation: Math.min(requestedGeneration, MAX_CASCADE_DEPTH) }],
    }),
  }));

  actions.push({
    name: `purchase(${saleAmount})`,
    guard: () => true,
    apply: (s) => ({
      ...s,
      lastAmount: saleAmount,
      lastPayout: payoutForAncestors(s.ancestors, saleAmount, { initialRate, floor, capRate, enforceCap }),
    }),
  });

  const EPS = 0.02;

  const invariants = [
    formulaInvariant({
      name: "royalty_never_exceeds_cap",
      formula: "withinCap",
      atoms: (s) => ({ withinCap: s.lastPayout <= round2(s.lastAmount * capRate) + EPS }),
      message: (s) =>
        `royalty payout ${s.lastPayout} exceeds ${capRate * 100}% of sale amount ${s.lastAmount} (cap=${round2(
          s.lastAmount * capRate,
        )}) across ${s.ancestors.length} ancestor(s).`,
    }),
    {
      name: "cascade_generation_bounded",
      check: (s) => s.ancestors.every((a) => a.generation <= MAX_CASCADE_DEPTH),
      message: (s) =>
        `an ancestor generation exceeded MAX_CASCADE_DEPTH=${MAX_CASCADE_DEPTH}: ${JSON.stringify(s.ancestors)}`,
    },
  ];

  return {
    initialState: { ancestors: [], lastAmount: 0, lastPayout: 0 },
    actions,
    invariants,
  };
}
