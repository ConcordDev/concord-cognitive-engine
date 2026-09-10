'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ArrowDownToLine, History, Loader2, X as XIcon } from 'lucide-react';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { DensityToggle } from '@/components/ui/DensityToggle';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { WalletTxDetail } from './WalletTxDetail';
import { WalletTxRow } from './WalletTxRow';
import {
  flattenHistoryPages,
  useWalletBalance,
  useWalletHistory,
  useWalletWithdrawals,
} from './useWalletQueries';
import { TRANSACTION_TABS, type TxFilterId, type WalletPanelProps, type WalletTransaction } from './wallet-model';

export function WalletActivityPanel(_props: WalletPanelProps) {
  const [filter, setFilter] = useState<TxFilterId>('all');
  const [txQuery, setTxQuery] = useState('');
  const [activeTx, setActiveTx] = useState<WalletTransaction | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { data: balanceData } = useWalletBalance();
  const { data: withdrawalsData } = useWalletWithdrawals();
  const {
    data: txPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useWalletHistory(filter);

  const transactions = flattenHistoryPages(txPages?.pages);
  const visible = useMemo(() => {
    const q = txQuery.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter((tx) => {
      const haystack = [
        tx.type,
        tx.description,
        tx.from,
        tx.to,
        tx.status,
        tx.amount?.toString(),
        tx.fee?.toString(),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [transactions, txQuery]);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect();
      if (!node) return;
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
        },
        { threshold: 0.1 },
      );
      observerRef.current.observe(node);
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  const exportCsv = useCallback(() => {
    if (!visible.length) return;
    const headers = ['id', 'type', 'amount', 'fee', 'net', 'description', 'from', 'to', 'status', 'created_at'];
    const escape = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = visible.map((tx) =>
      headers.map((h) => escape((tx as unknown as Record<string, unknown>)[h])).join(','),
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wallet-${filter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [visible, filter]);

  const balance = balanceData?.balance ?? balanceData?.tokens ?? 0;
  const withdrawals = withdrawalsData?.withdrawals || withdrawalsData?.items || [];

  return (
    <div className={cn(ds.panel, 'p-0')}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h2 className={ds.heading3}>Activity</h2>
        <DensityToggle variant="dropdown" showLabels={false} />
      </div>
      <div className="flex gap-1 border-b border-lattice-border px-4 pt-2 flex-wrap" role="tablist">
        {TRANSACTION_TABS.map((tab) => {
          const isActive = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setFilter(tab.id)}
              className={cn(
                'px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
                isActive
                  ? 'text-[var(--lens-accent)] border-[var(--lens-accent)]'
                  : 'text-gray-400 border-transparent hover:text-white hover:border-gray-600',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {filter === 'withdrawal' && (
        <div className="px-4 pt-4">
          <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border mb-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Recent withdrawals</p>
            <div className="space-y-2">
              {withdrawals.slice(0, 5).map((w) => (
                <div key={w.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <ArrowDownToLine className="w-3.5 h-3.5 text-amber-400" />
                    <span className="font-mono text-white">{w.amount.toLocaleString()} CC</span>
                    {w.fee > 0 && <span className="text-xs text-gray-400">(fee: {w.fee})</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-xs px-1.5 py-0.5 rounded',
                        w.status === 'complete' || w.status === 'completed'
                          ? 'bg-[var(--lens-accent)]/10 text-[var(--lens-accent)]'
                          : 'bg-amber-500/10 text-amber-400',
                      )}
                    >
                      {w.status}
                    </span>
                    <span className="text-xs text-gray-400">{new Date(w.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
              {withdrawals.length === 0 && <p className="text-xs text-gray-400">No withdrawals found</p>}
            </div>
          </div>
        </div>
      )}

      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <input
              ref={searchRef}
              type="text"
              value={txQuery}
              onChange={(e) => setTxQuery(e.target.value)}
              placeholder="Search type, description, address, amount…"
              className="w-full pl-3 pr-8 py-1.5 text-sm bg-lattice-deep border border-lattice-border rounded text-white placeholder-gray-500 focus:outline-none focus:border-[var(--lens-accent)]/50"
              aria-label="Search transactions"
            />
            {txQuery && (
              <button
                type="button"
                onClick={() => setTxQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-lattice-elevated text-gray-400 hover:text-white"
                aria-label="Clear search"
              >
                <XIcon className="w-3 h-3" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={visible.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-lattice-border text-gray-300 hover:bg-lattice-elevated hover:text-white disabled:opacity-40"
            title="Download visible transactions as CSV"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            CSV
          </button>
          <DTUExportButton
            domain="wallet"
            data={{
              balance,
              totalCredits: balanceData?.totalCredits,
              totalDebits: balanceData?.totalDebits,
              transactions: visible,
            }}
            title="Wallet snapshot"
            tags={['wallet', 'economy', 'export']}
            compact
          />
          {txQuery && (
            <span className="text-[10px] text-gray-400 whitespace-nowrap">
              {visible.length} of {transactions.length}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} variant="block" height={56} />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={<History className="w-8 h-8" />}
            title="No transactions found"
            description={
              filter !== 'all'
                ? 'Try the All filter to see every ledger row.'
                : 'Your transaction history will appear here.'
            }
            compact
          />
        ) : visible.length === 0 ? (
          <EmptyState title={`No transactions match “${txQuery}”`} compact />
        ) : (
          <div className="space-y-1">
            {visible.map((tx, i) => (
              <button
                key={tx.id || i}
                type="button"
                onClick={() => setActiveTx(tx)}
                className="w-full text-left rounded-lg hover:bg-lattice-elevated/40 transition-colors"
                aria-label="Transaction row"
              >
                <WalletTxRow tx={tx} />
              </button>
            ))}
            {hasNextPage && !txQuery && (
              <div ref={loadMoreRef} className="py-4 text-center">
                {isFetchingNextPage ? (
                  <Loader2 className="w-5 h-5 mx-auto animate-spin" style={{ color: 'var(--lens-secondary)' }} />
                ) : (
                  <span className="text-xs text-gray-400">Scroll for more</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {activeTx && <WalletTxDetail tx={activeTx} onClose={() => setActiveTx(null)} />}
      </AnimatePresence>
    </div>
  );
}
