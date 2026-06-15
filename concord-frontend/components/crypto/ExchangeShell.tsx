'use client';

/**
 * ExchangeShell — a wallet-chrome sidebar chrome.
 *
 * Left rail: Portfolio / Watchlist / Recurring / Staking / NFTs /
 * Activity / Tax / Insights / Wallet (existing approvals + addressbook
 * + swap panels live here).
 */

import React from 'react';
import { Wallet, Eye, Repeat, Coins, ImageIcon, Activity, Receipt, Sparkles, Bell, Send, CandlestickChart, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CryptoNav =
  | 'portfolio'
  | 'trade'
  | 'market'
  | 'watchlist'
  | 'recurring'
  | 'staking'
  | 'nfts'
  | 'activity'
  | 'tax'
  | 'insights'
  | 'alerts'
  | 'wallet';

interface NavItem { id: CryptoNav; label: string; icon: typeof Wallet; badge?: number | string }

const NAV: NavItem[] = [
  { id: 'portfolio', label: 'Portfolio', icon: Wallet },
  { id: 'trade',     label: 'Trade', icon: CandlestickChart },
  { id: 'market',    label: 'Market', icon: Globe },
  { id: 'watchlist', label: 'Watchlist', icon: Eye },
  { id: 'recurring', label: 'Recurring (DCA)', icon: Repeat },
  { id: 'staking',   label: 'Staking', icon: Coins },
  { id: 'nfts',      label: 'NFTs', icon: ImageIcon },
  { id: 'activity',  label: 'Activity', icon: Activity },
  { id: 'tax',       label: 'Tax', icon: Receipt },
  { id: 'insights',  label: 'AI Insights', icon: Sparkles },
  { id: 'alerts',    label: 'Price alerts', icon: Bell },
  { id: 'wallet',    label: 'Wallets & Send', icon: Send },
];

export interface ExchangeShellProps {
  activeNav: CryptoNav;
  onNavChange: (n: CryptoNav) => void;
  badges?: Partial<Record<CryptoNav, number | string>>;
  totalValueUsd?: number;
  unrealizedPnlPct?: number;
  children: React.ReactNode;
}

export function ExchangeShell({ activeNav, onNavChange, badges = {}, totalValueUsd, unrealizedPnlPct, children }: ExchangeShellProps) {
  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[640px] bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
      <aside className="w-48 bg-[#0a0c10] border-r border-white/5 flex flex-col flex-shrink-0">
        <header className="px-3 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-semibold text-gray-200">Portfolio</span>
          </div>
          {totalValueUsd !== undefined && (
            <div className="mt-1">
              <div className="text-base font-mono text-white">${totalValueUsd.toLocaleString()}</div>
              {unrealizedPnlPct !== undefined && (
                <div className={cn('text-[10px] font-mono', unrealizedPnlPct >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                  {unrealizedPnlPct >= 0 ? '+' : ''}{unrealizedPnlPct.toFixed(2)}% unrealized
                </div>
              )}
            </div>
          )}
        </header>
        <nav className="flex-1 overflow-y-auto py-2">
          <ul>
            {NAV.map(n => {
              const Icon = n.icon;
              const active = activeNav === n.id;
              const badge = badges[n.id];
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onNavChange(n.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                      active ? 'bg-blue-500/10 text-blue-200 border-l-2 border-blue-400' : 'text-gray-400 hover:text-white hover:bg-white/[0.04] border-l-2 border-transparent',
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="truncate flex-1 text-left">{n.label}</span>
                    {badge !== undefined && badge !== 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-500/20 text-blue-300 font-mono">{badge}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-4">{children}</main>
    </div>
  );
}

export default ExchangeShell;
