'use client';

/**
 * CurrencyHUD
 *
 * Persistent top-bar showing the player's CC balance + skill level summary.
 * Polls /api/economy/balance every 30s; bumps on socket events for live
 * delta. Click → opens the wallet panel.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { Coins, TrendingUp, Award } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';
import { useWalletBalance } from '@/hooks/useWalletBalance';

interface CurrencyHUDProps {
  onClick?: () => void;
}

export default function CurrencyHUD({ onClick }: CurrencyHUDProps) {
  const balance = useWalletBalance();
  const [delta, setDelta] = useState<number | null>(null);
  const [skillCount, setSkillCount] = useState<number>(0);
  const [badges, setBadges] = useState<number>(0);

  // Surface the balance delta as a brief +/- pulse, same UX as before the
  // fetch loop moved into the shared useWalletBalance hook.
  const prevBalanceRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevBalanceRef.current;
    if (prev !== null && prev !== 0 && balance !== prev) {
      setDelta(balance - prev);
      const t = setTimeout(() => setDelta(null), 2500);
      prevBalanceRef.current = balance;
      return () => clearTimeout(t);
    }
    prevBalanceRef.current = balance;
  }, [balance]);

  const refreshSummary = useCallback(async () => {
    try {
      const r = await fetch('/api/creator/dashboard', { credentials: 'include' });
      if (!r.ok) return;
      const data = await r.json();
      setSkillCount(data?.summary?.dtuCount ?? 0);
    } catch { /* silent */ }
    try {
      const r2 = await fetch('/api/creator/badges', { credentials: 'include' });
      if (!r2.ok) return;
      const data = await r2.json();
      setBadges((data?.badges ?? []).length);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refreshSummary();
    const id = window.setInterval(refreshSummary, 30_000);
    return () => window.clearInterval(id);
  }, [refreshSummary]);

  // Balance itself refreshes via useWalletBalance (poll + marketplace:*
  // socket bump); this component only needs to bump the skill/badge
  // summary on its own event.
  useEffect(() => {
    const offBadge = subscribe<unknown>('reputation:badge-earned', () => refreshSummary());
    return () => { offBadge(); };
  }, [refreshSummary]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-black/80 backdrop-blur-sm border border-amber-500/30 rounded-full pl-3 pr-4 py-1.5 hover:border-amber-400/60 transition-colors pointer-events-auto"
      aria-label="Open wallet"
    >
      <span className="flex items-center gap-1.5">
        <Coins className="w-4 h-4 text-amber-400" />
        <span className="font-mono text-amber-200 text-sm">{balance.toLocaleString()}</span>
        {delta !== null && (
          <span className={`font-mono text-xs animate-pulse ${delta > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {delta > 0 ? '+' : ''}{delta}
          </span>
        )}
      </span>
      <span className="w-px h-4 bg-white/10" />
      <span className="flex items-center gap-1.5">
        <TrendingUp className="w-4 h-4 text-cyan-400" />
        <span className="font-mono text-cyan-200 text-sm">{skillCount}</span>
      </span>
      <span className="w-px h-4 bg-white/10" />
      <span className="flex items-center gap-1.5">
        <Award className="w-4 h-4 text-violet-400" />
        <span className="font-mono text-violet-200 text-sm">{badges}</span>
      </span>
    </button>
  );
}
