// economy/coin-service.js
// Concord Coin: 1:1 USD-pegged utility token.
// Handles minting (on purchase), burning (on withdrawal), and treasury invariant enforcement.
// Treasury Balance >= Sum of All User Balances + Sum of All Emergent Balances — always.

import { randomUUID } from "crypto";
import { recordTransaction, generateTxId } from "./ledger.js";
import { economyAudit } from "./audit.js";
import { CREDIT_ROW_PREDICATE } from "./balances.js";

function uid(prefix = "tev") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

const TREASURY_ID = "treasury_main";

/**
 * Build the treasury_events.metadata_json payload for a mint/burn.
 *
 * `treasury_events` has no request_id/ip columns of its own (migration 008:
 * id, event_type, amount, usd_*, coins_*, ref_id, metadata_json, created_at),
 * so the caller-supplied audit fields belong in metadata_json — the column
 * that exists precisely to carry per-event context.
 *
 * Why this matters: mintCoins/burnCoins both DESTRUCTURED `requestId` and `ip`
 * and then referenced neither, while all three real callers pass them —
 * the Stripe webhook mint (stripe.js), the admin mint (routes.js), and the
 * fiat withdrawal burn (stripe.js). The three most audit-sensitive paths on
 * the money system were each handing over a request correlation id and an
 * originating IP that went straight on the floor, leaving treasury events
 * un-correlatable with the request that caused them during an incident.
 *
 * Keys are omitted rather than written as null when absent, so events from
 * callers that genuinely have no request context (tests, internal reward
 * mints) stay byte-identical to their previous `{"userId":"…"}` payload
 * instead of gaining noise columns.
 */
function eventMetadata(userId, requestId, ip) {
  const meta = { userId };
  if (requestId) meta.requestId = requestId;
  if (ip) meta.ip = ip;
  return JSON.stringify(meta);
}

/**
 * Mint coins — called when a user purchases tokens via Stripe.
 * Atomically increases both USD and coin supply in the treasury.
 * @param {object} db — better-sqlite3 instance
 * @param {object} opts
 * @param {number} opts.amount — number of coins to mint (= USD received)
 * @param {string} opts.userId — recipient of minted coins
 * @param {string} [opts.refId] — idempotency reference
 * @returns {{ ok: boolean, treasury?: object, error?: string }}
 */
export function mintCoins(db, { amount, userId, refId, requestId, ip }) {
  if (!amount || amount <= 0) return { ok: false, error: "invalid_mint_amount" };
  if (!userId) return { ok: false, error: "missing_user_id" };

  const doMint = db.transaction(() => {
    // Idempotency (Stripe-webhook atomicity hardening): a MINT already recorded
    // under this refId means this exact mint landed on a prior webhook delivery.
    // The webhook path is executePurchase (idempotent) → mintCoins → markEventProcessed;
    // a crash (or Stripe at-least-once re-delivery) between the mint and the
    // markEventProcessed would re-enter here and mint a SECOND time, inflating
    // the treasury above the ledger's credited supply. Short-circuit with the
    // already-recorded state so the caller still sees ok:true, no double-mint.
    // Every real caller passes a unique/idempotent-by-design refId
    // (stripe_mint:<eventId>, admin_mint:<batchId>, event_reward:<e>:<u>, …).
    if (refId) {
      const prior = db.prepare(
        "SELECT usd_before, usd_after, coins_before, coins_after FROM treasury_events WHERE ref_id = ? AND event_type = 'MINT'",
      ).get(refId);
      if (prior) {
        return {
          idempotent: true,
          usdBefore: prior.usd_before, usdAfter: prior.usd_after,
          coinsBefore: prior.coins_before, coinsAfter: prior.coins_after,
        };
      }
    }

    const treasury = getTreasuryState(db);
    if (!treasury) throw new Error("treasury_not_initialized");

    const usdBefore = treasury.total_usd;
    const coinsBefore = treasury.total_coins;
    const usdAfter = Math.round((usdBefore + amount) * 100) / 100;
    const coinsAfter = Math.round((coinsBefore + amount) * 100) / 100;

    // Update treasury
    db.prepare(`
      UPDATE treasury SET total_usd = ?, total_coins = ?, updated_at = ? WHERE id = ?
    `).run(usdAfter, coinsAfter, nowISO(), TREASURY_ID);

    // Record treasury event
    db.prepare(`
      INSERT INTO treasury_events (id, event_type, amount, usd_before, usd_after, coins_before, coins_after, ref_id, metadata_json, created_at)
      VALUES (?, 'MINT', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uid("tev"), amount, usdBefore, usdAfter, coinsBefore, coinsAfter,
      refId || null, eventMetadata(userId, requestId, ip), nowISO(),
    );

    return { usdBefore, usdAfter, coinsBefore, coinsAfter };
  });

  try {
    const result = doMint();
    return {
      ok: true,
      idempotent: result.idempotent === true,
      amount,
      userId,
      treasury: {
        usdBefore: result.usdBefore,
        usdAfter: result.usdAfter,
        coinsBefore: result.coinsBefore,
        coinsAfter: result.coinsAfter,
      },
    };
  } catch (err) {
    console.error("[economy] mint_failed:", err.message);
    return { ok: false, error: "mint_failed" };
  }
}

/**
 * Burn coins — called when a user withdraws to fiat.
 * Atomically decreases both USD and coin supply in the treasury.
 */
export function burnCoins(db, { amount, userId, refId, requestId, ip }) {
  if (!amount || amount <= 0) return { ok: false, error: "invalid_burn_amount" };
  if (!userId) return { ok: false, error: "missing_user_id" };

  const doBurn = db.transaction(() => {
    const treasury = getTreasuryState(db);
    if (!treasury) throw new Error("treasury_not_initialized");

    if (treasury.total_coins < amount) {
      throw new Error(`treasury_insufficient:${treasury.total_coins}:${amount}`);
    }

    const usdBefore = treasury.total_usd;
    const coinsBefore = treasury.total_coins;
    const usdAfter = Math.round((usdBefore - amount) * 100) / 100;
    const coinsAfter = Math.round((coinsBefore - amount) * 100) / 100;

    // Enforce treasury invariant: coins can never exceed USD
    if (coinsAfter < 0) throw new Error("treasury_invariant_violation");

    db.prepare(`
      UPDATE treasury SET total_usd = ?, total_coins = ?, updated_at = ? WHERE id = ?
    `).run(usdAfter, coinsAfter, nowISO(), TREASURY_ID);

    db.prepare(`
      INSERT INTO treasury_events (id, event_type, amount, usd_before, usd_after, coins_before, coins_after, ref_id, metadata_json, created_at)
      VALUES (?, 'BURN', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uid("tev"), amount, usdBefore, usdAfter, coinsBefore, coinsAfter,
      refId || null, eventMetadata(userId, requestId, ip), nowISO(),
    );

    return { usdBefore, usdAfter, coinsBefore, coinsAfter };
  });

  try {
    const result = doBurn();
    return {
      ok: true,
      amount,
      userId,
      treasury: {
        usdBefore: result.usdBefore,
        usdAfter: result.usdAfter,
        coinsBefore: result.coinsBefore,
        coinsAfter: result.coinsAfter,
      },
    };
  } catch (err) {
    if (err.message?.startsWith("treasury_insufficient:")) {
      const parts = err.message.split(":");
      return { ok: false, error: "treasury_insufficient", available: Number(parts[1]), requested: Number(parts[2]) };
    }
    console.error("[economy] burn_failed:", err.message);
    return { ok: false, error: "burn_failed" };
  }
}

/**
 * Get current treasury state.
 */
export function getTreasuryState(db) {
  return db.prepare("SELECT * FROM treasury WHERE id = ?").get(TREASURY_ID) || null;
}

/**
 * Verify the treasury invariant: total_coins <= total_usd.
 * Also verifies total_coins >= sum of all user/emergent balances.
 */
export function verifyTreasuryInvariant(db) {
  const treasury = getTreasuryState(db);
  if (!treasury) return { ok: false, error: "treasury_not_initialized" };

  // Check 1: coins never exceed USD
  const coinsExceedUsd = treasury.total_coins > treasury.total_usd;

  // Check 2: sum of all balances (derived from ledger)
  const totalCredits = db.prepare(`
    SELECT COALESCE(SUM(CAST(ROUND(net * 100) AS INTEGER)), 0) as total_cents
    FROM economy_ledger WHERE to_user_id IS NOT NULL AND status = 'complete' AND ${CREDIT_ROW_PREDICATE}
  `).get()?.total_cents || 0;

  const totalDebits = db.prepare(`
    SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) as total_cents
    FROM economy_ledger WHERE from_user_id IS NOT NULL AND status = 'complete'
  `).get()?.total_cents || 0;

  const circulatingCents = totalCredits - totalDebits;
  const circulatingCoins = circulatingCents / 100;

  const invariantHolds = !coinsExceedUsd && treasury.total_usd >= circulatingCoins;

  return {
    ok: true,
    invariantHolds,
    treasury: {
      totalUsd: treasury.total_usd,
      totalCoins: treasury.total_coins,
    },
    circulation: {
      totalCredits: totalCredits / 100,
      totalDebits: totalDebits / 100,
      circulatingCoins,
    },
    checks: {
      coinsLteUsd: !coinsExceedUsd,
      usdCoversCirculation: treasury.total_usd >= circulatingCoins,
    },
  };
}

/**
 * Get treasury event history.
 */
export function getTreasuryEvents(db, { limit = 50, offset = 0, type } = {}) {
  let sql = "SELECT * FROM treasury_events WHERE 1=1";
  const params = [];

  if (type) {
    sql += " AND event_type = ?";
    params.push(type);
  }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  return db.prepare(sql).all(params);
}
