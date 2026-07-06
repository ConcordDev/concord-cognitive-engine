// server/lib/currency.js
// Dual-currency helpers. Sparks = gameplay-only, no real-world value.
// CC (concordia_credits) = real money equivalent, NEVER awarded by gameplay.

import crypto from "crypto";

/**
 * Award Sparks to a player for a gameplay action.
 * Returns the new Sparks balance.
 */
export function awardSparks(db, userId, amount, reason, worldId = null) {
  if (!userId || amount <= 0) return 0;
  const id = crypto.randomUUID();
  // Money-hygiene fix (verification-audit campaign): the balance UPDATE and
  // the sparks_ledger INSERT must land together — every caller of this
  // function (not just transferSparks) gets the atomicity guarantee, since
  // better-sqlite3 nests transactions via savepoints when a caller (e.g.
  // transferSparks below) wraps its own transaction() around this one.
  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET sparks = sparks + ? WHERE id = ?`).run(amount, userId);
    db.prepare(`
      INSERT INTO sparks_ledger (id, user_id, delta, reason, world_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, amount, reason, worldId);
  });
  tx();
  const row = db.prepare(`SELECT sparks FROM users WHERE id = ?`).get(userId);
  return row?.sparks ?? 0;
}

/**
 * Spend Sparks. Throws if insufficient balance.
 * Returns new balance.
 */
export function spendSparks(db, userId, amount, reason, worldId = null) {
  if (!userId || amount <= 0) return 0;
  const row = db.prepare(`SELECT sparks FROM users WHERE id = ?`).get(userId);
  if (!row) throw new Error("user_not_found");
  if (row.sparks < amount) throw new Error("insufficient_sparks");

  const id = crypto.randomUUID();
  // Money-hygiene fix (verification-audit campaign): see awardSparks above.
  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET sparks = sparks - ? WHERE id = ?`).run(amount, userId);
    db.prepare(`
      INSERT INTO sparks_ledger (id, user_id, delta, reason, world_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, -amount, reason, worldId);
  });
  tx();

  const updated = db.prepare(`SELECT sparks FROM users WHERE id = ?`).get(userId);
  return updated?.sparks ?? 0;
}

/**
 * Get both balances for a user.
 */
export function getBalances(db, userId) {
  const row = db.prepare(`SELECT sparks, concordia_credits FROM users WHERE id = ?`).get(userId);
  return { sparks: row?.sparks ?? 0, concordiaCredits: row?.concordia_credits ?? 0 };
}

/**
 * Transfer Sparks between two players (inventory trade, robbery, etc.).
 * Caller must validate consent rules before calling.
 */
export function transferSparks(db, fromUserId, toUserId, amount, reason) {
  // Money-hygiene fix (verification-audit campaign): spendSparks and
  // awardSparks are each individually atomic (see above), but without this
  // outer wrap a crash between the two calls could still destroy Sparks —
  // the sender's spend already committed, the recipient's award never ran.
  // better-sqlite3 nests this transaction via a savepoint around each
  // delegate's own transaction() call.
  const tx = db.transaction(() => {
    spendSparks(db, fromUserId, amount, `transfer_out:${reason}`);
    awardSparks(db, toUserId, amount, `transfer_in:${reason}`);
  });
  tx();
}
