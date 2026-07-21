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

  useEffect(() => {
    refreshBalance();
    const id = window.setInterval(refreshBalance, 30_000);
    return () => window.clearInterval(id);
  }, [refreshBalance]);

  useEffect(() => {
    const offPurchase = subscribe<{ price: number }>('marketplace:purchase', () => refreshBalance());
    const offSale = subscribe<{ earnings: number }>('marketplace:sale', () => refreshBalance());
    return () => { offPurchase(); offSale(); };
  }, [refreshBalance]);

  return balance;
}
