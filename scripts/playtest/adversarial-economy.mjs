// scripts/playtest/adversarial-economy.mjs
//
// Axis B — the exploit gate. Emergent + UGC + royalties = gaming's richest
// exploit surface. Pure economic-invariant checks over a ledger/wallet snapshot
// + an adversarial driver runner whose job is to TRY to break it (dupe loops,
// an accidental one-shot move, royalty gaming, market manipulation).

/**
 * Assert the constitutional economic invariants over a snapshot. Returns the
 * list of violations (empty = sound).
 * @param {object} s {
 *   wallets: [{user_id, balance}],
 *   royaltySplits: [{saleId, total, parts:[amount...]}],   // each sale's payout
 *   citations: [{child_id, parent_id}],                    // edges (dupes = exploit)
 *   maxRoyaltyRate?: number (default 0.30)
 * }
 */
export function checkEconomicInvariants(s = {}) {
  const v = [];
  const maxRate = s.maxRoyaltyRate ?? 0.30;

  for (const w of s.wallets || []) {
    if (Number(w.balance) < 0) v.push({ kind: "negative_balance", subject: w.user_id, balance: w.balance });
  }

  for (const sale of s.royaltySplits || []) {
    const sum = (sale.parts || []).reduce((a, b) => a + Number(b || 0), 0);
    if (sum - Number(sale.total) > 1e-6) {
      v.push({ kind: "overpaid_split", subject: sale.saleId, total: sale.total, paid: sum });
    }
    const ancestorShare = (sale.parts || []).slice(1).reduce((a, b) => a + Number(b || 0), 0);
    if (ancestorShare - Number(sale.total) * maxRate > 1e-6) {
      v.push({ kind: "royalty_cap_breached", subject: sale.saleId, ancestorShare, cap: sale.total * maxRate });
    }
  }

  const seen = new Set();
  for (const c of s.citations || []) {
    const key = `${c.child_id}:${c.parent_id}`;
    if (seen.has(key)) v.push({ kind: "dupe_citation", subject: key });
    seen.add(key);
  }

  return v;
}

/** The gate predicate. */
export function economySound(snapshot) { return checkEconomicInvariants(snapshot).length === 0; }

/**
 * Live adversarial runner: execute a set of attack functions against the driver,
 * then snapshot + check invariants. Each attack returns a label; any invariant
 * violation after the attacks = a real exploit.
 */
export async function runAdversarialEconomy({ driver, attacks = [], snapshotEconomy } = {}) {
  if (!driver || typeof snapshotEconomy !== "function") return { ok: false, reason: "need_driver_and_snapshot" };
  const attempted = [];
  for (const attack of attacks) {
    try { attempted.push(await attack(driver)); } catch (e) { attempted.push({ error: e?.message }); }
  }
  const violations = checkEconomicInvariants(await snapshotEconomy(driver));
  return { ok: violations.length === 0, violations, attempted };
}
