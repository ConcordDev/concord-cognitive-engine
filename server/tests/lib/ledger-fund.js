// tests/lib/ledger-fund.js — fund a test account the way real money arrives.
//
// Concord Coin balances live on economy_ledger (the wallet UI, Stripe coin
// purchases and every creditWallet/debitWallet bridge use it; server.js
// getWallet keeps its in-memory cache in step with it). A test that needs a
// buyer with N CC sets the LEDGER balance to exactly N with one
// TOKEN_PURCHASE credit (or a TRANSFER debit to trim) written through the
// sanctioned ledger writer (economy/ledger.js recordTransaction), never by
// writing the in-memory wallet map, which would be money that does not exist.
import { recordTransaction } from "../../economy/ledger.js";
import { getBalance } from "../../economy/balances.js";

export function setLedgerBalance(db, userId, amount) {
  if (!db) throw new Error("setLedgerBalance needs the real database");
  const current = getBalance(db, userId).balance;
  const delta = Math.round((Number(amount) - current) * 100) / 100;
  if (delta === 0) return current;
  const credit = delta > 0;
  recordTransaction(db, {
    type: credit ? "TOKEN_PURCHASE" : "TRANSFER",
    from: credit ? null : userId,
    to: credit ? userId : null,
    amount: Math.abs(delta),
    fee: 0,
    net: Math.abs(delta),
    metadata: { source: "test_fund" },
  });
  return getBalance(db, userId).balance;
}
