'use client';

/**
 * Shared live-wallet-balance source. Extracted from CurrencyHUD so its data
 * fetching (poll /api/economy/balance every 30s + bump on real marketplace
 * socket events) can be reused by other HUD surfaces without either
 * duplicating the poll loop or, worse, hardcoding a fake balance — see
 * HUDOverlay's currency prop at app/lenses/world/page.tsx, which used to
 * pass a literal `{ concordCoin: 0 }` regardless of the player's real CC.
 */

import { useEffect, useState, useCallback } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { useSmartPolling } from '@/hooks/useSmartPolling';

interface BalanceResponse { ok: boolean; balance?: number; concordCoins?: number }

export function useWalletBalance() {
  const [balance, setBalance] = useState<number>(0);

  const refreshBalance = useCallback(async () => {
    try {
      const r = await fetch('/api/economy/balance', { credentials: 'include' });
      if (!r.ok) return;
      const data = (await r.json()) as BalanceResponse;
      setBalance(data.balance ?? data.concordCoins ?? 0);
    } catch { /* network silent — keep last known balance */ }
  }, []);

  // Audit fix (2026-07-27): pauses while the tab is hidden instead of
  // polling the wallet balance every 30s in the background — this HUD is
  // mounted for the entire time a player is in the world lens.
  useSmartPolling(refreshBalance, 30_000);

  useEffect(() => {
    const offPurchase = subscribe<{ price: number }>('marketplace:purchase', () => refreshBalance());
    const offSale = subscribe<{ earnings: number }>('marketplace:sale', () => refreshBalance());
    return () => { offPurchase(); offSale(); };
  }, [refreshBalance]);

  return balance;
}
