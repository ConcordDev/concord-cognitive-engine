// economy/balances.js
// Balances are NEVER stored — always derived from the ledger.
// balance = sum(credits) - sum(debits) for completed transactions.

/**
 * Compute balance for a user by scanning the ledger.
 * Credits = rows where to_user_id = userId (net amount received).
 * Debits  = rows where from_user_id = userId (amount sent, including fees).
 *
 * @param {object} db — better-sqlite3 instance
 * @param {string} userId
 * @returns {{ balance: number, totalCredits: number, totalDebits: number }}
 */
export function getBalance(db, userId) {
  // Use integer arithmetic (cents) to avoid floating-point drift.
  // CAST to INTEGER rounds at the DB level, then we divide by 100 for display.
  //
  // Balance is event-sourced (a pure function of the ledger) — there is NO
  // stored balance to drift. The two queries below are served as index-only
  // scans by migration 324's covering indexes (idx_ledger_balance_credits /
  // _debits), so this stays O(matching rows) even on large histories. See that
  // migration for why a stateful balance cache was deliberately rejected.
  const credits = db.prepare(`
    SELECT COALESCE(SUM(CAST(ROUND(net * 100) AS INTEGER)), 0) as total_cents
    FROM economy_ledger
    WHERE to_user_id = ? AND status = 'complete'
  `).get(userId);

  const debits = db.prepare(`
    SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) as total_cents
    FROM economy_ledger
    WHERE from_user_id = ? AND status = 'complete'
  `).get(userId);

  const totalCreditsCents = credits?.total_cents || 0;
  const totalDebitsCents = debits?.total_cents || 0;
  const balanceCents = totalCreditsCents - totalDebitsCents;

  return {
    balance: balanceCents / 100,
    totalCredits: totalCreditsCents / 100,
    totalDebits: totalDebitsCents / 100,
  };
}

/**
 * Check if a user has sufficient balance for a given amount.
 */
export function hasSufficientBalance(db, userId, amount) {
  const { balance } = getBalance(db, userId);
  return balance >= amount;
}

/**
 * Get balances for multiple users at once (admin dashboard).
 */
export function getBalances(db, userIds) {
  const results = {};
  for (const userId of userIds) {
    results[userId] = getBalance(db, userId);
  }
  return results;
}

/**
 * Get the platform account balance.
 */
export function getPlatformBalance(db, platformAccountId) {
  return getBalance(db, platformAccountId);
}

/**
 * Get a comprehensive balance summary including all account types.
 * Covers user wallets, emergent accounts, and platform accounts.
 * @param {object} db
 * @returns {{ users: object, emergents: object, platform: object, total: object }}
 */
export function getSystemBalanceSummary(db) {
  const allAccounts = db.prepare(`
    SELECT DISTINCT to_user_id as account_id FROM economy_ledger WHERE to_user_id IS NOT NULL
    UNION
    SELECT DISTINCT from_user_id as account_id FROM economy_ledger WHERE from_user_id IS NOT NULL
  `).all();

  let totalUserBalance = 0;
  let totalEmergentBalance = 0;
  let totalPlatformBalance = 0;
  let userCount = 0;
  let emergentCount = 0;

  for (const { account_id } of allAccounts) {
    if (!account_id) continue;
    const { balance } = getBalance(db, account_id);
    if (balance <= 0) continue;

    if (account_id.startsWith("emergent_op:") || account_id.startsWith("emergent_res:")) {
      totalEmergentBalance += balance;
      emergentCount++;
    } else if (account_id.startsWith("__")) {
      totalPlatformBalance += balance;
    } else {
      totalUserBalance += balance;
      userCount++;
    }
  }

  return {
    users: {
      count: userCount,
      totalBalance: Math.round(totalUserBalance * 100) / 100,
    },
    emergents: {
      count: emergentCount,
      totalBalance: Math.round(totalEmergentBalance * 100) / 100,
    },
    platform: {
      totalBalance: Math.round(totalPlatformBalance * 100) / 100,
    },
    total: {
      circulatingBalance: Math.round((totalUserBalance + totalEmergentBalance + totalPlatformBalance) * 100) / 100,
    },
  };
}
