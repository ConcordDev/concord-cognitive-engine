'use client';

import type { ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowDownToLine,
  ArrowUpRight,
  Award,
  BarChart3,
  Coins,
  CreditCard,
  DollarSign,
  Gift,
  Repeat,
  Sparkles,
  Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTxType, type WalletTransaction } from './wallet-model';

const TYPE_ICONS: Record<string, ReactNode> = {
  purchase: <CreditCard className="w-4 h-4 text-gray-300" />,
  tip: <Gift className="w-4 h-4 text-gray-300" />,
  withdrawal: <ArrowDownToLine className="w-4 h-4 text-gray-300" />,
  earning: <Award className="w-4 h-4 text-gray-300" />,
  reward: <Sparkles className="w-4 h-4 text-gray-300" />,
  credit: <ArrowDownRight className="w-4 h-4" style={{ color: 'var(--lens-accent)' }} />,
  debit: <ArrowUpRight className="w-4 h-4 text-red-400" />,
  transfer: <Repeat className="w-4 h-4 text-gray-300" />,
  bounty: <Target className="w-4 h-4 text-gray-300" />,
  sale: <DollarSign className="w-4 h-4" style={{ color: 'var(--lens-accent)' }} />,
  fee: <BarChart3 className="w-4 h-4 text-gray-400" />,
};

const STATUS_COLORS: Record<string, string> = {
  complete: 'text-[var(--lens-accent)]',
  completed: 'text-[var(--lens-accent)]',
  pending: 'text-amber-400',
  processing: 'text-[var(--lens-secondary)]',
  failed: 'text-red-400',
  reversed: 'text-gray-400',
  canceled: 'text-gray-400',
};

export function WalletTxRow({ tx }: { tx: WalletTransaction }) {
  const isPositive = tx.amount > 0;
  const dateStr = tx.created_at || tx.timestamp || '';
  const date = dateStr ? new Date(dateStr) : null;

  return (
    <div className="flex items-center gap-3 px-3 py-3 rounded-lg group">
      <div className="flex-shrink-0 p-2 rounded-lg bg-lattice-deep border border-lattice-border">
        {TYPE_ICONS[tx.type] || <Coins className="w-4 h-4 text-gray-400" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white truncate">{tx.description || formatTxType(tx.type)}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {date && (
            <span className="text-xs text-gray-400">
              {date.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
              })}{' '}
              {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {tx.status && (
            <span className={cn('text-xs capitalize', STATUS_COLORS[tx.status] || 'text-gray-400')}>
              {tx.status}
            </span>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <span
          className={cn(
            'text-sm font-mono font-medium tabular-nums',
            isPositive ? 'text-[var(--lens-accent)]' : 'text-red-400',
          )}
        >
          {isPositive ? '+' : ''}
          {tx.amount.toLocaleString()} CC
        </span>
        {tx.fee && tx.fee > 0 && (
          <p className="text-xs text-gray-400 font-mono">fee: {tx.fee.toLocaleString()}</p>
        )}
      </div>
    </div>
  );
}
