/**
 * Ledger rows store a positive amount. Direction is who paid.
 * A viewer who is from_user_id spent the coins. A viewer who is
 * to_user_id received them. Without a viewer id the raw amount stays.
 */
export function signedLedgerAmount(
  tx: {
    amount?: number | null;
    from_user_id?: string | null;
    to_user_id?: string | null;
    from?: string | null;
    to?: string | null;
  },
  viewerId?: string | null,
): number {
  const raw = Number(tx.amount);
  if (!Number.isFinite(raw)) return 0;
  if (!viewerId) return raw;
  const magnitude = Math.abs(raw);
  const from = tx.from_user_id || tx.from || '';
  const to = tx.to_user_id || tx.to || '';
  if (from && from === viewerId) return -magnitude;
  if (to && to === viewerId) return magnitude;
  return raw;
}
