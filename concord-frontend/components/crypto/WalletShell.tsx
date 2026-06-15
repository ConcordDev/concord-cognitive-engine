'use client';

/**
 * WalletShell — a wallet surface.
 *
 * Big balance up top with hide/show, send/receive/swap action triple,
 * portfolio breakdown by asset, transaction history rail. Drop-in for
 * /lenses/crypto + any wallet-shaped lens. Numbers/assets passed in as
 * props so the caller controls the data; the visual silhouette is
 * what makes the lens feel like a wallet on first glance.
 */

import React, { useState } from 'react';
import { Eye, EyeOff, ArrowUpRight, ArrowDownLeft, Repeat, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WalletAsset {
  id: string;
  symbol: string;
  name: string;
  amount: number;
  fiatValue: number;
  changePct?: number;
  iconUrl?: string;
}

export interface WalletTx {
  id: string;
  kind: 'send' | 'receive' | 'swap' | 'reward' | 'fee';
  asset: string;
  amount: number;
  fiatValue?: number;
  counterparty?: string;
  timestamp: string;
  status?: 'pending' | 'confirmed' | 'failed';
}

export interface WalletShellProps {
  totalFiat: number;
  totalDeltaPct?: number;
  assets: WalletAsset[];
  txs: WalletTx[];
  fiatSymbol?: string;
  onSend?: () => void;
  onReceive?: () => void;
  onSwap?: () => void;
  onSelectAsset?: (asset: WalletAsset) => void;
  className?: string;
}

function fmt(n: number, sym = '$'): string {
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function WalletShell({
  totalFiat,
  totalDeltaPct,
  assets,
  txs,
  fiatSymbol = '$',
  onSend,
  onReceive,
  onSwap,
  onSelectAsset,
  className,
}: WalletShellProps) {
  const [hidden, setHidden] = useState(false);
  return (
    <div className={cn('flex flex-col gap-4 p-5 bg-[#0d0e12] text-gray-100', className)}>
      {/* Big balance */}
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-gray-400">Portfolio value</span>
          <button
            type="button"
            onClick={() => setHidden((v) => !v)}
            aria-pressed={hidden}
            className="text-gray-400 hover:text-gray-300"
            title={hidden ? 'Show balance' : 'Hide balance'}
          >
            {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-5xl font-mono font-semibold text-white tabular-nums">
            {hidden ? '••••••' : fmt(totalFiat, fiatSymbol)}
          </span>
          {totalDeltaPct !== undefined && !hidden && (
            <span
              className={cn(
                'text-sm font-mono tabular-nums',
                totalDeltaPct > 0 ? 'text-emerald-300' : totalDeltaPct < 0 ? 'text-rose-300' : 'text-gray-400'
              )}
            >
              {totalDeltaPct > 0 ? '+' : ''}{totalDeltaPct.toFixed(2)}% 24h
            </span>
          )}
        </div>
      </header>

      {/* Action triple */}
      <div className="grid grid-cols-3 gap-2">
        <ActionTile icon={ArrowUpRight} label="Send" onClick={onSend} />
        <ActionTile icon={ArrowDownLeft} label="Receive" onClick={onReceive} />
        <ActionTile icon={Repeat} label="Swap" onClick={onSwap} />
      </div>

      {/* Assets */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Assets</h2>
        <ul className="space-y-1">
          {assets.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onSelectAsset?.(a)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-white/5 text-left"
              >
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-mono text-gray-300">
                  {a.symbol.slice(0, 3)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{a.name}</div>
                  <div className="text-[11px] text-gray-400 font-mono">
                    {hidden ? '••••' : a.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} {a.symbol}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono tabular-nums text-white">
                    {hidden ? '••••' : fmt(a.fiatValue, fiatSymbol)}
                  </div>
                  {a.changePct !== undefined && !hidden && (
                    <div
                      className={cn(
                        'text-[11px] font-mono tabular-nums',
                        a.changePct > 0 ? 'text-emerald-300' : a.changePct < 0 ? 'text-rose-300' : 'text-gray-400'
                      )}
                    >
                      {a.changePct > 0 ? '+' : ''}{a.changePct.toFixed(2)}%
                    </div>
                  )}
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Transactions */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Recent activity</h2>
        {txs.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No transactions yet.</p>
        ) : (
          <ul className="space-y-1">
            {txs.slice(0, 12).map((tx) => (
              <li
                key={tx.id}
                className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-white/5"
              >
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center',
                  tx.kind === 'send' ? 'bg-rose-500/20 text-rose-300'
                    : tx.kind === 'receive' ? 'bg-emerald-500/20 text-emerald-300'
                    : tx.kind === 'swap' ? 'bg-violet-500/20 text-violet-300'
                    : tx.kind === 'reward' ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-gray-500/20 text-gray-400'
                )}>
                  {tx.kind === 'send' ? <ArrowUpRight className="w-4 h-4" />
                    : tx.kind === 'receive' ? <ArrowDownLeft className="w-4 h-4" />
                    : tx.kind === 'swap' ? <Repeat className="w-4 h-4" />
                    : '·'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate capitalize">
                    {tx.kind} {tx.asset}
                  </div>
                  <div className="text-[11px] text-gray-400 truncate">
                    {tx.counterparty ?? '—'} · {new Date(tx.timestamp).toLocaleString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn(
                    'text-sm font-mono tabular-nums',
                    tx.kind === 'send' || tx.kind === 'fee' ? 'text-rose-300' : 'text-emerald-300'
                  )}>
                    {tx.kind === 'send' || tx.kind === 'fee' ? '-' : '+'}{tx.amount}
                  </div>
                  {tx.fiatValue !== undefined && !hidden && (
                    <div className="text-[11px] text-gray-400 font-mono">
                      {fmt(tx.fiatValue, fiatSymbol)}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface ActionTileProps {
  icon: typeof ArrowUpRight;
  label: string;
  onClick?: () => void;
}

function ActionTile({ icon: Icon, label, onClick }: ActionTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 flex flex-col items-center gap-1.5 text-sm font-medium text-white hover:bg-white/10 hover:border-white/20 transition"
    >
      <Icon className="w-5 h-5 text-cyan-300" aria-hidden="true" />
      {label}
    </button>
  );
}

export default WalletShell;
